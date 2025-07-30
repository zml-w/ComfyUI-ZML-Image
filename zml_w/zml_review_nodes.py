# zml_w/zml_review_nodes.py
# FINAL VERSION (UI Localization & Custom Skin Support)

import torch
import numpy as np
from PIL import Image, ImageDraw
import os
import time
import uuid

try:
    from ultralytics import YOLO
except ImportError:
    print("Warning: ultralytics is not installed. ZML_AutoCensorNode will not work without it.")
import folder_paths
import logging
from contextlib import contextmanager
import cv2
import server
from aiohttp import web

# --- API Endpoint (Correct and Final) ---
@server.PromptServer.instance.routes.post("/zml/unpause")
async def unpause_node(request):
    try:
        data = await request.json()
        node_id = data.get("node_id")
        selected_output = data.get("selected_output")
        if node_id is not None and selected_output is not None:
            temp_dir = folder_paths.get_temp_directory()
            signal_file = os.path.join(temp_dir, f"zml_unpause_{node_id}.signal")
            with open(signal_file, "w", encoding="utf-8") as f:
                f.write(str(selected_output))
            return web.Response(status=200, text="Unpaused")
        else:
            return web.Response(status=400, text="Node ID or selected output not provided")
    except Exception as e:
        # print(f"[ZML_PauseNode] Error unpausing: {e}") 
        return web.Response(status=500, text=f"Error: {e}")

# --- Compatibility Loader (Unchanged) ---
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

