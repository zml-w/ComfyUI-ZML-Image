# custom_nodes/zml_w/zml_resolution_nodes.py

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

# ============================== 添加文字水印节点 ==============================
class ZML_AddTextWatermark:
    def __init__(self):
        self.node_dir = os.path.dirname(os.path.abspath(__file__))
        self.font_dir = os.path.join(self.node_dir, "Text")
        self.counter_dir = os.path.join(self.node_dir, "counter")
        os.makedirs(self.counter_dir, exist_ok=True)
        self.counter_file = os.path.join(self.counter_dir, "Watermark.txt")
        os.makedirs(self.font_dir, exist_ok=True)
        self.ensure_counter_file()

    def ensure_counter_file(self):
        try:
            if not os.path.exists(self.counter_file):
                with open(self.counter_file, "w", encoding="utf-8") as f:
                    f.write("0")
        except Exception as e:
            print(f"创建水印计数文件失败: {e}")

    def increment_counter(self):
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
            print(f"更新水印计数失败: {e}")
            return 1
        return count

    @classmethod
    def INPUT_TYPES(cls):
        font_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Text")
        if not os.path.exists(font_dir):
            os.makedirs(font_dir)
        fonts = [f for f in os.listdir(font_dir) if f.lower().endswith(('.ttf', '.otf'))]
        if not fonts:
            fonts = ["Default"]
        return {
            "required": {
                "图像": ("IMAGE",),
                "文本": ("STRING", {"multiline": True, "default": "ZML_水印"}),
                "字体": (fonts,),
                "字体大小": ("INT", {"default": 48, "min": 8, "max": 1024}),
                "颜色": ("STRING", {"default": "#000000", "placeholder": "留空为透明字体; 输入'ZML'为随机填充色"}), # 默认黑色
                "不透明度": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 1.0, "step": 0.01}),
                "书写方向": (["横排", "竖排"],),
                "位置": (["左上", "中上", "右上", "左中", "居中", "右中", "左下", "中下", "右下", "全屏"],),
                "水平边距": ("INT", {"default": 20, "min": 0, "max": 4096}),
                "垂直边距": ("INT", {"default": 20, "min": 0, "max": 4096}),
                "字符间距": ("INT", {"default": 0, "min": -50, "max": 100}),
                "行间距": ("INT", {"default": 10, "min": -50, "max": 200}),
                "描边宽度": ("INT", {"default": 1, "min": 0, "max": 100}), # 默认描边宽度1
                "描边颜色": ("STRING", {"default": "#FFFFFF", "placeholder": "留空则不描边; 输入'ZML'为随机颜色"}), # 默认白色描边
                "全屏水印旋转角度": ("INT", {"default": -30, "min": -360, "max": 360}),
                "全屏水印密度": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 5.0, "step": 0.1})
            }
        }

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan") 

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("图像", "Help")
    FUNCTION = "add_watermark"
    CATEGORY = "image/ZML_图像/工具"

    def hex_to_rgba(self, hex_color, opacity):
        hex_color = hex_color.lstrip('#')
        r, g, b = tuple(int(hex_color[i:i + 2], 16) for i in (0, 2, 4))
        return (r, g, b, int(opacity * 255))

    def _generate_random_dark_color(self, opacity):
        r, g, b = random.randint(0, 255), random.randint(0, 255), random.randint(0, 255)
        # 移除了 while True 循环、brightness 计算和 if 过滤条件
        return (r, g, b, int(opacity * 255))


    def tensor_to_pil(self, tensor):
        return Image.fromarray(np.clip(255. * tensor.cpu().numpy().squeeze(), 0, 255).astype(np.uint8))

    def pil_to_tensor(self, pil_image):
        return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)

    def _get_char_size(self, char, font):
        try:
            bbox = font.getbbox(char)
            return bbox[2] - bbox[0], bbox[3] - bbox[1]
        except Exception: # Fallback for deprecated getsize if getbbox fails for some reason
            return font.getsize(char)

    def _prepare_lines(self, text, font, max_dim, char_spacing, orientation):
        lines, paragraphs = [], text.split('\n')
        for p in paragraphs:
            if not p:
                lines.append(""); continue
            line, dim = "", 0
            for char in p:
                w, h = self._get_char_size(char, font); char_dim = w if orientation == "横排" else h
                if dim + char_dim + char_spacing > max_dim and line: lines.append(line); line, dim = char, char_dim + char_spacing
                else: line += char; dim += char_dim + char_spacing
            if line: lines.append(line)
        return lines

    def _get_text_block_size(self, lines, font, char_spacing, line_spacing, orientation):
        if not lines: return 0, 0
        if orientation == "横排":
            max_w, total_h = 0, 0
            for i, line in enumerate(lines):
                line_w = sum(self._get_char_size(c, font)[0] + char_spacing for c in line) - char_spacing if line else 0
                max_w = max(max_w, line_w)
                line_h = max([self._get_char_size(c, font)[1] for c in line] or [font.getbbox("A")[3] - font.getbbox("A")[1]])
                total_h += line_h
                if i < len(lines) - 1: total_h += line_spacing
            return max_w, total_h
        else: # 竖排
            total_w, max_h = 0, 0
            for i, line in enumerate(lines):
                line_h = sum(self._get_char_size(c, font)[1] + char_spacing for c in line) - char_spacing if line else 0
                max_h = max(max_h, line_h)
                line_w = max([self._get_char_size(c, font)[0] for c in line] or [font.getbbox("A")[2] - font.getbbox("A")[0]])
                total_w += line_w
                if i < len(lines) - 1: total_w += line_spacing
            return total_w, max_h

    def _draw_text_manually(self, draw, lines, start_x, start_y, font, fill_color_param, stroke_width, stroke_fill_color_param, opacity, char_spacing, line_spacing, orientation):
        cursor_x, cursor_y = start_x, start_y

        # Helper to get actual color for a character based on mode
        def get_char_color(base_color_param, current_opacity):
            if base_color_param is None: # Random color requested (by passing None)
                return self._generate_random_dark_color(current_opacity)
            elif isinstance(base_color_param, tuple) and len(base_color_param) == 4: # Specific RGBA tuple
                return base_color_param
            else: # Fallback, should not happen if logic is correct
                return (0, 0, 0, 0) # Default to fully transparent

        if orientation == "横排":
            for line in lines:
                line_h = max([self._get_char_size(c, font)[1] for c in line] or [font.getbbox("A")[3] - font.getbbox("A")[1]])

                for char in line:
                    char_fill_color = get_char_color(fill_color_param, opacity)
                    char_stroke_color = get_char_color(stroke_fill_color_param, opacity)
                    
                    # Draw text with fill and stroke
                    draw.text((cursor_x, cursor_y), char, font=font,
                              fill=char_fill_color,
                              stroke_width=stroke_width,
                              stroke_fill=char_stroke_color)
                    
                    cursor_x += self._get_char_size(char, font)[0] + char_spacing
                cursor_x = start_x
                cursor_y += line_h + line_spacing
        else: # 竖排
            for line in lines:
                line_w = max([self._get_char_size(c, font)[0] for c in line] or [font.getbbox("A")[2] - font.getbbox("A")[0]])

                for char in line:
                    char_fill_color = get_char_color(fill_color_param, opacity)
                    char_stroke_color = get_char_color(stroke_fill_color_param, opacity)

                    # Draw text with fill and stroke
                    draw.text((cursor_x, cursor_y), char, font=font,
                              fill=char_fill_color,
                              stroke_width=stroke_width,
                              stroke_fill=char_stroke_color)

                    cursor_y += self._get_char_size(char, font)[1] + char_spacing
                cursor_y = start_y
                cursor_x += line_w + line_spacing

    def add_watermark(self, 图像, 文本, 字体, 字体大小, 颜色, 不透明度, 书写方向, 位置, 水平边距, 垂直边距, 字符间距, 行间距, 描边宽度, 描边颜色, 全屏水印旋转角度, 全屏水印密度):
        count = self.increment_counter()
        help_text = f"你好，欢迎使用ZML节点~到目前为止，你通过此节点总共添加了{count}次水印！！\n颜色代码那里留空则代表使用透明，输入‘ZML’代表随机颜色，你可以在文字颜色那里留空，描边颜色保持默认，这样就可以生成透明描边字体了！\n在这里提供一些常用颜色代码：\n黑色: #000000\n白色: #FFFFFF\n红色: #FF0000\n蓝色: #0000FF\n黄色: #FFFF00\n绿色: #008000\n祝你天天开心~"

        font = ImageFont.load_default()
        if 字体 != "Default":
            try:
                font_path = os.path.join(self.font_dir, 字体)
                font = ImageFont.truetype(font_path, 字体大小)
            except Exception as e:
                print(f"字体加载失败: {e}，将使用默认字体。")

        # --- 解析填充颜色 ---
        fill_color_for_draw = None
        if not 颜色.strip():  # 颜色留空，设置为完全透明
            fill_color_for_draw = (0, 0, 0, 0) # RGBA，alpha为0
        elif 颜色.strip().lower() == "zml": # 输入'ZML'，留给_draw_text_manually生成随机色
            fill_color_for_draw = None # _draw_text_manually will call _generate_random_dark_color
        else: # 正常颜色代码
            fill_color_for_draw = self.hex_to_rgba(颜色, 不透明度)
        
        # --- 解析描边颜色及描边宽度 ---
        stroke_width_for_draw = 描边宽度 # 默认使用用户输入的描边宽度
        stroke_fill_color_for_draw = None
        if not 描边颜色.strip(): # 描边颜色留空，则不描边
            stroke_width_for_draw = 0 
            stroke_fill_color_for_draw = (0, 0, 0, 0) # 设为透明色，虽然宽度为0实际不绘制，但保持数据类型一致
        elif 描边颜色.strip().lower() == "zml": # 输入'ZML'，描边颜色随机
            stroke_fill_color_for_draw = None # _draw_text_manually will call _generate_random_dark_color
        else: # 正常颜色代码
            stroke_fill_color_for_draw = self.hex_to_rgba(描边颜色, 不透明度)

        processed_images = []
        for img_tensor in 图像:
            pil_image = self.tensor_to_pil(img_tensor).convert("RGBA")
            img_width, img_height = pil_image.size

            if 位置 == "全屏":
                lines, tw, th = 文本.split('\n'), *self._get_text_block_size(文本.split('\n'), font, 字符间距, 行间距, 书写方向)
                if tw == 0 or th == 0:
                    processed_images.append(self.pil_to_tensor(pil_image)); continue
                
                # Adjust tile size for stroke
                tile_w, tile_h = tw + (2 * stroke_width_for_draw), th + (2 * stroke_width_for_draw) 
                
                text_img = Image.new('RGBA', (tile_w, tile_h))
                text_draw = ImageDraw.Draw(text_img)
                
                # Call drawing function with new stroke parameters
                self._draw_text_manually(text_draw, lines, stroke_width_for_draw, stroke_width_for_draw, font, 
                                        fill_color_for_draw, stroke_width_for_draw, stroke_fill_color_for_draw, 
                                        不透明度, 字符间距, 行间距, 书写方向)
                
                rot_img = text_img.rotate(全屏水印旋转角度, expand=True, resample=Image.BICUBIC)
                r_width, r_height = rot_img.size
                sx, sy = int((r_width + 水平边距) / 全屏水印密度), int((r_height + 垂直边距) / 全屏水印密度)
                sx = 1 if sx < 1 else sx; sy = 1 if sy < 1 else sy
                offset, row_idx = sx // 2, 0
                for y in range(-r_height, img_height, sy):
                    start_x = -r_width + (offset if (row_idx % 2) != 0 else 0)
                    for x in range(start_x, img_width, sx):
                        pil_image.paste(rot_img, (x, y), rot_img)
                    row_idx += 1
            else:
                # 创建一个临时的透明层来绘制文本
                text_layer = Image.new('RGBA', (img_width, img_height), (0, 0, 0, 0))
                draw = ImageDraw.Draw(text_layer)

                max_dim = (img_width - (水平边距 * 2) - (stroke_width_for_draw * 2)) if 书写方向 == "横排" else (img_height - (垂直边距 * 2) - (stroke_width_for_draw * 2))
                max_dim = max(1, max_dim)

                lines = self._prepare_lines(文本, font, max_dim, 字符间距, 书写方向)
                tw, th = self._get_text_block_size(lines, font, 字符间距, 行间距, 书写方向)
                
                x = 水平边距 if "左" in 位置 else (img_width - tw - 水平边距 if "右" in 位置 else (img_width - tw) // 2)
                y = 垂直边距 if "上" in 位置 else (img_height - th - 垂直边距 if "下" in 位置 else (img_height - th) // 2)
                
                self._draw_text_manually(draw, lines, x, y, font, 
                                        fill_color_for_draw, stroke_width_for_draw, stroke_fill_color_for_draw, 
                                        不透明度, 字符间距, 行间距, 书写方向)
                
                # 将绘制好的文本层合成到原始图像上
                pil_image = Image.alpha_composite(pil_image, text_layer)
            
            processed_images.append(self.pil_to_tensor(pil_image))
        return (torch.cat(processed_images, dim=0), help_text)

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
    
    RETURN_TYPES = ("IMAGE", "MASK",)
    RETURN_NAMES = ("图像", "遮罩",)
    FUNCTION = "crop_visually"
    CATEGORY = "image/ZML_图像/图像"

    def tensor_to_pil(self, t): 
        return Image.fromarray(np.clip(255. * t.cpu().numpy().squeeze(), 0, 255).astype(np.uint8))

    def pil_to_tensor(self, p): 
        return torch.from_numpy(np.array(p).astype(np.float32) / 255.0).unsqueeze(0)

    def crop_visually(self, 图像, 模式, 保持图像大小, **kwargs):
        crop_data = kwargs.get("crop_data", "{}")
        try:
            data = json.loads(crop_data)
        except:
            black_mask = torch.zeros_like(图像[:, :, :, 0])
            return (图像, black_mask,)
        
        cropped_images_list = []
        mask_list = []

        for img_tensor in 图像:
            pil_image = self.tensor_to_pil(img_tensor)
            full_size_mask = Image.new("L", pil_image.size, 0)
            draw = ImageDraw.Draw(full_size_mask)

            image_to_append = None 
            final_bbox = None

            if 模式 in ["路径选择", "画笔"]:
                points = data.get("points")
                bbox_data = data.get("bbox")
                if not points or not bbox_data: return (图像, torch.zeros_like(图像[:,:,:,0]))

                pts = [(p['x'], p['y']) for p in points]
                final_bbox = (int(bbox_data["x"]), int(bbox_data["y"]), int(bbox_data["x"]) + int(bbox_data["width"]), int(bbox_data["y"]) + int(bbox_data["height"]))
                if not pts: return (图像, torch.zeros_like(图像[:,:,:,0]))
                draw.polygon(pts, fill=255)

            else: # 矩形或圆形模式
                x, y, w, h = int(data.get("x",0)), int(data.get("y",0)), int(data.get("width",0)), int(data.get("height",0))
                if w == 0 or h == 0: return (图像, torch.zeros_like(图像[:,:,:,0]))
                final_bbox = (x, y, x + w, y + h)

                if 模式 == "圆形":
                    draw.ellipse(final_bbox, fill=255) 
                else: # 矩形模式
                    draw.rectangle(final_bbox, fill=255)
            
            if 保持图像大小:
                output_image = Image.new("RGBA", pil_image.size, (0, 0, 0, 0))
                pil_image_rgba = pil_image.convert("RGBA")
                output_image.paste(pil_image_rgba, mask=full_size_mask)
                image_to_append = output_image
            else:
                if final_bbox:
                    if 模式 != "矩形":
                        img_rgba = pil_image.convert("RGBA")
                        masked_output = Image.new("RGBA", img_rgba.size)
                        masked_output.paste(img_rgba, mask=full_size_mask) 
                        image_to_append = masked_output.crop(final_bbox)
                    else: # 矩形模式
                        image_to_append = pil_image.crop(final_bbox)
            
            if image_to_append:
                cropped_images_list.append(self.pil_to_tensor(image_to_append))
                
                mask_np = np.array(full_size_mask).astype(np.float32) / 255.0
                mask_tensor = torch.from_numpy(mask_np).unsqueeze(0)
                mask_list.append(mask_tensor)

        if not cropped_images_list or not mask_list:
             black_mask = torch.zeros_like(图像[:, :, :, 0])
             return (图像, black_mask,)

        final_cropped_tensors = torch.cat(cropped_images_list, dim=0)
        final_mask_tensors = torch.cat(mask_list, dim=0)
        
        return (final_cropped_tensors, final_mask_tensors)

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
    CATEGORY = "image/ZML_图像/图像"

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

# ============================== 文本图像节点 ==============================
class ZML_TextToImage:
    def __init__(self):
        self.node_dir = os.path.dirname(os.path.abspath(__file__))
        self.font_dir = os.path.join(self.node_dir, "Text")
        self.counter_dir = os.path.join(self.node_dir, "counter")
        os.makedirs(self.font_dir, exist_ok=True)
        os.makedirs(self.counter_dir, exist_ok=True)
        self.counter_file = os.path.join(self.counter_dir, "TextToImage.txt")
        self.ensure_counter_file()

    def ensure_counter_file(self):
        try:
            if not os.path.exists(self.counter_file):
                with open(self.counter_file, "w", encoding="utf-8") as f:
                    f.write("0")
        except Exception as e:
            print(f"创建文本图像计数文件失败: {e}")

    def increment_counter(self):
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
            print(f"更新文本图像计数失败: {e}")
            return 1
        return count

    @classmethod
    def INPUT_TYPES(cls):
        font_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Text")
        if not os.path.exists(font_dir):
            os.makedirs(font_dir)
        fonts = [f for f in os.listdir(font_dir) if f.lower().endswith(('.ttf', '.otf'))]
        if not fonts:
            fonts = ["Default"]
        return {
            "required": {
                "文本": ("STRING", {"multiline": True, "default": "ZML_文本"}),
                "字体": (fonts,),
                "字体大小": ("INT", {"default": 48, "min": 1, "max": 1024}),
                "颜色": ("STRING", {"default": "#000000", "placeholder": "留空为透明字体; 输入'ZML'为随机填充色"}), # 默认黑色
                "不透明度": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                "书写方向": (["横排", "竖排"],),
                "水平边距": ("INT", {"default": 20, "min": 0, "max": 4096}),
                "垂直边距": ("INT", {"default": 20, "min": 0, "max": 4096}),
                "字符间距": ("INT", {"default": 0, "min": -50, "max": 100}),
                "行间距": ("INT", {"default": 10, "min": -50, "max": 200}),
                "描边宽度": ("INT", {"default": 1, "min": 0, "max": 100}), # 默认描边宽度1
                "描边颜色": ("STRING", {"default": "#FFFFFF", "placeholder": "留空则不描边; 输入'ZML'为随机颜色"}), # 默认白色描边
                "背景颜色": (["透明", "白色", "黑色", "红色", "蓝色", "黄色", "绿色"], {"default": "透明"}),
                "图像大小模式": (["根据字体大小决定图像尺寸", "根据图像尺寸决定字体大小", "字体大小和图像尺寸独立计算"], {"default": "根据字体大小决定图像尺寸"}),
                "图像宽": ("INT", {"default": 512, "min": 1, "max": 8192, "step": 8}),
                "图像高": ("INT", {"default": 512, "min": 1, "max": 8192, "step": 8}),
            }
        }

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan") 

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("图像", "Help")
    FUNCTION = "generate_text_image"
    CATEGORY = "image/ZML_图像/工具"

    def hex_to_rgba(self, hex_color, opacity):
        hex_color = hex_color.lstrip('#')
        r, g, b = tuple(int(hex_color[i:i + 2], 16) for i in (0, 2, 4))
        return (r, g, b, int(opacity * 255))

    def _generate_random_dark_color(self, opacity): 
        r, g, b = random.randint(0, 255), random.randint(0, 255), random.randint(0, 255)
        # 移除了 while True 循环、brightness 计算和 if 过滤条件
        return (r, g, b, int(opacity * 255))

    def _get_char_size(self, char, font):
        try:
            bbox = font.getbbox(char)
            return bbox[2] - bbox[0], bbox[3] - bbox[1]
        except Exception: # Fallback for deprecated getsize if getbbox fails for some reason
            return font.getsize(char)

    def _prepare_lines(self, text, font, char_spacing, orientation, max_dim=None):
        lines, paragraphs = [], text.split('\n')
        for p in paragraphs:
            if not p:
                lines.append("")
                continue
            line, dim = "", 0
            for char in p:
                w, h = self._get_char_size(char, font)
                char_dim = w if orientation == "横排" else h
                if max_dim is not None and dim + char_dim + char_spacing > max_dim and line:
                    lines.append(line)
                    line, dim = char, char_dim + char_spacing
                else:
                    line += char
                    dim += char_dim + char_spacing
            if line:
                lines.append(line)
        return lines

    def _get_text_block_size(self, lines, font, char_spacing, line_spacing, orientation):
        if not lines:
            return 0, 0

        if orientation == "横排":
            max_w, total_h = 0, 0
            for i, line in enumerate(lines):
                line_w = sum(self._get_char_size(c, font)[0] + char_spacing for c in line) - char_spacing if line else 0
                max_w = max(max_w, line_w)
                
                line_h = 0
                if line:
                    line_h = max([self._get_char_size(c, font)[1] for c in line])
                else:
                    try:
                        line_h = font.getbbox("A")[3] - font.getbbox("A")[1]
                    except:
                        line_h = font.getsize("A")[1] if font.getsize("A") else 0
                
                total_h += line_h
                if i < len(lines) - 1:
                    total_h += line_spacing
            return max_w, total_h
        else: # 竖排
            total_w, max_h = 0, 0
            for i, line in enumerate(lines):
                line_h = sum(self._get_char_size(c, font)[1] + char_spacing for c in line) - char_spacing if line else 0
                max_h = max(max_h, line_h)

                line_w = 0
                if line:
                    line_w = max([self._get_char_size(c, font)[0] for c in line])
                else:
                    try:
                        line_w = font.getbbox("A")[2] - font.getbbox("A")[0]
                    except:
                        line_w = font.getsize("A")[0] if font.getsize("A") else 0
                    
                total_w += line_w
                if i < len(lines) - 1:
                    total_w += line_spacing
            return total_w, max_h

    def _draw_text_manually(self, draw, lines, start_x, start_y, font, fill_color_param, stroke_width, stroke_fill_color_param, opacity, char_spacing, line_spacing, orientation):
        cursor_x, cursor_y = start_x, start_y

        # Helper to get actual color for a character based on mode
        def get_char_color(base_color_param, current_opacity):
            if base_color_param is None: # Random color requested (by passing None)
                return self._generate_random_dark_color(current_opacity)
            elif isinstance(base_color_param, tuple) and len(base_color_param) == 4: # Specific RGBA tuple
                return base_color_param
            else: # Fallback, should not happen if logic is correct
                return (0, 0, 0, 0) # Default to fully transparent

        if orientation == "横排":
            for line in lines:
                line_h = 0
                if line:
                    line_h = max([self._get_char_size(c, font)[1] for c in line])
                else:
                    try:
                        line_h = font.getbbox("A")[3] - font.getbbox("A")[1]
                    except:
                        line_h = font.getsize("A")[1] if font.getsize("A") else 0

                for char in line:
                    char_fill_color = get_char_color(fill_color_param, opacity)
                    char_stroke_color = get_char_color(stroke_fill_color_param, opacity)

                    draw.text((cursor_x, cursor_y), char, font=font,
                              fill=char_fill_color,
                              stroke_width=stroke_width,
                              stroke_fill=char_stroke_color)
                    
                    cursor_x += self._get_char_size(char, font)[0] + char_spacing
                cursor_x = start_x
                cursor_y += line_h + line_spacing
        else: # 竖排
            for line in lines:
                line_w = 0
                if line:
                    line_w = max([self._get_char_size(c, font)[0] for c in line])
                else:
                    try:
                        line_w = font.getbbox("A")[2] - font.getbbox("A")[0]
                    except:
                        line_w = font.getsize("A")[0] if font.getsize("A") else 0

                for char in line:
                    char_fill_color = get_char_color(fill_color_param, opacity)
                    char_stroke_color = get_char_color(stroke_fill_color_param, opacity)

                    draw.text((cursor_x, cursor_y), char, font=font,
                              fill=char_fill_color,
                              stroke_width=stroke_width,
                              stroke_fill=char_stroke_color)
                    
                    cursor_y += self._get_char_size(char, font)[1] + char_spacing
                cursor_y = start_y
                cursor_x += line_w + line_spacing

    def pil_to_tensor(self, pil_image):
        return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)

    def generate_text_image(self, 文本, 字体, 字体大小, 颜色, 不透明度, 书写方向, 水平边距, 垂直边距, 字符间距, 行间距, 描边宽度, 描边颜色, 背景颜色, 图像大小模式, 图像宽, 图像高):
        count = self.increment_counter()
        help_text = f"你好，欢迎使用ZML节点~到目前为止，你通过此节点总共添加了{count}次文本图像！！\n颜色代码那里留空则代表使用透明，输入‘ZML’代表随机颜色，你可以在文字颜色那里留空，描边颜色保持默认，这样就可以生成透明描边字体了！\n在这里提供一些常用颜色代码：\n黑色: #000000\n白色: #FFFFFF\n红色: #FF0000\n蓝色: #0000FF\n黄色: #FFFF00\n绿色: #008000\n祝你天天开心~"

        bg_color_map = {
            "透明": (0, 0, 0, 0),
            "白色": (255, 255, 255, 255),
            "黑色": (0, 0, 0, 255),
            "红色": (255, 0, 0, 255),
            "蓝色": (0, 0, 255, 255),
            "黄色": (255, 255, 0, 255),
            "绿色": (0, 128, 0, 255),
        }
        current_bg_color = bg_color_map.get(背景颜色, (0, 0, 0, 0))

        font = ImageFont.load_default()
        if 字体 != "Default":
            try:
                font_path = os.path.join(self.font_dir, 字体)
                font = ImageFont.truetype(font_path, 字体大小) 
            except Exception as e:
                print(f"字体加载失败: {e}，将使用默认字体。")
                font = ImageFont.load_default()

        # --- 解析填充颜色 ---
        fill_color_for_draw = None
        if not 颜色.strip():  # 颜色留空，设置为完全透明
            fill_color_for_draw = (0, 0, 0, 0) # RGBA，alpha为0
        elif 颜色.strip().lower() == "zml": # 输入'ZML'，留给_draw_text_manually生成随机色
            fill_color_for_draw = None
        else: # 正常颜色代码
            fill_color_for_draw = self.hex_to_rgba(颜色, 不透明度)
        
        # --- 解析描边颜色及描边宽度 ---
        stroke_width_for_draw = 描边宽度 # 默认使用用户输入的描边宽度
        stroke_fill_color_for_draw = None
        if not 描边颜色.strip(): # 描边颜色留空，则不描边
            stroke_width_for_draw = 0
            stroke_fill_color_for_draw = (0, 0, 0, 0) # 设为透明色，虽然宽度为0实际不绘制，但保持数据类型一致
        elif 描边颜色.strip().lower() == "zml": # 输入'ZML'，描边颜色随机
            stroke_fill_color_for_draw = None
        else: # 正常颜色代码
            stroke_fill_color_for_draw = self.hex_to_rgba(描边颜色, 不透明度)

        final_font_size = 字体大小
        final_img_width = 图像宽
        final_img_height = 图像高
        
        # 文本区域计算时考虑描边宽度
        effective_h_margin = 水平边距 + stroke_width_for_draw
        effective_v_margin = 垂直边距 + stroke_width_for_draw

        if 图像大小模式 == "根据字体大小决定图像尺寸":
            # Pass stroke_width for more accurate sizing, although PIL's getbbox doesn't directly include stroke
            lines_for_sizing = self._prepare_lines(文本, font, 字符间距, 书写方向)
            text_block_width, text_block_height = self._get_text_block_size(lines_for_sizing, font, 字符间距, 行间距, 书写方向)

            final_img_width = text_block_width + (effective_h_margin * 2) 
            final_img_height = text_block_height + (effective_v_margin * 2)
            
            final_img_width = max(1, final_img_width)
            final_img_height = max(1, final_img_height)

        elif 图像大小模式 == "根据图像尺寸决定字体大小":
            target_width = max(1, 图像宽 - (effective_h_margin * 2))
            target_height = max(1, 图像高 - (effective_v_margin * 2))

            if target_width <= 0 or target_height <= 0:
                print(f"ZML_TextToImage: 计算文本区域尺寸为零或负数。图像宽:{图像宽}, 水平边距:{水平边距}, 描边宽度:{描边宽度}, 图像高:{图像高}, 垂直边距:{垂直边距}")
                target_width = 1
                target_height = 1

            test_font_size = 200
            # Ensure font path is defined for truetype
            font_path = os.path.join(self.font_dir, 字体) if 字体 != "Default" else None

            while test_font_size > 0:
                try:
                    # Load font for testing size
                    current_test_font = ImageFont.truetype(font_path, test_font_size) if font_path else ImageFont.load_default(test_font_size)
                except Exception:
                    # Fallback if font size causes issues
                    current_test_font = ImageFont.load_default(test_font_size) if test_font_size > 0 else ImageFont.load_default()
                    if test_font_size == 0: break

                lines_for_sizing = self._prepare_lines(文本, current_test_font, 字符间距, 书写方向, max_dim=target_width if 书写方向 == "横排" else target_height)
                tb_w, tb_h = self._get_text_block_size(lines_for_sizing, current_test_font, 字符间距, 行间距, 书写方向)
            
                # Check dimensions adjusted for stroke (text content + stroke)
                is_overflow = False
                if 书写方向 == "横排":
                    # For horizontal, consider text_block_width + 2*stroke_width for effective width
                    # and text_block_height + 2*stroke_width for effective height
                    if (tb_w + 2 * stroke_width_for_draw) > target_width or (tb_h + 2 * stroke_width_for_draw) > target_height:
                        is_overflow = True
                else: # 竖排
                    if (tb_w + 2 * stroke_width_for_draw) > target_width or (tb_h + 2 * stroke_width_for_draw) > target_height:
                         is_overflow = True
                
                if is_overflow:
                    test_font_size -= 1
                else:
                    final_font_size = test_font_size
                    break
                
                if test_font_size <= 1:
                    final_font_size = 1
                    break
            
            try:
                font = ImageFont.truetype(font_path, final_font_size) if font_path else ImageFont.load_default(final_font_size)
            except Exception:
                font = ImageFont.load_default(final_font_size)
            
            final_img_width = 图像宽
            final_img_height = 图像高

        elif 图像大小模式 == "字体大小和图像尺寸独立计算":
            try:
                font_path = os.path.join(self.node_dir, "Text", 字体) if 字体 != "Default" else None
                font = ImageFont.truetype(font_path, 字体大小) if font_path else ImageFont.load_default(字体大小)
            except Exception:
                font = ImageFont.load_default(字体大小)
            
            final_img_width = 图像宽
            final_img_height = 图像高

        text_image = Image.new('RGBA', (max(1, final_img_width), max(1, final_img_height)), current_bg_color)
        draw = ImageDraw.Draw(text_image)

        # Max text dimension accounts for stroke as well for wrapping
        max_text_dim = (final_img_width - (effective_h_margin * 2)) if 书写方向 == "横排" else (final_img_height - (effective_v_margin * 2))
        max_text_dim = max(1, max_text_dim) # Ensure it's at least 1

        final_lines = self._prepare_lines(文本, font, 字符间距, 书写方向, max_dim=max_text_dim)

        text_block_actual_width, text_block_actual_height = self._get_text_block_size(final_lines, font, 字符间距, 行间距, 书写方向)
        
        # Start drawing coordinates adjusted for internal content and stroke
        start_x = effective_h_margin + (max(0, (final_img_width - (effective_h_margin * 2) - text_block_actual_width)) // 2)
        start_y = effective_v_margin + (max(0, (final_img_height - (effective_v_margin * 2) - text_block_actual_height)) // 2)

        self._draw_text_manually(draw, final_lines, start_x, start_y, font, 
                                fill_color_for_draw, stroke_width_for_draw, stroke_fill_color_for_draw, 
                                不透明度, 字符间距, 行间距, 书写方向)
        
        output_tensor = self.pil_to_tensor(text_image)
        
        return (output_tensor, help_text)

# ============================== 画画 ==============================
class ZML_ImagePainter:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像": ("IMAGE",),
                "paint_data": ("STRING", {"multiline": True, "default": "{}", "widget": "hidden"}),
            },
            "optional": { 
                "画笔图像": ("IMAGE",),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("图像", "遮罩")
    FUNCTION = "paint_image"
    CATEGORY = "image/ZML_图像/图像"

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

    def paint_image(self, 图像, 画笔图像=None, paint_data="{}"):
        try:
            data = json.loads(paint_data)
        except (json.JSONDecodeError, KeyError, ValueError, TypeError) as e:
            print(f"ZML_ImagePainter: 解析paint_data时出错: {e}. 返回原始图像。")
            data = {}

        draw_paths = data.get('draw_paths', [])
        image_stamps = data.get('image_stamps', [])
        mosaic_rects = data.get('mosaic_rects', [])
        
        is_empty_paint = not draw_paths and not image_stamps and not mosaic_rects
        if is_empty_paint:
            h, w = 图像.shape[1:3]
            black_mask_tensor = torch.zeros((图像.shape[0], h, w), dtype=torch.float32)
            return (图像, black_mask_tensor)

        brush_pil = None
        if 画笔图像 is not None and len(image_stamps) > 0:
            brush_pil = self.tensor_to_pil(画笔图像[0])

        processed_images = []
        mask_tensors = []
        
        for img_tensor in 图像:
            pil_image = self.tensor_to_pil(img_tensor).convert("RGBA")
            mask_image = Image.new('L', pil_image.size, 0)
            
            # 创建一个副本用于马赛克处理，避免影响后续的图像笔刷和路径绘制
            mosaic_layer = pil_image.copy()

            # 1. 绘制马赛克
            if mosaic_rects:
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
                        
                        # 在遮罩上标记马赛克区域
                        draw_mask = ImageDraw.Draw(mask_image)
                        draw_mask.rectangle(box, fill=255)
                    except Exception as e:
                        print(f"ZML_ImagePainter: 绘制马赛克时出错: {e}")

            # 2. 绘制图像笔刷 (在马赛克层之上)
            if brush_pil and image_stamps:
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
                        
                        # 在遮罩上标记笔刷区域
                        mask_stamp = Image.new('L', resized_brush.size, 255)
                        draw_mask = ImageDraw.Draw(mask_image)
                        draw_mask.bitmap((x_pos, y_pos), mask_stamp, fill=255)
                    except Exception as e:
                        print(f"ZML_ImagePainter: 绘制图像笔刷时出错: {e}")

            # 3. 绘制路径和形状 (在所有图层之上)
            if draw_paths:
                draw_img = ImageDraw.Draw(mosaic_layer)
                draw_mask = ImageDraw.Draw(mask_image)
                for path in draw_paths:
                    try:
                        points = path.get('points', [])
                        if len(points) < 1: continue
                        
                        pts_int = [tuple(map(int, p)) for p in points]
                        color_hex = path.get('color', '#FF0000')
                        width = int(path.get('width', 5))
                        is_fill = path.get('isFill', False)
                        
                        fill_color_rgb = tuple(int(color_hex.lstrip('#')[i:i+2], 16) for i in (0, 2, 4))
                        
                        if is_fill:
                            draw_img.polygon(pts_int, fill=fill_color_rgb)
                            draw_mask.polygon(pts_int, fill=255)
                        else:
                            # 单点情况，画一个圆点
                            if len(pts_int) == 1:
                                r = width / 2
                                box = [pts_int[0][0]-r, pts_int[0][1]-r, pts_int[0][0]+r, pts_int[0][1]+r]
                                draw_img.ellipse(box, fill=fill_color_rgb)
                                draw_mask.ellipse(box, fill=255)
                            else: # 多点情况，画线
                                draw_img.line(pts_int, fill=fill_color_rgb, width=width, joint='curve')
                                draw_mask.line(pts_int, fill=255, width=width, joint='curve')
                    except Exception as e:
                        print(f"ZML_ImagePainter: 绘制路径时出错: {e}")

            processed_images.append(self.pil_to_tensor(mosaic_layer.convert("RGB")))
            mask_tensors.append(self.pil_to_tensor(mask_image))

        if not processed_images:
            return (图像, torch.zeros_like(图像[:, :, :, 0]))

        return (torch.cat(processed_images, dim=0), torch.cat(mask_tensors, dim=0))

# ============================== 取色器节点 ==============================
class ZML_ColorPicker:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "颜色代码": ("STRING", {"multiline": False, "default": "#FFFFFF", "widget": "hidden"}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("颜色代码",)
    FUNCTION = "get_color"
    CATEGORY = "image/ZML_图像/工具"

    def get_color(self, 颜色代码):
        return (颜色代码,)


# ============================== 节点注册 ==============================
NODE_CLASS_MAPPINGS = {
    "ZML_LimitResolution": ZML_LimitResolution,
    "ZML_AddTextWatermark": ZML_AddTextWatermark,
    "ZML_CropPureColorBackground": ZML_CropPureColorBackground,
    "ZML_AddSolidColorBackground": ZML_AddSolidColorBackground,
    "ZML_VisualCropImage": ZML_VisualCropImage,
    "ZML_MergeImages": ZML_MergeImages,
    "ZML_TextToImage": ZML_TextToImage,
    "ZML_ImagePainter": ZML_ImagePainter,
    "ZML_ColorPicker": ZML_ColorPicker,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_LimitResolution": "ZML_限制分辨率格式",
    "ZML_AddTextWatermark": "ZML_添加文字水印",
    "ZML_CropPureColorBackground": "ZML_限制纯色背景大小",
    "ZML_AddSolidColorBackground": "ZML_添加纯色背景",
    "ZML_VisualCropImage": "ZML_可视化裁剪图像",
    "ZML_MergeImages": "ZML_合并图像",
    "ZML_TextToImage": "ZML_文本图像",
    "ZML_ImagePainter": "ZML_画画",
    "ZML_ColorPicker": "ZML_取色器",
}