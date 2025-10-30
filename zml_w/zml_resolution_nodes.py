# custom_nodes/ComfyUI-ZML-Image/zml_w/zml_resolution_nodes.py

import math
import os
from PIL import Image, ImageDraw, ImageFont, ImageOps
import numpy as np
import torch
import random
import json
from collections import deque
import base64
from io import BytesIO

try:
    from scipy.ndimage import binary_dilation
except ImportError:
    print("ZML_CropPureColorBackground/ZML_AddSolidColorBackground: scipy not found. '不规则形状' and '无固定形状' features will be disabled.")
    print("Please install it by running: pip install scipy")
    binary_dilation = None

# ============================== 限制分辨率格式节点 ==============================
class ZML_LimitResolution:
    @classmethod
    def INPUT_TYPES(cls):
        return { "required": { "倍数": ("INT", {"default": 8, "min": 1, "max": 256}), "模式": (["取大", "取小"],), }, "optional": { "数值_A": ("INT", {"forceInput": True}), "数值_B": ("INT", {"forceInput": True}), } }
    RETURN_TYPES = ("INT", "INT")
    RETURN_NAMES = ("结果_A", "结果_B")
    FUNCTION = "limit_value"
    CATEGORY = "image/ZML_图像/整数"
    def _calculate(self, value, multiple, mode):
        if value is None: return 0
        if multiple < 1: multiple = 1
        value_float, multiple_float = float(value), float(multiple)
        if mode == "取大": result = math.ceil(value_float / multiple_float) * multiple_float
        else: result = math.floor(value_float / multiple_float) * multiple_float
        return int(result)
    def limit_value(self, 倍数, 模式, 数值_A=None, 数值_B=None):
        if 倍数 < 1: 倍数 = 1
        return (self._calculate(数值_A, 倍数, 模式), self._calculate(数值_B, 倍数, 模式))

# ============================== 限制纯色背景大小节点 ==============================
class ZML_CropPureColorBackground:
    @classmethod
    def INPUT_TYPES(cls):
        return { 
            "required": { 
                "图像": ("IMAGE",), 
                "处理模式": (["矩形", "不规则形状"],), 
                "背景颜色": (["白色", "黑色", "绿色", "透明", "自定义"],), 
                "阈值": ("INT", {"default": 10, "min": 0, "max": 255}), 
                "不规则形状保留像素": ("INT", {"default": 50, "min": 0, "max": 256}), 
                "透明图像添加背景": (["无", "白色", "绿色"],), 
            },
            "optional": {
                "自定义背景颜色": ("STRING", {"default": "#000000"}),
            }
        }
    RETURN_TYPES = ("IMAGE",); RETURN_NAMES = ("图像",); FUNCTION = "crop_background"; CATEGORY = "image/ZML_图像/图像"
    
    def tensor_to_pil(self, tensor):
        img_np = np.clip(255. * tensor.cpu().numpy().squeeze(), 0, 255).astype(np.uint8)
        return Image.fromarray(img_np, 'RGBA' if img_np.shape[-1] == 4 else 'RGB')

    def pil_to_tensor(self, pil_image): 
        return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)

    def crop_background(self, 图像, 处理模式, 背景颜色, 阈值, 不规则形状保留像素, 透明图像添加背景, 自定义背景颜色="#000000"):
        cropped_images = []
        for img_tensor in 图像:
            pil_image = self.tensor_to_pil(img_tensor).convert("RGBA"); np_image = np.array(pil_image); h, w = np_image.shape[:2]
            
            target_rgb = None
            if 背景颜色 != "透明":
                if 背景颜色 == "白色":
                    target_rgb = np.array([255, 255, 255], dtype=np.float32)
                elif 背景颜色 == "黑色":
                    target_rgb = np.array([0, 0, 0], dtype=np.float32)
                elif 背景颜色 == "绿色":
                    target_rgb = np.array([0, 255, 0], dtype=np.float32)
                elif 背景颜色 == "自定义":
                    try:
                        hex_color = 自定义背景颜色.lstrip('#')
                        r, g, b = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
                        target_rgb = np.array([r, g, b], dtype=np.float32)
                    except Exception as e:
                        print(f"ZML_CropPureColorBackground: 无效的自定义颜色代码'{自定义背景颜色}'，将使用黑色作为默认背景。错误: {e}")
                        target_rgb = np.array([0, 0, 0], dtype=np.float32)

            def is_background(y, x):
                pixel = np_image[y, x]
                if 背景颜色 == "透明": 
                    return pixel[3] == 0
                else: 
                    if target_rgb is None: return False
                    return np.sum(np.abs(pixel[:3].astype(np.float32) - target_rgb)) <= 阈值

            final_pil = None
            if 处理模式 == "矩形":
                if 背景颜色 == "透明": 
                    mask = np_image[:, :, 3] > 0
                else: 
                    if target_rgb is None:
                        mask = np.ones((h, w), dtype=bool)
                    else:
                        mask = np.sum(np.abs(np_image[..., :3].astype(np.float32) - target_rgb), axis=-1) > 阈值
                
                coords = np.argwhere(mask)
                if coords.size > 0: 
                    y1, x1 = coords.min(axis=0); y2, x2 = coords.max(axis=0)
                    final_pil = Image.fromarray(np_image[y1:y2+1, x1:x2+1], 'RGBA')
            else: # 不规则形状
                if binary_dilation is None:
                    print("ZML_CropPureColorBackground: Scipy not installed. '不规则形状' mode is disabled.")
                    final_pil = pil_image
                else:
                    border_bg_mask = np.zeros((h, w), dtype=bool); q = deque()
                    for c in range(w):
                        if is_background(0, c) and not border_bg_mask[0, c]: q.append((0, c)); border_bg_mask[0, c] = True
                        if is_background(h-1, c) and not border_bg_mask[h-1, c]: q.append((h-1, c)); border_bg_mask[h-1, c] = True
                    for r in range(1, h-1):
                        if is_background(r, 0) and not border_bg_mask[r, 0]: q.append((r, 0)); border_bg_mask[r, 0] = True
                        if is_background(r, w-1) and not border_bg_mask[r, w-1]: q.append((r, w-1)); border_bg_mask[r, w-1] = True
                    
                    while q:
                        y, x = q.popleft()
                        for dy, dx in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
                            ny, nx = y + dy, x + dx
                            if 0 <= ny < h and 0 <= nx < w and not border_bg_mask[ny, nx] and is_background(ny, nx): 
                                border_bg_mask[ny, nx] = True; q.append((ny, nx))
                    
                    final_alpha_mask = None
                    if 不规则形状保留像素 > 0:
                        dilated_mask = binary_dilation(~border_bg_mask, iterations=不规则形状保留像素)
                        final_alpha_mask = ~dilated_mask
                    else: 
                        final_alpha_mask = border_bg_mask
                    
                    output_np = np_image.copy()
                    output_np[final_alpha_mask, 3] = 0
                    visible_coords = np.argwhere(~final_alpha_mask)
                    if visible_coords.size > 0: 
                        y1, x1 = visible_coords.min(axis=0); y2, x2 = visible_coords.max(axis=0)
                        final_pil = Image.fromarray(output_np[y1:y2+1, x1:x2+1], 'RGBA')

            if final_pil is None:
                fallback_color = (0,0,0,0)
                bg_map = {"白色": (255, 255, 255), "绿色": (0, 255, 0)}
                if 背景颜色 == "透明" and 透明图像添加背景 != "无": 
                    final_pil = Image.new("RGB", (1, 1), bg_map[透明图像添加背景])
                else:
                    if 背景颜色 == "白色": fallback_color = (255,255,255,255)
                    elif 背景颜色 == "黑色": fallback_color = (0,0,0,255)
                    elif 背景颜色 == "绿色": fallback_color = (0,255,0,255)
                    elif 背景颜色 == "自定义":
                        try:
                            hex_color = 自定义背景颜色.lstrip('#')
                            r, g, b = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
                            fallback_color = (r, g, b, 255)
                        except:
                            fallback_color = (0,0,0,255)
                    final_pil = Image.new("RGBA", (1, 1), fallback_color)

            if final_pil.mode == 'RGBA' and 透明图像添加背景 != "无":
                bg_color = {"白色": (255, 255, 255), "绿色": (0, 255, 0)}[透明图像添加背景]
                background = Image.new("RGB", final_pil.size, bg_color)
                background.paste(final_pil, (0, 0), final_pil)
                final_pil = background
            
            cropped_images.append(self.pil_to_tensor(final_pil))
        
        return (torch.cat(cropped_images, dim=0),)

