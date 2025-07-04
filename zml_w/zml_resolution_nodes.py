# custom_nodes/zml_resolution_nodes.py

import math
import os
from PIL import Image, ImageDraw, ImageFont
import numpy as np
import torch
import random

# ============================== 限制分辨率格式节点 ==============================
class ZML_LimitResolution:
    """
    ZML 限制分辨率格式节点
    将输入的整数值约束为指定倍数的整数。
    支持两个并行的可选输入和输出。
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "倍数": ("INT", {"default": 8, "min": 1, "max": 256, "step": 1}),
                "模式": (["取大", "取小"], {"default": "取大"}),
            },
            "optional": {
                "数值_A": ("INT", {"forceInput": True}),
                "数值_B": ("INT", {"forceInput": True}),
            }
        }

    RETURN_TYPES = ("INT", "INT")
    RETURN_NAMES = ("结果_A", "结果_B")
    FUNCTION = "limit_value"
    CATEGORY = "image/ZML_图像"

    def _calculate(self, value, multiple, mode):
        if value is None:
            return 0
        
        if multiple < 1:
            multiple = 1
        
        value_float = float(value)
        multiple_float = float(multiple)
        
        if mode == "取大":
            result = math.ceil(value_float / multiple_float) * multiple_float
        else:
            result = math.floor(value_float / multiple_float) * multiple_float
            
        return int(result)

    def limit_value(self, 倍数, 模式, 数值_A=None, 数值_B=None):
        if 倍数 < 1:
            倍数 = 1
        
        result_A = self._calculate(数值_A, 倍数, 模式)
        result_B = self._calculate(数值_B, 倍数, 模式)
            
        return (result_A, result_B)

# ============================== 添加文字水印节点======== ==============================
class ZML_AddTextWatermark:
    """
    ZML 添加文字水印节点
    为图像添加可自定义位置、字体、颜色、透明度的文字水印，并支持自动换行、竖排、字符间距和行间距。
    """
    def __init__(self):
        # 定义字体和计数器文件的路径
        self.node_dir = os.path.dirname(os.path.abspath(__file__))
        self.font_dir = os.path.join(self.node_dir, "Text")
        
        # 将计数器文件路径移动到 "counter" 子文件夹
        self.counter_dir = os.path.join(self.node_dir, "counter")
        os.makedirs(self.counter_dir, exist_ok=True)
        self.counter_file = os.path.join(self.counter_dir, "Watermark.txt")
        
        # 确保文件夹和文件存在
        os.makedirs(self.font_dir, exist_ok=True)
        self.ensure_counter_file()

    def ensure_counter_file(self):
        """确保计数器文件存在，如果不存在则创建并初始化为0"""
        try:
            if not os.path.exists(self.counter_file):
                with open(self.counter_file, "w", encoding="utf-8") as f:
                    f.write("0")
        except Exception as e:
            print(f"创建水印计数文件失败: {e}")

    def increment_counter(self):
        """读取、增加并返回计数器的值"""
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
                "文本": ("STRING", {"multiline": True, "default": "ZML Watermark"}),
                "字体": (fonts,),
                "字体大小": ("INT", {"default": 48, "min": 8, "max": 1024, "step": 1}),
                "颜色": ("STRING", {"default": "#FFFFFF", "placeholder": "留空则每个字颜色随机"}),
                "不透明度": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 1.0, "step": 0.01}),
                "书写方向": (["横排", "竖排"], {"default": "横排"}),
                "位置": (["左上", "中上", "右上", "左中", "居中", "右中", "左下", "中下", "右下"], {"default": "左上"}),
                "水平边距": ("INT", {"default": 20, "min": 0, "max": 4096, "step": 1}),
                "垂直边距": ("INT", {"default": 20, "min": 0, "max": 4096, "step": 1}),
                "字符间距": ("INT", {"default": 0, "min": -50, "max": 100, "step": 1}),
                "行间距": ("INT", {"default": 10, "min": -50, "max": 200, "step": 1}),
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("图像", "Help")
    FUNCTION = "add_watermark"
    CATEGORY = "image/ZML_图像"

    def hex_to_rgba(self, hex_color, opacity):
        hex_color = hex_color.lstrip('#')
        r, g, b = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
        return (r, g, b, int(opacity * 255))
        
    def _generate_random_dark_color(self, opacity):
        """生成一个随机的、非浅色的颜色"""
        while True:
            r = random.randint(0, 255)
            g = random.randint(0, 255)
            b = random.randint(0, 255)
            # 确保颜色足够深（亮度较低），避免接近白色
            # (R+G+B)/3 < 180 是一种简单的亮度判断
            if (r + g + b) < 540: # 提高阈值，允许更多颜色
                return (r, g, b, int(opacity * 255))

    def tensor_to_pil(self, tensor):
        return Image.fromarray(np.clip(255. * tensor.cpu().numpy().squeeze(), 0, 255).astype(np.uint8))

    def pil_to_tensor(self, pil_image):
        return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)

    def _get_char_size(self, char, font):
        try: # 使用textbbox获取更精确的尺寸
            bbox = font.getbbox(char)
            return bbox[2] - bbox[0], bbox[3] - bbox[1]
        except: # 回退到getsize
            return font.getsize(char)

    def _prepare_lines(self, text, font, max_dim, char_spacing, orientation):
        lines = []
        for paragraph in text.split('\n'):
            if not paragraph:
                lines.append("")
                continue

            current_line = ""
            current_dim = 0
            
            for char in paragraph:
                char_w, char_h = self._get_char_size(char, font)
                char_dim = char_w if orientation == "横排" else char_h
                
                if current_dim + char_dim + char_spacing > max_dim and current_line:
                    lines.append(current_line)
                    current_line = char
                    current_dim = char_dim + char_spacing
                else:
                    current_line += char
                    current_dim += char_dim + char_spacing
            
            if current_line:
                lines.append(current_line)
        return lines

    def _get_text_block_size(self, lines, font, char_spacing, line_spacing, orientation):
        if not lines: return 0, 0
            
        if orientation == "横排":
            max_w = 0
            total_h = 0
            for i, line in enumerate(lines):
                line_w = sum(self._get_char_size(c, font)[0] + char_spacing for c in line) - char_spacing if line else 0
                max_w = max(max_w, line_w)
                line_h = max([self._get_char_size(c, font)[1] for c in line] or [font.getbbox("A")[3] - font.getbbox("A")[1]])
                total_h += line_h
                if i < len(lines) - 1: total_h += line_spacing
            return max_w, total_h
        else: # 竖排
            total_w = 0
            max_h = 0
            for i, line in enumerate(lines):
                line_h = sum(self._get_char_size(c, font)[1] + char_spacing for c in line) - char_spacing if line else 0
                max_h = max(max_h, line_h)
                line_w = max([self._get_char_size(c, font)[0] for c in line] or [font.getbbox("A")[2] - font.getbbox("A")[0]])
                total_w += line_w
                if i < len(lines) - 1: total_w += line_spacing
            return total_w, max_h

    def _draw_text_manually(self, draw, lines, start_x, start_y, font, fill_color, opacity, char_spacing, line_spacing, orientation):
        cursor_x, cursor_y = start_x, start_y
        random_color_mode = fill_color is None

        if orientation == "横排":
            for line in lines:
                line_height = max([self._get_char_size(c, font)[1] for c in line] or [font.getbbox("A")[3] - font.getbbox("A")[1]])
                for char in line:
                    char_color = self._generate_random_dark_color(opacity) if random_color_mode else fill_color
                    draw.text((cursor_x, cursor_y), char, font=font, fill=char_color)
                    cursor_x += self._get_char_size(char, font)[0] + char_spacing
                cursor_x = start_x
                cursor_y += line_height + line_spacing
        else: # 竖排
            for line in lines:
                line_width = max([self._get_char_size(c, font)[0] for c in line] or [font.getbbox("A")[2] - font.getbbox("A")[0]])
                for char in line:
                    char_color = self._generate_random_dark_color(opacity) if random_color_mode else fill_color
                    draw.text((cursor_x, cursor_y), char, font=font, fill=char_color)
                    cursor_y += self._get_char_size(char, font)[1] + char_spacing
                cursor_y = start_y
                cursor_x += line_width + line_spacing

    def add_watermark(self, 图像, 文本, 字体, 字体大小, 颜色, 不透明度, 书写方向, 位置, 水平边距, 垂直边距, 字符间距, 行间距):
        count = self.increment_counter()
        help_text = f"你好，欢迎使用ZML节点~到目前为止，你通过此节点总共添加了{count}次水印！！颜色代码那里留空时有惊喜哦~\n在这里提供一些常用的颜色代码：\n黑色: #000000\n白色: #FFFFF\n红色: #FF0000\n蓝色: #0000FF\n黄色: #FFFF00\n绿色: #008000\n粉色: #FFC0CB\n紫色: #800080\n祝你天天开心~"

        font = ImageFont.load_default()
        if 字体 != "Default":
            try:
                font_path = os.path.join(self.font_dir, 字体)
                font = ImageFont.truetype(font_path, 字体大小)
            except Exception as e:
                print(f"字体加载失败: {e}，将使用默认字体。")

        # 检查颜色输入是否为空
        is_random_color = not 颜色.strip()
        fill_color = None if is_random_color else self.hex_to_rgba(颜色, 不透明度)

        processed_images = []
        for img_tensor in 图像:
            pil_image = self.tensor_to_pil(img_tensor).convert("RGBA")
            draw = ImageDraw.Draw(pil_image)
            img_width, img_height = pil_image.size

            max_dim = (img_width - (水平边距 * 2)) if 书写方向 == "横排" else (img_height - (垂直边距 * 2))
            lines = self._prepare_lines(文本, font, max_dim, 字符间距, 书写方向)
            
            text_width, text_height = self._get_text_block_size(lines, font, 字符间距, 行间距, 书写方向)

            if "左" in 位置: x = 水平边距
            elif "右" in 位置: x = img_width - text_width - 水平边距
            else: x = (img_width - text_width) / 2

            if "上" in 位置: y = 垂直边距
            elif "下" in 位置: y = img_height - text_height - 垂直边距
            else: y = (img_height - text_height) / 2

            self._draw_text_manually(draw, lines, x, y, font, fill_color, 不透明度, 字符间距, 行间距, 书写方向)
            
            processed_image_rgb = pil_image.convert("RGB")
            processed_images.append(self.pil_to_tensor(processed_image_rgb))

        final_batch = torch.cat(processed_images, dim=0)
        
        return (final_batch, help_text)

# ============================== 节点注册 ==============================
NODE_CLASS_MAPPINGS = {
    "ZML_LimitResolution": ZML_LimitResolution,
    "ZML_AddTextWatermark": ZML_AddTextWatermark,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_LimitResolution": "ZML_限制分辨率格式",
    "ZML_AddTextWatermark": "ZML_添加文字水印",
}