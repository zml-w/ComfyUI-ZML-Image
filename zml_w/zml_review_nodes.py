# zml_w/zml_review_nodes.py

import torch
import numpy as np
from PIL import Image, ImageDraw
import os
from ultralytics import YOLO
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

# --- 节点主类 ---
class ZML_AutoCensorNode:
    """
    ZML_自动打码节点：
    - 自动支持BBox和SEGM模型
    - 支持图像或马赛克覆盖
    - 支持蒙版缩放和膨胀
    - 支持按数量自适应马赛克
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        model_list = folder_paths.get_filename_list("ultralytics") or []
        if not model_list:
            return {"required": {"提示": ("STRING", { "default": "错误: 未在 'ComfyUI/models/ultralytics/' 目录下找到任何模型文件。", "multiline": True })}}
            
        return {
            "required": {
                "原始图像": ("IMAGE",),
                "YOLO模型": (model_list,),
                "置信度阈值": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.01}),
                "覆盖模式": (["图像", "马赛克"],),
                "马赛克数量": ("INT", {"default": 5, "min": 1, "max": 256, "step": 1}),
                "遮罩缩放系数": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 5.0, "step": 0.05}),
                "遮罩膨胀": ("INT", {"default": 0, "min": 0, "max": 128, "step": 1}),
            },
            "optional": {
                "覆盖图": ("IMAGE",),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("处理后图像", "检测遮罩")
    FUNCTION = "process"
    CATEGORY = "image/ZML_图像"

    def process(self, 原始图像, YOLO模型, 置信度阈值, 覆盖模式, 马赛克数量, 遮罩缩放系数, 遮罩膨胀, 覆盖图=None):
        
        # --- 修改点 1: 移除报错逻辑 ---
        # 当“图像”模式下没有输入覆盖图时，不再抛出错误，而是让流程继续
        # if 覆盖模式 == "图像" and 覆盖图 is None:
        #     raise ValueError("[ZML_自动打码] '图像'覆盖模式需要连接一个'覆盖图'输入。")

        model_path = folder_paths.get_full_path("ultralytics", YOLO模型)
        if not model_path: raise FileNotFoundError(f"模型文件 '{YOLO模型}' 未找到。")
        with force_compatibility_mode():
            model = YOLO(model_path)
        
        source_pil = self.tensor_to_pil(原始图像)
        source_cv2 = cv2.cvtColor(np.array(source_pil), cv2.COLOR_RGB2BGR)
        h, w = source_cv2.shape[:2]
        
        results = model(source_pil, conf=置信度阈值, verbose=False)
        
        final_combined_mask = Image.new('L', (w, h), 0)
        
        if len(results[0]) > 0:
            for result in results[0]:
                mask_cv = self.get_mask(result, w, h)
                if mask_cv is None: continue

                processed_mask_cv = self.process_mask(mask_cv, 遮罩缩放系数, 遮罩膨胀)
                
                source_cv2 = self.apply_overlay(source_cv2, processed_mask_cv, 覆盖模式, 覆盖图, 马赛克数量)

                final_combined_mask.paste(Image.fromarray(processed_mask_cv), (0,0), Image.fromarray(processed_mask_cv))

        final_image_pil = Image.fromarray(cv2.cvtColor(source_cv2, cv2.COLOR_BGR2RGB))
        final_image_tensor = self.pil_to_tensor(final_image_pil)
        final_mask_tensor = self.pil_to_tensor(final_combined_mask).squeeze(-1)
        
        return (final_image_tensor, final_mask_tensor)

    def get_mask(self, result, w, h):
        if hasattr(result, 'masks') and result.masks is not None:
            mask_data = result.masks.data[0].cpu().numpy()
            return (cv2.resize(mask_data, (w, h), interpolation=cv2.INTER_NEAREST) * 255).astype(np.uint8)
        elif hasattr(result, 'boxes') and result.boxes is not None:
            box = result.boxes.xyxy[0].cpu().numpy().astype(int)
            mask_cv = np.zeros((h, w), dtype=np.uint8)
            cv2.rectangle(mask_cv, (box[0], box[1]), (box[2], box[3]), 255, -1)
            return mask_cv
        return None

    def process_mask(self, mask_cv, scale, dilation):
        processed_mask = mask_cv.copy()
        
        if scale != 1.0 and np.any(processed_mask):
            M = cv2.moments(processed_mask)
            if M["m00"] != 0:
                cX = int(M["m10"] / M["m00"])
                cY = int(M["m01"] / M["m00"])
                T = cv2.getRotationMatrix2D((cX, cY), 0, scale)
                processed_mask = cv2.warpAffine(processed_mask, T, (processed_mask.shape[1], processed_mask.shape[0]))

        if dilation > 0:
            kernel = np.ones((dilation, dilation), np.uint8)
            processed_mask = cv2.dilate(processed_mask, kernel, iterations=1)
            
        return processed_mask
        
    def apply_overlay(self, source_cv2, mask_cv, mode, overlay_image_tensor, mosaic_count):
        contours, _ = cv2.findContours(mask_cv, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours: return source_cv2
        
        all_points = np.concatenate(contours, axis=0)
        x, y, w, h = cv2.boundingRect(all_points)

        if w == 0 or h == 0: return source_cv2

        roi = source_cv2[y:y+h, x:x+w]
        mask_roi = mask_cv[y:y+h, x:x+w]
        
        if mode == "马赛克":
            aspect_ratio = h / w if w > 0 else 1
            new_width = mosaic_count
            new_height = max(1, int(new_width * aspect_ratio))
            
            small_roi = cv2.resize(roi, (new_width, new_height), interpolation=cv2.INTER_LINEAR)
            mosaic_roi = cv2.resize(small_roi, (w, h), interpolation=cv2.INTER_NEAREST)
            
            roi_to_change = source_cv2[y:y+h, x:x+w]
            mask_bool = mask_roi.astype(bool)
            roi_to_change[mask_bool] = mosaic_roi[mask_bool]

        elif mode == "图像":
            # --- 修改点 2: 添加默认黑色图像逻辑 ---
            if overlay_image_tensor is None:
                # 如果没有提供覆盖图，创建一个1x1的纯黑色图像张量作为默认值
                # 后续的缩放逻辑会自动将其调整到正确的大小
                overlay_image_tensor = torch.zeros((1, 1, 1, 3), dtype=torch.float32)

            overlay_pil = self.tensor_to_pil(overlay_image_tensor).convert("RGBA")
            overlay_cv2 = cv2.cvtColor(np.array(overlay_pil), cv2.COLOR_RGBA2BGRA)
            resized_overlay = cv2.resize(overlay_cv2, (w, h))
            
            if resized_overlay.shape[2] == 4:
                overlay_rgb = resized_overlay[:, :, :3]
                alpha_mask = resized_overlay[:, :, 3]
                final_alpha_mask = cv2.bitwise_and(mask_roi, alpha_mask)
                alpha_float = final_alpha_mask.astype(float) / 255.0
                alpha_float_3d = np.stack([alpha_float, alpha_float, alpha_float], axis=2)
                blended_roi = (overlay_rgb * alpha_float_3d) + (roi * (1 - alpha_float_3d))
                np.copyto(source_cv2[y:y+h, x:x+w], blended_roi.astype(np.uint8), where=np.stack([mask_roi, mask_roi, mask_roi], axis=2).astype(bool))
            else:
                np.copyto(source_cv2[y:y+h, x:x+w], resized_overlay, where=np.stack([mask_roi, mask_roi, mask_roi], axis=2).astype(bool))
            
        return source_cv2

    def tensor_to_pil(self, tensor):
        return Image.fromarray((tensor.squeeze(0).cpu().numpy() * 255).astype(np.uint8))

    def pil_to_tensor(self, pil_image):
        return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)

# --- 节点注册 ---
NODE_CLASS_MAPPINGS = {
    "ZML_AutoCensorNode": ZML_AutoCensorNode,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_AutoCensorNode": "ZML_自动打码",
}