# ============================== 添加纯色背景节点==============================
class ZML_AddSolidColorBackground:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像": ("IMAGE",),
                "处理模式": (["矩形", "无固定形状", "透明转纯色"],),
                "背景颜色": (["白色", "黑色", "绿色", "透明"],),
                "外拓像素": ("INT", {"default": 50, "min": 0, "max": 1024}),
                "外拓方向": (["全方向", "上", "下", "左", "右", "上下", "左右"],),
            }
        }
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("图像",)
    FUNCTION = "add_background"
    CATEGORY = "image/ZML_图像/图像"

    def tensor_to_pil(self, tensor):
        img_np = np.clip(255. * tensor.cpu().numpy().squeeze(), 0, 255).astype(np.uint8)
        return Image.fromarray(img_np, 'RGBA' if img_np.shape[-1] == 4 else 'RGB')

    def pil_to_tensor(self, pil_image):
        return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)

    def add_background(self, 图像, 处理模式, 背景颜色, 外拓像素, 外拓方向):
        color_map = {
            "白色": (255, 255, 255, 255), "黑色": (0, 0, 0, 255),
            "绿色": (0, 255, 0, 255), "透明": (0, 0, 0, 0)
        }
        bg_color = color_map.get(背景颜色, (255, 255, 255, 255))
        
        processed_images = []
        for img_tensor in 图像:
            pil_image = self.tensor_to_pil(img_tensor).convert("RGBA")
            
            if 处理模式 == "透明转纯色":
                background = Image.new("RGBA", pil_image.size, bg_color)
                background.paste(pil_image, (0, 0), pil_image)
                final_pil = background
            
            elif 处理模式 == "矩形":
                bbox = pil_image.getbbox()
                if not bbox: # 如果图像完全透明
                    final_pil = Image.new("RGBA", (外拓像素 if 外拓像素 > 0 else 1, 外拓像素 if 外拓像素 > 0 else 1), bg_color)
                else:
                    pad_top = pad_bottom = pad_left = pad_right = 0
                    if "上" in 外拓方向 or "全方向" in 外拓方向: pad_top = 外拓像素
                    if "下" in 外拓方向 or "全方向" in 外拓方向: pad_bottom = 外拓像素
                    if "左" in 外拓方向 or "全方向" in 外拓方向: pad_left = 外拓像素
                    if "右" in 外拓方向 or "全方向" in 外拓方向: pad_right = 外拓像素

                    subject = pil_image.crop(bbox)
                    new_width = subject.width + pad_left + pad_right
                    new_height = subject.height + pad_top + pad_bottom
                    
                    background = Image.new("RGBA", (new_width, new_height), bg_color)
                    background.paste(subject, (pad_left, pad_top), subject)
                    final_pil = background

            elif 处理模式 == "无固定形状":
                if binary_dilation is None:
                    print("ZML_AddSolidColorBackground: Scipy not installed. '无固定形状' mode is disabled. Falling back to '矩形' mode.")
                    # Scipy未安装时，回退到矩形模式（全方向）
                    bbox = pil_image.getbbox()
                    if not bbox:
                        final_pil = Image.new("RGBA", (外拓像素 if 外拓像素 > 0 else 1, 外拓像素 if 外拓像素 > 0 else 1), bg_color)
                    else:
                        subject = pil_image.crop(bbox)
                        pad = 外拓像素
                        new_width = subject.width + 2 * pad
                        new_height = subject.height + 2 * pad
                        background = Image.new("RGBA", (new_width, new_height), bg_color)
                        background.paste(subject, (pad, pad), subject)
                        final_pil = background
                else:
                    # 正常执行无固定形状逻辑
                    bbox = pil_image.getbbox()
                    if not bbox:
                        final_pil = Image.new("RGBA", (1, 1), (0,0,0,0)) # 完全透明的图像，返回一个透明像素
                    else:
                        # 1. 裁剪主体，并在一个更大的、带外拓边距的画布上操作
                        subject = pil_image.crop(bbox)
                        pad = 外拓像素
                        work_canvas = Image.new("RGBA", (subject.width + 2 * pad, subject.height + 2 * pad))
                        work_canvas.paste(subject, (pad, pad), subject)
                        
                        # 2. 获取Alpha蒙版并进行扩张
                        alpha_mask = np.array(work_canvas)[:, :, 3] > 0
                        dilated_mask = binary_dilation(alpha_mask, iterations=pad)
                        
                        # 3. 创建带颜色的背景层
                        background = Image.new("RGBA", work_canvas.size, bg_color)
                        
                        # 4. 将扩张后的蒙版应用到背景上
                        final_mask_pil = Image.fromarray(dilated_mask.astype(np.uint8) * 255, 'L')
                        background.putalpha(final_mask_pil)
                        
                        # 5. 将原始主体粘贴回中心
                        background.paste(work_canvas, (0, 0), work_canvas)
                        
                        # 6. 裁剪掉多余的透明区域
                        final_bbox = background.getbbox()
                        if final_bbox:
                            final_pil = background.crop(final_bbox)
                        else: # 如果结果是全透明，则返回一个1x1的透明图像
                            final_pil = Image.new("RGBA", (1, 1), (0,0,0,0))

            processed_images.append(self.pil_to_tensor(final_pil))
        return (torch.cat(processed_images, dim=0),)


