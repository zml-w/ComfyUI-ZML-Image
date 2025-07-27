# custom_nodes/zml_resolution_nodes.py

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
                with open(self.counter_file, "w", encoding="utf-8") as f: f.write("0")
        except Exception as e: print(f"创建水印计数文件失败: {e}")
    def increment_counter(self):
        count = 0
        try:
            with open(self.counter_file, "r+", encoding="utf-8") as f:
                content = f.read().strip()
                if content.isdigit(): count = int(content)
                count += 1
                f.seek(0); f.write(str(count)); f.truncate()
        except Exception as e:
            print(f"更新水印计数失败: {e}"); return 1
        return count
    @classmethod
    def INPUT_TYPES(cls):
        font_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Text")
        if not os.path.exists(font_dir): os.makedirs(font_dir)
        fonts = [f for f in os.listdir(font_dir) if f.lower().endswith(('.ttf', '.otf'))]
        if not fonts: fonts = ["Default"]
        return { "required": { "图像": ("IMAGE",), "文本": ("STRING", {"multiline": True, "default": "ZML_水印"}), "字体": (fonts,), "字体大小": ("INT", {"default": 48, "min": 8, "max": 1024}), "颜色": ("STRING", {"default": "#FFFFFF", "placeholder": "留空则每个字颜色随机"}), "不透明度": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 1.0, "step": 0.01}), "书写方向": (["横排", "竖排"],), "位置": (["左上", "中上", "右上", "左中", "居中", "右中", "左下", "中下", "右下", "全屏"],), "水平边距": ("INT", {"default": 20, "min": 0, "max": 4096}), "垂直边距": ("INT", {"default": 20, "min": 0, "max": 4096}), "字符间距": ("INT", {"default": 0, "min": -50, "max": 100}), "行间距": ("INT", {"default": 10, "min": -50, "max": 200}), "全屏水印旋转角度": ("INT", {"default": -30, "min": -360, "max": 360}), "全屏水印密度": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 5.0, "step": 0.1}) } }
    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("图像", "Help")
    FUNCTION = "add_watermark"
    CATEGORY = "image/ZML_图像/图像"
    def hex_to_rgba(self, hex_color, opacity):
        hex_color = hex_color.lstrip('#'); r, g, b = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4)); return (r, g, b, int(opacity * 255))
    def _generate_random_dark_color(self, opacity):
        while True: r, g, b = random.randint(0, 255), random.randint(0, 255), random.randint(0, 255);_ = (r + g + b); __ = 540; return (r, g, b, int(opacity * 255)) if _ < __ else None
    def tensor_to_pil(self, tensor): return Image.fromarray(np.clip(255. * tensor.cpu().numpy().squeeze(), 0, 255).astype(np.uint8))
    def pil_to_tensor(self, pil_image): return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)
    def _get_char_size(self, char, font):
        try: bbox = font.getbbox(char); return bbox[2] - bbox[0], bbox[3] - bbox[1]
        except: return font.getsize(char)
    def _prepare_lines(self, text, font, max_dim, char_spacing, orientation):
        lines, paragraphs = [], text.split('\n')
        for p in paragraphs:
            if not p: lines.append(""); continue
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
                line_w = sum(self._get_char_size(c, font)[0] + char_spacing for c in line) - char_spacing if line else 0; max_w = max(max_w, line_w)
                line_h = max([self._get_char_size(c, font)[1] for c in line] or [font.getbbox("A")[3] - font.getbbox("A")[1]]); total_h += line_h
                if i < len(lines) - 1: total_h += line_spacing
            return max_w, total_h
        else:
            total_w, max_h = 0, 0
            for i, line in enumerate(lines):
                line_h = sum(self._get_char_size(c, font)[1] + char_spacing for c in line) - char_spacing if line else 0; max_h = max(max_h, line_h)
                line_w = max([self._get_char_size(c, font)[0] for c in line] or [font.getbbox("A")[2] - font.getbbox("A")[0]]); total_w += line_w
                if i < len(lines) - 1: total_w += line_spacing
            return total_w, max_h
    def _draw_text_manually(self, draw, lines, start_x, start_y, font, fill_color, opacity, char_spacing, line_spacing, orientation):
        cursor_x, cursor_y = start_x, start_y; random_color_mode = fill_color is None
        if orientation == "横排":
            for line in lines:
                line_h = max([self._get_char_size(c, font)[1] for c in line] or [font.getbbox("A")[3] - font.getbbox("A")[1]])
                for char in line: char_color = self._generate_random_dark_color(opacity) if random_color_mode else fill_color; draw.text((cursor_x, cursor_y), char, font=font, fill=char_color); cursor_x += self._get_char_size(char, font)[0] + char_spacing
                cursor_x = start_x; cursor_y += line_h + line_spacing
        else:
            for line in lines:
                line_w = max([self._get_char_size(c, font)[0] for c in line] or [font.getbbox("A")[2] - font.getbbox("A")[0]])
                for char in line: char_color = self._generate_random_dark_color(opacity) if random_color_mode else fill_color; draw.text((cursor_x, cursor_y), char, font=font, fill=char_color); cursor_y += self._get_char_size(char, font)[1] + char_spacing
                cursor_y = start_y; cursor_x += line_w + line_spacing
    def add_watermark(self, 图像, 文本, 字体, 字体大小, 颜色, 不透明度, 书写方向, 位置, 水平边距, 垂直边距, 字符间距, 行间距, 全屏水印旋转角度, 全屏水印密度):
        count = self.increment_counter(); help_text = f"你好，欢迎使用ZML节点~到目前为止，你通过此节点总共添加了{count}次水印！！颜色代码那里留空时有惊喜哦~\n常用颜色代码：\n黑色: #000000, 白色: #FFFFFF, 红色: #FF0000, 蓝色: #0000FF, 黄色: #FFFF00, 绿色: #008000\n祝你天天开心~"
        font = ImageFont.load_default()
        if 字体 != "Default":
            try: font_path = os.path.join(self.font_dir, 字体); font = ImageFont.truetype(font_path, 字体大小)
            except Exception as e: print(f"字体加载失败: {e}，将使用默认字体。")
        is_random_color = not 颜色.strip(); fill_color = None if is_random_color else self.hex_to_rgba(颜色, 不透明度)
        processed_images = []
        for img_tensor in 图像:
            pil_image = self.tensor_to_pil(img_tensor).convert("RGBA"); img_width, img_height = pil_image.size
            if 位置 == "全屏":
                lines, tw, th = 文本.split('\n'), *self._get_text_block_size(文本.split('\n'), font, 字符间距, 行间距, 书写方向)
                if tw == 0 or th == 0: processed_images.append(self.pil_to_tensor(pil_image)); continue
                
                padding = 10
                tile_w, tile_h = tw + (2 * padding), th + (2 * padding)
                
                text_img = Image.new('RGBA', (tile_w, tile_h))
                text_draw = ImageDraw.Draw(text_img)
                
                self._draw_text_manually(text_draw, lines, padding, padding, font, fill_color, 不透明度, 字符间距, 行间距, 书写方向)
                rot_img = text_img.rotate(全屏水印旋转角度, expand=True, resample=Image.BICUBIC); r_width, r_height = rot_img.size
                sx, sy = int((r_width + 水平边距) / 全屏水印密度), int((r_height + 垂直边距) / 全屏水印密度); sx = 1 if sx < 1 else sx; sy = 1 if sy < 1 else sy
                offset, row_idx = sx // 2, 0
                for y in range(-r_height, img_height, sy):
                    start_x = -r_width + (offset if (row_idx % 2) != 0 else 0)
                    for x in range(start_x, img_width, sx): pil_image.paste(rot_img, (x, y), rot_img)
                    row_idx += 1
            else:
                draw = ImageDraw.Draw(pil_image); max_dim = (img_width - (水平边距*2)) if 书写方向 == "横排" else (img_height - (垂直边距*2))
                lines = self._prepare_lines(文本, font, max_dim, 字符间距, 书写方向); tw, th = self._get_text_block_size(lines, font, 字符间距, 行间距, 书写方向)
                x = 水平边距 if "左" in 位置 else (img_width - tw - 水平边距 if "右" in 位置 else (img_width - tw) // 2)
                y = 垂直边距 if "上" in 位置 else (img_height - th - 垂直边距 if "下" in 位置 else (img_height - th) // 2)
                self._draw_text_manually(draw, lines, x, y, font, fill_color, 不透明度, 字符间距, 行间距, 书写方向)
            processed_images.append(self.pil_to_tensor(pil_image))
        return (torch.cat(processed_images, dim=0), help_text)

# ============================== 限制纯色背景大小节点 ==============================
class ZML_CropPureColorBackground:
    @classmethod
    def INPUT_TYPES(cls):
        return { "required": { "图像": ("IMAGE",), "处理模式": (["矩形", "不规则形状"],), "背景颜色": (["白色", "绿色", "透明"],), "阈值": ("INT", {"default": 10, "min": 0, "max": 255}), "不规则形状保留像素": ("INT", {"default": 50, "min": 0, "max": 256}), "透明图像添加背景": (["无", "白色", "绿色"],), } }
    RETURN_TYPES = ("IMAGE",); RETURN_NAMES = ("图像",); FUNCTION = "crop_background"; CATEGORY = "image/ZML_图像/图像"
    def tensor_to_pil(self, tensor):
        img_np = np.clip(255. * tensor.cpu().numpy().squeeze(), 0, 255).astype(np.uint8)
        return Image.fromarray(img_np, 'RGBA' if img_np.shape[-1] == 4 else 'RGB')
    def pil_to_tensor(self, pil_image): return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)
    def crop_background(self, 图像, 处理模式, 背景颜色, 阈值, 不规则形状保留像素, 透明图像添加背景):
        cropped_images = []
        for img_tensor in 图像:
            pil_image = self.tensor_to_pil(img_tensor).convert("RGBA"); np_image = np.array(pil_image); h, w = np_image.shape[:2]
            target_rgb = None
            if 背景颜色 != "透明": target_rgb = np.array((255, 255, 255) if 背景颜色 == "白色" else (0, 255, 0), dtype=np.float32)
            def is_background(y, x):
                pixel = np_image[y, x]
                if 背景颜色 == "透明": return pixel[3] == 0
                else: return np.sum(np.abs(pixel[:3].astype(np.float32) - target_rgb)) <= 阈值
            final_pil = None
            if 处理模式 == "矩形":
                if 背景颜色 == "透明": mask = np_image[:, :, 3] > 0
                else: mask = np.sum(np.abs(np_image[..., :3].astype(np.float32) - target_rgb), axis=-1) > 阈值
                coords = np.argwhere(mask)
                if coords.size > 0: y1, x1 = coords.min(axis=0); y2, x2 = coords.max(axis=0); final_pil = Image.fromarray(np_image[y1:y2+1, x1:x2+1], 'RGBA')
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
                        if 0 <= ny < h and 0 <= nx < w and not border_bg_mask[ny, nx] and is_background(ny, nx): border_bg_mask[ny, nx] = True; q.append((ny, nx))
                final_alpha_mask = None
                if 不规则形状保留像素 > 0 and binary_dilation is not None:
                    dilated_mask = binary_dilation(~border_bg_mask, iterations=不规则形状保留像素); final_alpha_mask = ~dilated_mask
                else: final_alpha_mask = border_bg_mask
                output_np = np_image.copy(); output_np[final_alpha_mask, 3] = 0
                visible_coords = np.argwhere(~final_alpha_mask)
                if visible_coords.size > 0: y1, x1 = visible_coords.min(axis=0); y2, x2 = visible_coords.max(axis=0); final_pil = Image.fromarray(output_np[y1:y2+1, x1:x2+1], 'RGBA')
            if final_pil is None:
                fallback_color = (0,0,0,0); bg_map = {"白色": (255, 255, 255), "绿色": (0, 255, 0)}
                if 背景颜色 == "透明" and 透明图像添加背景 != "无": final_pil = Image.new("RGB", (1, 1), bg_map[透明图像添加背景])
                else:
                    if 背景颜色 == "白色": fallback_color = (255,255,255,255)
                    elif 背景颜色 == "绿色": fallback_color = (0,255,0,255)
                    final_pil = Image.new("RGBA", (1, 1), fallback_color)
            if final_pil.mode == 'RGBA' and 透明图像添加背景 != "无":
                bg_color = {"白色": (255, 255, 255), "绿色": (0, 255, 0)}[透明图像添加背景]
                background = Image.new("RGB", final_pil.size, bg_color); background.paste(final_pil, (0, 0), final_pil); final_pil = background
            cropped_images.append(self.pil_to_tensor(final_pil))
        return (torch.cat(cropped_images, dim=0),)

# ============================== 添加纯色背景节点 (新) ==============================
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
        return { "required": { "图像": ("IMAGE",), "模式": (["矩形", "圆形", "路径选择", "画笔"],), "裁剪比例": (["禁用", "1:1", "16:9", "9:16", "4:3", "3:4"],), "裁剪宽度": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 8}), "裁剪高度": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 8}), "crop_data": ("STRING", {"multiline": True, "default": "{}", "widget": "hidden"}), } }
    RETURN_TYPES = ("IMAGE",); RETURN_NAMES = ("图像",); FUNCTION = "crop_visually"; CATEGORY = "image/ZML_图像/图像"
    def tensor_to_pil(self, t): return Image.fromarray(np.clip(255. * t.cpu().numpy().squeeze(), 0, 255).astype(np.uint8))
    def pil_to_tensor(self, p): return torch.from_numpy(np.array(p).astype(np.float32) / 255.0).unsqueeze(0)
    def crop_visually(self, 图像, 模式, **kwargs):
        crop_data = kwargs.get("crop_data", "{}")
        try: data = json.loads(crop_data)
        except: return (图像,)
        cropped_images = []
        for img_tensor in 图像:
            pil_image = self.tensor_to_pil(img_tensor)
            if 模式 in ["路径选择", "画笔"]:
                points, bbox_data = data.get("points"), data.get("bbox")
                if not points or not bbox_data: return (图像,)
                pts = [(p['x'], p['y']) for p in points]; bbox = (int(bbox_data["x"]), int(bbox_data["y"]), int(bbox_data["x"]) + int(bbox_data["width"]), int(bbox_data["y"]) + int(bbox_data["height"]))
                if not pts: return (图像,)
                pil_image = pil_image.convert("RGBA"); mask = Image.new("L", pil_image.size, 0); draw = ImageDraw.Draw(mask)
                draw.polygon(pts, fill=255); output = pil_image.copy(); output.putalpha(mask)
                final_cropped = output.crop(bbox)
            else:
                x, y, w, h = int(data.get("x",0)), int(data.get("y",0)), int(data.get("width",0)), int(data.get("height",0))
                if w == 0 or h == 0: return (图像,)
                if 模式 == "圆形":
                    pil_image = pil_image.convert("RGBA"); mask = Image.new("L", pil_image.size, 0); draw = ImageDraw.Draw(mask)
                    draw.ellipse((x, y, x + w, y + h), fill=255); output = pil_image.copy(); output.putalpha(mask)
                    final_cropped = output.crop((x, y, x + w, y + h))
                else: final_cropped = pil_image.crop((x, y, x + w, y + h))
            cropped_images.append(self.pil_to_tensor(final_cropped))
        return (torch.cat(cropped_images, dim=0),)

