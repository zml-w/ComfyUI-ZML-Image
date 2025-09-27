# zml_w/zml_review_nodes.py

import torch
import numpy as np
from PIL import Image, ImageDraw
import os
import time
import uuid
import json
from scipy.spatial.distance import cdist


try:
    from ultralytics import YOLO
except ImportError:
    print("Warning: ultralytics is not installed. ZML_AutoCensorNode and ZML_YoloToMask will not work without it.")
import folder_paths
import logging
from contextlib import contextmanager
import cv2
import server
from aiohttp import web

#根据插件地址反推YOLO模型路径
try:
    current_node_file_path = os.path.abspath(__file__)

    comfyui_app_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(current_node_file_path))))

    correct_ultralytics_model_dir = os.path.join(comfyui_app_root, "models", "ultralytics")

    is_registered = False
    if "ultralytics" in folder_paths.folder_names_and_paths:
        if correct_ultralytics_model_dir in folder_paths.folder_names_and_paths["ultralytics"][0]:
            is_registered = True
        
    if not is_registered and os.path.exists(correct_ultralytics_model_dir):
        folder_paths.add_model_folder_path("ultralytics", correct_ultralytics_model_dir)
    elif is_registered:
        pass # 已经注册了，无需重复打印或注册
    else:
        print(f"ZML Nodes: Warning! Correct 'ultralytics' model directory not found or unreachable: {correct_ultralytics_model_dir}. Could not register.")

except Exception as e:
    print(f"ZML Nodes: Error during custom model path registration for 'ultralytics' (auto-detection failed): {e}")


# --- API Endpoint (For Pause Node) ---
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
        return web.Response(status=500, text=f"Error: {e}")

# --- Compatibility Loader ---
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
    RETURN_TYPES = ("IMAGE", "MASK", "STRING"); RETURN_NAMES = ("处理后图像", "检测遮罩", "Help"); FUNCTION = "process"; CATEGORY = "image/ZML_图像/工具"
    def process(self, 原始图像, YOLO模型, 置信度阈值, 覆盖模式, 拉伸图像, 马赛克数量, 遮罩缩放系数, 遮罩膨胀, 覆盖图=None):
        help_text = self.increment_and_get_help_text()
        if not YOLO模型: _, h, w, _ = 原始图像.shape; return (原始图像, torch.zeros((1, h, w), dtype=torch.float32), help_text)
        if 覆盖模式 == "图像" and 覆盖图 is None: 覆盖图 = torch.zeros((1, 1, 1, 3), dtype=torch.float32)
        model_path = folder_paths.get_full_path("ultralytics", YOLO模型)
        if not model_path: raise FileNotFoundError(f"模型文件 '{YOLO模型}' 未找到。")
        with force_compatibility_mode(): model = YOLO(model_path)
        source_pil = self.tensor_to_pil(原始图像); source_cv2 = cv2.cvtColor(np.array(source_pil), cv2.COLOR_RGB2BGR); h, w = source_cv2.shape[:2]
        results = model(source_pil, conf= 置信度阈值, verbose=False)
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
        elif hasattr(result, 'boxes') and result.boxes: box = result.boxes.xyxy[0].cpu().numpy().astype(int); mask_cv = np.zeros((h, w), dtype=np.uint8); cv2.rectangle(mask_cv, (box[0], box[1]), (box[2], box[3]), 255, -1); return mask_cv, 'bbox' # 修正了box[1]这里的问题
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
    def INPUT_TYPES(cls): return {"required": {"原始图像": ("IMAGE",), "遮罩": ("MASK",), "覆盖模式": (["图像", "马赛克"],), "马赛克数量": ("INT", {"default": 5, "min": 1, "max": 256}), "遮罩缩放系数": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 5.0, "step": 0.05}), "遮罩膨胀": ("INT", {"default": 0, "min": 0, "max": 128}), }, "optional": { "覆盖图": ("IMAGE",), }}
    RETURN_TYPES = ("IMAGE", "MASK", "STRING"); RETURN_NAMES = ("处理后图像", "处理后遮罩", "Help")
    def process(self, 原始图像, 遮罩, 覆盖模式, 马赛克数量, 遮罩缩放系数, 遮罩膨胀, 覆盖图=None):
        help_text = self.increment_and_get_help_text(); source_cv2 = cv2.cvtColor(np.array(self.tensor_to_pil(原始图像)), cv2.COLOR_RGB2BGR)
        mask_cv = (遮罩.squeeze(0).cpu().numpy() * 255).astype(np.uint8); processed_mask_cv = self.process_mask(mask_cv, 遮罩缩放系数, 遮罩膨胀)
        source_cv2 = self.apply_overlay(source_cv2, processed_mask_cv, 覆盖模式, 覆盖图 or torch.zeros((1, 1, 1, 3)), 马赛克数量, "启用", 'bbox')
        final_image_pil = Image.fromarray(cv2.cvtColor(source_cv2, cv2.COLOR_BGR2RGB))
        return (self.pil_to_tensor(final_image_pil), self.pil_to_tensor(Image.fromarray(processed_mask_cv)).squeeze(-1), help_text)

class ZML_MaskCropNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像": ("IMAGE",),
                "遮罩": ("MASK",),
                "遮罩缩放系数": ("FLOAT", {"default": 1.0, "min": -1.0, "max": 3.0, "step": 0.05}),
            }
        }
    RETURN_TYPES = ("IMAGE", "IMAGE", "MASK")
    RETURN_NAMES = ("裁剪图像", "反转裁剪", "反转遮罩")
    FUNCTION = "process_mask_crop"
    CATEGORY = "image/ZML_图像/遮罩"

    def process_mask_crop(self, 图像, 遮罩, 遮罩缩放系数):
        # 将tensor转换为PIL图像
        source_pil = self.tensor_to_pil(图像)
        h, w = source_pil.height, source_pil.width
        
        # 处理遮罩
        mask_pil = Image.fromarray((遮罩.squeeze(0).cpu().numpy() * 255).astype(np.uint8), mode='L')
        
        # 应用遮罩缩放系数
        if 遮罩缩放系数 != 1.0 and np.any(遮罩.squeeze(0).cpu().numpy()):
            mask_cv = np.array(mask_pil)
            # 计算质心
            M = cv2.moments(mask_cv)
            if M["m00"] != 0:
                cX = int(M["m10"] / M["m00"])
                cY = int(M["m01"] / M["m00"])
                # 应用缩放变换
                T = cv2.getRotationMatrix2D((cX, cY), 0, 遮罩缩放系数)
                mask_cv = cv2.warpAffine(mask_cv, T, (w, h))
                mask_pil = Image.fromarray(mask_cv, mode='L')
        
        # 创建裁剪图像 (基于遮罩保留内容)
        crop_pil = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        source_rgba = source_pil.convert('RGBA')
        crop_pil.paste(source_rgba, (0, 0), mask_pil)
        
        # 创建反转裁剪图像 (基于遮罩移除内容)
        inverted_mask_pil = Image.fromarray(255 - np.array(mask_pil), mode='L')
        inverted_crop_pil = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        inverted_crop_pil.paste(source_rgba, (0, 0), inverted_mask_pil)
        
        # 计算反转遮罩
        inverted_mask_tensor = 1.0 - 遮罩
        
        # 将PIL图像转换回tensor
        crop_tensor = self.pil_to_tensor(crop_pil)
        inverted_crop_tensor = self.pil_to_tensor(inverted_crop_pil)
        
        return (crop_tensor, inverted_crop_tensor, inverted_mask_tensor)
    
    def tensor_to_pil(self, tensor):
        # 处理RGBA和RGB情况
        if tensor.shape[-1] == 4:
            return Image.fromarray((tensor.squeeze(0).cpu().numpy() * 255).astype(np.uint8), mode='RGBA')
        else:
            return Image.fromarray((tensor.squeeze(0).cpu().numpy() * 255).astype(np.uint8))
    
    def pil_to_tensor(self, pil_image):
        # 处理RGBA和RGB情况
        if pil_image.mode == 'RGBA':
            return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)
        else:
            return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)