# ============================== 可视化裁剪图像节点 ==============================
class ZML_VisualCropImage:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像": ("IMAGE",),
                "模式": (["矩形", "圆形", "路径选择", "画笔"],),
                "保持图像大小": ("BOOLEAN", {"default": False}),
                "裁剪比例": (["禁用", "1:1", "16:9", "9:16", "4:3", "3:4"],),
                "裁剪宽度": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 8}),
                "裁剪高度": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 8}),
                "crop_data": ("STRING", {"multiline": True, "default": "{}", "widget": "hidden"}),
            }
        }
    
    RETURN_TYPES = ("IMAGE", "IMAGE", "MASK",) # 添加了第二个 IMAGE 类型
    RETURN_NAMES = ("图像", "裁剪掉的图像", "遮罩",) # 添加了对应的名称
    FUNCTION = "crop_visually"
    CATEGORY = "image/ZML_图像/高级图像工具"

    def tensor_to_pil(self, t): 
        # 确保转换为RGBA以正确处理透明度
        return Image.fromarray(np.clip(255. * t.cpu().numpy().squeeze(), 0, 255).astype(np.uint8)).convert("RGBA")

    def pil_to_tensor(self, p): 
        return torch.from_numpy(np.array(p).astype(np.float32) / 255.0).unsqueeze(0)

    def crop_visually(self, 图像, 模式, 保持图像大小, **kwargs):
        crop_data = kwargs.get("crop_data", "{}")
        try:
            data = json.loads(crop_data)
        except:
            # 如果JSON解析失败，返回原始图像，一个全透明图像和一个全黑遮罩
            h, w = 图像.shape[1:3]
            black_mask = torch.zeros_like(图像[:, :, :, 0])
            transparent_image = torch.zeros_like(图像) # 全透明图像，假设图像是RGBA
            return (图像, transparent_image, black_mask,)
        
        cropped_images_list = []
        discarded_images_list = [] # 用于存储裁剪掉的图像
        mask_list = []

        for img_tensor in 图像:
            pil_image_rgba = self.tensor_to_pil(img_tensor).convert("RGBA") # 确保始终以RGBA处理
            full_size_mask = Image.new("L", pil_image_rgba.size, 0)
            draw = ImageDraw.Draw(full_size_mask)

            image_to_append = None 
            final_bbox = None

            if 模式 in ["路径选择", "画笔"]:
                points = data.get("points")
                bbox_data = data.get("bbox")
                if not points or not bbox_data:
                    # 如果数据无效，返回原始图像，全透明图像和全黑遮罩
                    black_mask = torch.zeros_like(img_tensor[:, :, 0])
                    transparent_image = torch.zeros_like(img_tensor)
                    cropped_images_list.append(img_tensor)
                    discarded_images_list.append(transparent_image)
                    mask_list.append(black_mask)
                    continue

                pts = [(p['x'], p['y']) for p in points]
                final_bbox = (int(bbox_data["x"]), int(bbox_data["y"]), int(bbox_data["x"]) + int(bbox_data["width"]), int(bbox_data["y"]) + int(bbox_data["height"]))
                if not pts:
                    # 如果数据无效，返回原始图像，全透明图像和全黑遮罩
                    black_mask = torch.zeros_like(img_tensor[:, :, 0])
                    transparent_image = torch.zeros_like(img_tensor)
                    cropped_images_list.append(img_tensor)
                    discarded_images_list.append(transparent_image)
                    mask_list.append(black_mask)
                    continue
                draw.polygon(pts, fill=255)

            else: # 矩形或圆形模式
                x, y, w, h = int(data.get("x",0)), int(data.get("y",0)), int(data.get("width",0)), int(data.get("height",0))
                if w == 0 or h == 0:
                    # 如果数据无效，返回原始图像，全透明图像和全黑遮罩
                    black_mask = torch.zeros_like(img_tensor[:, :, 0])
                    transparent_image = torch.zeros_like(img_tensor)
                    cropped_images_list.append(img_tensor)
                    discarded_images_list.append(transparent_image)
                    mask_list.append(black_mask)
                    continue
                final_bbox = (x, y, x + w, y + h)

                if 模式 == "圆形":
                    draw.ellipse(final_bbox, fill=255) 
                else: # 矩形模式
                    draw.rectangle(final_bbox, fill=255)
            
            # --- 处理“保留”部分图像 ---
            if 保持图像大小:
                output_image = Image.new("RGBA", pil_image_rgba.size, (0, 0, 0, 0))
                output_image.paste(pil_image_rgba, mask=full_size_mask)
                image_to_append = output_image
            else:
                if final_bbox:
                    # 创建一个临时的RGBA图像，将原图按遮罩粘贴，然后裁剪最小外接矩形
                    masked_output = Image.new("RGBA", pil_image_rgba.size, (0,0,0,0))
                    masked_output.paste(pil_image_rgba, mask=full_size_mask) 
                    image_to_append = masked_output.crop(final_bbox)
                else:
                    image_to_append = Image.new("RGBA", (1,1), (0,0,0,0)) # 默认一个透明像素

            # --- 处理“裁剪掉的”部分图像 ---
            # 反转遮罩
            inverted_mask = ImageOps.invert(full_size_mask)
            
            if 保持图像大小:
                discarded_image_full_size = Image.new("RGBA", pil_image_rgba.size, (0, 0, 0, 0))
                discarded_image_full_size.paste(pil_image_rgba, mask=inverted_mask)
                discarded_images_list.append(self.pil_to_tensor(discarded_image_full_size))
            else:
                # 裁剪掉的部分的图像，也可能是不规则的
                # 这里我们直接用inverted_mask将原图非裁剪区域置为透明，然后计算其边界进行裁剪
                discarded_masked_output = Image.new("RGBA", pil_image_rgba.size, (0,0,0,0))
                discarded_masked_output.paste(pil_image_rgba, mask=inverted_mask)
                discarded_bbox = discarded_masked_output.getbbox() # 获取裁剪掉部分的实际边界
                
                if discarded_bbox:
                    discarded_images_list.append(self.pil_to_tensor(discarded_masked_output.crop(discarded_bbox)))
                else:
                    discarded_images_list.append(self.pil_to_tensor(Image.new("RGBA", (1,1), (0,0,0,0)))) # 没有裁剪掉的部分，返回透明像素

            if image_to_append:
                cropped_images_list.append(self.pil_to_tensor(image_to_append))
                
                mask_np = np.array(full_size_mask).astype(np.float32) / 255.0
                mask_tensor = torch.from_numpy(mask_np).unsqueeze(0)
                mask_list.append(mask_tensor)

        if not cropped_images_list or not mask_list or not discarded_images_list:
             # 如果列表为空，返回原图和全透明/黑色的默认值
             h, w = 图像.shape[1:3]
             black_mask = torch.zeros_like(图像[:, :, :, 0])
             transparent_image = torch.zeros_like(图像) # 全透明图像，假设图像是RGBA
             return (图像, transparent_image, black_mask,)

        final_cropped_tensors = torch.cat(cropped_images_list, dim=0)
        final_discarded_tensors = torch.cat(discarded_images_list, dim=0) # 新增
        final_mask_tensors = torch.cat(mask_list, dim=0)
        
        return (final_cropped_tensors, final_discarded_tensors, final_mask_tensors) # 调整返回顺序

