# custom_nodes/ComfyUI-ZML-Image/zml_w/zml_text_annotation.py

import os
from PIL import Image, ImageDraw, ImageFont
import numpy as np
import torch
import random
import math
import re # 导入正则表达式模块

# 递归查找字体文件的辅助函数
def find_font_files(directory):
    font_files = []
    # 遍历目录及其所有子目录
    for root, dirs, files in os.walk(directory):
        for file in files:
            # 检查文件是否为字体文件
            if file.lower().endswith(('.ttf', '.otf')):
                # 计算相对路径作为字体标识，以便后续加载
                rel_path = os.path.relpath(os.path.join(root, file), directory)
                font_files.append(rel_path)
    return font_files

# ============================== ZML_AddTextWatermark 节点==============================
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
        fonts = find_font_files(font_dir)
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
                "字符间距": ("INT", {"default": 10, "min": -50, "max": 100}),
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
        return (r, g, b, int(opacity * 255))

    def tensor_to_pil(self, tensor):
        return Image.fromarray(np.clip(255. * tensor.cpu().numpy().squeeze(), 0, 255).astype(np.uint8))

    def pil_to_tensor(self, pil_image):
        return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)

    def _get_char_size(self, char, font):
        try:
            bbox = font.getbbox(char)
            width = max(1, bbox[2] - bbox[0])
            height = max(1, bbox[3] - bbox[1])
            return width, height
        except Exception: 
            w, h = font.getsize(char)
            return max(1, w), max(1, h)

    def _prepare_lines(self, text, font, char_spacing, orientation, max_dim=None):
        # 首先按用户手动换行符分割文本
        manual_lines = text.split('\n')
        
        # 当没有最大尺寸限制或不是输入图像模式时，直接返回手动换行的结果
        if max_dim is None or max_dim <= 0:
            return manual_lines
        
        result_lines = []
        
        # 对于每一行手动换行的文本，检查是否需要自动换行
        for manual_line in manual_lines:
            if not manual_line.strip():
                result_lines.append('')
                continue
                
            # 根据书写方向决定如何自动换行
            if orientation == "横排":
                current_line = ''
                current_width = 0
                
                # 智能处理英文单词，避免在单词中间换行
                # 首先尝试按单词分割文本
                words = []
                current_word = ''
                for char in manual_line:
                    if char.isspace():
                        if current_word:
                            words.append(current_word)
                            words.append(char)  # 保留空格
                            current_word = ''
                        else:
                            words.append(char)  # 连续空格
                    else:
                        current_word += char
                if current_word:
                    words.append(current_word)
                
                # 如果成功分割了单词（有空格分隔），则按单词进行换行处理
                if len(words) > 1 and any(char.isspace() for char in manual_line):
                    for word in words:
                        word_width = sum(self._get_char_size(c, font)[0] for c in word) + (max(0, len(word) - 1) * char_spacing)
                        
                        # 如果是空格且当前行为空，跳过
                        if word.isspace() and not current_line:
                            continue
                        
                        # 检查添加当前单词是否会超出最大宽度
                        if current_line and (current_width + word_width + char_spacing > max_dim):
                            result_lines.append(current_line)
                            current_line = word
                            current_width = word_width
                        else:
                            if current_line and not word.isspace():  # 如果不是行首且当前单词不是纯空格，添加字符间距
                                current_width += char_spacing
                            current_line += word
                            current_width += word_width
                else:
                    # 纯字符模式，按原始字符逐个处理
                    for char in manual_line:
                        char_width = self._get_char_size(char, font)[0]
                        # 检查添加当前字符是否会超出最大宽度
                        if current_line and (current_width + char_width + char_spacing > max_dim):
                            result_lines.append(current_line)
                            current_line = char
                            current_width = char_width
                        else:
                            if current_line:  # 如果不是行首，添加字符间距
                                current_width += char_spacing
                            current_line += char
                            current_width += char_width
                
                if current_line:  # 添加最后一行
                    result_lines.append(current_line)
            else:  # 竖排
                # 对于竖排，我们仍然可以进行适当的行分割，特别是当文本非常长时
                # 这里采用简单的按字符数分割，确保每行长不会导致显示问题
                MAX_VERTICAL_CHARS_PER_LINE = 100  # 一个合理的默认值
                for i in range(0, len(manual_line), MAX_VERTICAL_CHARS_PER_LINE):
                    result_lines.append(manual_line[i:i+MAX_VERTICAL_CHARS_PER_LINE])
        
        return result_lines


    def _get_text_block_size(self, lines, font, char_spacing, line_spacing, orientation):
        if not lines:
            return 0, 0

        if orientation == "横排":
            max_w, total_h = 0, 0
            for i, line in enumerate(lines):
                line_w = 0
                if line:
                    # 精确计算字符宽度和间距
                    line_w = sum(self._get_char_size(c, font)[0] for c in line) + (max(0, len(line) - 1) * char_spacing)
                    # 添加额外间距检查，避免字符溢出
                    line_w += 2  # 微小安全间距
                max_w = max(max_w, line_w)
                
                line_h = 0
                if line:
                    line_h = max([self._get_char_size(c, font)[1] for c in line])
                else: 
                    try:
                        line_h = max(1, font.getbbox("A")[3] - font.getbbox("A")[1])
                    except Exception:
                        line_h = max(1, font.getsize("A")[1] if font.getsize("A") else 1)
                
                total_h += line_h
                if i < len(lines) - 1:
                    total_h += line_spacing
            return max(1, max_w), max(1, total_h)
        else: # 竖排
            total_w, max_h = 0, 0
            for i, line in enumerate(lines):
                line_h = 0
                if line:
                    line_h = sum(self._get_char_size(c, font)[1] for c in line) + (max(0, len(line) - 1) * char_spacing)
                max_h = max(max_h, line_h)

                line_w = 0
                if line:
                    line_w = max([self._get_char_size(c, font)[0] for c in line])
                else: 
                    try:
                        line_w = max(1, font.getbbox("A")[2] - font.getbbox("A")[0])
                    except Exception:
                        line_w = max(1, font.getsize("A")[0] if font.getsize("A") else 1)
                    
                total_w += line_w
                if i < len(lines) - 1:
                    total_w += line_spacing
            return max(1, total_w), max(1, max_h)


    def _draw_text_manually(self, draw, lines, start_x, start_y, font, fill_color_param, stroke_width, stroke_fill_color_param, opacity, char_spacing, line_spacing, orientation):
        cursor_x, cursor_y = start_x, start_y

        def get_char_color(base_color_param, current_opacity):
            if base_color_param is None: 
                return self._generate_random_dark_color(current_opacity)
            elif isinstance(base_color_param, tuple) and len(base_color_param) == 4: 
                return base_color_param
            else: 
                return (0, 0, 0, 0) 

        if orientation == "横排":
            for line in lines:
                line_h = 0
                if line:
                    line_h = max([self._get_char_size(c, font)[1] for c in line])
                else:
                    try:
                        line_h = max(1, font.getbbox("A")[3] - font.getbbox("A")[1])
                    except:
                        line_h = max(1, font.getsize("A")[1] if font.getsize("A") else 1)

                # 计算字符垂直偏移量，确保字符完全显示
                y_offset = max(1, line_h // 4)  # 字体通常有基线，偏移约为行高的1/4，使文本垂直居中

                for char in line:
                    char_fill_color = get_char_color(fill_color_param, opacity)
                    char_stroke_color = get_char_color(stroke_fill_color_param, opacity)

                    draw.text((cursor_x, cursor_y + y_offset), char, font=font,
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
                        line_w = max(1, font.getbbox("A")[2] - font.getbbox("A")[0])
                    except:
                        line_w = max(1, font.getsize("A")[0] if font.getsize("A") else 1)

                # 计算字符垂直偏移量，确保字符完全显示
                y_offset = max(1, line_h // 4)  # 字体通常有基线，偏移约为行高的1/4，使文本垂直居中

                for char in line:
                    char_fill_color = get_char_color(fill_color_param, opacity)
                    char_stroke_color = get_char_color(stroke_fill_color_param, opacity)

                    draw.text((cursor_x, cursor_y + y_offset), char, font=font,
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
                # 字体路径已经包含了相对路径信息
                font_path = os.path.join(self.font_dir, 字体)
                font = ImageFont.truetype(font_path, 字体大小)
            except Exception as e:
                print(f"字体加载失败: {e}，将使用默认字体。")

        fill_color_for_draw = None
        if not 颜色.strip():  
            fill_color_for_draw = (0, 0, 0, 0) 
        elif 颜色.strip().lower() == "zml": 
            fill_color_for_draw = None 
        else: 
            fill_color_for_draw = self.hex_to_rgba(颜色, 不透明度)

        stroke_width_for_draw = 描边宽度 
        stroke_fill_color_for_draw = None
        if not 描边颜色.strip(): 
            stroke_width_for_draw = 0
            stroke_fill_color_for_draw = (0, 0, 0, 0) 
        elif 描边颜色.strip().lower() == "zml": 
            stroke_fill_color_for_draw = None 
        else: 
            stroke_fill_color_for_draw = self.hex_to_rgba(描边颜色, 不透明度)

        processed_images = []
        for img_tensor in 图像:
            pil_image = self.tensor_to_pil(img_tensor).convert("RGBA")
            img_width, img_height = pil_image.size

            if 位置 == "全屏":
                lines = 文本.split('\n')
                try:
                    current_font_for_sizing = ImageFont.truetype(os.path.join(self.font_dir, 字体), 字体大小) if 字体 != "Default" else ImageFont.load_default(字体大小)
                except Exception:
                    current_font_for_sizing = ImageFont.load_default(字体大小)
                
                tw, th = self._get_text_block_size(lines, current_font_for_sizing, adjusted_char_spacing, adjusted_line_spacing, 书写方向)
                
                if tw == 0 or th == 0:
                    processed_images.append(self.pil_to_tensor(pil_image)); continue
                
                tile_w, tile_h = tw + (2 * stroke_width_for_draw), th + (2 * stroke_width_for_draw)
                
                text_img = Image.new('RGBA', (max(1, tile_w), max(1, tile_h))) 
                text_draw = ImageDraw.Draw(text_img)
                
                self._draw_text_manually(text_draw, lines, stroke_width_for_draw, stroke_width_for_draw, font,
                                        fill_color_for_draw, stroke_width_for_draw, stroke_fill_color_for_draw,
                                        不透明度, 字符间距, 行间距, 书写方向)
                
                rot_img = text_img.rotate(全屏水印旋转角度, expand=True, resample=Image.Resampling.BICUBIC)
                r_width, r_height = rot_img.size
                sx, sy = int((r_width + 水平边距) / 全屏水印密度), int((r_height + 垂直边距) / 全屏水印密度)
                sx = max(1, sx); sy = max(1, sy) 
                offset, row_idx = sx // 2, 0
                for y in range(-r_height, img_height, sy):
                    start_x = -r_width + (offset if (row_idx % 2) != 0 else 0)
                    for x in range(start_x, img_width, sx):
                        if 0 <= x < img_width and 0 <= y < img_height: 
                            pil_image.paste(rot_img, (x, y), rot_img)
                    row_idx += 1
            else:
                text_layer = Image.new('RGBA', (img_width, img_height), (0, 0, 0, 0))
                draw = ImageDraw.Draw(text_layer)

                max_dim = (img_width - (水平边距 * 2) - (stroke_width_for_draw * 2)) if 书写方向 == "横排" else (img_height - (垂直边距 * 2) - (stroke_width_for_draw * 2))
                max_dim = max(1, max_dim) 

                lines = self._prepare_lines(文本, font, 字符间距, 书写方向, max_dim=max_dim)
                tw, th = self._get_text_block_size(lines, font, 字符间距, 行间距, 书写方向)
                
                x_pos = 水平边距 if "左" in 位置 else (img_width - tw - 水平边距 if "右" in 位置 else (img_width - tw) // 2)
                y_pos = 垂直边距 if "上" in 位置 else (img_height - th - 垂直边距 if "下" in 位置 else (img_height - th) // 2)

                x_pos = max(0, min(x_pos, img_width - 1))
                y_pos = max(0, min(y_pos, img_height - 1))
                
                self._draw_text_manually(draw, lines, x_pos, y_pos, font,
                                        fill_color_for_draw, stroke_width_for_draw, stroke_fill_color_for_draw,
                                        不透明度, 字符间距, 行间距, 书写方向)
                
                pil_image = Image.alpha_composite(pil_image, text_layer)
            
            processed_images.append(self.pil_to_tensor(pil_image))
        return (torch.cat(processed_images, dim=0), help_text)


# ============================== ZML_TextToImage 节点==============================
class ZML_TextToImage:
    # 文本内容在文本图像区域内的缩放比例，提高到0.95以使用更多可用空间
    TEXT_CONTENT_SCALE_PERCENTAGE = 0.95 
    NAME_SEPARATOR = "#-#"  # 多图名称分隔符

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
                  # Do not increment in case of multiline, this count is for single node execution, not for each image in batch
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
        fonts = find_font_files(font_dir)
        if not fonts:
            fonts = ["Default"]
        return {
            "required": {
                "文本": ("STRING", {"multiline": True, "default": "ZML_文本"}),
                "字体": (fonts,),
                "字体大小": ("INT", {"default": 48, "min": 1, "max": 1024}),
                "颜色": ("STRING", {"default": "#000000", "placeholder": "留空为透明字体; 输入'ZML'为随机填充色"}),
                "书写方向": (["横排", "竖排"],),
                "字符间距": ("INT", {"default": 10, "min": -50, "max": 100}),
                "行间距": ("INT", {"default": 10, "min": -50, "max": 200}),
                "文字描边宽度": ("INT", {"default": 3, "min": 0, "max": 100}), 
                "文字描边颜色": ("STRING", {"default": "#FFFFFF", "placeholder": "留空则不描边; 输入'ZML'为随机颜色"}), 
                "背景颜色": ("STRING", {"default": "#FFFFFF", "placeholder": "输入颜色代码，如#FFFFFF为白色，#000000为黑色"}), 
                "图像大小模式": (["根据字体大小决定图像尺寸", "根据图像尺寸决定字体大小", "字体大小和图像尺寸独立计算"], {"default": "根据字体大小决定图像尺寸"}), 
                "图像宽": ("INT", {"default": 512, "min": 1, "max": 8192, "step": 1}),
                "图像高": ("INT", {"default": 512, "min": 1, "max": 8192, "step": 1}),
                "文本图像占比": ("FLOAT", {"default": 0.15, "min": 0.05, "max": 0.5, "step": 0.05, "tooltip": "此参数仅在接入图像时生效"}), 
                "图像拼接方向": (["上", "下", "左", "右"], {"default": "下", "tooltip": "此参数仅在接入图像时生效"}), 
                "外边框宽度": ("INT", {"default": 30, "min": 0, "max": 100, "tooltip": "此参数仅在接入图像时生效"}),
                "外边框颜色": ("STRING", {"default": "#FFFFFF", "placeholder": "留空则无边框; 输入'ZML'为随机颜色", "tooltip": "此参数仅在接入图像时生效"}), 
                "内边框宽度": ("INT", {"default": 20, "min": 0, "max": 100, "tooltip": "此参数仅在接入图像时生效"}),
                "内边框颜色": ("STRING", {"default": "#FFFFFF", "placeholder": "留空则无边框; 输入'ZML'为随机颜色", "tooltip": "此参数仅在接入图像时生效"}), 
            },
            "optional": {
                "输入图像": ("IMAGE", {"forceInput": True}),
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
        return (r, g, b, int(opacity * 255))

    def _get_char_size(self, char, font):
        try:
            bbox = font.getbbox(char)
            width = max(1, bbox[2] - bbox[0])
            height = max(1, bbox[3] - bbox[1])
            return width, height
        except Exception:
            w, h = font.getsize(char)
            return max(1, w), max(1, h)

    def _prepare_lines(self, text, font, char_spacing, orientation, max_dim=None):
        # 首先按用户手动换行符分割文本
        manual_lines = text.split('\n')
        
        # 当没有最大尺寸限制或不是输入图像模式时，直接返回手动换行的结果
        if max_dim is None or max_dim <= 0:
            return manual_lines
        
        result_lines = []
        
        # 对于每一行手动换行的文本，检查是否需要自动换行
        for manual_line in manual_lines:
            if not manual_line.strip():
                result_lines.append('')
                continue
                
            # 根据书写方向决定如何自动换行
            if orientation == "横排":
                current_line = ''
                current_width = 0
                
                # 智能处理英文单词，避免在单词中间换行
                # 首先尝试按单词分割文本
                words = []
                current_word = ''
                for char in manual_line:
                    if char.isspace():
                        if current_word:
                            words.append(current_word)
                            words.append(char)  # 保留空格
                            current_word = ''
                        else:
                            words.append(char)  # 连续空格
                    else:
                        current_word += char
                if current_word:
                    words.append(current_word)
                
                # 如果成功分割了单词（有空格分隔），则按单词进行换行处理
                if len(words) > 1 and any(char.isspace() for char in manual_line):
                    for word in words:
                        word_width = sum(self._get_char_size(c, font)[0] for c in word) + (max(0, len(word) - 1) * char_spacing)
                        
                        # 如果是空格且当前行为空，跳过
                        if word.isspace() and not current_line:
                            continue
                        
                        # 检查添加当前单词是否会超出最大宽度
                        if current_line and (current_width + word_width + char_spacing > max_dim):
                            result_lines.append(current_line)
                            current_line = word
                            current_width = word_width
                        else:
                            if current_line and not word.isspace():  # 如果不是行首且当前单词不是纯空格，添加字符间距
                                current_width += char_spacing
                            current_line += word
                            current_width += word_width
                else:
                    # 纯字符模式，按原始字符逐个处理
                    for char in manual_line:
                        char_width = self._get_char_size(char, font)[0]
                        # 检查添加当前字符是否会超出最大宽度
                        if current_line and (current_width + char_width + char_spacing > max_dim):
                            result_lines.append(current_line)
                            current_line = char
                            current_width = char_width
                        else:
                            if current_line:  # 如果不是行首，添加字符间距
                                current_width += char_spacing
                            current_line += char
                            current_width += char_width
                
                if current_line:  # 添加最后一行
                    result_lines.append(current_line)
            else:  # 竖排
                # 对于竖排，我们仍然可以进行适当的行分割，特别是当文本非常长时
                # 这里采用简单的按字符数分割，确保每行长不会导致显示问题
                MAX_VERTICAL_CHARS_PER_LINE = 100  # 一个合理的默认值
                for i in range(0, len(manual_line), MAX_VERTICAL_CHARS_PER_LINE):
                    result_lines.append(manual_line[i:i+MAX_VERTICAL_CHARS_PER_LINE])
        
        return result_lines

    def _get_text_block_size(self, lines, font, char_spacing, line_spacing, orientation):
        if not lines:
            return 0, 0

        if orientation == "横排":
            max_w, total_h = 0, 0
            for i, line in enumerate(lines):
                line_w = 0
                if line:
                    line_w = sum(self._get_char_size(c, font)[0] for c in line) + (max(0, len(line) - 1) * char_spacing)
                max_w = max(max_w, line_w)
                
                line_h = 0
                if line:
                    line_h = max([self._get_char_size(c, font)[1] for c in line])
                else: 
                    try:
                        line_h = max(1, font.getbbox("A")[3] - font.getbbox("A")[1])
                    except Exception:
                        line_h = max(1, font.getsize("A")[1] if font.getsize("A") else 1)
                
                total_h += line_h
                if i < len(lines) - 1:
                    total_h += line_spacing
            return max(1, max_w), max(1, total_h)
        else: # 竖排
            total_w, max_h = 0, 0
            for i, line in enumerate(lines):
                line_h = 0
                if line:
                    line_h = sum(self._get_char_size(c, font)[1] for c in line) + (max(0, len(line) - 1) * char_spacing)
                max_h = max(max_h, line_h)

                line_w = 0
                if line:
                    line_w = max([self._get_char_size(c, font)[0] for c in line])
                else: 
                    try:
                        line_w = max(1, font.getbbox("A")[2] - font.getbbox("A")[0])
                    except Exception:
                        line_w = max(1, font.getsize("A")[0] if font.getsize("A") else 1)
                    
                total_w += line_w
                if i < len(lines) - 1:
                    total_w += line_spacing
            return max(1, total_w), max(1, max_h)


    def _draw_text_manually(self, draw, lines, start_x, start_y, font, fill_color_param, stroke_width, stroke_fill_color_param, opacity, char_spacing, line_spacing, orientation):
        cursor_x, cursor_y = start_x, start_y

        def get_char_color(base_color_param, current_opacity):
            if base_color_param is None: 
                return self._generate_random_dark_color(current_opacity)
            elif isinstance(base_color_param, tuple) and len(base_color_param) == 4: 
                return base_color_param
            else: 
                return (0, 0, 0, 0) 

        if orientation == "横排":
            for line in lines:
                line_h = 0
                if line:
                    line_h = max([self._get_char_size(c, font)[1] for c in line])
                else:
                    try:
                        line_h = max(1, font.getbbox("A")[3] - font.getbbox("A")[1])
                    except:
                        line_h = max(1, font.getsize("A")[1] if font.getsize("A") else 1)

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
                        line_w = max(1, font.getbbox("A")[2] - font.getbbox("A")[0])
                    except:
                        line_w = max(1, font.getsize("A")[0] if font.getsize("A") else 1)

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
        
    def tensor_to_pil(self, tensor):
        img_np = np.clip(255. * tensor.cpu().numpy().squeeze(), 0, 255).astype(np.uint8)
        return Image.fromarray(img_np, 'RGBA' if img_np.shape[-1] == 4 else 'RGB')

    def _stitch_images(self, images, direction, seam_size, seam_color):
        if not images:
            return Image.new('RGBA', (1, 1), (0, 0, 0, 0)) # Return a tiny transparent image

        if len(images) == 1:
            return images[0]

        if direction == "vertical":
            max_width = max(img.width for img in images)
            total_height = sum(img.height for img in images) + (len(images) - 1) * seam_size
            stitched_image = Image.new('RGBA', (max_width, total_height), (0, 0, 0, 0))
            draw = ImageDraw.Draw(stitched_image)
            current_y = 0
            for i, img in enumerate(images):
                paste_x = (max_width - img.width) // 2
                stitched_image.paste(img, (paste_x, current_y), img)
                current_y += img.height
                if seam_size > 0 and i < len(images) - 1:
                    draw.rectangle([(0, current_y), (max_width - 1, current_y + seam_size - 1)], fill=seam_color)
                    current_y += seam_size
            return stitched_image
        else: # horizontal
            max_height = max(img.height for img in images)
            total_width = sum(img.width for img in images) + (len(images) - 1) * seam_size
            stitched_image = Image.new('RGBA', (total_width, max_height), (0, 0, 0, 0))
            draw = ImageDraw.Draw(stitched_image)
            current_x = 0
            for i, img in enumerate(images):
                paste_y = (max_height - img.height) // 2
                stitched_image.paste(img, (current_x, paste_y), img)
                current_x += img.width
                if seam_size > 0 and i < len(images) - 1:
                    draw.rectangle([(current_x, 0), (current_x + seam_size - 1, max_height - 1)], fill=seam_color)
                    current_x += seam_size
            return stitched_image

    def _count_text_ratio(self, text):
        chinese_count = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')
        english_count = sum(1 for c in text if ('\u0041' <= c <= '\u005a') or ('\u0061' <= c <= '\u007a'))
        total = max(chinese_count + english_count, 1)
        return chinese_count / total, english_count / total

    def _auto_adjust_font_size(self, text, user_initial_font_size, target_width, target_height, char_spacing, line_spacing, orientation, stroke_width, font_dir, font_name):
        if not text.strip(): return 1 

        font_path = os.path.join(font_dir, font_name) if font_name != "Default" else None

        target_width = max(1, target_width)
        target_height = max(1, target_height)
        
        # 根据文本长度动态调整安全空间，文本越长安全空间越小
        text_length = len(text)
        # 统一使用英文的处理方式，不再区分中英文
        base_safety = 0.01  # 英文基础安全边距
        reduction_factor = 0.95  # 英文文本长度对安全边距的调整幅度
        
        # 结合文本长度动态调整安全空间
        # 重要优化：对于超长文本，进一步减少安全边距
        if text_length > 1000:
            safety_margin_percent = max(base_safety * (1 - (min(text_length, 2000) / 3000 * reduction_factor)), base_safety * 0.3)
        else:
            safety_margin_percent = max(base_safety * (1 - (min(text_length, 500) / 5000 * reduction_factor)), base_safety * 0.5)

        def check_fit(fs):
            if fs <= 0: return False
            try:
                test_font = ImageFont.truetype(font_path, fs) if font_path else ImageFont.load_default(fs)
            except Exception:
                test_font = ImageFont.load_default(max(1,fs)) 

            max_line_dim = target_width if orientation == "横排" else target_height
            lines = self._prepare_lines(text, test_font, char_spacing, orientation, max_dim=max_line_dim)
            actual_w, actual_h = self._get_text_block_size(lines, test_font, char_spacing, line_spacing, orientation)

            # 使用动态安全空间
            safety_margin = int(actual_h * safety_margin_percent)
            # 对于描边宽度较大的情况，适当减少安全空间要求，确保字体不会过小
            stroke_adjustment = max(0, stroke_width - 3) * 0.1  # 描边宽度每增加1，降低10%的安全要求
            adjusted_safety_margin = max(1, int(safety_margin * (1 - stroke_adjustment)))
            
            # 统一使用英文的处理方式
            stroke_multiplier = 1.0  # 减少描边宽度对宽度计算的影响
            width_multiplier = 1.1  # 允许使用更多宽度空间(10%)
            return (actual_w + stroke_multiplier * stroke_width <= target_width * width_multiplier) and\
                   (actual_h + adjusted_safety_margin + 2 * stroke_width <= target_height * 1.0)

        # 重要修复：根据文本长度调整初始字体大小范围
        # 对于长文本，需要从更小的字体开始测试，避免计算错误
        initial_high = max(user_initial_font_size, target_height, target_width, 200)
        
        # 根据文本长度动态调整初始上限
        if text_length > 1000:
            initial_high = min(initial_high, 1000)  # 超长文本限制初始上限
        elif text_length > 500:
            initial_high = min(initial_high, 1500)  # 长文本适当限制初始上限
        
        low = 1
        high = min(4096, initial_high)  # 最大上限不超过4096

        if target_width < 50 or target_height < 50:
             high = min(high, 100)  # 对于小尺寸，也提供更大的初始范围
        
        best_fit_font_size = 1 

        # 改进的二分查找算法，使用更精确的步骤
        while low <= high:
            mid = (low + high) // 2
            if mid == 0: 
                low = 1
                continue
            if check_fit(mid):
                best_fit_font_size = mid
                low = mid + 1 
            else:
                high = mid - 1 
        
        # 尝试进一步优化，稍微增加字体大小，确保充分利用空间
        # 对于较长的文本，尝试幅度更大
        increment = 1 if text_length < 100 else (2 if text_length < 300 else 3)
        for i in range(1, increment + 1):
            if check_fit(best_fit_font_size + i):
                best_fit_font_size += i
            else:
                break
        
        # 重要修复：如果文本很长但找到的字体大小仍然很大，可能是算法有误，强制重新计算
        # 对于超长文本，我们需要确保字体大小与文本长度成反比
        if text_length > 800 and best_fit_font_size > 200:
            # 对于超长文本，重新使用较小的初始值进行计算
            high = min(200, high)
            best_fit_font_size = 1
            low = 1
            
            # 重新运行二分查找
            while low <= high:
                mid = (low + high) // 2
                if mid == 0: 
                    low = 1
                    continue
                if check_fit(mid):
                    best_fit_font_size = mid
                    low = mid + 1 
                else:
                    high = mid - 1
            
            # 再次尝试微调
            for i in range(1, increment + 1):
                if check_fit(best_fit_font_size + i):
                    best_fit_font_size += i
                else:
                    break

        return best_fit_font_size

    def generate_text_image(self, 文本, 字体, 字体大小, 颜色, 书写方向, 字符间距, 行间距, 文字描边宽度, 文字描边颜色, 背景颜色, 图像大小模式, 图像宽, 图像高, 文本图像占比, 输入图像=None, 图像拼接方向="下", 外边框宽度=30, 外边框颜色="#FFFFFF", 内边框宽度=10, 内边框颜色="#FFFFFF"):
        node_execution_count = self.increment_counter()
        help_text = f"你好，欢迎使用ZML节点~到目前为止，你通过此节点总共添加了{node_execution_count}次文本图像！！\n颜色代码那里输入‘ZML’代表随机颜色，留空代表透明。\n\n接入图像时会自动将文本图像拼接到输入图像的对应方向上，拼接方向为左右时排序方向为从上到下，拼接方向为上下时排序方向为从左到右。\n\n也可以输入多张图像，多图模式可以用‘#-#’分隔每张图的文本名称：例如‘输入图像#-#输出图像’，则第一张使用‘输入图像’，第二张使用‘输出图像’。\n如果某张没有对应名称，则使用自然数序号‘1、2、3…’作为名称。\n\n你可以使用‘统一图像分辨率’节点来输入并处理多个图像，再输入给这个‘文本图像’节点！也可以用‘多文本输入-五’节点来分开写提示词，并分隔符换成‘#-#’，这会让你的使用体验大大提升！\n祝你天天开心~"

        default_opacity = 1.0
        default_h_margin = 30
        default_v_margin = 20

        if not 背景颜色.strip():
            current_bg_color_rgba = (0, 0, 0, 0)
        elif 背景颜色.strip().lower() == "zml":
            current_bg_color_rgba = self._generate_random_dark_color(255)
        else:
            try:
                current_bg_color_rgba = self.hex_to_rgba(背景颜色, 255)
            except:
                current_bg_color_rgba = (255, 255, 255, 255)
        
        font_path_base = os.path.join(self.font_dir, 字体) if 字体 != "Default" else None
        adjusted_char_spacing = int(字符间距 * 0.8)
        adjusted_line_spacing = int(行间距 * 0.8)

        fill_color_for_draw = None
        if not 颜色.strip():  
            fill_color_for_draw = (0, 0, 0, 0) 
        elif 颜色.strip().lower() == "zml": 
            fill_color_for_draw = None
        else: 
            fill_color_for_draw = self.hex_to_rgba(颜色, default_opacity) 

        stroke_width_for_draw = 文字描边宽度 
        stroke_fill_color_for_draw = None
        if not 文字描边颜色.strip(): 
            stroke_width_for_draw = 0
            stroke_fill_color_for_draw = (0, 0, 0, 0) 
        elif 文字描边颜色.strip().lower() == "zml": 
            stroke_fill_color_for_draw = None
        else: 
            stroke_fill_color_for_draw = self.hex_to_rgba(文字描边颜色, default_opacity) 
            
        border_width_for_draw = 外边框宽度
        inner_border_width_for_draw = 内边框宽度
        
        inner_border_color_actual = None
        if not 内边框颜色.strip(): 
            inner_border_color_actual = (0, 0, 0, 0)
        elif 内边框颜色.strip().lower() == "zml": 
            inner_border_color_actual = self._generate_random_dark_color(default_opacity)
        else: 
            inner_border_color_actual = self.hex_to_rgba(内边框颜色, default_opacity)

        outer_border_color_actual = None
        if not 外边框颜色.strip(): 
            outer_border_color_actual = (0, 0, 0, 0)
        elif 外边框颜色.strip().lower() == "zml": 
            outer_border_color_actual = self._generate_random_dark_color(default_opacity)
        else: 
            outer_border_color_actual = self.hex_to_rgba(外边框颜色, default_opacity)

        effective_h_margin = default_h_margin + stroke_width_for_draw
        effective_v_margin = default_v_margin + stroke_width_for_draw
        
        processed_combined_images_raw = []
        input_batch_size = 输入图像.shape[0] if 输入图像 is not None else 0 # Use 0 if no input images
        names = [seg.strip() for seg in 文本.split(self.NAME_SEPARATOR)] if self.NAME_SEPARATOR in 文本 else [文本]
        num_texts = len(names)

        # Group images by text
        text_image_groups = [] # List of (text_content, [list_of_pil_images])
        
        if input_batch_size == 0:
            # No input images, just create a single text image from the first text
            text_image_groups.append((names[0], []))
        else:
            # Distribute images to texts
            for i in range(num_texts):
                text_image_groups.append([names[i], []]) # Use list for mutability
            
            for i in range(input_batch_size):
                text_index = min(i, num_texts - 1) # All remaining images share the last text
                text_image_groups[text_index][1].append(self.tensor_to_pil(输入图像[i]).convert("RGBA"))

        for text_content, image_group in text_image_groups:
            current_text_to_draw = text_content
            
            current_input_pil_image = None
            if image_group:
                if len(image_group) > 1:
                    # Stitch images in the group
                    stitch_direction_for_group = "vertical" if 图像拼接方向 in ["左", "右"] else "horizontal"
                    current_input_pil_image = self._stitch_images(image_group, stitch_direction_for_group, inner_border_width_for_draw, inner_border_color_actual)
                else:
                    current_input_pil_image = image_group[0]

            final_font_size_iter = 字体大小
            final_img_width_iter = 图像宽
            final_img_height_iter = 图像高

            if current_input_pil_image is not None:
                input_width, input_height = current_input_pil_image.size
                
                if 图像拼接方向 in ["左", "右"]:
                    final_img_height_iter = input_height 
                    final_img_width_iter = max(1, int(input_width * 文本图像占比)) 
                elif 图像拼接方向 in ["上", "下"]:
                    final_img_width_iter = input_width 
                    final_img_height_iter = max(1, int(input_height * 文本图像占比)) 
                else: 
                    final_img_width_iter = max(1, int(input_width * 文本图像占比))
                    final_img_height_iter = input_height

                base_drawable_width = max(1, final_img_width_iter - (effective_h_margin * 2))
                base_drawable_height = max(1, final_img_height_iter - (effective_v_margin * 2))
                
                content_scale = 0.98
                effective_target_drawable_w_for_text_content = int(base_drawable_width * content_scale)
                effective_target_drawable_h_for_text_content = int(base_drawable_height * content_scale)

                final_font_size_iter = self._auto_adjust_font_size(
                    current_text_to_draw, 字体大小, 
                    effective_target_drawable_w_for_text_content, effective_target_drawable_h_for_text_content,
                    adjusted_char_spacing, adjusted_line_spacing, 书写方向, stroke_width_for_draw,
                    self.font_dir, 字体
                )
            else:
                if 图像大小模式 == "根据字体大小决定图像尺寸":
                    final_font_size_iter = 字体大小
                    try:
                        font_for_sizing = ImageFont.truetype(font_path_base, final_font_size_iter) if font_path_base else ImageFont.load_default(final_font_size_iter)
                    except Exception: font_for_sizing = ImageFont.load_default(final_font_size_iter)

                    lines_for_sizing = self._prepare_lines(current_text_to_draw, font_for_sizing, adjusted_char_spacing, 书写方向)
                    text_block_width, text_block_height = self._get_text_block_size(lines_for_sizing, font_for_sizing, 字符间距, 行间距, 书写方向)

                    vertical_safety_margin = int(text_block_height * 0.05)
                    final_img_width_iter = max(1, text_block_width + (effective_h_margin * 2)) 
                    final_img_height_iter = max(1, text_block_height + vertical_safety_margin + (effective_v_margin * 2))
                    
                elif 图像大小模式 == "根据图像尺寸决定字体大小":
                    base_drawable_width = max(1, 图像宽 - (effective_h_margin * 2))
                    base_drawable_height = max(1, 图像高 - (effective_v_margin * 2))

                    effective_target_drawable_w_for_text_content = int(base_drawable_width * self.TEXT_CONTENT_SCALE_PERCENTAGE)
                    effective_target_drawable_h_for_text_content = int(base_drawable_height * self.TEXT_CONTENT_SCALE_PERCENTAGE)

                    final_font_size_iter = self._auto_adjust_font_size(
                        current_text_to_draw, 字体大小, 
                        effective_target_drawable_w_for_text_content, effective_target_drawable_h_for_text_content,
                        字符间距, 行间距, 书写方向, stroke_width_for_draw,
                        self.font_dir, 字体
                    )
                    final_img_width_iter = 图像宽
                    final_img_height_iter = 图像高

            try:
                final_font_instance = ImageFont.truetype(font_path_base, final_font_size_iter) if font_path_base else ImageFont.load_default(final_font_size_iter)
            except Exception:
                print(f"ZML_TextToImage: Final font size {final_font_size_iter} could not be loaded for '{字体}'. Falling back to default font.", exc_info=True)
                final_font_instance = ImageFont.load_default(max(1, final_font_size_iter) if final_font_size_iter > 0 else 10) 

            text_image_panel = Image.new('RGBA', (max(1, final_img_width_iter), max(1, final_img_height_iter)), current_bg_color_rgba)
            draw = ImageDraw.Draw(text_image_panel)

            drawable_content_w = max(1, final_img_width_iter - (effective_h_margin * 2))
            drawable_content_h = max(1, final_img_height_iter - (effective_v_margin * 2))
            
            max_text_dim_for_drawing = drawable_content_w if 书写方向 == "横排" else drawable_content_h

            final_lines_for_drawing = self._prepare_lines(current_text_to_draw, final_font_instance, adjusted_char_spacing, 书写方向, max_dim=max_text_dim_for_drawing)
            text_block_actual_width, text_block_actual_height = self._get_text_block_size(final_lines_for_drawing, final_font_instance, adjusted_char_spacing, adjusted_line_spacing, 书写方向)
            
            start_x = effective_h_margin + (max(0, (drawable_content_w - text_block_actual_width)) // 2)
            start_y = effective_v_margin + (max(0, (drawable_content_h - text_block_actual_height)) // 2)
            
            start_x = max(0, start_x)
            start_y = max(0, start_y)

            # 只有当字体颜色不为空或有描边时才绘制文本
            if 颜色.strip() or (文字描边颜色.strip() and stroke_width_for_draw > 0):
                self._draw_text_manually(draw, final_lines_for_drawing, start_x, start_y, final_font_instance,
                                        fill_color_for_draw, stroke_width_for_draw, stroke_fill_color_for_draw,
                                        default_opacity, adjusted_char_spacing, adjusted_line_spacing, 书写方向)
            
            combined_output_pil_raw = None
            if current_input_pil_image is not None:
                input_width, input_height = current_input_pil_image.size
                text_width, text_height = text_image_panel.size
                
                seam_size = inner_border_width_for_draw if inner_border_width_for_draw > 0 else 0

                if 图像拼接方向 in ["左", "右"]:
                    total_w = text_width + input_width + seam_size
                    total_h = max(text_height, input_height)
                    if 图像拼接方向 == "左":
                        pos_text = (0, (total_h - text_height) // 2)
                        pos_input = (text_width + seam_size, (total_h - input_height) // 2)
                    else: # "右"
                        pos_input = (0, (total_h - input_height) // 2)
                        pos_text = (input_width + seam_size, (total_h - text_height) // 2)
                else: # "上", "下"
                    total_w = max(text_width, input_width)
                    total_h = text_height + input_height + seam_size
                    if 图像拼接方向 == "上":
                        pos_text = ((total_w - text_width) // 2, 0)
                        pos_input = ((total_w - input_width) // 2, text_height + seam_size)
                    else: # "下"
                        pos_input = ((total_w - input_width) // 2, 0)
                        pos_text = ((total_w - text_width) // 2, input_height + seam_size)

                canvas_bg_for_combined = (0, 0, 0, 0)
                
                combined_output_pil_raw = Image.new('RGBA', (total_w, total_h), canvas_bg_for_combined)
                combined_output_pil_raw.paste(text_image_panel, pos_text, text_image_panel)
                combined_output_pil_raw.paste(current_input_pil_image, pos_input, current_input_pil_image)

                if seam_size > 0:
                    draw = ImageDraw.Draw(combined_output_pil_raw)
                    seam_color = inner_border_color_actual
                    
                    if 图像拼接方向 == "左":
                        draw.rectangle([(text_width, 0), (text_width + seam_size - 1, total_h - 1)], fill=seam_color)
                    elif 图像拼接方向 == "右":
                        draw.rectangle([(input_width, 0), (input_width + seam_size - 1, total_h - 1)], fill=seam_color)
                    elif 图像拼接方向 == "上":
                        draw.rectangle([(0, text_height), (total_w - 1, text_height + seam_size - 1)], fill=seam_color)
                    else: # "下"
                        draw.rectangle([(0, input_height), (total_w - 1, input_height + seam_size - 1)], fill=seam_color)
            else:
                combined_output_pil_raw = text_image_panel
            
            processed_combined_images_raw.append(combined_output_pil_raw)

        if not processed_combined_images_raw:
            return (torch.zeros((1, 64, 64, 4)), help_text) 

        if len(processed_combined_images_raw) == 1:
            final_image_no_border = processed_combined_images_raw[0]
        else:
            final_concat_direction = "vertical" if 图像拼接方向 in ["左", "右"] else "horizontal"
            seam_size = inner_border_width_for_draw if inner_border_width_for_draw > 0 else 0
            
            final_image_no_border = self._stitch_images(processed_combined_images_raw, final_concat_direction, seam_size, inner_border_color_actual)
        
        if border_width_for_draw > 0:
            new_width = final_image_no_border.width + 2 * border_width_for_draw
            new_height = final_image_no_border.height + 2 * border_width_for_draw
            
            final_output_image = Image.new('RGBA', (new_width, new_height), (0, 0, 0, 0))
            final_output_image.paste(final_image_no_border, (border_width_for_draw, border_width_for_draw), final_image_no_border)
            
            if outer_border_color_actual[3] > 0:
                draw_border = ImageDraw.Draw(final_output_image)
                draw_border.rectangle([(0, 0), (new_width - 1, new_height - 1)], 
                                     outline=outer_border_color_actual, width=border_width_for_draw)
        else:
            final_output_image = final_image_no_border

        final_output_tensor = self.pil_to_tensor(final_output_image)
        return (final_output_tensor, help_text)
    
# ============================== ZML_AddImageWatermark==============================
class ZML_AddImageWatermark:
    def __init__(self):
        self.node_dir = os.path.dirname(os.path.abspath(__file__))
        self.watermark_dir = os.path.join(self.node_dir, "web", "images")
        self.counter_dir = os.path.join(self.node_dir, "counter")
        os.makedirs(self.counter_dir, exist_ok=True)
        self.counter_file = os.path.join(self.counter_dir, "ImageWatermark.txt")
        self.ensure_counter_file()

    def ensure_counter_file(self):
        try:
            if not os.path.exists(self.counter_file):
                with open(self.counter_file, "w", encoding="utf-8") as f:
                    f.write("0")
        except Exception as e:
            print(f"创建图像水印计数文件失败: {e}")

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
            print(f"更新图像水印计数失败: {e}")
            return 1
        return count

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像": ("IMAGE",),
                "水印大小比例": ("FLOAT", {"default": 0.25, "min": 0.01, "max": 2.0, "step": 0.01}),
                "不透明度": ("FLOAT", {"default": 1, "min": 0.0, "max": 1.0, "step": 0.01}),
                "位置": (["左上", "中上", "右上", "左中", "居中", "右中", "左下", "中下", "右下", "全屏"],),
                "水平边距": ("INT", {"default": 30, "min": 0, "max": 4096}),
                "垂直边距": ("INT", {"default": 30, "min": 0, "max": 4096}),
                "全屏水印旋转角度": ("INT", {"default": -30, "min": -360, "max": 360}),
                "全屏水印密度": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 5.0, "step": 0.1}),
                "全屏水印间距": ("INT", {"default": 10, "min": 0, "max": 200})
            },
            "optional": {
                "水印图像": ("IMAGE",)
            }
        }

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("图像", "Help")
    FUNCTION = "add_watermark"
    CATEGORY = "image/ZML_图像/工具" 

    def tensor_to_pil(self, tensor):
        return Image.fromarray(np.clip(255. * tensor.cpu().numpy().squeeze(), 0, 255).astype(np.uint8))

    def pil_to_tensor(self, pil_image):
        return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)

    def add_watermark(self, 图像, 水印大小比例=0.25, 不透明度=0.7, 位置="右下", 水平边距=20, 垂直边距=20, 全屏水印旋转角度=-30, 全屏水印密度=1.0, 全屏水印间距=10, 水印图像=None):
        count = self.increment_counter()
        help_text = (f"你好，欢迎使用ZML图像水印节点~到目前为止，你通过此节点总共添加了{count}次图像水印！！\n祝你使用愉快~")

        # 加载水印图像
        watermark_img = None
        if 水印图像 is not None:
            try:
                # 从输入的图像张量创建水印图像
                watermark_pil = self.tensor_to_pil(水印图像[0]).convert("RGBA")
                watermark_img = watermark_pil
            except Exception as e:
                print(f"水印图像处理失败: {e}")
                # 如果水印图像处理失败，创建默认水印
                watermark_img = Image.new('RGBA', (100, 100), (0, 0, 0, 0))
                draw = ImageDraw.Draw(watermark_img)
                draw.rectangle([0, 0, 100, 100], fill=(0, 0, 0, 100))
                draw.text((20, 40), "Watermark", fill=(255, 255, 255, 200))
        else:
            # 如果没有提供水印图像，创建一个默认的简单水印
            watermark_img = Image.new('RGBA', (100, 100), (0, 0, 0, 0))
            draw = ImageDraw.Draw(watermark_img)
            draw.rectangle([0, 0, 100, 100], fill=(0, 0, 0, 100))
            draw.text((20, 40), "Watermark", fill=(255, 255, 255, 200))

        processed_images = []
        for img_tensor in 图像:
            pil_image = self.tensor_to_pil(img_tensor).convert("RGBA")
            img_width, img_height = pil_image.size
            
            # 基于输入图像的大小计算水印尺寸（等比缩放）
            base_size = min(img_width, img_height)
            target_size = int(base_size * 水印大小比例)
            wm_width, wm_height = watermark_img.size
            
            # 计算等比缩放的新尺寸
            ratio = min(target_size / wm_width, target_size / wm_height)
            new_width = int(wm_width * ratio)
            new_height = int(wm_height * ratio)
            resized_watermark = watermark_img.resize((max(1, new_width), max(1, new_height)), Image.Resampling.LANCZOS)
            wm_width, wm_height = resized_watermark.size
            
            # 调整水印透明度
            if 不透明度 < 1.0:
                r, g, b, a = resized_watermark.split()
                a = a.point(lambda p: p * 不透明度)
                resized_watermark = Image.merge('RGBA', (r, g, b, a))

            # 根据位置添加水印
            if 位置 == "全屏":
                # 全屏平铺水印
                try:
                    # 旋转水印图像
                    rot_img = resized_watermark.rotate(全屏水印旋转角度, expand=True, resample=Image.Resampling.BICUBIC)
                    r_width, r_height = rot_img.size
                    # 计算间距
                    sx, sy = int((r_width + 水平边距) / 全屏水印密度), int((r_height + 垂直边距) / 全屏水印密度)
                    sx = max(1, sx); sy = max(1, sy) 
                    # 交错排列水印
                    offset, row_idx = sx // 2, 0
                    for y in range(-r_height, img_height, sy):
                        start_x = -r_width + (offset if (row_idx % 2) != 0 else 0)
                        for x in range(start_x, img_width, sx):
                            if 0 <= x + r_width and 0 <= y + r_height:
                                pil_image.paste(rot_img, (x, y), rot_img)
                        row_idx += 1
                except Exception as e:
                    print(f"全屏水印处理失败: {e}")
            else:
                # 在指定位置添加水印
                x_pos = 水平边距 if "左" in 位置 else (img_width - wm_width - 水平边距 if "右" in 位置 else (img_width - wm_width) // 2)
                y_pos = 垂直边距 if "上" in 位置 else (img_height - wm_height - 垂直边距 if "下" in 位置 else (img_height - wm_height) // 2)

                # 确保水印在图像范围内
                x_pos = max(0, min(x_pos, img_width - 1))
                y_pos = max(0, min(y_pos, img_height - 1))
                
                # 添加水印到图像
                pil_image.paste(resized_watermark, (x_pos, y_pos), resized_watermark)
            
            processed_images.append(self.pil_to_tensor(pil_image))
        return (torch.cat(processed_images, dim=0), help_text)

# ============================== 节点注册 ==============================
NODE_CLASS_MAPPINGS = {
    "ZML_AddTextWatermark": ZML_AddTextWatermark,
    "ZML_TextToImage": ZML_TextToImage,
    "ZML_AddImageWatermark": ZML_AddImageWatermark,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_AddTextWatermark": "ZML_添加文字水印",
    "ZML_TextToImage": "ZML_文本图像",
    "ZML_AddImageWatermark": "ZML_添加图像水印",
}