class ZML_YoloToMask(ZML_AutoCensorNode): # 继承自 ZML_AutoCensorNode 以复用其工具函数
    @classmethod
    def INPUT_TYPES(cls):
        try: model_list = folder_paths.get_filename_list("ultralytics") or []
        except KeyError: model_list = []
        return {
            "required": {
                "图像": ("IMAGE",),
                "YOLO模型": (model_list,), 
                "置信度阈值": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.01}),
                "遮罩缩放系数": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 5.0, "step": 0.05}),
                "遮罩膨胀": ("INT", {"default": 0, "min": 0, "max": 128, "step": 1}),
                "描边颜色": ("STRING", {"default": "#FF0000", "tooltip": "描边颜色，十六进制代码 (例如 #RRGGBB)。默认红色。", "pysssss.color": True}),
                "描边厚度": ("INT", {"default": 2, "min": 0, "max": 30, "step": 1}),
                "外扩描边像素": ("INT", {"default": 0, "min": 0, "max": 50, "step": 1}),
                "保持裁剪图像原始分辨率": ("BOOLEAN", {"default": False, "tooltip": "如果为True，裁剪图像将保持原始输入图像的分辨率并填充透明像素；如果为False，裁剪图像将自动剪裁周围的透明区域，只保留最小有效内容。"}),
            }
        }
    RETURN_TYPES = ("MASK", "MASK", "IMAGE", "IMAGE") # 新增 IMAGE 输出类型给裁剪图像
    RETURN_NAMES = ("遮罩", "反转遮罩", "描边图像", "裁剪图像") # 新增 裁剪图像 名称
    FUNCTION = "process_yolo_to_mask"
    CATEGORY = "image/ZML_图像/遮罩" # 放在遮罩分类下

    def process_yolo_to_mask(self, 图像, YOLO模型, 置信度阈值, 遮罩缩放系数, 遮罩膨胀, 描边颜色, 描边厚度, 外扩描边像素, 保持裁剪图像原始分辨率):
        if not YOLO模型: 
            _, h, w, _ = 图像.shape
            # 返回空遮罩、全白反转遮罩、原始图像和全黑图像作为裁剪图像
            return (torch.zeros((1, h, w), dtype=torch.float32), 
                    torch.ones((1, h, w), dtype=torch.float32), 
                    图像,
                    torch.zeros_like(图像)) # 返回与输入图像大小相同的全黑图像

        model_path = folder_paths.get_full_path("ultralytics", YOLO模型)
        if not model_path: raise FileNotFoundError(f"模型文件 '{YOLO模型}' 未找到。")

        # 使用兼容模式加载YOLO模型
        with force_compatibility_mode():
            model = YOLO(model_path)
        
        source_pil = self.tensor_to_pil(图像)
        source_cv2_bgr = cv2.cvtColor(np.array(source_pil), cv2.COLOR_RGB2BGR) # 用于描边和裁剪
        h, w = source_pil.height, source_pil.width # 获取实际图片宽高

        # 运行YOLO推理
        results = model(source_pil, conf=置信度阈值, verbose=False)

        # 初始化一个空白遮罩用于组合所有检测结果
        final_combined_mask_pil = Image.new('L', (w, h), 0) # 'L'是8位灰度模式，0表示全黑
        
        # 用于描边的所有轮廓
        all_contours_to_draw = []

        # 遍历所有检测结果并组合遮罩
        if results and len(results[0]) > 0:
            for result in results[0]:
                mask_cv, _ = self.get_mask(result, w, h) # 获取到的mask_cv已经是0-255的uint8
                if mask_cv is None:
                    continue
                
                # 应用遮罩缩放系数和遮罩膨胀
                processed_mask_cv = self.process_mask(mask_cv, 遮罩缩放系数, 遮罩膨胀)
                
                # 提取描边轮廓
                # 使用RETR_EXTERNAL模式只找最外层轮廓，简化描边
                contours, _ = cv2.findContours(processed_mask_cv, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                all_contours_to_draw.extend(contours)

                # 将处理后的遮罩叠加到最终组合遮罩上
                final_combined_mask_pil.paste(Image.fromarray(processed_mask_cv), (0,0), Image.fromarray(processed_mask_cv))
        
        # 将PIL图像遮罩转换为ComfyUI的MASK张量格式 (B, H, W)
        output_mask = self.pil_to_tensor(final_combined_mask_pil).squeeze(-1) # .squeeze(-1) 从 (B, H, W, 1) 变为 (B, H, W)

        # 生成反转遮罩
        inverted_mask = 1.0 - output_mask

        # --- 描边图像处理 ---
        # 将颜色十六进制转换为BGR元组 (用于OpenCV)
        line_color_rgb_tuple = tuple(int(描边颜色.lstrip('#')[i:i+2], 16) for i in (0, 2, 4)) # RRGGBB -> RGB
        line_color_bgr_tuple = (line_color_rgb_tuple[2], line_color_rgb_tuple[1], line_color_rgb_tuple[0]) # RGB -> BGR

        # 创建一个描边图像副本，以在上面绘图
        stroked_image_cv2 = source_cv2_bgr.copy() 

        if 描边厚度 > 0 and len(all_contours_to_draw) > 0:
            # 描边前先对外扩描边像素进行处理（如果大于0）
            if 外扩描边像素 > 0:
                # 对每个轮廓进行外扩处理
                expanded_contours = []
                for contour in all_contours_to_draw:
                    # 创建一个只包含当前轮廓的空白遮罩
                    temp_mask = np.zeros_like(source_cv2_bgr[:,:,0], dtype=np.uint8)
                    cv2.drawContours(temp_mask, [contour], -1, 255, cv2.FILLED) # Use 255 and cv2.FILLED to make a solid mask
                    
                    # 膨胀这个遮罩
                    kernel = np.ones((外扩描边像素 * 2 + 1, 外扩描边像素 * 2 + 1), np.uint8)
                    dilated_mask = cv2.dilate(temp_mask, kernel, iterations=1)
                    
                    # 找到新遮罩的轮廓
                    new_contours, _ = cv2.findContours(dilated_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                    expanded_contours.extend(new_contours) # 将膨胀后的轮廓加入列表
                
                # 在描边图像上绘制膨胀后的轮廓描边
                cv2.drawContours(stroked_image_cv2, expanded_contours, -1, line_color_bgr_tuple, 描边厚度)
            else:
                # 直接绘制原始轮廓的描边
                cv2.drawContours(stroked_image_cv2, all_contours_to_draw, -1, line_color_bgr_tuple, 描边厚度)

        # 将描边图像从OpenCV BGR格式转换为ComfyUI的IMAGE张量格式 (B, H, W, 3)
        stroked_image_pil = Image.fromarray(cv2.cvtColor(stroked_image_cv2, cv2.COLOR_BGR2RGB))
        output_stroked_image = self.pil_to_tensor(stroked_image_pil)

        # --- 裁剪图像处理 ---
        # 创建一个透明背景的图像，用于裁剪
        temp_cropped_pil = Image.new('RGBA', (w, h), (0, 0, 0, 0)) # 初始透明背景
        
        original_pil_rgba = source_pil.convert("RGBA") # 确保原始图像是RGBA模式，以便正确粘贴到透明背景上

        # 使用遮罩粘贴原始图像内容
        # PIL.Image.paste(im, box=None, mask=None) - mask中的非零区域决定了im的哪些像素会被复制
        # 我们需要遮罩是L模式，且0表示透明，255表示不透明
        final_combined_mask_pil_for_paste = final_combined_mask_pil.convert("L")

        temp_cropped_pil.paste(original_pil_rgba, (0, 0), final_combined_mask_pil_for_paste)

        # 根据 `保持裁剪图像原始分辨率` 选项处理
        output_cropped_image = None
        if 保持裁剪图像原始分辨率:
            # 保持原始分辨率，直接输出带透明背景的裁剪图像
            output_cropped_image = self.pil_to_tensor(temp_cropped_pil)
        else:
            # 自动裁剪，只保留非透明区域（即实际内容）的最紧凑边界框
            # Image.getbbox() 返回图像的非零区域（或非透明区域）的边界框 (left, upper, right, lower)
            bbox = temp_cropped_pil.getbbox() # 自动获取包含所有非透明像素的最小矩形
            if bbox:
                cropped_content_pil = temp_cropped_pil.crop(bbox)
                output_cropped_image = self.pil_to_tensor(cropped_content_pil)
            else:
                # 如果 bbox 为None (图像完全透明/空白)，返回一个1x1的透明图像
                output_cropped_image = self.pil_to_tensor(Image.new('RGBA', (1, 1), (0, 0, 0, 0)))

        return (output_mask, inverted_mask, output_stroked_image, output_cropped_image)


class ZML_MaskSplitNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "宽度": ("INT", {"default": 1024}),
                "高度": ("INT", {"default": 1024}),
                "分割比例": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.1}),
                "分割方向": (["竖", "横", "对角线"],) # 添加“对角线”选项
            }
        }
    RETURN_TYPES = ("MASK", "MASK", "MASK", "MASK", "MASK"); RETURN_NAMES = ("遮罩A", "遮罩B", "单独遮罩A", "单独遮罩B", "完整遮罩"); FUNCTION = "process"; CATEGORY = "image/ZML_图像/遮罩"
    def process(self, 宽度, 高度, 分割比例, 分割方向):
        a = np.zeros((高度, 宽度), dtype=np.float32)
        b = np.zeros((高度, 宽度), dtype=np.float32)
        sa = np.zeros((1, 1), dtype=np.float32) # 初始化，为了防止空遮罩报错
        sb = np.zeros((1, 1), dtype=np.float32) # 初始化

        if 分割方向 == "竖":
            w_split = int(宽度 * 分割比例)
            a[:, :w_split] = 1.0
            b[:, w_split:] = 1.0
            if w_split > 0:
                sa = np.ones((高度, w_split), dtype=np.float32)
            if (宽度 - w_split) > 0:
                sb = np.ones((高度, 宽度 - w_split), dtype=np.float32)
        elif 分割方向 == "横":
            h_split = int(高度 * 分割比例)
            a[:h_split, :] = 1.0
            b[h_split:, :] = 1.0
            if h_split > 0:
                sa = np.ones((h_split, 宽度), dtype=np.float32)
            if (高度 - h_split) > 0:
                sb = np.ones((高度 - h_split, 宽度), dtype=np.float32)
        elif 分割方向 == "对角线":
            y_coords, x_coords = np.indices((高度, 宽度))
            
            gradient = (x_coords / 宽度 + y_coords / 高度) / 2.0
            
            a[gradient <= 分割比例] = 1.0
            b[gradient > 分割比例] = 1.0

            sa = a.copy()
            sb = b.copy()

        # 确保sa和sb在某些极端情况下（如尺寸0，或分割比例导致其中一个为0）不会是空数组
        if sa.size == 0 or sa.shape[0] == 0 or sa.shape[1] == 0: sa = np.zeros((1, 1), dtype=np.float32)
        if sb.size == 0 or sb.shape[0] == 0 or sb.shape[1] == 0: sb = np.zeros((1, 1), dtype=np.float32)

        return tuple(torch.from_numpy(x).unsqueeze(0) for x in [a, b, sa, sb, np.ones((高度, 宽度), dtype=np.float32)])

