# zml_w/zml_review_nodes.py

import torch
import numpy as np
from PIL import Image, ImageDraw
import os
try:
    from ultralytics import YOLO
except ImportError:
    print("Warning: ultralytics is not installed. ZML_AutoCensorNode will not work without it.")
import folder_paths
import logging
from contextlib import contextmanager
import cv2

# --- 兼容模式加载器 ---
@contextmanager
def force_compatibility_mode():
    original_load = torch.load
    try:
        def compatibility_load(*args, **kwargs):
            kwargs['weights_only'] = False
            return original_load(*args, **kwargs)
        torch.load = compatibility_load
        yield
    finally:
        torch.load = original_load

# ==========================================================================================
# 节点 1: ZML_自动打码
# ==========================================================================================
class ZML_AutoCensorNode:
    def __init__(self):
        # 初始化计数器文件路径
        self.node_dir = os.path.dirname(os.path.abspath(__file__))
        self.counter_dir = os.path.join(self.node_dir, "counter")
        os.makedirs(self.counter_dir, exist_ok=True)
        self.counter_file = os.path.join(self.counter_dir, "review.txt")
        self.ensure_counter_file()

    def ensure_counter_file(self):
        """确保计数器文件存在，如果不存在则创建并初始化为0"""
        if not os.path.exists(self.counter_file):
            with open(self.counter_file, "w", encoding="utf-8") as f:
                f.write("0")

    def increment_and_get_help_text(self):
        """读取、增加并返回计数器的值和格式化的帮助文本"""
        count = 0
        try:
            with open(self.counter_file, "r+", encoding="utf-8") as f:
                content = f.read().strip()
                if content.isdigit():
                    count = int(content)
                count += 1
                f.seek(0)
                f.write(str(count))
                f.truncate()
        except Exception as e:
            print(f"更新审核节点计数失败: {e}")
            count = 1  # 如果失败则从1开始
        return f"你好，欢迎使用ZML节点~到目前为止，你通过此节点总共处理了{count}次！！"

    @classmethod
    def INPUT_TYPES(cls):
        # [修改] START: 使用 try-except 块来防止因找不到 'ultralytics' 路径而崩溃
        try:
            model_list = folder_paths.get_filename_list("ultralytics") or []
        except KeyError:
            model_list = []
            print("[ZML_AutoCensorNode] Warning: 'ultralytics' model folder not found or not configured in extra_model_paths.yaml. The node will load, but no models will be available.")
        # [修改] END
        
        return {
            "required": {
                "原始图像": ("IMAGE",),
                "YOLO模型": (model_list,),
                "置信度阈值": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.01}),
                "覆盖模式": (["图像", "马赛克"],),
                "拉伸图像": (["关闭", "启用"], {"default": "关闭"}),
                "马赛克数量": ("INT", {"default": 5, "min": 1, "max": 256, "step": 1}),
                "遮罩缩放系数": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 5.0, "step": 0.05}),
                "遮罩膨胀": ("INT", {"default": 0, "min": 0, "max": 128, "step": 1}),
            },
            "optional": { "覆盖图": ("IMAGE",), }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "STRING")
    RETURN_NAMES = ("处理后图像", "检测遮罩", "Help")
    FUNCTION = "process"
    CATEGORY = "image/ZML_图像/图像"

    def process(self, 原始图像, YOLO模型, 置信度阈值, 覆盖模式, 拉伸图像, 马赛克数量, 遮罩缩放系数, 遮罩膨胀, 覆盖图=None):
        help_text = self.increment_and_get_help_text()

        if not YOLO模型:
            logging.warning("[ZML_自动打码] 未选择YOLO模型或模型列表为空。节点将透传原始图像。")
            _, h, w, _ = 原始图像.shape; empty_mask = torch.zeros((1, h, w), dtype=torch.float32)
            return (原始图像, empty_mask, help_text)
        
        if 覆盖模式 == "图像" and 覆盖图 is None: 覆盖图 = torch.zeros((1, 1, 1, 3), dtype=torch.float32)
        model_path = folder_paths.get_full_path("ultralytics", YOLO模型)
        if not model_path: raise FileNotFoundError(f"模型文件 '{YOLO模型}' 未找到。")
        with force_compatibility_mode(): model = YOLO(model_path)
        
        source_pil = self.tensor_to_pil(原始图像); source_cv2 = cv2.cvtColor(np.array(source_pil), cv2.COLOR_RGB2BGR)
        h, w = source_cv2.shape[:2]
        results = model(source_pil, conf=置信度阈值, verbose=False)
        final_combined_mask = Image.new('L', (w, h), 0)
        
        if len(results[0]) > 0:
            for result in results[0]:
                mask_cv, mask_type = self.get_mask(result, w, h)
                if mask_cv is None: continue
                processed_mask_cv = self.process_mask(mask_cv, 遮罩缩放系数, 遮罩膨胀)
                source_cv2 = self.apply_overlay(source_cv2, processed_mask_cv, 覆盖模式, 覆盖图, 马赛克数量, 拉伸图像, mask_type)
                final_combined_mask.paste(Image.fromarray(processed_mask_cv), (0,0), Image.fromarray(processed_mask_cv))

        final_image_pil = Image.fromarray(cv2.cvtColor(source_cv2, cv2.COLOR_BGR2RGB))
        return (self.pil_to_tensor(final_image_pil), self.pil_to_tensor(final_combined_mask).squeeze(-1), help_text)

    def get_mask(self, result, w, h):
        if hasattr(result, 'masks') and result.masks is not None:
            mask_data = result.masks.data[0].cpu().numpy()
            mask_cv = (cv2.resize(mask_data, (w, h), interpolation=cv2.INTER_NEAREST) * 255).astype(np.uint8)
            return mask_cv, 'segm'
        elif hasattr(result, 'boxes') and result.boxes is not None:
            box = result.boxes.xyxy[0].cpu().numpy().astype(int); mask_cv = np.zeros((h, w), dtype=np.uint8)
            cv2.rectangle(mask_cv, (box[0], box[1]), (box[2], box[3]), 255, -1)
            return mask_cv, 'bbox'
        return None, None

    def process_mask(self, mask_cv, scale, dilation):
        processed_mask = mask_cv.copy()
        if scale != 1.0 and np.any(processed_mask):
            M = cv2.moments(processed_mask)
            if M["m00"] != 0:
                cX = int(M["m10"] / M["m00"]); cY = int(M["m01"] / M["m00"])
                T = cv2.getRotationMatrix2D((cX, cY), 0, scale)
                processed_mask = cv2.warpAffine(processed_mask, T, (processed_mask.shape[1], processed_mask.shape[0]))
        if dilation > 0:
            kernel = np.ones((dilation, dilation), np.uint8)
            processed_mask = cv2.dilate(processed_mask, kernel, iterations=1)
        return processed_mask
        
    def apply_overlay(self, source_cv2, mask_cv, mode, overlay_image_tensor, mosaic_count, stretch_image, mask_type='segm'):
        contours, _ = cv2.findContours(mask_cv, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours: return source_cv2
        all_points = np.concatenate(contours, axis=0); x, y, w, h = cv2.boundingRect(all_points)
        if w == 0 or h == 0: return source_cv2
        roi = source_cv2[y:y+h, x:x+w]; mask_roi = mask_cv[y:y+h, x:x+w]
        
        if mode == "马赛克":
            aspect_ratio = h / w if w > 0 else 1; new_width = mosaic_count; new_height = max(1, int(new_width * aspect_ratio))
            small_roi = cv2.resize(roi, (new_width, new_height), interpolation=cv2.INTER_LINEAR)
            mosaic_roi = cv2.resize(small_roi, (w, h), interpolation=cv2.INTER_NEAREST)
            source_cv2[y:y+h, x:x+w][mask_roi.astype(bool)] = mosaic_roi[mask_roi.astype(bool)]
        
        elif mode == "图像":
            overlay_pil = self.tensor_to_pil(overlay_image_tensor).convert("RGB")
            overlay_cv2_bgr = cv2.cvtColor(np.array(overlay_pil), cv2.COLOR_RGB2BGR)

            if mask_type == 'bbox' and stretch_image == '关闭':
                overlay_h, overlay_w = overlay_cv2_bgr.shape[:2]
                box_aspect = w / h if h > 0 else 1; overlay_aspect = overlay_w / overlay_h if overlay_h > 0 else 1
                if box_aspect > overlay_aspect: new_h = h; new_w = int(overlay_aspect * h)
                else: new_w = w; new_h = int(w / overlay_aspect)
                scaled_overlay = cv2.resize(overlay_cv2_bgr, (new_w, new_h))
                
                canvas = np.zeros((h, w, 3), dtype=np.uint8)
                paste_x = (w - new_w) // 2; paste_y = (h - new_h) // 2
                canvas[paste_y:paste_y+new_h, paste_x:paste_x+new_w] = scaled_overlay
                resized_overlay = canvas
            else:
                resized_overlay = cv2.resize(overlay_cv2_bgr, (w, h))
            
            roi_to_change = source_cv2[y:y+h, x:x+w]
            mask_roi_3d = np.stack([mask_roi]*3, axis=-1)
            np.copyto(roi_to_change, resized_overlay, where=mask_roi_3d.astype(bool))
                
        return source_cv2

    def tensor_to_pil(self, tensor): return Image.fromarray((tensor.squeeze(0).cpu().numpy() * 255).astype(np.uint8))
    def pil_to_tensor(self, pil_image): return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)