# ============================== 合并图像节点==============================
class ZML_MergeImages:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "底图": ("IMAGE",),
                "前景图_1": ("IMAGE",),
                "transform_data": ("STRING", {"multiline": True, "default": "{}", "widget": "hidden"}),
            },
            "optional": {
                "前景图_2": ("IMAGE",),
                "前景图_3": ("IMAGE",),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("图像",)
    FUNCTION = "merge_images"
    CATEGORY = "image/ZML_图像/高级图像工具"

    def _tensor_to_pil(self, tensor_slice): 
        # Convert tensor to PIL Image, ensuring it has an alpha channel if needed
        img_np = np.clip(255. * tensor_slice.cpu().numpy(), 0, 255).astype(np.uint8)
        if img_np.shape[-1] == 4: # Already RGBA
            return Image.fromarray(img_np, 'RGBA')
        elif img_np.shape[-1] == 3: # RGB, convert to RGBA
            return Image.fromarray(img_np, 'RGB').convert('RGBA')
        return Image.fromarray(img_np) # Fallback, should not happen with standard IMAGE type

    def _pil_to_tensor(self, pil_image):
        return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)

    def merge_images(self, 底图, 前景图_1, transform_data, 前景图_2=None, 前景图_3=None):
        try:
            data = json.loads(transform_data)
            # 旧版逻辑：直接将数据作为参数数组
            if not isinstance(data, list):
                print("ZML_MergeImages: transform_data格式不正确，预计为列表。")
                return (底图,)
            layer_params = data
        except (json.JSONDecodeError, KeyError) as e:
            print(f"ZML_MergeImages: 解析transform_data失败: {e}。返回原始底图。")
            return (底图,)

        fg_images = [前景图_1, 前景图_2, 前景图_3]
        
        output_images = []
        batch_size = 底图.shape[0]

        for i in range(batch_size):
            # 将底图转换为RGBA模式，以便支持透明度合并
            bg_pil = self._tensor_to_pil(底图[i]).convert("RGBA")

            for layer_idx, fg_tensor_batch in enumerate(fg_images):
                if fg_tensor_batch is not None and i < fg_tensor_batch.shape[0]:
                    if layer_idx >= len(layer_params): continue # 没有该图层的参数，跳过
                    
                    params = layer_params[layer_idx]
                    if not params: continue # 参数为空，跳过

                    # 将前景图转换为RGBA模式
                    fg_pil = self._tensor_to_pil(fg_tensor_batch[i]).convert("RGBA")

                    new_width = int(fg_pil.width * params.get('scaleX', 1.0))
                    new_height = int(fg_pil.height * params.get('scaleY', 1.0))
                    if new_width <= 0 or new_height <= 0: continue # 尺寸无效，跳过
                    
                    # 调整大小，使用高质量的插值方法
                    fg_pil_resized = fg_pil.resize((new_width, new_height), Image.Resampling.LANCZOS)
                    
                    # 旋转前景图
                    fg_pil_rotated = fg_pil_resized.rotate(-params.get('angle', 0), expand=True, resample=Image.Resampling.BICUBIC)
                    
                    # MODIFICATION START: Apply opacity
                    opacity = float(params.get('opacity', 1.0)) # 从参数中获取不透明度，默认为1.0（完全不透明）
                    if opacity < 1.0:
                        # 分离RGB和Alpha通道
                        r, g, b, a = fg_pil_rotated.split()
                        # 根据不透明度调整Alpha通道
                        a = a.point(lambda p: p * opacity)
                        fg_pil_rotated = Image.merge('RGBA', (r, g, b, a))
                    # MODIFICATION END

                    # 计算粘贴位置
                    # Fabricjs的left/top是中心点，PIL paste是左上角
                    paste_x = int(params.get('left', 0) - fg_pil_rotated.width / 2)
                    paste_y = int(params.get('top', 0) - fg_pil_rotated.height / 2)

                    # 将前景图粘贴到底图上，使用前景图的Alpha通道作为蒙版
                    bg_pil.paste(fg_pil_rotated, (paste_x, paste_y), fg_pil_rotated)

            # 最终输出为RGB模式，如果不需要透明背景的话
            # 如果需要保留透明度，则改为 "RGBA"
            final_pil = bg_pil.convert("RGB") 
            output_images.append(self._pil_to_tensor(final_pil))

        if not output_images:
            return (底图,) # 如果没有处理任何图像，返回原始底图

        return (torch.cat(output_images, dim=0),)