class ZML_MaskSplitNode_Five:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "宽度": ("INT", {"default": 1024}),
                "高度": ("INT", {"default": 1024}),
                "分割数量": ("INT", {"default": 5, "min": 1, "max": 5})
            }
        }
    RETURN_TYPES = ("MASK", "MASK", "MASK", "MASK", "MASK", "MASK", "MASK")
    RETURN_NAMES = ("遮罩1", "遮罩2", "遮罩3", "遮罩4", "遮罩5", "单独遮罩", "完整遮罩")
    FUNCTION = "process"
    CATEGORY = "image/ZML_图像/遮罩"

    def process(self, 宽度, 高度, 分割数量):
        masks = []
        pos = [int(i * 宽度 / 分割数量) for i in range(分割数量 + 1)]
        pos[-1] = 宽度

        # Generate the 5 full-size masks
        for i in range(5):
            m = np.zeros((高度, 宽度), dtype=np.float32)
            if i < 分割数量:
                m[:, pos[i]:pos[i+1]] = 1.0
            masks.append(torch.from_numpy(m).unsqueeze(0))

        # CORRECTED LOGIC:
        # Calculate the width of a single segment for the "单独遮罩".
        # This will be the width of the first segment.
        segment_width = pos[1] - pos[0] if 分割数量 > 0 else 0

        if segment_width > 0 and 高度 > 0:
            sa = np.ones((高度, segment_width), dtype=np.float32)
        else:
            sa = np.zeros((1, 1), dtype=np.float32) # Handle edge case

        # Generate the "完整遮罩" (full white mask)
        full_mask = np.ones((高度, 宽度), dtype=np.float32)

        # Combine all masks for the return tuple
        final_outputs = masks + [torch.from_numpy(sa).unsqueeze(0), torch.from_numpy(full_mask).unsqueeze(0)]

        return tuple(final_outputs)

# ============================== 图像旋转节点==============================
class ZML_ImageRotate:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像": ("IMAGE",),
                "旋转方向": (["顺时针", "逆时针"],),
                "旋转角度": ("INT", {"default": 90, "min": 0, "max": 360, "step": 1, "display": "number"}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("旋转后图像",)
    FUNCTION = "rotate_image"
    CATEGORY = "image/ZML_图像/图像"

    def _tensor_to_pil(self, tensor: torch.Tensor) -> Image.Image:
        """将 torch Tensor 转换为 PIL Image"""
        return Image.fromarray(np.clip(255. * tensor.cpu().numpy().squeeze(0), 0, 255).astype(np.uint8))

    def _pil_to_tensor(self, pil_image: Image.Image) -> torch.Tensor:
        """将 PIL Image 转换为 torch Tensor"""
        return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)

    def rotate_image(self, 图像: torch.Tensor, 旋转方向: str, 旋转角度: int):
        pil_image = self._tensor_to_pil(图像)

        angle_to_rotate = -旋转角度 if 旋转方向 == "顺时针" else 旋转角度

        rotated_pil_image = pil_image.rotate(angle_to_rotate, resample=Image.BICUBIC, expand=True)

        output_tensor = self._pil_to_tensor(rotated_pil_image)

        return (output_tensor,)

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
    CATEGORY = "image/ZML_图像/工具"

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

        outputs = [dummy_image, dummy_image, dummy_image]

        active_output = real_output if real_output is not None else dummy_image

        if 0 <= selected_path < len(outputs):
            outputs[selected_path] = active_output
        else:
            outputs[0] = active_output

        return tuple(outputs) + (help_text,)

# --- API Endpoint (For Audio Player) ---
@server.PromptServer.instance.routes.get("/zml/get_audio")
async def get_audio_file(request):
    filename = request.query.get('filename')
    if not filename:
        return web.Response(status=400, text="Filename not provided")

    base_filename = os.path.basename(filename)
    if base_filename != filename:
        return web.Response(status=403, text="Forbidden")

    audio_dir = os.path.join(os.path.dirname(__file__), "audio")
    file_path = os.path.join(audio_dir, base_filename)

    if not os.path.exists(file_path):
        return web.Response(status=404, text=f"Audio file not found: {filename}")

    content_type = 'application/octet-stream'
    if filename.lower().endswith('.mp3'):
        content_type = 'audio/mpeg'
    elif filename.lower().endswith('.wav'):
        content_type = 'audio/wav'
    elif filename.lower().endswith('.ogg'):
        content_type = 'audio/ogg'

    try:
        with open(file_path, 'rb') as f:
            audio_data = f.read()
        return web.Response(body=audio_data, content_type=content_type)
    except Exception as e:
        return web.Response(status=500, text=f"Error reading file: {e}")

# ============================== AnyType HACK ==============================
# 实现可以匹配任意类型的代理类
class AlwaysEqualProxy(str):
    def __eq__(self, _):
        return True

    def __ne__(self, _):
        return False