# ==========================================================================================
# 节点 2: ZML_自定义打码
# ==========================================================================================
class ZML_CustomCensorNode(ZML_AutoCensorNode):
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "原始图像": ("IMAGE",), "遮罩": ("MASK",),
                "覆盖模式": (["图像", "马赛克"],),
                "马赛克数量": ("INT", {"default": 5, "min": 1, "max": 256, "step": 1}),
                "遮罩缩放系数": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 5.0, "step": 0.05}),
                "遮罩膨胀": ("INT", {"default": 0, "min": 0, "max": 128, "step": 1}),
            },
            "optional": { "覆盖图": ("IMAGE",), }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "STRING")
    RETURN_NAMES = ("处理后图像", "处理后遮罩", "Help")
    
    def process(self, 原始图像, 遮罩, 覆盖模式, 马赛克数量, 遮罩缩放系数, 遮罩膨胀, 覆盖图=None):
        help_text = self.increment_and_get_help_text()
        
        if 覆盖模式 == "图像" and 覆盖图 is None: 覆盖图 = torch.zeros((1, 1, 1, 3), dtype=torch.float32)

        source_pil = self.tensor_to_pil(原始图像)
        source_cv2 = cv2.cvtColor(np.array(source_pil), cv2.COLOR_RGB2BGR)
        mask_cv = (遮罩.squeeze(0).cpu().numpy() * 255).astype(np.uint8)
        
        processed_mask_cv = self.process_mask(mask_cv, 遮罩缩放系数, 遮罩膨胀)
        source_cv2 = self.apply_overlay(source_cv2, processed_mask_cv, 覆盖模式, 覆盖图, 马赛克数量, stretch_image="启用", mask_type='bbox')

        final_image_pil = Image.fromarray(cv2.cvtColor(source_cv2, cv2.COLOR_BGR2RGB))
        processed_mask_tensor = self.pil_to_tensor(Image.fromarray(processed_mask_cv)).squeeze(-1)
        
        return (self.pil_to_tensor(final_image_pil), processed_mask_tensor, help_text)

