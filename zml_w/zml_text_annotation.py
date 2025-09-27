# custom_nodes/ComfyUI-ZML-Image/zml_w/zml_text_annotation.py

import os
from PIL import Image, ImageDraw, ImageFont
import numpy as np
import torch
import random
import math
import re # 导入正则表达式模块

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
                
                tw, th = self._get_text_block_size(lines, current_font_for_sizing, 字符间距, 行间距, 书写方向)
                
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
    # 文本内容在文本图像区域内的缩放比例，100%表示使用全部可用区域
    TEXT_CONTENT_SCALE_PERCENTAGE = 0.9 
    BATCH_INDEX_PLACEHOLDER = r"#(\d+(\.\d+)?):(\d+(\.\d+)?)#" # 正则表达式匹配 #start:step#

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
        fonts = [f for f in os.listdir(font_dir) if f.lower().endswith(('.ttf', '.otf'))]
        if not fonts:
            fonts = ["Default"]
        return {
            "required": {
                "文本": ("STRING", {"multiline": True, "default": "ZML_文本"}),
                "字体": (fonts,),
                "字体大小": ("INT", {"default": 48, "min": 1, "max": 1024}),
                "颜色": ("STRING", {"default": "#000000", "placeholder": "留空为透明字体; 输入'ZML'为随机填充色"}), # 默认黑色
                "书写方向": (["横排", "竖排"],),
                "字符间距": ("INT", {"default": 0, "min": -50, "max": 100}),
                "行间距": ("INT", {"default": 10, "min": -50, "max": 200}),
                "描边宽度": ("INT", {"default": 1, "min": 0, "max": 100}), # 默认描边宽度1
                "描边颜色": ("STRING", {"default": "#FFFFFF", "placeholder": "留空则不描边; 输入'ZML'为随机颜色"}), # 默认白色描边
                "背景颜色": (["白色", "黑色", "透明", "红色", "蓝色", "黄色", "绿色"], {"default": "白色"}), # 调整默认和顺序
                "图像大小模式": (["根据字体大小决定图像尺寸", "根据图像尺寸决定字体大小", "字体大小和图像尺寸独立计算"], {"default": "根据字体大小决定图像尺寸"}), # 移除了"根据输入图像尺寸决定"选项
                "图像宽": ("INT", {"default": 512, "min": 1, "max": 8192, "step": 1}),
                "图像高": ("INT", {"default": 512, "min": 1, "max": 8192, "step": 1}),
                "文本图像占比": ("FLOAT", {"default": 0.15, "min": 0.05, "max": 0.5, "step": 0.05}), # 新增文本图像占比选项
            },
            "optional": {
                "输入图像": ("IMAGE", {"forceInput": True}),
                "图像拼接方向": (["上", "下", "左", "右"], {"default": "左"}), # 移动到接缝选项上方
                "多图模式图像接缝": ("INT", {"default": 10, "min": 0, "max": 256}), # 新增接缝选项
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

    def _auto_adjust_font_size(self, text, user_initial_font_size, target_width, target_height, char_spacing, line_spacing, orientation, stroke_width, font_dir, font_name):
        if not text.strip(): return 1 

        font_path = os.path.join(font_dir, font_name) if font_name != "Default" else None

        target_width = max(1, target_width)
        target_height = max(1, target_height)

        def check_fit(fs):
            if fs <= 0: return False
            try:
                test_font = ImageFont.truetype(font_path, fs) if font_path else ImageFont.load_default(fs)
            except Exception:
                test_font = ImageFont.load_default(max(1,fs)) 

            max_line_dim = target_width if orientation == "横排" else target_height
            lines = self._prepare_lines(text, test_font, char_spacing, orientation, max_dim=max_line_dim)
            actual_w, actual_h = self._get_text_block_size(lines, test_font, char_spacing, line_spacing, orientation)

            # 确保文本块高度包含行间距和安全空间
            safety_margin = int(actual_h * 0.1)  # 10%安全空间
            return (actual_w + 2 * stroke_width <= target_width) and \
                   (actual_h + safety_margin + 2 * stroke_width <= target_height)

        low = 1
        high = min(4096, max(user_initial_font_size, target_height, target_width, 100)) 

        if target_width < 50 or target_height < 50:
             high = min(high, 50) 
        
        best_fit_font_size = 1 

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

        return best_fit_font_size

    def generate_text_image(self, 文本, 字体, 字体大小, 颜色, 书写方向, 字符间距, 行间距, 描边宽度, 描边颜色, 背景颜色, 图像大小模式, 图像宽, 图像高, 文本图像占比, 输入图像=None, 图像拼接方向="左", 多图模式图像接缝=10): # 调整参数顺序
        node_execution_count = self.increment_counter()
        help_text = f"你好，欢迎使用ZML节点~到目前为止，你通过此节点总共添加了{node_execution_count}次文本图像！！\n颜色代码那里输入‘ZML’代表随机颜色哦。\n\n节点默认是生成一张空白的文本图像，不含背景什么的。在接入图像时会自动将文本图像拼接到输入的图像那里。\n\n节点也支持输入多批次图像！会自动排序并给予序号，拼接方向为左右时排序方向为从上到下，拼接方向为上下时则排序方向为从左到右。\n默认序号是从‘1’开始，步长也是‘1’，如果你想自定义起始数和步长，可以用这样的格式‘#x:x#’，x代表数字，第一个x是起始数，第二个是步长，‘#x:x#’格式生效的时候还可以添加前后缀文本！比如输入的为‘ZML_#0:0.5#_哈哈’，那么输出的序号就为‘ZML_0_哈哈哈’、‘ZML_0.5_哈哈哈’……这种，当然！也支持换行文本！\n\n你可以使用‘统一图像分辨率’节点来输入并处理多个图像，再输入给这个‘文本图像’节点！\n祝你天天开心~"

        default_opacity = 1.0
        # 这些默认边距将用于计算 "有效可绘制区域" 的内部文本边距
        default_h_margin = 20
        default_v_margin = 20

        bg_color_map = {
            "白色": (255, 255, 255, 255),
            "黑色": (0, 0, 0, 255),
            "透明": (0, 0, 0, 0),
            "红色": (255, 0, 0, 255),
            "蓝色": (0, 0, 255, 255),
            "黄色": (255, 255, 0, 255),
            "绿色": (0, 128, 0, 255),
        }
        current_bg_color_rgba = bg_color_map.get(背景颜色, (255, 255, 255, 255)) # Default to white
        current_bg_color_rgb_tuple = current_bg_color_rgba[:3] # For solid seams and borders


        font_path_base = os.path.join(self.font_dir, 字体) if 字体 != "Default" else None

        fill_color_for_draw = None
        if not 颜色.strip():  
            fill_color_for_draw = (0, 0, 0, 0) 
        elif 颜色.strip().lower() == "zml": 
            fill_color_for_draw = None
        else: 
            fill_color_for_draw = self.hex_to_rgba(颜色, default_opacity) 

        stroke_width_for_draw = 描边宽度 
        stroke_fill_color_for_draw = None
        if not 描边颜色.strip(): 
            stroke_width_for_draw = 0
            stroke_fill_color_for_draw = (0, 0, 0, 0) 
        elif 描边颜色.strip().lower() == "zml": 
            stroke_fill_color_for_draw = None
        else: 
            stroke_fill_color_for_draw = self.hex_to_rgba(描边颜色, default_opacity) 

        # 文本区域计算时考虑描边宽度和固定边距。
        # 这些是文本内容到文本图像边缘的"硬边距"
        effective_h_margin = default_h_margin + stroke_width_for_draw
        effective_v_margin = default_v_margin + stroke_width_for_draw
        
        # --- Batch processing loop ---
        processed_combined_images_raw = [] # This list will store individual combined images BEFORE padding/border
        input_batch_size = 输入图像.shape[0] if 输入图像 is not None else 1
        first_image_font_size = None  # 存储第一张图像的字体大小

        for i in range(input_batch_size):
            # 1. 动态生成当前图像的文本内容 (支持 #start:step# 格式)
            current_text_to_draw = 文本
            match = re.search(self.BATCH_INDEX_PLACEHOLDER, 文本)
            if input_batch_size > 1 and match:
                try:
                    start_val = float(match.group(1))
                    step_val = float(match.group(3))
                    calculated_value = start_val + i * step_val
                    
                    # Determine appropriate formatting for integer/float
                    if step_val == 0 and start_val.is_integer():
                         formatted_value = int(start_val)
                    elif calculated_value.is_integer():
                        formatted_value = int(calculated_value)
                    else:
                        # Format float to avoid excessive decimal places
                        formatted_value = round(calculated_value, 2)
                    
                    current_text_to_draw = re.sub(self.BATCH_INDEX_PLACEHOLDER, str(formatted_value), 文本)
                except ValueError:
                    print(f"ZML_TextToImage: Invalid number format in batch index '{match.group(0)}'. Falling back to plain text.")
            elif input_batch_size > 1: # No #x:y# pattern, but multiple images, use simple 1,2,3...
                current_text_to_draw = f"{i+1}"
            
            # 2. 获取当前迭代的输入图像
            current_input_pil_image = None
            if 输入图像 is not None:
                current_input_pil_image = self.tensor_to_pil(输入图像[i % 输入图像.shape[0]]).convert("RGBA")

            # 3. 根据模式计算文本图像的尺寸和字体大小
            if i == 0 or first_image_font_size is None:
                # 第一张图像或未计算字体大小时，正常计算
                final_font_size_iter = 字体大小
            else:
                # 后续图像，使用第一张图像的字体大小
                final_font_size_iter = first_image_font_size
                
            final_img_width_iter = 图像宽
            final_img_height_iter = 图像高

            # 当没有输入图像但选择了"根据输入图像尺寸决定"模式时，默认切换到"根据字体大小决定图像尺寸"模式
            # if current_input_pil_image is None and 图像大小模式 == "根据输入图像尺寸决定":
            #     图像大小模式 = "根据字体大小决定图像尺寸"

            if current_input_pil_image is not None:
                input_width, input_height = current_input_pil_image.size
                
                # --- 新增的文本内容缩放：将目标可绘制区域按比例缩小 ---
                effective_target_drawable_w_for_text_content = 0
                effective_target_drawable_h_for_text_content = 0

                # 当有输入图像时，自动应用"根据输入图像尺寸决定"的逻辑，无论用户选择了什么模式
                # if 图像大小模式 == "根据输入图像尺寸决定":
                if True:  # 总是应用这个逻辑，因为我们已经删除了该选项
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
                    
                    effective_target_drawable_w_for_text_content = int(base_drawable_width * self.TEXT_CONTENT_SCALE_PERCENTAGE)
                    effective_target_drawable_h_for_text_content = int(base_drawable_height * self.TEXT_CONTENT_SCALE_PERCENTAGE)

                    final_font_size_iter = self._auto_adjust_font_size(
                        current_text_to_draw, 字体大小, 
                        effective_target_drawable_w_for_text_content, effective_target_drawable_h_for_text_content,
                        字符间距, 行间距, 书写方向, stroke_width_for_draw,
                        self.font_dir, 字体
                    )
                    # 保存第一张图像的字体大小
                    if i == 0 and first_image_font_size is None:
                        first_image_font_size = final_font_size_iter

                # else: # Input image present, but not "根据输入图像尺寸决定" mode
                #     # 当有输入图像时，不再执行这些逻辑，因为我们总是应用"根据输入图像尺寸决定"的逻辑
                #     if 图像拼接方向 in ["左", "右"]:
                #         final_img_height_iter = input_height # Fixed height based on input image
                #         
                #         if 图像大小模式 == "根据字体大小决定图像尺寸":
                #             try:
                #                 font_for_sizing = ImageFont.truetype(font_path_base, final_font_size_iter) if font_path_base else ImageFont.load_default(final_font_size_iter)
                #             except Exception: font_for_sizing = ImageFont.load_default(final_font_size_iter)
                #             
                #             max_wrap_dim = max(1, int((input_height - (effective_v_margin * 2)) * self.TEXT_CONTENT_SCALE_PERCENTAGE))
                #             lines_for_sizing = self._prepare_lines(current_text_to_draw, font_for_sizing, 字符间距, 书写方向, max_dim=max_wrap_dim)
                #             text_block_width, _ = self._get_text_block_size(lines_for_sizing, font_for_sizing, 字符间距, 行间距, 书写方向)
                #             final_img_width_iter = max(1, text_block_width + (effective_h_margin * 2)) 
                #             
                #         elif 图像大小模式 == "根据图像尺寸决定字体大小":
                #             base_drawable_width = max(1, 图像宽 - (effective_h_margin * 2))
                #             base_drawable_height = max(1, final_img_height_iter - (effective_v_margin * 2))

                #             effective_target_drawable_w_for_text_content = int(base_drawable_width * self.TEXT_CONTENT_SCALE_PERCENTAGE)
                #             effective_target_drawable_h_for_text_content = int(base_drawable_height * self.TEXT_CONTENT_SCALE_PERCENTAGE)

                #             final_font_size_iter = self._auto_adjust_font_size(
                #                 current_text_to_draw, 字体大小, 
                #                 effective_target_drawable_w_for_text_content, effective_target_drawable_h_for_text_content,
                #                 字符间距, 行间距, 书写方向, stroke_width_for_draw,
                #                 self.font_dir, 字体
                #             )
                #             # 保存第一张图像的字体大小
                #             if i == 0 and first_image_font_size is None:
                #                 first_image_font_size = final_font_size_iter
                #             final_img_width_iter = 图像宽 
                #             
                #     elif 图像拼接方向 in ["上", "下"]:
                #         final_img_width_iter = input_width # Fixed width based on input image

                #         if 图像大小模式 == "根据字体大小决定图像尺寸":
                #             try:
                #                 font_for_sizing = ImageFont.truetype(font_path_base, final_font_size_iter) if font_path_base else ImageFont.load_default(final_font_size_iter)
                #             except Exception: font_for_sizing = ImageFont.load_default(final_font_size_iter)
                #             
                #             max_wrap_dim = max(1, int((input_width - (effective_h_margin * 2)) * self.TEXT_CONTENT_SCALE_PERCENTAGE))
                #             lines_for_sizing = self._prepare_lines(current_text_to_draw, font_for_sizing, 字符间距, 书写方向, max_dim=max_wrap_dim)
                #             _, text_block_height = self._get_text_block_size(lines_for_sizing, font_for_sizing, 字符间距, 行间距, 书写方向)
                #             final_img_height_iter = max(1, text_block_height + (effective_v_margin * 2)) 

                #         elif 图像大小模式 == "根据图像尺寸决定字体大小":
                #             base_drawable_width = max(1, final_img_width_iter - (effective_h_margin * 2))
                #             base_drawable_height = max(1, 图像高 - (effective_v_margin * 2))

                #             effective_target_drawable_w_for_text_content = int(base_drawable_width * self.TEXT_CONTENT_SCALE_PERCENTAGE)
                #             effective_target_drawable_h_for_text_content = int(base_drawable_height * self.TEXT_CONTENT_SCALE_PERCENTAGE)

                #             final_font_size_iter = self._auto_adjust_font_size(
                #                 current_text_to_draw, 字体大小, 
                #                 effective_target_drawable_w_for_text_content, effective_target_drawable_h_for_text_content,
                #                 字符间距, 行间距, 书写方向, stroke_width_for_draw,
                #                 self.font_dir, 字体
                #             )
                #             final_img_height_iter = 图像高 

            else: # No input image, process based on selected mode
                if 图像大小模式 == "根据字体大小决定图像尺寸":
                    # 直接使用用户指定的字体大小
                    final_font_size_iter = 字体大小
                    # 使用指定的字体大小计算行数和文本块大小
                    try:
                        font_for_sizing = ImageFont.truetype(font_path_base, final_font_size_iter) if font_path_base else ImageFont.load_default(final_font_size_iter)
                    except Exception: font_for_sizing = ImageFont.load_default(final_font_size_iter)

                    lines_for_sizing = self._prepare_lines(current_text_to_draw, font_for_sizing, 字符间距, 书写方向)
                    text_block_width, text_block_height = self._get_text_block_size(lines_for_sizing, font_for_sizing, 字符间距, 行间距, 书写方向)

                    # 增加额外的垂直安全空间，确保多行文本不会被截断
                    vertical_safety_margin = int(text_block_height * 0.1)  # 增加10%的安全高度
                    # 直接使用文本块大小加上边距，不再除以缩放系数，避免生成过大图像
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
                    # 保存第一张图像的字体大小
                    if i == 0 and first_image_font_size is None:
                        first_image_font_size = final_font_size_iter
                    
                    final_img_width_iter = 图像宽
                    final_img_height_iter = 图像高

            # 4. 加载最终确定的字体并绘制文本图像板
            try:
                final_font_instance = ImageFont.truetype(font_path_base, final_font_size_iter) if font_path_base else ImageFont.load_default(final_font_size_iter)
            except Exception:
                print(f"ZML_TextToImage: Final font size {final_font_size_iter} could not be loaded for '{字体}'. Falling back to default font.", exc_info=True)
                final_font_instance = ImageFont.load_default(max(1, final_font_size_iter) if final_font_size_iter > 0 else 10) 

            text_image_panel = Image.new('RGBA', (max(1, final_img_width_iter), max(1, final_img_height_iter)), current_bg_color_rgba)
            draw = ImageDraw.Draw(text_image_panel)

            # 计算文本内容实际绘制的区域
            drawable_content_w = max(1, final_img_width_iter - (effective_h_margin * 2))
            drawable_content_h = max(1, final_img_height_iter - (effective_v_margin * 2))
            
            # Use this drawable_content_w/h for line wrapping within the panel
            max_text_dim_for_drawing = drawable_content_w if 书写方向 == "横排" else drawable_content_h

            final_lines_for_drawing = self._prepare_lines(current_text_to_draw, final_font_instance, 字符间距, 书写方向, max_dim=max_text_dim_for_drawing)
            text_block_actual_width, text_block_actual_height = self._get_text_block_size(final_lines_for_drawing, final_font_instance, 字符间距, 行间距, 书写方向)
            
            # 计算将文本块绘制到区域中并居中的起始坐标
            start_x = effective_h_margin + (max(0, (drawable_content_w - text_block_actual_width)) // 2)
            start_y = effective_v_margin + (max(0, (drawable_content_h - text_block_actual_height)) // 2)
            
            start_x = max(0, start_x)
            start_y = max(0, start_y)

            self._draw_text_manually(draw, final_lines_for_drawing, start_x, start_y, final_font_instance,
                                    fill_color_for_draw, stroke_width_for_draw, stroke_fill_color_for_draw,
                                    default_opacity, 字符间距, 行间距, 书写方向)
            
            # 5. 合并文本图像面板 (text_image_panel) 和输入图像 (如果存在)，得到单个组合图像
            combined_output_pil_raw = None
            if current_input_pil_image is not None:
                input_width, input_height = current_input_pil_image.size
                
                if 图像拼接方向 == "左":
                    output_combined_width = text_image_panel.width + input_width
                    output_combined_height = max(text_image_panel.height, input_height)
                    combined_output_pil_raw = Image.new('RGBA', (output_combined_width, output_combined_height), (0, 0, 0, 0))
                    combined_output_pil_raw.paste(text_image_panel, (0, (output_combined_height - text_image_panel.height) // 2), text_image_panel) 
                    combined_output_pil_raw.paste(current_input_pil_image, (text_image_panel.width, (output_combined_height - input_height) // 2), current_input_pil_image) 
                elif 图像拼接方向 == "右":
                    output_combined_width = input_width + text_image_panel.width
                    output_combined_height = max(input_height, text_image_panel.height)
                    combined_output_pil_raw = Image.new('RGBA', (output_combined_width, output_combined_height), (0, 0, 0, 0))
                    combined_output_pil_raw.paste(current_input_pil_image, (0, (output_combined_height - input_height) // 2)) 
                    combined_output_pil_raw.paste(text_image_panel, (input_width, (output_combined_height - text_image_panel.height) // 2), text_image_panel) 
                elif 图像拼接方向 == "上":
                    output_combined_width = max(input_width, text_image_panel.width)
                    output_combined_height = text_image_panel.height + input_height
                    combined_output_pil_raw = Image.new('RGBA', (output_combined_width, output_combined_height), (0, 0, 0, 0))
                    combined_output_pil_raw.paste(text_image_panel, ((output_combined_width - text_image_panel.width) // 2, 0), text_image_panel) 
                    combined_output_pil_raw.paste(current_input_pil_image, ((output_combined_width - input_width) // 2, text_image_panel.height), current_input_pil_image) 
                elif 图像拼接方向 == "下":
                    output_combined_width = max(input_width, text_image_panel.width)
                    output_combined_height = input_height + text_image_panel.height
                    combined_output_pil_raw = Image.new('RGBA', (output_combined_width, output_combined_height), (0, 0, 0, 0))
                    combined_output_pil_raw.paste(current_input_pil_image, ((output_combined_width - input_width) // 2, 0), current_input_pil_image) 
                    combined_output_pil_raw.paste(text_image_panel, ((output_combined_width - text_image_panel.width) // 2, input_height), text_image_panel) 
                
            else: # No input image, just the text_image_panel itself
                combined_output_pil_raw = text_image_panel

            processed_combined_images_raw.append(combined_output_pil_raw)


        # --- Final batch concatenation with outer border and inner seams ---
        if not processed_combined_images_raw:
            return (torch.zeros((1, 64, 64, 4)), help_text) 

        # 单图模式下直接返回原图，不添加额外边框
        if len(processed_combined_images_raw) == 1:
            final_output_image = processed_combined_images_raw[0]
        else:
            # 多图模式下的拼接逻辑
            # Determine final concatenation direction based on where text was placed relative to image
            final_concat_direction = None
            if 图像拼接方向 in ["左", "右"]:
                final_concat_direction = "vertical" # Text was horizontal to main image, so stack results vertically
            elif 图像拼接方向 in ["上", "下"]:
                final_concat_direction = "horizontal" # Text was vertical to main image, so stack results horizontally
            else:
                final_concat_direction = "vertical" 

            # Calculate total dimensions for final image including outer border and internal seams
            # Also determine max width/height needed for aligning individual images
            max_item_width = 0
            max_item_height = 0
            for img_item in processed_combined_images_raw:
                max_item_width = max(max_item_width, img_item.width)
                max_item_height = max(max_item_height, img_item.height)

            total_width_sum = 0
            total_height_sum = 0
            
            if final_concat_direction == "vertical":
                total_width_for_stack = max_item_width # All items resized to this common width
                total_height_sum = sum(img.height for img in processed_combined_images_raw)
                total_final_height = total_height_sum + max(0, len(processed_combined_images_raw) - 1) * 多图模式图像接缝 + (2 * 多图模式图像接缝) # Sum heights + inner seams + outer border
                total_final_width = total_width_for_stack + (2 * 多图模式图像接缝) # Max width + outer border
            else: # horizontal
                total_height_for_stack = max_item_height # All items resized to this common height
                total_width_sum = sum(img.width for img in processed_combined_images_raw)
                total_final_width = total_width_sum + max(0, len(processed_combined_images_raw) - 1) * 多图模式图像接缝 + (2 * 多图模式图像接缝) # Sum widths + inner seams + outer border
                total_final_height = total_height_for_stack + (2 * 多图模式图像接缝) # Max height + outer border
            
            # Create the final background image with outer border
            final_output_image = Image.new("RGBA", 
                                           (max(1, total_final_width), max(1, total_final_height)), # Ensure 1x1 minimum
                                           current_bg_color_rgba if 背景颜色 == "透明" else current_bg_color_rgb_tuple + (255,))

            current_x = 多图模式图像接缝 # Start first item after outer border
            current_y = 多图模式图像接缝 # Start first item after outer border

        # 仅在多图模式下执行拼接循环
        if len(processed_combined_images_raw) > 1:
            for img_idx, img_item_raw in enumerate(processed_combined_images_raw):
                img_item = img_item_raw.convert("RGBA") # Ensure RGBA for paste with alpha

                if final_concat_direction == "vertical":
                    # Resize to common width (LANCZOS is high quality) and center if needed
                    aligned_img_item = Image.new("RGBA", (total_width_for_stack, img_item.height), (0,0,0,0))
                    aligned_img_item.paste(img_item, ((total_width_for_stack - img_item.width) // 2, 0))

                    final_output_image.paste(aligned_img_item, (current_x, current_y), aligned_img_item)
                    current_y += aligned_img_item.height + 多图模式图像接缝 # Move down for next item with seam
                else: # horizontal
                    # Resize to common height and center if needed
                    aligned_img_item = Image.new("RGBA", (img_item.width, total_height_for_stack), (0,0,0,0))
                    aligned_img_item.paste(img_item, (0, (total_height_for_stack - img_item.height) // 2))

                    final_output_image.paste(aligned_img_item, (current_x, current_y), aligned_img_item)
                    current_x += aligned_img_item.width + 多图模式图像接缝 # Move right for next item with seam
        
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