# 创建一个 AlwaysEqualProxy 的实例，其值为通配符"*"
any_type = AlwaysEqualProxy("*")
# =====================================================================================


# ============================== 音频播放器节点 ==============================
class ZML_AudioPlayerNode:
    def __init__(self):
        self.audio_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "audio")
        os.makedirs(self.audio_dir, exist_ok=True)

    @classmethod
    def INPUT_TYPES(cls):
        audio_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "audio")
        if not os.path.exists(audio_dir):
            os.makedirs(audio_dir)

        supported_formats = ('.mp3', '.wav', '.ogg')
        audio_files = [f for f in os.listdir(audio_dir) if f.lower().endswith(supported_formats)]

        if not audio_files:
            audio_files = ["(空) 请在zml_w/audio文件夹中放入音频"]

        return {
            "required": {
                "音频文件": (audio_files,),
            },
            "optional": {
                # 使用 any_type 对象实例作为类型
                "任意输入": (any_type, {}),
            }
        }

    # 返回任意类型，以便可以连接到任何其他节点
    RETURN_TYPES = (any_type,)
    RETURN_NAMES = ("任意输出",)
    FUNCTION = "play_audio"
    CATEGORY = "image/ZML_图像/工具"

    def play_audio(self, 音频文件, 任意输入=None):
        # 后端什么也不做，只是传递输入的任意类型数据
        # 如果没有输入，则返回一个空元组作为占位符
        output = 任意输入 if 任意输入 is not None else tuple()
        # 返回结果，可以连接到其他任何节点
        return (output,)


# ============================== 桥接预览节点 ==============================
class ZML_ImageMemory:
    # 启用OUTPUT_NODE，使其能在UI中预览图像。
    OUTPUT_NODE = True

    def __init__(self):
        self.stored_image = None
        # 定义临时预览图像子目录
        self.temp_subfolder = "zml_image_memory_previews"
        self.temp_output_dir = folder_paths.get_temp_directory()
        # 本地持久化文件路径
        self.persistence_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "image_memory_cache.png")

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "关闭输入": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "输入图像": ("IMAGE",),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("图像",)
    FUNCTION = "store_and_retrieve_image"
    CATEGORY = "image/ZML_图像/工具"

    def store_and_retrieve_image(self, 关闭输入, 输入图像=None):
        image_to_output = None

        if 关闭输入:
            # 关闭输入时，从内存获取图像
            image_to_output = self.stored_image
        elif 输入图像 is not None:
            # 有新输入图像时，存储到内存
            self.stored_image = 输入图像
            image_to_output = 输入图像
        else:
            # 无新输入图像时，从内存获取
            image_to_output = self.stored_image

        if image_to_output is None:
            default_size = 1
            image_to_output = torch.zeros((1, default_size, default_size, 3), dtype=torch.float32, device="cpu")

        # ====== 处理UI预览图像 ======
        subfolder_path = os.path.join(self.temp_output_dir, self.temp_subfolder)
        os.makedirs(subfolder_path, exist_ok=True)

        # 将 tensor 转换为 PIL Image
        # 确保尺寸正确，如果 tensor 是 (1, 1, 1, 3)，PIL无法处理，需要先转换为 (1, 3) 假图
        if image_to_output.shape[1] == 1 and image_to_output.shape[2] == 1:
            # 对于1x1的黑图，创建一个可见的小图用于预览，例如 32x32，并保存
            preview_image_tensor = torch.zeros((1, 32, 32, 3), dtype=torch.float32, device=image_to_output.device)
            pil_image = Image.fromarray((preview_image_tensor.squeeze(0).cpu().numpy() * 255).astype(np.uint8))
        else:
            # 正常图像处理
            pil_image = Image.fromarray((image_to_output.squeeze(0).cpu().numpy() * 255).astype(np.uint8))

        # 生成唯一文件名
        filename = f"zml_image_memory_{uuid.uuid4()}.png"
        file_path = os.path.join(subfolder_path, filename)

        pil_image.save(file_path, "PNG")

        # 准备UI所需的数据
        ui_image_data = [{"filename": filename, "subfolder": self.temp_subfolder, "type": "temp"}]

        # 返回结果：(图像,), 同时返回UI信息
        return {"ui": {"images": ui_image_data}, "result": (image_to_output,)}

    def _save_to_local(self, image_tensor):
        """将图像张量保存到本地文件"""
        try:
            pil_image = Image.fromarray((image_tensor.squeeze(0).cpu().numpy() * 255).astype(np.uint8))
            pil_image.save(self.persistence_file, "PNG")
        except Exception as e:
            print(f"保存图像到本地失败: {e}")

    def _load_from_local(self):
        """从本地文件加载图像张量"""
        if os.path.exists(self.persistence_file):
            try:
                pil_image = Image.open(self.persistence_file).convert('RGB')
                image_np = np.array(pil_image).astype(np.float32) / 255.0
                return torch.from_numpy(image_np).unsqueeze(0)
            except Exception as e:
                print(f"从本地加载图像失败: {e}")
        return None

# ============================== 遮罩分离-2 节点 ==============================
class ZML_MaskSeparateDistance:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "输入遮罩": ("MASK",),
                "分离阈值": ("FLOAT", {
                    "default": 0.2,
                    "min": 0.0,
                    "max": 1.0,
                    "step": 0.01,
                    "display": "slider",
                }),
                "最小面积比例": ("FLOAT", {
                    "default": 0.01,
                    "min": 0.0,
                    "max": 1.0,
                    "step": 0.001,
                    "display": "slider",
                }),
            }
        }

    RETURN_TYPES = ("MASK", "MASK")
    RETURN_NAMES = ("靠左遮罩", "靠右遮罩")
    FUNCTION = "separate_mask"
    CATEGORY = "image/ZML_图像/遮罩"
    def _mask_to_numpy_uint8(self, mask_tensor: torch.Tensor) -> np.ndarray:
        """Converts a ComfyUI MASK tensor (B, H, W) to a (H, W) uint8 numpy array."""
        mask_np_float = mask_tensor.squeeze(0).cpu().numpy()
        mask_np_uint8 = (mask_np_float * 255).astype(np.uint8)
        _, binary_mask = cv2.threshold(mask_np_uint8, 127, 255, cv2.THRESH_BINARY)
        return binary_mask

    def _numpy_uint8_to_mask(self, mask_np: np.ndarray) -> torch.Tensor:
        """Converts a (H, W) uint8 numpy array to a ComfyUI MASK tensor (B, H, W)."""
        return torch.from_numpy(mask_np.astype(np.float32) / 255.0).unsqueeze(0)

    def separate_mask(self, 输入遮罩: torch.Tensor, 分离阈值: float, 最小面积比例: float):
        mask_np = self._mask_to_numpy_uint8(输入遮罩)
        h, w = mask_np.shape

        binary_mask = (mask_np > 127).astype(np.uint8) * 255

        num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(binary_mask, 8, cv2.CV_32S)

        mask_left = np.zeros((h, w), dtype=np.uint8)
        mask_right = np.zeros((h, w), dtype=np.uint8)

        if num_labels <= 1: # Only background or a single component
            return (self._numpy_uint8_to_mask(mask_left), self._numpy_uint8_to_mask(mask_right))

        valid_components = []
        valid_centroids = []
        total_image_pixels = h * w

        for i in range(1, num_labels): # Start from 1 to skip background
            area = stats[i, cv2.CC_STAT_AREA]
            if area > total_image_pixels * 最小面积比例:
                valid_components.append(i)
                valid_centroids.append(centroids[i])

        if not valid_components:
            return (self._numpy_uint8_to_mask(mask_left), self._numpy_uint8_to_mask(mask_right))

        if len(valid_components) == 1:
            mask_left[labels == valid_components[0]] = 255
            return (self._numpy_uint8_to_mask(mask_left), self._numpy_uint8_to_mask(mask_right))

        valid_centroids_np = np.array(valid_centroids)

        sorted_indices = np.argsort(valid_centroids_np[:, 0])
        sorted_components = [valid_components[i] for i in sorted_indices]
        sorted_centroids = valid_centroids_np[sorted_indices]

        best_split_idx = -1
        max_dist_between_groups = -1

        for i in range(len(sorted_components) - 1):
            left_group_centroids = sorted_centroids[:i+1]
            right_group_centroids = sorted_centroids[i+1:]

            left_max_x = left_group_centroids[:, 0].max()
            right_min_x = right_group_centroids[:, 0].min()

            current_dist = right_min_x - left_max_x

            if current_dist > max_dist_between_groups:
                max_dist_between_groups = current_dist
                best_split_idx = i

        pixel_threshold = 分离阈值 * w

        if best_split_idx != -1 and max_dist_between_groups > pixel_threshold:
            left_group_labels = sorted_components[:best_split_idx + 1]
            right_group_labels = sorted_components[best_split_idx + 1:]

            for label_id in left_group_labels:
                mask_left[labels == label_id] = 255
            for label_id in right_group_labels:
                mask_right[labels == label_id] = 255
        else:
            for label_id in valid_components:
                mask_left[labels == label_id] = 255

        return (self._numpy_uint8_to_mask(mask_left), self._numpy_uint8_to_mask(mask_right))