class ZML_AutoCensorNode:
    def __init__(self):
        self.node_dir = os.path.dirname(os.path.abspath(__file__)); self.counter_dir = os.path.join(self.node_dir, "counter"); os.makedirs(self.counter_dir, exist_ok=True); self.counter_file = os.path.join(self.counter_dir, "review.txt"); self.ensure_counter_file()
    def ensure_counter_file(self):
        if not os.path.exists(self.counter_file):
            with open(self.counter_file, "w", encoding="utf-8") as f: f.write("0")
    def increment_and_get_help_text(self):
        count = 0
        try:
            with open(self.counter_file, "r+", encoding="utf-8") as f:
                content = f.read().strip(); count = int(content) if content.isdigit() else 0; count += 1; f.seek(0); f.write(str(count)); f.truncate()
        except Exception: count = 1
        return f"你好，欢迎使用ZML节点~到目前为止，你通过此节点总共处理了{count}次！！"
    @classmethod
    def INPUT_TYPES(cls):
        try: model_list = folder_paths.get_filename_list("ultralytics") or []
        except KeyError: model_list = []
        return {"required": {"原始图像": ("IMAGE",), "YOLO模型": (model_list,), "置信度阈值": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.01}), "覆盖模式": (["图像", "马赛克"],), "拉伸图像": (["关闭", "启用"], {"default": "关闭"}), "马赛克数量": ("INT", {"default": 5, "min": 1, "max": 256, "step": 1}), "遮罩缩放系数": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 5.0, "step": 0.05}), "遮罩膨胀": ("INT", {"default": 0, "min": 0, "max": 128, "step": 1}),}, "optional": { "覆盖图": ("IMAGE",), }}
    RETURN_TYPES = ("IMAGE", "MASK", "STRING"); RETURN_NAMES = ("处理后图像", "检测遮罩", "Help"); FUNCTION = "process"; CATEGORY = "image/ZML_图像/图像"
    def process(self, 原始图像, YOLO模型, 置信度阈值, 覆盖模式, 拉伸图像, 马赛克数量, 遮罩缩放系数, 遮罩膨胀, 覆盖图=None):
        help_text = self.increment_and_get_help_text()
        if not YOLO模型: _, h, w, _ = 原始图像.shape; return (原始图像, torch.zeros((1, h, w), dtype=torch.float32), help_text)
        if 覆盖模式 == "图像" and 覆盖图 is None: 覆盖图 = torch.zeros((1, 1, 1, 3), dtype=torch.float32)
        model_path = folder_paths.get_full_path("ultralytics", YOLO模型)
        if not model_path: raise FileNotFoundError(f"模型文件 '{YOLO模型}' 未找到。")
        with force_compatibility_mode(): model = YOLO(model_path)
        source_pil = self.tensor_to_pil(原始图像); source_cv2 = cv2.cvtColor(np.array(source_pil), cv2.COLOR_RGB2BGR); h, w = source_cv2.shape[:2]
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
        if hasattr(result, 'masks') and result.masks: return (cv2.resize(result.masks.data[0].cpu().numpy(), (w, h), interpolation=cv2.INTER_NEAREST) * 255).astype(np.uint8), 'segm'
        elif hasattr(result, 'boxes') and result.boxes: box = result.boxes.xyxy[0].cpu().numpy().astype(int); mask_cv = np.zeros((h, w), dtype=np.uint8); cv2.rectangle(mask_cv, (box[0], box[1]), (box[2], box[3]), 255, -1); return mask_cv, 'bbox'
        return None, None
    def process_mask(self, mask_cv, scale, dilation):
        processed_mask = mask_cv.copy()
        if scale != 1.0 and np.any(processed_mask):
            M = cv2.moments(processed_mask)
            if M["m00"] != 0: cX = int(M["m10"] / M["m00"]); cY = int(M["m01"] / M["m00"]); T = cv2.getRotationMatrix2D((cX, cY), 0, scale); processed_mask = cv2.warpAffine(processed_mask, T, (processed_mask.shape[1], processed_mask.shape[0]))
        if dilation > 0: kernel = np.ones((dilation, dilation), np.uint8); processed_mask = cv2.dilate(processed_mask, kernel, iterations=1)
        return processed_mask
    def apply_overlay(self, source_cv2, mask_cv, mode, overlay_image_tensor, mosaic_count, stretch_image, mask_type='segm'):
        contours, _ = cv2.findContours(mask_cv, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE);
        if not contours: return source_cv2
        all_points = np.concatenate(contours, axis=0); x, y, w, h = cv2.boundingRect(all_points)
        if w == 0 or h == 0: return source_cv2
        roi = source_cv2[y:y+h, x:x+w]; mask_roi = mask_cv[y:y+h, x:x+w]
        if mode == "马赛克":
            small_roi = cv2.resize(roi, (mosaic_count, max(1, int(mosaic_count * (h/w if w > 0 else 1)))), interpolation=cv2.INTER_LINEAR)
            mosaic_roi = cv2.resize(small_roi, (w, h), interpolation=cv2.INTER_NEAREST); source_cv2[y:y+h, x:x+w][mask_roi.astype(bool)] = mosaic_roi[mask_roi.astype(bool)]
        elif mode == "图像":
            overlay_cv2_bgr = cv2.cvtColor(np.array(self.tensor_to_pil(overlay_image_tensor).convert("RGB")), cv2.COLOR_RGB2BGR)
            if mask_type == 'bbox' and stretch_image == '关闭':
                oh, ow = overlay_cv2_bgr.shape[:2]; box_aspect = w/h if h>0 else 1; overlay_aspect = ow/oh if oh>0 else 1
                if box_aspect > overlay_aspect: new_h, new_w = h, int(overlay_aspect * h)
                else: new_w, new_h = w, int(w / overlay_aspect)
                scaled_overlay = cv2.resize(overlay_cv2_bgr, (new_w, new_h)); canvas = np.zeros((h, w, 3), dtype=np.uint8)
                paste_x, paste_y = (w - new_w) // 2, (h - new_h) // 2; canvas[paste_y:paste_y+new_h, paste_x:paste_x+new_w] = scaled_overlay; resized_overlay = canvas
            else: resized_overlay = cv2.resize(overlay_cv2_bgr, (w, h))
            np.copyto(source_cv2[y:y+h, x:x+w], resized_overlay, where=np.stack([mask_roi]*3, axis=-1).astype(bool))
        return source_cv2
    def tensor_to_pil(self, tensor): return Image.fromarray((tensor.squeeze(0).cpu().numpy() * 255).astype(np.uint8))
    def pil_to_tensor(self, pil_image): return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)