# ============================== 画画 = ==============================
class ZML_ImagePainter:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "默认宽": ("INT", {"default": 1024, "min": 1, "max": 8192, "step": 1}),
                "默认高": ("INT", {"default": 1024, "min": 1, "max": 8192, "step": 1}),
                "清空绘制内容": ("BOOLEAN", {"default": False, "tooltip": "开启此按钮时，每次打开绘制UI都会清空画布"}),
                "启用自适应动画": ("BOOLEAN", {"default": True, "tooltip": "开启此按钮时，打开UI会显示窗口自适应动画；关闭时直接显示默认大小窗口"}),
                "paint_data": ("STRING", {"multiline": True, "default": "{}", "widget": "hidden"}),
            },
            "optional": { 
                "图像": ("IMAGE",),
                "画笔图像": ("IMAGE",),
            }
        }

    RETURN_TYPES = ("IMAGE", "IMAGE", "MASK")
    RETURN_NAMES = ("图像", "绘制图层", "遮罩")
    FUNCTION = "paint_image"
    CATEGORY = "image/ZML_图像/高级图像工具"

    def tensor_to_pil(self, tensor, mode='RGBA'):
        img_np = np.clip(255. * tensor.cpu().numpy().squeeze(), 0, 255).astype(np.uint8)
        pil_image = Image.fromarray(img_np)
        return pil_image.convert(mode)

    def pil_to_tensor(self, pil_image):
        mode = pil_image.mode
        if mode == 'L':
            return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)
        elif mode == 'RGB':
            return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)
        elif mode == 'RGBA':
            return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)
        else: # Fallback for other modes
            return torch.from_numpy(np.array(pil_image.convert("RGBA")).astype(np.float32) / 255.0).unsqueeze(0)

    def paint_image(self, 默认宽, 默认高, 清空绘制内容=False, 启用自适应动画=True, paint_data="{}", 图像=None, 画笔图像=None):
        # 始终尝试解析paint_data，无论清空绘制内容参数如何设置
        # 这样可以确保用户在UI中绘制的内容能够被正确应用
        try:
            data = json.loads(paint_data)
        except (json.JSONDecodeError, KeyError, ValueError, TypeError) as e:
            print(f"ZML_ImagePainter: 解析paint_data时出错: {e}. 返回原始图像。")
            data = {}

        draw_paths = data.get('draw_paths', [])
        image_stamps = data.get('image_stamps', [])
        mosaic_rects = data.get('mosaic_rects', [])
        
        # 如果没有图像输入，创建默认的黑色空画布
        if 图像 is None:
            h, w = 默认高, 默认宽
            # 创建一个黑色张量，维度为 [1, h, w, 3]，因为图像通常是 RGB 格式
            图像 = torch.zeros((1, h, w, 3), dtype=torch.float32)
        
        is_empty_paint = not draw_paths and not image_stamps and not mosaic_rects
        if is_empty_paint:
            h, w = 图像.shape[1:3]
            black_mask_tensor = torch.zeros((图像.shape[0], h, w), dtype=torch.float32)
            # 创建空的绘制图层（透明背景）
            empty_draw_layer = torch.zeros((图像.shape[0], h, w, 4), dtype=torch.float32)
            return (图像, empty_draw_layer, black_mask_tensor)

        brush_pil = None
        if 画笔图像 is not None and len(image_stamps) > 0:
            brush_pil = self.tensor_to_pil(画笔图像[0])

        processed_images = []
        mask_tensors = []
        draw_layers = []
        
        for img_tensor in 图像:
            pil_image = self.tensor_to_pil(img_tensor).convert("RGBA")
            mask_image = Image.new('L', pil_image.size, 0)
            
            # 创建一个副本用于马赛克处理，避免影响后续的图像笔刷和路径绘制
            mosaic_layer = pil_image.copy()
            
            # 创建一个透明背景的绘制图层，只包含绘制内容
            draw_layer = Image.new('RGBA', pil_image.size, (0, 0, 0, 0))

            # 1. 绘制马赛克
            if mosaic_rects:
                # 创建马赛克专用的临时图层
                mosaic_temp_layer = Image.new('RGBA', pil_image.size, (0, 0, 0, 0))
                
                for rect in mosaic_rects:
                    try:
                        # 确保所有坐标和尺寸都是整数
                        x, y, w, h = map(int, [rect['x'], rect['y'], rect['w'], rect['h']])
                        if w <= 0 or h <= 0: continue
                        
                        box = (x, y, x + w, y + h)
                        region = pil_image.crop(box)
                        
                        # 缩小再放大以创建马赛克效果
                        pixel_size = max(1, int(rect.get('pixelSize', 10)))
                        small = region.resize((w // pixel_size, h // pixel_size), Image.NEAREST)
                        mosaic = small.resize(region.size, Image.NEAREST)
                        
                        mosaic_layer.paste(mosaic, box)
                        mosaic_temp_layer.paste(mosaic, box)
                        
                        # 在遮罩上标记马赛克区域
                        draw_mask = ImageDraw.Draw(mask_image)
                        draw_mask.rectangle(box, fill=255)
                    except Exception as e:
                        print(f"ZML_ImagePainter: 绘制马赛克时出错: {e}")
                
                # 将马赛克绘制到绘制图层
                draw_layer = Image.alpha_composite(draw_layer, mosaic_temp_layer)

            # 2. 绘制图像笔刷 (在马赛克层之上)
            if brush_pil and image_stamps:
                # 创建笔刷专用的临时图层
                brush_temp_layer = Image.new('RGBA', pil_image.size, (0, 0, 0, 0))
                
                for stamp in image_stamps:
                    try:
                        w, h = brush_pil.size
                        scale = float(stamp.get('scale', 1.0))
                        new_size = (int(w * scale), int(h * scale))
                        if new_size[0] < 1 or new_size[1] < 1: continue
                        
                        resized_brush = brush_pil.resize(new_size, Image.LANCZOS)
                        x_pos = int(stamp['x'] - new_size[0] / 2)
                        y_pos = int(stamp['y'] - new_size[1] / 2)
                        
                        mosaic_layer.paste(resized_brush, (x_pos, y_pos), resized_brush)
                        brush_temp_layer.paste(resized_brush, (x_pos, y_pos), resized_brush)
                        
                        # 在遮罩上标记笔刷区域
                        mask_stamp = Image.new('L', resized_brush.size, 255)
                        draw_mask = ImageDraw.Draw(mask_image)
                        draw_mask.bitmap((x_pos, y_pos), mask_stamp, fill=255)
                    except Exception as e:
                        print(f"ZML_ImagePainter: 绘制图像笔刷时出错: {e}")
                
                # 将笔刷绘制到绘制图层
                draw_layer = Image.alpha_composite(draw_layer, brush_temp_layer)

            # 3. 绘制路径和形状 (在所有图层之上)
            if draw_paths:
                draw_img = ImageDraw.Draw(mosaic_layer)
                draw_mask = ImageDraw.Draw(mask_image)
                # 创建路径专用的临时图层
                path_temp_layer = Image.new('RGBA', pil_image.size, (0, 0, 0, 0))
                
                for path in draw_paths:
                    try:
                        points = path.get('points', [])
                        if len(points) < 1: continue
                        
                        pts_int = [tuple(map(int, p)) for p in points]
                        color_str = path.get('color', '#FF0000')
                        width = int(path.get('width', 5))
                        is_fill = path.get('isFill', False)
                        
                        # 解析颜色，支持rgba和hex格式
                        if color_str.startswith('rgba'):
                            # 解析rgba格式: rgba(r, g, b, a)
                            import re
                            rgba_match = re.search(r'rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)', color_str)
                            if rgba_match:
                                r, g, b, alpha = map(float, rgba_match.groups())
                                alpha = int(alpha * 255)  # 转换为0-255范围
                                fill_color = (int(r), int(g), int(b), alpha)
                            else:
                                # 解析失败，使用默认值
                                fill_color = (255, 0, 0, 255)
                        else:
                            # 处理十六进制颜色
                            hex_color = color_str.lstrip('#')
                            if len(hex_color) == 6:
                                r = int(hex_color[0:2], 16)
                                g = int(hex_color[2:4], 16)
                                b = int(hex_color[4:6], 16)
                                fill_color = (r, g, b, 255)  # 默认完全不透明
                            else:
                                fill_color = (255, 0, 0, 255)  # 默认红色
                        
                        # 创建一个临时图层用于绘制透明效果
                        temp_layer = Image.new('RGBA', mosaic_layer.size, (0, 0, 0, 0))
                        temp_draw = ImageDraw.Draw(temp_layer)
                        
                        if is_fill:
                            # 与前端一致：既填充形状，又绘制边框线（使用strokeWidth）
                            # 先填充
                            temp_draw.polygon(pts_int, fill=fill_color)
                            draw_mask.polygon(pts_int, fill=255)
                            
                            # 再绘制边框线，保证与fabric的填充+描边效果一致
                            if len(pts_int) > 1:
                                # 不强制闭合，保持与保存的数据一致；非箭头通常已包含首点收尾
                                temp_draw.line(pts_int, fill=fill_color, width=width, joint='curve')
                                draw_mask.line(pts_int, fill=255, width=width, joint='curve')
                                # 圆润端点
                                r = width / 2
                                start_x, start_y = pts_int[0]
                                temp_draw.ellipse([start_x-r, start_y-r, start_x+r, start_y+r], fill=fill_color)
                                draw_mask.ellipse([start_x-r, start_y-r, start_x+r, start_y+r], fill=255)
                                end_x, end_y = pts_int[-1]
                                temp_draw.ellipse([end_x-r, end_y-r, end_x+r, end_y+r], fill=fill_color)
                                draw_mask.ellipse([end_x-r, end_y-r, end_x+r, end_y+r], fill=255)
                        else:
                            # 单点情况，画一个圆点
                            if len(pts_int) == 1:
                                r = width / 2
                                box = [pts_int[0][0]-r, pts_int[0][1]-r, pts_int[0][0]+r, pts_int[0][1]+r]
                                temp_draw.ellipse(box, fill=fill_color)
                                draw_mask.ellipse(box, fill=255)
                            else: # 多点情况，画线
                                # 绘制基础线条
                                temp_draw.line(pts_int, fill=fill_color, width=width, joint='curve')
                                draw_mask.line(pts_int, fill=255, width=width, joint='curve')
                                
                                # 为线条端点添加圆形来模拟圆角效果
                                if len(pts_int) > 1:
                                    # 在起点和终点绘制圆形
                                    r = width / 2
                                    # 起点
                                    start_x, start_y = pts_int[0]
                                    temp_draw.ellipse([start_x-r, start_y-r, start_x+r, start_y+r], fill=fill_color)
                                    draw_mask.ellipse([start_x-r, start_y-r, start_x+r, start_y+r], fill=255)
                                    # 终点
                                    end_x, end_y = pts_int[-1]
                                    temp_draw.ellipse([end_x-r, end_y-r, end_x+r, end_y+r], fill=fill_color)
                                    draw_mask.ellipse([end_x-r, end_y-r, end_x+r, end_y+r], fill=255)
                        
                        # 将临时图层合并到马赛克层和路径临时图层
                        mosaic_layer = Image.alpha_composite(mosaic_layer, temp_layer)
                        path_temp_layer = Image.alpha_composite(path_temp_layer, temp_layer)
                    except Exception as e:
                        print(f"ZML_ImagePainter: 绘制路径时出错: {e}")
                
                # 将路径绘制到绘制图层
                draw_layer = Image.alpha_composite(draw_layer, path_temp_layer)

            processed_images.append(self.pil_to_tensor(mosaic_layer.convert("RGB")))
            mask_tensors.append(self.pil_to_tensor(mask_image))
            draw_layers.append(self.pil_to_tensor(draw_layer))

        if not processed_images:
            # 创建空的绘制图层（透明背景）
            h, w = 图像.shape[1:3]
            empty_draw_layer = torch.zeros((图像.shape[0], h, w, 4), dtype=torch.float32)
            return (图像, empty_draw_layer, torch.zeros_like(图像[:, :, :, 0]))

        return (torch.cat(processed_images, dim=0), torch.cat(draw_layers, dim=0), torch.cat(mask_tensors, dim=0))

# ============================== 取色器节点 ==============================
class ZML_ColorPicker:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "颜色代码": ("STRING", {"multiline": False, "default": "#FFFFFF", "widget": "hidden"}),
                "随机输出颜色": ("BOOLEAN", {"default": False}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("颜色代码",)
    FUNCTION = "get_color"
    CATEGORY = "image/ZML_图像/工具"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")

    def get_color(self, 颜色代码, 随机输出颜色=False):
        if 随机输出颜色:
            r = random.randint(0, 255)
            g = random.randint(0, 255)
            b = random.randint(0, 255)
            随机颜色代码 = f"#{r:02X}{g:02X}{b:02X}"
            return (随机颜色代码,)
        return (颜色代码,)


# ============================== 颜色到遮罩节点 ==============================
class ZML_ColorToMask:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像": ("IMAGE",),
                "颜色代码1": ("STRING", {"default": "#FF0000", "label": "颜色代码一(红)", "placeholder": "如 #FF0000"}),
                "颜色代码2": ("STRING", {"default": "#00FF00", "label": "颜色代码二(绿)", "placeholder": "如 #00FF00"}),
                "颜色代码3": ("STRING", {"default": "#0000FF", "label": "颜色代码三(蓝)", "placeholder": "如 #0000FF"}),
                "容差": ("INT", {"default": 10, "min": 0, "max": 255, "step": 1, "label": "颜色容差"}),
            },
            "hidden": {
                "color_picker_data": ("STRING", {"default": "{}", "widget": "hidden"}),
            }
        }

    RETURN_TYPES = ("MASK", "MASK", "MASK")
    RETURN_NAMES = ("遮罩1", "遮罩2", "遮罩3")
    FUNCTION = "color_to_mask"
    CATEGORY = "image/ZML_图像/遮罩"

    def tensor_to_pil(self, tensor):
        img_np = np.clip(255. * tensor.cpu().numpy().squeeze(), 0, 255).astype(np.uint8)
        return Image.fromarray(img_np, 'RGBA' if img_np.shape[-1] == 4 else 'RGB')

    def pil_to_tensor(self, pil_image):
        return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)

    def hex_to_rgb(self, hex_color):
        try:
            hex_color = hex_color.lstrip('#')
            r, g, b = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
            return np.array([r, g, b], dtype=np.float32)
        except:
            return np.array([0, 0, 0], dtype=np.float32)  # 默认黑色

    def color_to_mask(self, 图像, 颜色代码1, 颜色代码2, 颜色代码3, 容差, color_picker_data="{}"):
        color1_rgb = self.hex_to_rgb(颜色代码1)
        color2_rgb = self.hex_to_rgb(颜色代码2)
        color3_rgb = self.hex_to_rgb(颜色代码3)

        mask1_list = []
        mask2_list = []
        mask3_list = []

        for img_tensor in 图像:
            pil_image = self.tensor_to_pil(img_tensor).convert("RGB")
            np_image = np.array(pil_image).astype(np.float32)

            # 计算与目标颜色的欧氏距离
            dist1 = np.sqrt(np.sum((np_image - color1_rgb) ** 2, axis=-1))
            dist2 = np.sqrt(np.sum((np_image - color2_rgb) ** 2, axis=-1))
            dist3 = np.sqrt(np.sum((np_image - color3_rgb) ** 2, axis=-1))

            # 根据容差生成遮罩
            mask1 = (dist1 <= 容差).astype(np.float32)
            mask2 = (dist2 <= 容差).astype(np.float32)
            mask3 = (dist3 <= 容差).astype(np.float32)

            mask1_tensor = torch.from_numpy(mask1)
            mask2_tensor = torch.from_numpy(mask2)
            mask3_tensor = torch.from_numpy(mask3)

            mask1_list.append(mask1_tensor)
            mask2_list.append(mask2_tensor)
            mask3_list.append(mask3_tensor)

        if not mask1_list or not mask2_list or not mask3_list:
            h, w = 图像.shape[1:3]
            return (torch.zeros((图像.shape[0], h, w)), torch.zeros((图像.shape[0], h, w)), torch.zeros((图像.shape[0], h, w)))

        return (torch.stack(mask1_list, dim=0), torch.stack(mask2_list, dim=0), torch.stack(mask3_list, dim=0))

# ============================== 节点注册 ==============================
NODE_CLASS_MAPPINGS = {
    "ZML_LimitResolution": ZML_LimitResolution,
    "ZML_CropPureColorBackground": ZML_CropPureColorBackground,
    "ZML_AddSolidColorBackground": ZML_AddSolidColorBackground,
    "ZML_VisualCropImage": ZML_VisualCropImage,
    "ZML_MergeImages": ZML_MergeImages,
    "ZML_ImagePainter": ZML_ImagePainter,
    "ZML_ColorPicker": ZML_ColorPicker,
    "ZML_ColorToMask": ZML_ColorToMask,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_LimitResolution": "ZML_限制分辨率格式",
    "ZML_CropPureColorBackground": "ZML_限制纯色背景大小",
    "ZML_AddSolidColorBackground": "ZML_添加纯色背景",
    "ZML_VisualCropImage": "ZML_可视化裁剪图像",
    "ZML_MergeImages": "ZML_合并图像",
    "ZML_ImagePainter": "ZML_画画",
    "ZML_ColorPicker": "ZML_取色器",
    "ZML_ColorToMask": "ZML_颜色到遮罩",
}