# ==========================================================================================
# 节点 3: ZML_遮罩分割
# ==========================================================================================
class ZML_MaskSplitNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "宽度": ("INT", {"default": 1024, "min": 1, "max": 8192, "step": 1}),
                "高度": ("INT", {"default": 1024, "min": 1, "max": 8192, "step": 1}),
                "分割比例": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.1}),
                "分割方向": (["竖", "横"],),
            }
        }

    RETURN_TYPES = ("MASK", "MASK", "MASK", "MASK", "MASK")
    RETURN_NAMES = ("遮罩A", "遮罩B", "单独遮罩A", "单独遮罩B", "完整遮罩")
    FUNCTION = "process"
    CATEGORY = "image/ZML_图像/图像"

    def process(self, 宽度, 高度, 分割比例, 分割方向):
        # 创建基于完整尺寸的遮罩(黑底)
        mask_a_np = np.zeros((高度, 宽度), dtype=np.float32)
        mask_b_np = np.zeros((高度, 宽度), dtype=np.float32)
        
        # 创建完整的纯白遮罩
        complete_mask_np = np.ones((高度, 宽度), dtype=np.float32)

        if 分割方向 == "竖":
            split_w = int(宽度 * 分割比例)
            rest_w = 宽度 - split_w
            
            mask_a_np[:, :split_w] = 1.0
            mask_b_np[:, split_w:] = 1.0

            # 创建纯遮罩（无黑底，实际分割尺寸）
            standalone_mask_a_np = np.ones((高度, split_w), dtype=np.float32)
            standalone_mask_b_np = np.ones((高度, rest_w), dtype=np.float32)
        else:  # "横"
            split_h = int(高度 * 分割比例)
            rest_h = 高度 - split_h

            mask_a_np[:split_h, :] = 1.0
            mask_b_np[split_h:, :] = 1.0
            
            # 创建纯遮罩（无黑底，实际分割尺寸）
            standalone_mask_a_np = np.ones((split_h, 宽度), dtype=np.float32)
            standalone_mask_b_np = np.ones((rest_h, 宽度), dtype=np.float32)

        # 转换为Tensor
        mask_a = torch.from_numpy(mask_a_np).unsqueeze(0)
        mask_b = torch.from_numpy(mask_b_np).unsqueeze(0)
        standalone_mask_a = torch.from_numpy(standalone_mask_a_np).unsqueeze(0)
        standalone_mask_b = torch.from_numpy(standalone_mask_b_np).unsqueeze(0)
        complete_mask = torch.from_numpy(complete_mask_np).unsqueeze(0)

        # 安全检查：如果分割比例为0或1，会导致其中一个遮罩尺寸为0，这可能引起下游节点报错
        # 在这种情况下，生成一个1x1的最小黑色遮罩以确保兼容性
        if standalone_mask_a.shape[1] == 0 or standalone_mask_a.shape[2] == 0:
            standalone_mask_a = torch.zeros((1, 1, 1), dtype=torch.float32)
        if standalone_mask_b.shape[1] == 0 or standalone_mask_b.shape[2] == 0:
            standalone_mask_b = torch.zeros((1, 1, 1), dtype=torch.float32)

        return (mask_a, mask_b, standalone_mask_a, standalone_mask_b, complete_mask)