# ============================== 合并图像节点 (新) ==============================
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

    # [MODIFIED] Helper to convert a single tensor slice to PIL
    def tensor_to_pil(self, tensor_slice):
        img_np = np.clip(255. * tensor_slice.cpu().numpy(), 0, 255).astype(np.uint8)
        return Image.fromarray(img_np)

    # [MODIFIED] Helper to convert a PIL image back to a tensor
    def pil_to_tensor(self, pil_image):
        return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)

    # [MAJOR REWRITE] The merging logic is now in Python
    def merge_images(self, 底图, 前景图_1, transform_data, 前景图_2=None, 前景图_3=None):
        try:
            data = json.loads(transform_data)
            # [MODIFIED] We now expect a 'layers' key, not 'image_data'
            if not data or 'layers' not in data or not data['layers']:
                # If no transform data, return the background as is
                return (底图,)
            layer_params = data['layers']
        except (json.JSONDecodeError, KeyError):
             # If data is invalid, return the background as is
            return (底图,)

        # Prepare a list of all foreground images that were provided
        fg_images = [前景图_1, 前景图_2, 前景图_3]
        
        output_images = []
        batch_size = 底图.shape[0]

        # Process each image in the batch
        for i in range(batch_size):
            # Start with the background image
            bg_pil = self.tensor_to_pil(底图[i]).convert("RGBA")

            # Iterate through available foregrounds and their corresponding parameters
            for layer_idx, fg_tensor_batch in enumerate(fg_images):
                if fg_tensor_batch is not None and i < fg_tensor_batch.shape[0]:
                    # Ensure there are parameters for this layer
                    if layer_idx >= len(layer_params):
                        continue
                    
                    params = layer_params[layer_idx]
                    if not params:
                        continue

                    # Get the specific foreground image for this batch item
                    fg_pil = self.tensor_to_pil(fg_tensor_batch[i]).convert("RGBA")

                    # 1. Scale the foreground
                    new_width = int(fg_pil.width * params.get('scaleX', 1.0))
                    new_height = int(fg_pil.height * params.get('scaleY', 1.0))
                    if new_width <= 0 or new_height <= 0: continue
                    fg_pil_resized = fg_pil.resize((new_width, new_height), Image.Resampling.LANCZOS)
                    
                    # 2. Rotate the foreground
                    # Fabric.js angle is clockwise, PIL is counter-clockwise, so we negate it.
                    # expand=True ensures the image is not cropped after rotation.
                    fg_pil_rotated = fg_pil_resized.rotate(-params.get('angle', 0), expand=True, resample=Image.Resampling.BICUBIC)
                    
                    # 3. Calculate paste position
                    # The 'left' and 'top' from JS are the center of the rotated object.
                    # We need to calculate the top-left corner for PIL's paste method.
                    paste_x = int(params.get('left', 0) - fg_pil_rotated.width / 2)
                    paste_y = int(params.get('top', 0) - fg_pil_rotated.height / 2)

                    # 4. Paste the transformed foreground onto the background
                    # The third argument (the rotated image itself) acts as the alpha mask.
                    bg_pil.paste(fg_pil_rotated, (paste_x, paste_y), fg_pil_rotated)

            # Convert final composed image back to RGB and then to a tensor
            final_pil = bg_pil.convert("RGB")
            output_images.append(self.pil_to_tensor(final_pil))

        # Combine all processed images in the batch into a single tensor
        return (torch.cat(output_images, dim=0),)


# ============================== 节点注册 ==============================
NODE_CLASS_MAPPINGS = {
    "ZML_LimitResolution": ZML_LimitResolution,
    "ZML_AddTextWatermark": ZML_AddTextWatermark,
    "ZML_CropPureColorBackground": ZML_CropPureColorBackground,
    "ZML_AddSolidColorBackground": ZML_AddSolidColorBackground, # 新增节点
    "ZML_VisualCropImage": ZML_VisualCropImage,
    "ZML_MergeImages": ZML_MergeImages,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_LimitResolution": "ZML_限制分辨率格式",
    "ZML_AddTextWatermark": "ZML_添加文字水印",
    "ZML_CropPureColorBackground": "ZML_限制纯色背景大小",
    "ZML_AddSolidColorBackground": "ZML_添加纯色背景", # 新增节点显示名称
    "ZML_VisualCropImage": "ZML_可视化裁剪图像",
    "ZML_MergeImages": "ZML_合并图像",
}