# ============================== 遮罩分离-3 节点 ==============================
class ZML_MaskSeparateThree:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "输入遮罩": ("MASK",),
                "分离阈值_1": ("FLOAT", {
                    "default": 0.1,
                    "min": 0.0,
                    "max": 1.0,
                    "step": 0.01,
                    "display": "slider",
                }),
                "分离阈值_2": ("FLOAT", {
                    "default": 0.1,
                    "min": 0.0,
                    "max": 1.0,
                    "step": 0.01,
                    "display": "slider",
                }),
                "最小面积比例": ("FLOAT", {
                    "default": 0.01,
                    "min": 0.0,
                    "max": 1.0,
                    "step": 0.001,
                    "display": "slider",
                }),
            }
        }

    RETURN_TYPES = ("MASK", "MASK", "MASK", "MASK")
    RETURN_NAMES = ("遮罩1_靠左", "遮罩2_中间", "遮罩3_靠右", "剩余遮罩")
    FUNCTION = "separate_mask_three"
    CATEGORY = "image/ZML_图像/遮罩"

    def _mask_to_numpy_uint8(self, mask_tensor: torch.Tensor) -> np.ndarray:
        """Converts a ComfyUI MASK tensor (B, H, W) to a (H, W) uint8 numpy array."""
        mask_np_float = mask_tensor.squeeze(0).cpu().numpy()
        mask_np_uint8 = (mask_np_float * 255).astype(np.uint8)
        _, binary_mask = cv2.threshold(mask_np_uint8, 127, 255, cv2.THRESH_BINARY)
        return binary_mask

    def _numpy_uint8_to_mask(self, mask_np: np.ndarray) -> torch.Tensor:
        """Converts a (H, W) uint8 numpy array to a ComfyUI MASK tensor (B, H, W)."""
        return torch.from_numpy(mask_np.astype(np.float32) / 255.0).unsqueeze(0)

    def separate_mask_three(self, 输入遮罩: torch.Tensor, 分离阈值_1: float, 分离阈值_2: float, 最小面积比例: float):
        mask_np = self._mask_to_numpy_uint8(输入遮罩)
        h, w = mask_np.shape

        binary_mask = (mask_np > 127).astype(np.uint8) * 255

        num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(binary_mask, 8, cv2.CV_32S)

        mask1 = np.zeros((h, w), dtype=np.uint8)
        mask2 = np.zeros((h, w), dtype=np.uint8)
        mask3 = np.zeros((h, w), dtype=np.uint8)
        remaining_mask = np.zeros((h, w), dtype=np.uint8)

        if num_labels <= 1:
            return (self._numpy_uint8_to_mask(mask1), self._numpy_uint8_to_mask(mask2),
                    self._numpy_uint8_to_mask(mask3), self._numpy_uint8_to_mask(remaining_mask))

        valid_components = []
        valid_centroids = []
        total_image_pixels = h * w

        for i in range(1, num_labels):
            area = stats[i, cv2.CC_STAT_AREA]
            if area > total_image_pixels * 最小面积比例:
                valid_components.append(i)
                valid_centroids.append(centroids[i])

        if not valid_components:
            return (self._numpy_uint8_to_mask(mask1), self._numpy_uint8_to_mask(mask2),
                    self._numpy_uint8_to_mask(mask3), self._numpy_uint8_to_mask(remaining_mask))

        if len(valid_components) == 1:
            mask1[labels == valid_components[0]] = 255
            return (self._numpy_uint8_to_mask(mask1), self._numpy_uint8_to_mask(mask2),
                    self._numpy_uint8_to_mask(mask3), self._numpy_uint8_to_mask(remaining_mask))
        elif len(valid_components) == 2:
            sorted_indices = np.argsort(np.array(valid_centroids)[:, 0])
            mask1[labels == valid_components[sorted_indices[0]]] = 255
            mask2[labels == valid_components[sorted_indices[1]]] = 255
            return (self._numpy_uint8_to_mask(mask1), self._numpy_uint8_to_mask(mask2),
                    self._numpy_uint8_to_mask(mask3), self._numpy_uint8_to_mask(remaining_mask))

        valid_centroids_np = np.array(valid_centroids)
        sorted_indices = np.argsort(valid_centroids_np[:, 0])
        sorted_components = [valid_components[i] for i in sorted_indices]
        sorted_centroids_x = valid_centroids_np[sorted_indices, 0] # Only X coordinates

        gaps = np.diff(sorted_centroids_x)

        pixel_threshold_1 = 分离阈值_1 * w
        pixel_threshold_2 = 分离阈值_2 * w

        if len(gaps) < 2:

            for label_id in valid_components:
                mask1[labels == label_id] = 255
            return (self._numpy_uint8_to_mask(mask1), self._numpy_uint8_to_mask(mask2),
                    self._numpy_uint8_to_mask(mask3), self._numpy_uint8_to_mask(remaining_mask))

        largest_gap_indices = np.argsort(gaps)[-2:] # Get indices of the 2 largest gaps
        split_point_indices = np.sort(largest_gap_indices) # Ensure they are in order

        split_1_ok = gaps[split_point_indices[0]] > pixel_threshold_1
        split_2_ok = gaps[split_point_indices[1]] > pixel_threshold_2

        if split_1_ok and split_2_ok:
            group1_labels = sorted_components[:split_point_indices[0] + 1]
            group2_labels = sorted_components[split_point_indices[0] + 1 : split_point_indices[1] + 1]
            group3_labels = sorted_components[split_point_indices[1] + 1:]

            for label_id in group1_labels:
                mask1[labels == label_id] = 255
            for label_id in group2_labels:
                mask2[labels == label_id] = 255
            for label_id in group3_labels:
                mask3[labels == label_id] = 255
        else:

            for label_id in valid_components:
                remaining_mask[labels == label_id] = 255

        return (self._numpy_uint8_to_mask(mask1), self._numpy_uint8_to_mask(mask2),
                self._numpy_uint8_to_mask(mask3), self._numpy_uint8_to_mask(remaining_mask))