class ZML_CustomCensorNode(ZML_AutoCensorNode):
    @classmethod
    def INPUT_TYPES(cls): return {"required": {"原始图像": ("IMAGE",), "遮罩": ("MASK",), "覆盖模式": (["图像", "马赛克"],), "马赛克数量": ("INT", {"default": 5, "min": 1, "max": 256}), "遮罩缩放系数": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 5.0}), "遮罩膨胀": ("INT", {"default": 0, "min": 0, "max": 128}), }, "optional": { "覆盖图": ("IMAGE",), }}
    RETURN_TYPES = ("IMAGE", "MASK", "STRING"); RETURN_NAMES = ("处理后图像", "处理后遮罩", "Help")
    def process(self, 原始图像, 遮罩, 覆盖模式, 马赛克数量, 遮罩缩放系数, 遮罩膨胀, 覆盖图=None):
        help_text = self.increment_and_get_help_text(); source_cv2 = cv2.cvtColor(np.array(self.tensor_to_pil(原始图像)), cv2.COLOR_RGB2BGR)
        mask_cv = (遮罩.squeeze(0).cpu().numpy() * 255).astype(np.uint8); processed_mask_cv = self.process_mask(mask_cv, 遮罩缩放系数, 遮罩膨胀)
        source_cv2 = self.apply_overlay(source_cv2, processed_mask_cv, 覆盖模式, 覆盖图 or torch.zeros((1, 1, 1, 3)), 马赛克数量, "启用", 'bbox')
        final_image_pil = Image.fromarray(cv2.cvtColor(source_cv2, cv2.COLOR_BGR2RGB))
        return (self.pil_to_tensor(final_image_pil), self.pil_to_tensor(Image.fromarray(processed_mask_cv)).squeeze(-1), help_text)

class ZML_MaskSplitNode:
    @classmethod
    def INPUT_TYPES(cls): return { "required": { "宽度": ("INT", {"default": 1024}), "高度": ("INT", {"default": 1024}), "分割比例": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0}), "分割方向": (["竖", "横"],) } }
    RETURN_TYPES = ("MASK", "MASK", "MASK", "MASK", "MASK"); RETURN_NAMES = ("遮罩A", "遮罩B", "单独遮罩A", "单独遮罩B", "完整遮罩"); FUNCTION = "process"; CATEGORY = "image/ZML_图像/图像"
    def process(self, 宽度, 高度, 分割比例, 分割方向):
        a = np.zeros((高度, 宽度), dtype=np.float32); b = np.zeros((高度, 宽度), dtype=np.float32)
        if 分割方向 == "竖": w_split = int(宽度 * 分割比例); a[:, :w_split] = 1.0; b[:, w_split:] = 1.0; sa = np.ones((高度, w_split)); sb = np.ones((高度, 宽度 - w_split))
        else: h_split = int(高度 * 分割比例); a[:h_split, :] = 1.0; b[h_split:, :] = 1.0; sa = np.ones((h_split, 宽度)); sb = np.ones((高度 - h_split, 宽度))
        if sa.size == 0: sa = np.zeros((1,1));
        if sb.size == 0: sb = np.zeros((1,1));
        return tuple(torch.from_numpy(x).unsqueeze(0) for x in [a, b, sa, sb, np.ones((高度, 宽度))])