# ==========================================================================================
# 节点 4: ZML_遮罩分割-五
# ==========================================================================================
class ZML_MaskSplitNode_Five:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "宽度": ("INT", {"default": 1024, "min": 1, "max": 8192, "step": 8}),
                "高度": ("INT", {"default": 1024, "min": 1, "max": 8192, "step": 8}),
                "分割数量": ("INT", {"default": 5, "min": 1, "max": 5, "step": 1}),
            }
        }

    RETURN_TYPES = ("MASK", "MASK", "MASK", "MASK", "MASK")
    RETURN_NAMES = ("遮罩1", "遮罩2", "遮罩3", "遮罩4", "遮罩5")
    FUNCTION = "process"
    CATEGORY = "image/ZML_图像/图像"

    def process(self, 宽度, 高度, 分割数量):
        output_masks = []
        
        # 精确计算每个分割点的x坐标，以避免像素累积误差
        x_positions = [int(i * 宽度 / 分割数量) for i in range(分割数量 + 1)]
        x_positions[-1] = 宽度 # 确保最后一个分割点是总宽度

        # 始终循环5次，因为有5个输出接口
        for i in range(5):
            if i < 分割数量:
                # 如果当前索引小于选择的分割数量，则生成一个有效的分割遮罩
                x_start = x_positions[i]
                x_end = x_positions[i+1]
                
                mask_np = np.zeros((高度, 宽度), dtype=np.float32)
                mask_np[:, x_start:x_end] = 1.0 # 绘制白色竖条
                
                output_masks.append(torch.from_numpy(mask_np).unsqueeze(0))
            else:
                # 对于未使用的输出接口，生成一个全黑的遮罩以防报错
                black_mask_np = np.zeros((高度, 宽度), dtype=np.float32)
                output_masks.append(torch.from_numpy(black_mask_np).unsqueeze(0))
                
        return tuple(output_masks)

# --- 节点注册 ---
NODE_CLASS_MAPPINGS = {
    "ZML_AutoCensorNode": ZML_AutoCensorNode,
    "ZML_CustomCensorNode": ZML_CustomCensorNode,
    "ZML_MaskSplitNode": ZML_MaskSplitNode,
    "ZML_MaskSplitNode_Five": ZML_MaskSplitNode_Five,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_AutoCensorNode": "ZML_自动打码",
    "ZML_CustomCensorNode": "ZML_自定义打码",
    "ZML_MaskSplitNode": "ZML_遮罩分割",
    "ZML_MaskSplitNode_Five": "ZML_遮罩分割-五",
}