# ============================== 统一图像分辨率节点 ==============================
class ZML_UnifyImageResolution:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像": ("IMAGE",),
                "分辨率": (["根据首张图像", "根据最大图像", "根据最小图像", "自定义"], {"default": "根据首张图像"}),
                "宽度": ("INT", {"default": 1024, "min": 8, "max": 8192, "step": 8}),
                "高度": ("INT", {"default": 1024, "min": 8, "max": 8192, "step": 8}),
                "处理模式": (["拉伸", "中心裁剪", "填充黑", "填充白"],),
            },
            "optional": {
                "图像_2": ("IMAGE",),
                "图像_3": ("IMAGE",),
                "图像_4": ("IMAGE",),
                "图像_5": ("IMAGE",),
            }
        }

    RETURN_TYPES = ("IMAGE", "INT", "INT")
    RETURN_NAMES = ("图像", "输出宽度", "输出高度")
    FUNCTION = "unify_resolution"
    CATEGORY = "image/ZML_图像/图像"

    def tensor_to_pil(self, tensor):
        # 确保转换为RGBA以正确处理透明度（尤其是填充模式）
        # 如果是批次维度，只取第一张进行转换，因为通常输入是 (B, H, W, C)
        # Squeeze dim 0 if it exists and is 1
        img_np = np.clip(255. * tensor.cpu().numpy().squeeze(0), 0, 255).astype(np.uint8)
        
        # 针对单通道图像 (如灰度图或遮罩) 转换为3通道，以适应RGBA转换
        if img_np.ndim == 2:
            img_np = np.stack([img_np, img_np, img_np], axis=-1)

        if img_np.ndim == 3 and img_np.shape[-1] == 4:
            return Image.fromarray(img_np, 'RGBA')
        elif img_np.ndim == 3 and img_np.shape[-1] == 3:
            return Image.fromarray(img_np, 'RGB').convert('RGBA')
        else: # Handle unexpected, try to convert to RGBA
            return Image.fromarray(img_np).convert('RGBA')

    def pil_to_tensor(self, pil_image):
        return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)

    # 辅助函数：根据处理模式获取默认填充颜色
    def _get_default_fill_color(self, 处理模式):
        if 处理模式 == "填充黑":
            return (0, 0, 0, 255) # 黑色透明度255
        elif 处理模式 == "填充白":
            return (255, 255, 255, 255) # 白色透明度255
        else: # 对于拉伸和中心裁剪，实际上不会用到填充色，但为了RGBA统一返回透明
            return (0, 0, 0, 0) # 完全透明

    def unify_resolution(self, 图像, 分辨率, 宽度, 高度, 处理模式, 图像_2=None, 图像_3=None, 图像_4=None, 图像_5=None):
        all_input_images_batches = [图像, 图像_2, 图像_3, 图像_4, 图像_5]

        # 过滤掉None的输入图像批次，并展平为一个列表，包含所有批次中的所有图像张量
        all_individual_images_tensors = []
        for batch_tensor in all_input_images_batches:
            if batch_tensor is not None:
                # 遍历批次中的每个单张图像
                for img_t in batch_tensor:
                    # 确保每张图像都有一个批次维度 (1, H, W, C)
                    all_individual_images_tensors.append(img_t.unsqueeze(0))

        # 初始化目标分辨率
        target_width = 宽度 # 默认使用节点输入的宽度
        target_height = 高度 # 默认使用节点输入的高度

        if 分辨率 == "自定义":
            # 如果是自定义模式，直接使用节点中输入的宽度和高度
            target_width = 宽度
            target_height = 高度
        else:
            # 根据所有传入的图像来计算目标分辨率
            if all_individual_images_tensors:
                first_image_dims = None
                max_w, max_h = 0, 0
                min_w, min_h = float('inf'), float('inf')

                # 遍历所有实际传入的图像，获取它们的尺寸信息
                for img_tensor_item in all_individual_images_tensors:
                    # tensor_to_pil 期望 (1, H, W, C)，所以我们传递单个图像张量
                    pil_img = self.tensor_to_pil(img_tensor_item) 
                    current_w, current_h = pil_img.size

                    if first_image_dims is None:
                        first_image_dims = (current_w, current_h)
                    
                    max_w = max(max_w, current_w)
                    max_h = max(max_h, current_h)
                    min_w = min(min_w, current_w)
                    min_h = min(min_h, current_h)
                
                # 根据“分辨率”选项设置最终目标分辨率
                if 分辨率 == "根据首张图像" and first_image_dims:
                    target_width, target_height = first_image_dims
                elif 分辨率 == "根据最大图像":
                    target_width, target_height = max_w, max_h
                elif 分辨率 == "根据最小图像":
                    target_width, target_height = min_w, min_h
                # 如果没有实际图像，或者选了根据图片但图片尺寸无效，则回到默认的宽度和高度
                else: 
                     if not first_image_dims or (target_width <= 0 or target_height <= 0):
                        logging.warning("ZML_UnifyImageResolution: No valid input images or chosen resolution source has zero dimensions. Falling back to custom width/height.")
                        target_width = 宽度
                        target_height = 高度
            else:
                # 如果没有任何图像输入，也使用节点中输入的宽度和高度
                logging.warning("ZML_UnifyImageResolution: No input images provided. Falling back to custom width/height.")
                target_width = 宽度
                target_height = 高度

        # 确保目标宽度和高度有效
        target_width = max(1, target_width)
        target_height = max(1, target_height)

        processed_images = []
        # 获取当前处理模式的默认填充色
        fill_color_rgba = self._get_default_fill_color(处理模式) 

        # 如果没有有效的输入图像，返回一个指定分辨率的纯色图像
        if not all_individual_images_tensors:
            new_image = Image.new("RGBA", (target_width, target_height), fill_color_rgba)
            final_output_batch = self.pil_to_tensor(new_image)
            return (final_output_batch, target_width, target_height)

        for img_tensor_batch_item in all_individual_images_tensors: # 遍历所有单独的图像张量
            pil_image = self.tensor_to_pil(img_tensor_batch_item).convert("RGBA")
            original_width, original_height = pil_image.size

            if original_width == 0 or original_height == 0:
                # 处理空图像情况，直接生成目标尺寸填充颜色的图像
                new_image = Image.new("RGBA", (target_width, target_height), fill_color_rgba)
                processed_images.append(self.pil_to_tensor(new_image))
                continue

            target_aspect = float(target_width) / target_height
            image_aspect = float(original_width) / original_height

            if 处理模式 == "拉伸":
                new_pil_image = pil_image.resize((target_width, target_height), resample=Image.Resampling.LANCZOS)
            elif 处理模式 == "中心裁剪":
                # 计算缩放后的尺寸，使图像能够完全覆盖目标区域
                if image_aspect > target_aspect:  # 图像宽于目标比例，以高度为基准缩放
                    resize_height = target_height
                    resize_width = int(resize_height * image_aspect)
                else:  # 图像高于目标比例，以宽度为基准缩放
                    resize_width = target_width
                    resize_height = int(resize_width / image_aspect)

                # 确保尺寸至少为1
                resize_width = max(1, resize_width)
                resize_height = max(1, resize_height)

                resized_image = pil_image.resize((resize_width, resize_height), resample=Image.Resampling.LANCZOS)

                # 计算裁剪区域
                cropped_left = (resize_width - target_width) / 2
                cropped_top = (resize_height - target_height) / 2
                cropped_right = (resize_width + target_width) / 2
                cropped_bottom = (resize_height + target_height) / 2
                new_pil_image = resized_image.crop((int(cropped_left), int(cropped_top), int(cropped_right), int(cropped_bottom)))

            elif 处理模式 in ["填充黑", "填充白"]: # 填充模式
                # 计算缩放后的尺寸，使图像能够完全适应目标区域
                if image_aspect > target_aspect:  # 图像宽于目标比例，以宽度为基准缩放
                    scaled_width = target_width
                    scaled_height = int(target_width / image_aspect)
                else:  # 图像高于目标比例，以高度为基准缩放
                    scaled_height = target_height
                    scaled_width = int(target_height * image_aspect)

                # 确保尺寸至少为1
                scaled_width = max(1, scaled_width)
                scaled_height = max(1, scaled_height)

                resized_image = pil_image.resize((scaled_width, scaled_height), resample=Image.Resampling.LANCZOS)

                # 创建新背景图像
                new_pil_image = Image.new("RGBA", (target_width, target_height), fill_color_rgba)

                # 计算粘贴位置 (居中)
                paste_x = (target_width - scaled_width) // 2
                paste_y = (target_height - scaled_height) // 2

                new_pil_image.paste(resized_image, (paste_x, paste_y), resized_image)

            processed_images.append(self.pil_to_tensor(new_pil_image))

        # 将所有处理过的单个图像张量合并成一个批次
        final_output_batch = torch.cat(processed_images, dim=0)

        return (final_output_batch, target_width, target_height) # 返回处理后的图像和输出宽高