class ZML_MaskSplitNode_Five:
    @classmethod
    def INPUT_TYPES(cls): return {"required": { "宽度": ("INT", {"default": 1024}), "高度": ("INT", {"default": 1024}), "分割数量": ("INT", {"default": 5, "min": 1, "max": 5}) } }
    RETURN_TYPES = ("MASK", "MASK", "MASK", "MASK", "MASK"); RETURN_NAMES = ("遮罩1", "遮罩2", "遮罩3", "遮罩4", "遮罩5"); FUNCTION = "process"; CATEGORY = "image/ZML_图像/图像"
    def process(self, 宽度, 高度, 分割数量):
        masks = []; pos = [int(i * 宽度 / 分割数量) for i in range(分割数量 + 1)]; pos[-1] = 宽度
        for i in range(5):
            m = np.zeros((高度, 宽度), dtype=np.float32)
            if i < 分割数量: m[:, pos[i]:pos[i+1]] = 1.0
            masks.append(torch.from_numpy(m).unsqueeze(0))
        return tuple(masks)

class ZML_PauseNode:
    @classmethod
    def INPUT_TYPES(cls):
        return { 
            "required": {
                "暂停时长": ("INT", {"default": 15, "min": 0, "max": 3600}),
                "占位符大小": (["1x1", "64x64"],),
            },
            "optional": {
                "图像": ("IMAGE",),
            },
            "hidden": {"prompt": "PROMPT", "unique_id": "UNIQUE_ID"},
        }
    
    RETURN_TYPES = ("IMAGE", "IMAGE", "IMAGE", "STRING",)
    RETURN_NAMES = ("图像_1", "图像_2", "图像_3", "help",)
    FUNCTION = "pause_workflow"
    CATEGORY = "image/ZML_图像/图像"

    def pause_workflow(self, 暂停时长, 占位符大小, 图像=None, prompt=None, unique_id=None):
        help_text = "如果后续的节点要连上VAE和采样器，那需要将占位符大小改为64x64像素。如果只是对图像进行处理，则可以选择1x1像素。如果后面接保存图像节点，那推荐你使用我的‘ZML_保存图像’节点，它在收到1*1的图像和64*64的纯黑图像时并不会保存，和这个节点完美契合。"
        
        size = 64 if 占位符大小 == "64x64" else 1

        if 图像 is None:
            dummy_image = torch.zeros((1, size, size, 3), dtype=torch.float32, device="cpu")
            real_output = None
        else:
            dummy_image = torch.zeros((1, size, size, 3), dtype=图像.dtype, device=图像.device)
            real_output = 图像

        node_id = unique_id
        temp_dir = folder_paths.get_temp_directory()
        signal_file = os.path.join(temp_dir, f"zml_unpause_{node_id}.signal")

        if os.path.exists(signal_file):
            try:
                os.remove(signal_file)
            except Exception as e:
                pass

        start_time = time.time()
        
        selected_path = 0
        interrupted = False

        while (time.time() - start_time) < 暂停时长:
            if os.path.exists(signal_file):
                try:
                    with open(signal_file, "r", encoding="utf-8") as f:
                        content = f.read(); selected_path = int(content)
                    interrupted = True
                    break
                except Exception as e:
                    pass
            time.sleep(0.1)

        if not interrupted:
            selected_path = 0
            
        if os.path.exists(signal_file):
            try:
                os.remove(signal_file)
            except Exception as e:
                pass
        
        outputs = [dummy_image, dummy_image, dummy_image]
        
        active_output = real_output if real_output is not None else dummy_image
        
        if 0 <= selected_path < len(outputs):
            outputs[selected_path] = active_output
        else: 
            outputs[0] = active_output

        return tuple(outputs) + (help_text,)


NODE_CLASS_MAPPINGS = {
    "ZML_AutoCensorNode": ZML_AutoCensorNode,
    "ZML_CustomCensorNode": ZML_CustomCensorNode,
    "ZML_MaskSplitNode": ZML_MaskSplitNode,
    "ZML_MaskSplitNode_Five": ZML_MaskSplitNode_Five,
    "ZML_PauseNode": ZML_PauseNode,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_AutoCensorNode": "ZML_自动打码",
    "ZML_CustomCensorNode": "ZML_自定义打码",
    "ZML_MaskSplitNode": "ZML_遮罩分割",
    "ZML_MaskSplitNode_Five": "ZML_遮罩分割-五",
    "ZML_PauseNode": "ZML_图像暂停",
}