# ============================== 限制遮罩形状节点 ==============================
class ZML_LimitMaskShape:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "遮罩": ("MASK",), # 输入接口名称更改为“遮罩”
                "形状": (["方形", "矩形"], {"default": "方形"}),
                "膨胀系数": ("FLOAT", { # 膨胀系数保持FLOAT，数字输入框
                    "default": 1.0,
                    "min": 0.1,
                    "max": 5.0,
                    "step": 0.1,
                    "display": "number",
                }),
                "最小面积比例": ("FLOAT", {
                    "default": 0.01,
                    "min": 0.0,
                    "max": 1.0,
                    "step": 0.001,
                    "display": "slider",
                }),
                # 删除了"阈值"选项
            }
        }

    RETURN_TYPES = ("MASK",)
    RETURN_NAMES = ("形状遮罩",) # 输出接口名称更改为“形状遮罩”
    FUNCTION = "limit_mask_shape"
    CATEGORY = "image/ZML_图像/遮罩"

    def _mask_to_numpy_uint8(self, mask_tensor: torch.Tensor) -> np.ndarray:
        """将 ComfyUI MASK 张量 (B, H, W) 转换为 (H, W) uint8 numpy 数组，并进行二值化（固定阈值127）。"""
        mask_np_float = mask_tensor.squeeze(0).cpu().numpy()
        mask_np_uint8 = (mask_np_float * 255).astype(np.uint8)
        _, binary_mask = cv2.threshold(mask_np_uint8, 127, 255, cv2.THRESH_BINARY)
        return binary_mask

    def _numpy_uint8_to_mask(self, mask_np: np.ndarray) -> torch.Tensor:
        """将 (H, W) uint8 numpy 数组转换为 ComfyUI MASK 张量 (B, H, W)。"""
        return torch.from_numpy(mask_np.astype(np.float32) / 255.0).unsqueeze(0)

    def limit_mask_shape(self, 遮罩: torch.Tensor, 形状: str, 膨胀系数: float, 最小面积比例: float):
        mask_np_binary = self._mask_to_numpy_uint8(遮罩)
        h, w = mask_np_binary.shape

        # ----------------- 新的局部有效区域过滤和全局边界计算 -----------------
        # Step 1: 过滤掉小的连通组件
        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask_np_binary, 8, cv2.CV_32S)
        
        filtered_mask = np.zeros_like(mask_np_binary)
        total_image_pixels = h * w
        has_valid_pixel = False

        if num_labels > 1: # 确保存在除了背景以外的连通组件
            for i in range(1, num_labels): # 跳过背景 (标签0)
                area = stats[i, cv2.CC_STAT_AREA]
                if area >= total_image_pixels * 最小面积比例:
                    filtered_mask[labels == i] = 255
                    has_valid_pixel = True
        # ----------------- ------------------------------------- -----------------

        output_mask_np = np.zeros((h, w), dtype=np.uint8)

        if not has_valid_pixel:
            # 如果没有找到任何符合最小面积的有效像素，返回全黑遮罩
            return (self._numpy_uint8_to_mask(output_mask_np),)

        # Step 2: 找到所有有效白色像素的全局边界
        # 找到所有非零（白色）像素的行和列索引
        white_pixels_y, white_pixels_x = np.where(filtered_mask == 255)

        if white_pixels_x.size == 0 or white_pixels_y.size == 0:
            # 如果过滤后没有任何白色像素，返回全黑遮罩
            return (self._numpy_uint8_to_mask(output_mask_np),)

        base_x = np.min(white_pixels_x)
        base_y = np.min(white_pixels_y)
        base_w = np.max(white_pixels_x) - base_x + 1 # +1 是因为max/min是索引，宽度是包含两端点的
        base_h = np.max(white_pixels_y) - base_y + 1 # +1 同上

        # 计算联合边界框的中心
        center_x = base_x + base_w // 2
        center_y = base_y + base_h // 2

        final_w, final_h = base_w, base_h # 默认值

        if 形状 == "方形":
            # 取联合边界框的最长边作为基础边长
            base_side = max(base_w, base_h)
            # 应用膨胀系数到边长
            final_side = int(base_side * 膨胀系数)
            if final_side < 1: final_side = 1 # 确保最小边长
            final_w = final_side
            final_h = final_side
        elif 形状 == "矩形":
            # 应用膨胀系数到原始宽度和高度
            final_w = int(base_w * 膨胀系数)
            final_h = int(base_h * 膨胀系数)
            if final_w < 1: final_w = 1 # 确保最小宽度
            if final_h < 1: final_h = 1 # 确保最小高度

        # 计算最终形状的左上角坐标
        # 根据中心点和新的宽高计算左上角
        final_x = center_x - final_w // 2
        final_y = center_y - final_h // 2


        # 确保最终矩形完全在图像边界内
        # 调整左上角坐标，使其不小于0
        final_x = max(0, final_x)
        final_y = max(0, final_y)

        # 调整宽度和高度，使其不超出图像右下边界
        final_w = min(final_w, w - final_x)
        final_h = min(final_h, h - final_y)
        
        # 防止调整后宽度或高度变为负数（如果原图太小或x/y过大）
        if final_w < 0: final_w = 0
        if final_h < 0: final_h = 0


        final_x_end = final_x + final_w
        final_y_end = final_y + final_h
        
        # 在输出遮罩上绘制最终的形状
        cv2.rectangle(output_mask_np, (final_x, final_y), (final_x_end, final_y_end), 255, -1)
        
        return (self._numpy_uint8_to_mask(output_mask_np),)

# ============================== 限制图像比例节点 ==============================
class ZML_LimitImageAspect:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像": ("IMAGE",),
                "目标比例": (["1：1", "16：9", "9：16", "3：2", "2：3", "4：3", "3：4", "21：9", "9：21", "5：4", "4：5"], {"default": "1：1"}),
                "模式": (["填充白", "填充黑", "裁剪", "拉伸"],),
                "限制分辨率": ("BOOLEAN", {"default": False, "tooltip": "如果启用，最终图像的宽度和高度将不会超过原始输入图像的宽度和高度。如果目标比例和模式导致尺寸变大，将等比缩小。"}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("处理后图像",)
    FUNCTION = "adjust_aspect_ratio"
    CATEGORY = "image/ZML_图像/图像" # 分类为 ZML_图像/图像

    def _tensor_to_pil(self, tensor: torch.Tensor) -> Image.Image:
        """Helper to convert ComfyUI IMAGE tensor to PIL Image (RGBA)."""
        img_np = np.clip(255. * tensor.cpu().numpy().squeeze(0), 0, 255).astype(np.uint8)
        if img_np.ndim == 3:
            if img_np.shape[2] == 4:
                return Image.fromarray(img_np, 'RGBA')
            elif img_np.shape[2] == 3:
                return Image.fromarray(img_np, 'RGB').convert('RGBA')
            else:
                return Image.fromarray(img_np).convert('RGBA')
        elif img_np.ndim == 2:
            return Image.fromarray(img_np, 'L').convert('RGBA')
        else:
            raise ValueError(f"Unsupported image tensor dimensions: {img_np.shape}")

    def _pil_to_tensor(self, pil_image: Image.Image) -> torch.Tensor:
        """Helper to convert PIL Image (RGBA/RGB) to ComfyUI IMAGE tensor."""
        if pil_image.mode not in ['RGB', 'RGBA']:
            pil_image = pil_image.convert('RGBA')
        return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)

    def adjust_aspect_ratio(self, 图像: torch.Tensor, 目标比例: str, 模式: str, 限制分辨率: bool):
        pil_image = self._tensor_to_pil(图像)
        original_width, original_height = pil_image.size

        # 1. 解析目标比例
        target_aspect_float = 1.0 # default for 1:1
        if 目标比例 == "16：9": target_aspect_float = 16.0 / 9.0
        elif 目标比例 == "9：16": target_aspect_float = 9.0 / 16.0
        elif 目标比例 == "3：2": target_aspect_float = 3.0 / 2.0
        elif 目标比例 == "2：3": target_aspect_float = 2.0 / 3.0
        elif 目标比例 == "4：3": target_aspect_float = 4.0 / 3.0
        elif 目标比例 == "3：4": target_aspect_float = 3.0 / 4.0
        elif 目标比例 == "21：9": target_aspect_float = 21.0 / 9.0
        elif 目标比例 == "9：21": target_aspect_float = 9.0 / 21.0
        elif 目标比例 == "5：4": target_aspect_float = 5.0 / 4.0
        elif 目标比例 == "4：5": target_aspect_float = 4.0 / 5.0

        # 处理空图像尺寸情况 (宽或高为0)
        # 返回一个符合目标比例的128x128（或等效尺寸）的颜色填充图
        if original_width == 0 or original_height == 0:
            default_fill_color = (0, 0, 0, 255) if 模式 == "填充黑" else (255, 255, 255, 255)
            # 确定一个非零的默认尺寸，并尊重目标比例 (例如，以128为基准)
            base_dim = 128
            if target_aspect_float >= 1: # 宽图 (或方形)
                fallback_width, fallback_height = int(base_dim * target_aspect_float), base_dim
            else: # 高图
                fallback_width, fallback_height = base_dim, int(base_dim / target_aspect_float)
            
            # 确保最小尺寸为1
            fallback_width = max(1, fallback_width)
            fallback_height = max(1, fallback_height)

            new_pil_image = Image.new("RGBA", (fallback_width, fallback_height), default_fill_color)
            return (self._pil_to_tensor(new_pil_image),)

        intermediate_result_pil = None # 用于存储未经最终分辨率限制处理的结果
        original_image_aspect = float(original_width) / original_height
        fill_color = (0, 0, 0, 255) if 模式 == "填充黑" else (255, 255, 255, 255)

        if 模式 == "拉伸":
            if original_width >= original_height: # 原始图像宽度更长或相等
                final_width = original_width
                final_height = int(final_width / target_aspect_float)
            else: # 原始图像高度更长
                final_height = original_height
                final_width = int(final_height * target_aspect_float)
            
            final_width = max(1, final_width)
            final_height = max(1, final_height)

            intermediate_result_pil = pil_image.resize((final_width, final_height), resample=Image.Resampling.LANCZOS)

        elif 模式 in ["填充白", "填充黑"]:
            # 填充模式现在总是根据原图尺寸来决定画布尺寸，以避免放大超出原图尺寸
            
            # 计算缩放后的原图尺寸，使其完全适应(fit in)目标比例矩形
            # 即以原图的宽或高为基准，确定新的宽高
            scale_factor_w = float(original_width) / original_width # 总是1
            scale_factor_h = float(original_height) / original_height # 总是1

            canvas_width = original_width
            canvas_height = original_height

            # 调整画布以符合目标比例
            if original_image_aspect < target_aspect_float: # 原始图像太“高”或不够“宽”，需要在左右填充
                canvas_width = int(original_height * target_aspect_float)
            else: # 原始图像太“宽”或不够“高”，需要在上下填充
                canvas_height = int(original_width / target_aspect_float)
            
            canvas_width = max(1, canvas_width)
            canvas_height = max(1, canvas_height)

            new_canvas = Image.new("RGBA", (canvas_width, canvas_height), fill_color)

            # 粘贴原图（无需缩放，因为画布尺寸是根据原图推导的）
            paste_x = (canvas_width - original_width) // 2
            paste_y = (canvas_height - original_height) // 2
            new_canvas.paste(pil_image, (paste_x, paste_y), pil_image) # 直接粘贴原图

            intermediate_result_pil = new_canvas

        elif 模式 == "裁剪":
            # 目标：在原始图像内找到一个符合目标比例的最大裁剪区域。
            # 裁剪模式本身就意味着缩小或保持尺寸，不会超出原始分辨率。
            
            crop_width, crop_height = 0, 0
            if original_image_aspect > target_aspect_float: # 原始图像相对目标比例更宽，以高度为基准确定裁剪宽度
                crop_height = original_height
                crop_width = int(original_height * target_aspect_float)
            else: # 原始图像相对目标比例更高或等比，以宽度为基准确定裁剪高度
                crop_width = original_width
                crop_height = int(original_width / target_aspect_float)
            
            crop_width = max(1, crop_width)
            crop_height = max(1, crop_height)

            # 计算裁剪框坐标以居中裁剪
            left = (original_width - crop_width) // 2
            top = (original_height - crop_height) // 2
            right = left + crop_width
            bottom = top + crop_height
            
            intermediate_result_pil = pil_image.crop((left, top, right, bottom))


        # 2. 应用 `限制分辨率` 开关 (仅当开关为 True 且结果超出原始尺寸时才生效)
        final_pil_image = intermediate_result_pil # 先假设 intermediate_result_pil 就是最终结果

        # 检查是否需要应用分辨率限制: 只有当限制分辨率为True 并且 (计算出的宽度大于原始宽度 或 计算出的高度大于原始高度)
        if 限制分辨率:
            current_width, current_height = final_pil_image.size
            if current_width > original_width or current_height > original_height:
                scale_factor = min(float(original_width) / current_width, float(original_height) / current_height)
                
                # 计算缩放后的尺寸，确保不为0
                new_limit_width = max(1, int(current_width * scale_factor))
                new_limit_height = max(1, int(current_height * scale_factor))
                
                # 执行缩放
                final_pil_image = final_pil_image.resize((new_limit_width, new_limit_height), resample=Image.Resampling.LANCZOS)

        # 3. 确保最终图像尺寸不为0（极端情况下可能出现）
        if final_pil_image.width == 0 or final_pil_image.height == 0:
            final_pil_image = Image.new("RGBA", (1, 1), (0, 0, 0, 255)) # 返回一个1x1的黑图

        output_tensor = self._pil_to_tensor(final_pil_image)

        return (output_tensor,)

# ============================== MAPPINGS ==============================
NODE_CLASS_MAPPINGS = {
    "ZML_AutoCensorNode": ZML_AutoCensorNode,
    "ZML_CustomCensorNode": ZML_CustomCensorNode,
    "ZML_YoloToMask": ZML_YoloToMask,
    "ZML_MaskSplitNode": ZML_MaskSplitNode,
    "ZML_MaskSplitNode_Five": ZML_MaskSplitNode_Five,
    "ZML_ImageRotate": ZML_ImageRotate,
    "ZML_PauseNode": ZML_PauseNode,
    "ZML_AudioPlayerNode": ZML_AudioPlayerNode,
    "ZML_ImageMemory": ZML_ImageMemory,
    "ZML_MaskSeparateDistance": ZML_MaskSeparateDistance,
    "ZML_MaskSeparateThree": ZML_MaskSeparateThree,
    "ZML_UnifyImageResolution": ZML_UnifyImageResolution,
    "ZML_LimitMaskShape": ZML_LimitMaskShape,
    "ZML_LimitImageAspect": ZML_LimitImageAspect,
    "ZML_MaskCropNode": ZML_MaskCropNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_AutoCensorNode": "ZML_YOLO打码",
    "ZML_CustomCensorNode": "ZML_遮罩打码",
    "ZML_YoloToMask": "ZML_YOLO到遮罩",
    "ZML_MaskSplitNode": "ZML_遮罩分割",
    "ZML_MaskSplitNode_Five": "ZML_遮罩分割-五",
    "ZML_ImageRotate": "ZML_图像旋转",
    "ZML_PauseNode": "ZML_图像暂停",
    "ZML_AudioPlayerNode": "ZML_音频播放器",
    "ZML_ImageMemory": "ZML_桥接预览图像",
    "ZML_MaskSeparateDistance": "ZML_遮罩分离-二",
    "ZML_MaskSeparateThree": "ZML_遮罩分离-三",
    "ZML_UnifyImageResolution": "ZML_统一图像分辨率",
    "ZML_LimitMaskShape": "ZML_限制遮罩形状",
    "ZML_LimitImageAspect": "ZML_限制图像比例",
    "ZML_MaskCropNode": "ZML_遮罩裁剪",
}
