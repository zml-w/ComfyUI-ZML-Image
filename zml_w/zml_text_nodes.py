# custom_nodes/zml_text_nodes.py

import os
import folder_paths
import re
import numpy as np
from PIL import Image
import io
import datetime
import torch
import base64
import html
import random
import json

# ============================== 文本输入节点 ==============================
class ZML_TextInput:
    """
    ZML 文本输入节点
    允许用户输入多行文本
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "文本": ("STRING", {
                    "multiline": True, 
                    "default": "",
                    "placeholder": "输入多行文本"
                }),
            }
        }
    
    CATEGORY = "image/ZML_图像/文本"
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("文本",)
    FUNCTION = "process_text"
    
    def process_text(self, 文本):
        """处理文本输入"""
        # 直接返回输入的文本
        return (文本,)

# ============================== 写入文本节点 ==============================
class ZML_WriteText:
    """ZML 写入文本节点"""
    
    def __init__(self):
        self.type = "output"
        node_dir = os.path.dirname(os.path.abspath(__file__))
        self.default_save_path = os.path.join(node_dir, "txt", "Text input", "文本输入.txt")
        self.help_text = "你好，欢迎使用ZML节点~\n本节点会将文本A和文本B结合后写入指定的TXT文件。如果你不指定路径，它会自动保存在插件的 'zml_/txt/Text input' 文件夹中。\n如果路径为文件夹，则会写入该文件夹下的“文本输入.txt”里，没有此文件会自动创建。\n也可以指定路径为一个txt文件，但仅支持txt格式。/n祝你使用愉快~天天开心~"
        
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "文本A": ("STRING", {"default": "", "placeholder": "输入文本A"}),
                "文本B": ("STRING", {"default": "", "placeholder": "输入文本B"}),
                "保存路径": ("STRING", {"default": "", "placeholder": "文件或文件夹路径 (可选)"}),
            }
        }
    
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("Help",)
    FUNCTION = "write_text"
    OUTPUT_NODE = True
    CATEGORY = "image/ZML_图像/文本"
    
    @classmethod
    def IS_CHANGED(cls):
        return float("nan")
    
    def write_text(self, 文本A, 文本B, 保存路径):
        """将文本A和文本B合并后写入文件"""
        
        # 移除文本A和文本B之间的分隔符
        combined_text = f"{文本A}{文本B}".strip()

        path_input = 保存路径.strip().strip('"').strip("'")
        
        file_path = ""
        
        # --- 路径解析逻辑 ---
        if not path_input:
            file_path = self.default_save_path
        elif os.path.isdir(path_input):
            file_path = os.path.join(path_input, "文本输入.txt")
        elif path_input.lower().endswith(".txt"):
            file_path = path_input
        else:
            raise ValueError("路径格式不正确，请输入一个文件夹路径或.txt文件路径。")

        # --- 文件写入逻辑 ---
        try:
            dir_path = os.path.dirname(file_path)
            os.makedirs(dir_path, exist_ok=True)
            
            abs_path = os.path.abspath(file_path)
            
            if not combined_text:
                # 在UI中提示，并返回Help文本
                return {"result": (self.help_text,), "ui": {"text": [f"文本为空，没有写入内容。\n文件位置: {abs_path}"]}}
            
            text_to_write = combined_text
            if combined_text and combined_text[-1] in ["，", "。", " "]:
                text_to_write = combined_text[:-1] + ","
            
            file_exists = os.path.exists(file_path)
            file_is_empty = not file_exists or os.path.getsize(file_path) == 0
            
            with open(file_path, "a", encoding="utf-8") as f:
                if not file_is_empty:
                    f.write("\n")
                f.write(text_to_write)
            
            msg = "文本已写入"
            if file_is_empty:
                msg += "（新文件）"
            else:
                msg += "（已追加）"
            
            # 操作成功后，在UI中提示，并返回Help文本
            return {"result": (self.help_text,), "ui": {"text": [f"{msg}\n文件位置: {abs_path}"]}}
        
        except Exception as e:
            print(f"写入文件时发生错误: {e}")
            raise e

# ============================== 预设文本节点==============================
# 定义预设文件的路径
PRESET_FILE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "txt", "Preset text", "Preset text.txt")

class ZML_PresetText:
    """
    ZML 预设文本节点
    从预设文件中加载文本选项
    """
    _presets_map = {}
    _preset_names = []

    @classmethod
    def _load_presets(cls):
        """从文本文件中加载、解析和准备预设。"""
        preset_dir = os.path.dirname(PRESET_FILE_PATH)
        # 如果目录或文件不存在，则创建它们并填入默认内容
        if not os.path.exists(preset_dir):
            os.makedirs(preset_dir, exist_ok=True)
        if not os.path.exists(PRESET_FILE_PATH):
            with open(PRESET_FILE_PATH, 'w', encoding='utf-8') as f:
                f.write("# 这是注释行，将被忽略\n")
                f.write("001 #-# 1girl, solo, best quality\n")
                f.write("002 #-# 1boy, safe, masterpiece\n")

        try:
            with open(PRESET_FILE_PATH, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            
            # 每次加载前清空旧数据
            cls._presets_map.clear()
            cls._preset_names.clear()

            for line in lines:
                line = line.strip()
                # 跳过空行或以'#'开头的注释行
                if not line or line.startswith('#'):
                    continue
                
                parts = line.split('#-#', 1)
                if len(parts) == 2:
                    name = parts[0].strip()
                    value = parts[1].strip()
                    if name:  # 确保名称不为空
                        cls._presets_map[name] = value
                        cls._preset_names.append(name)
            
            # 如果加载后列表仍为空，提供一个提示选项
            if not cls._preset_names:
                cls._preset_names.append("文件为空或格式错误")
                cls._presets_map["文件为空或格式错误"] = ""

        except Exception as e:
            print(f"ZML_PresetText 错误: 无法加载预设文件: {e}")
            cls._preset_names = ["错误：无法加载文件"]
            cls._presets_map = {"错误：无法加载文件": ""}
    
    @classmethod
    def INPUT_TYPES(cls):
        # 加载预设以填充下拉菜单
        cls._load_presets()
        return {
            "required": {
                "预设": (cls._preset_names, ),
            }
        }
    
    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("文本", "help")
    FUNCTION = "get_text"
    CATEGORY = "image/ZML_图像/文本"

    def get_text(self, 预设):
        # 从已加载的映射中获取输出文本
        output_text = self._presets_map.get(预设, "")
        help_text = "你好~欢迎使用ZML节点~\n此节点会读取‘ComfyUI-ZML-Image\\zml_w\\txt\\Preset text\\Preset text.txt’文件，会将文本的每一行都算为一个选项，文本由‘#-#’分割，前面的作为下拉选项的显示名称，后面的作为输出的文本，随便试试应该就可以搞明白了。\n祝你生活愉快，天天开心~"
        return (output_text, help_text)

# ============================== 图片转HTML节点 ==============================
class ZML_ImageToHTML:
    """ZML 图片转HTML节点"""
    
    def __init__(self):
        self.output_dir = folder_paths.get_output_directory()
        self.type = "output"
        self.node_dir = os.path.dirname(os.path.abspath(__file__))
        
        # HTML计数器文件路径
        self.counter_file = os.path.join(self.node_dir, "HTML计数器.txt")
        
        # 确保计数器文件存在
        self.ensure_counter_file()
    
    def ensure_counter_file(self):
        """确保HTML计数器文件存在"""
        try:
            if not os.path.exists(self.counter_file):
                with open(self.counter_file, "w", encoding="utf-8") as f:
                    f.write("0")
        except Exception:
            pass
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "optional": {
                "图像": ("IMAGE", {}),  # 图像作为可选输入
                "附加图像": ("IMAGE", {}),  # 附加图像作为可选输入
            },
            "required": {
                "文件名": ("STRING", {"default": "", "placeholder": "HTML文件名（不带扩展名）"}),
                "保存路径": ("STRING", {"default": "", "placeholder": "相对/绝对路径 (留空使用output)"}),
                "纯图片输出": (["启用", "禁用"], {"default": "禁用"}),
                "标题": ("STRING", {"default": "", "placeholder": "自定义标题（最多30字符）"}),
                "附加图像分辨率": (["100*100", "200*200", "300*300", "500*500"], {"default": "200*200"}),
                # 新增GIF帧率选项
                "GIF帧率": ("INT", {"default": 16, "min": 1, "max": 60, "step": 1}),
            }
        }
    
    # 添加输出接口
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("Help",)
    FUNCTION = "convert_to_html"
    OUTPUT_NODE = True
    CATEGORY = "image/ZML_图像/图像"
    
    def sanitize_filename(self, name):
        """清理文件名，移除非法字符"""
        if not name:
            return ""
        name = re.sub(r'[<>:"/\\|?*\x00-\x1F]', '', name).strip()
        name = name.strip('"').strip("'")
        name = name.replace(' ', '-')
        return name
    
    def format_path(self, path):
        """格式化用户输入的路径"""
        if not path:
            return self.output_dir
        
        path = path.strip().strip('"').strip("'")
        
        if path.startswith("./"):
            path = path[2:]
        
        if not path:
            return self.output_dir
        
        if os.path.isabs(path):
            return path
        
        comfyui_root = os.path.dirname(self.output_dir)
        full_path = os.path.join(comfyui_root, path)
        return full_path
    
    def ensure_directory(self, path):
        """确保目录存在"""
        try:
            if not os.path.exists(path):
                os.makedirs(path, exist_ok=True)
            return path
        except Exception:
            return self.output_dir
    
    def increment_html_counter(self):
        """增加HTML转换计数器"""
        try:
            if os.path.exists(self.counter_file):
                with open(self.counter_file, "r", encoding="utf-8") as f:
                    count = int(f.read().strip()) + 1
            else:
                count = 1
            with open(self.counter_file, "w", encoding="utf-8") as f:
                f.write(str(count))
            return count
        except Exception:
            return 0
    
    def get_unique_filepath(self, filepath):
        """获取唯一文件名，避免覆盖已有文件"""
        base, ext = os.path.splitext(filepath)
        counter = 1
        new_path = filepath
        
        while os.path.exists(new_path):
            new_path = f"{base} ({counter}){ext}"
            counter += 1
            
        return new_path
    
    def tensor_to_pil(self, image_tensor):
        """将图像张量转换为PIL图像"""
        image_array = 255. * image_tensor.cpu().numpy()
        image_array = np.clip(image_array, 0, 255).astype(np.uint8)
        
        # 确保通道顺序为 (高度, 宽度, 通道)
        if image_array.shape[0] in (3, 4) and image_array.ndim == 3:
            image_array = image_array.transpose(1, 2, 0)
        
        # 转换为PIL图像
        if image_array.shape[-1] == 4:  # RGBA
            return Image.fromarray(image_array, 'RGBA')
        else:  # RGB
            return Image.fromarray(image_array, 'RGB')
    
    def create_gif(self, image_tensors, duration, max_size=0):
        """将多个图像张量创建为GIF"""
        try:
            # 创建帧列表
            frames = []
            
            for tensor in image_tensors:
                pil_img = self.tensor_to_pil(tensor)
                
                # 如果需要调整大小
                if max_size > 0:
                    width, height = pil_img.size
                    # 计算新尺寸（保持宽高比）
                    if width > height:
                        new_width = max_size
                        new_height = int(height * max_size / width)
                    else:
                        new_height = max_size
                        new_width = int(width * max_size / height)
                    
                    # 调整图像大小
                    pil_img = pil_img.resize((new_width, new_height), Image.LANCZOS)
                
                frames.append(pil_img)
            
            # 创建GIF
            gif_bytes = io.BytesIO()
            frames[0].save(
                gif_bytes,
                format='GIF',
                save_all=True,
                append_images=frames[1:],
                duration=duration,
                loop=0
            )
            gif_bytes = gif_bytes.getvalue()
            
            # 转换为Base64
            return base64.b64encode(gif_bytes).decode('utf-8')
        
        except Exception as e:
            print(f"创建GIF失败: {str(e)}")
            return ""
    
    def image_to_base64(self, image_tensor, max_size=0):
        """
        将图像张量转换为Base64编码字符串
        可选参数max_size用于限制图像最大尺寸（保持宽高比）
        """
        try:
            pil_image = self.tensor_to_pil(image_tensor)
            
            # 如果需要调整大小
            if max_size > 0:
                width, height = pil_image.size
                # 计算新尺寸（保持宽高比）
                if width > height:
                    new_width = max_size
                    new_height = int(height * max_size / width)
                else:
                    new_height = max_size
                    new_width = int(width * max_size / height)
                
                # 调整图像大小
                pil_image = pil_image.resize((new_width, new_height), Image.LANCZOS)
            
            # 转换为字节流
            img_byte_arr = io.BytesIO()
            pil_image.save(img_byte_arr, format='PNG')
            img_byte_arr = img_byte_arr.getvalue()
            
            # 转换为Base64
            return base64.b64encode(img_byte_arr).decode('utf-8')
        
        except Exception as e:
            print(f"图像转换失败: {str(e)}")
            return ""
    
    def convert_to_html(self, 图像=None, **kwargs):
        """将图像转换为HTML文件（支持GIF合成）"""
        # 从kwargs中获取其他参数
        文件名 = kwargs.get("文件名", "")
        保存路径 = kwargs.get("保存路径", "")
        纯图片输出 = kwargs.get("纯图片输出", "禁用")
        标题 = kwargs.get("标题", "")
        附加图像 = kwargs.get("附加图像", None)
        附加图像分辨率 = kwargs.get("附加图像分辨率", "200*200")
        gif帧率 = kwargs.get("GIF帧率", 16)  # 获取GIF帧率
        
        # 计算帧间隔时间（毫秒）
        frame_duration = int(1000 / gif帧率) if gif帧率 > 0 else 100
        
        # 解析附加图像分辨率
        try:
            max_logo_size = int(附加图像分辨率.split('*')[0])
        except:
            max_logo_size = 200
        
        # 增加HTML计数器
        total_count = self.increment_html_counter()
        help_output = f"你好，很高兴你使用ZML节点，到目前为止，你通过此节点总共转格式了{total_count}次图像！\n如果你不想转换后的HTML文件里有标题的话，那可以选择纯图片输出，这样转化后的HTML文件里就只含有图片了。\n标题输入有字数限制，超过30个字符就不写入了。\n附加图像只有在禁用“纯图片输出”时才会启用，附加图像会展示在标题的左边，节点还会根据附加图像的比例来自动调整分辨率，如果你的附加图像是“400*200”，但是你选择的分辨率为“200*200”，那调整后的附加图像比例为“200*100”，所以好好选择附加图像的分辨率哦~\n并且此节点支持合并图像为GIF，你可以使用‘GIF文件路径’节点来加载GIF，然后再输入给此节点转化为HTML~\n好啦~祝你生活愉快~天天开心~"
        
        # 如果没有主图像输入
        if 图像 is None or 图像.size(0) == 0:
            return {"result": (help_output,)}
        
        # 处理文件名和路径
        sanitized_filename = self.sanitize_filename(文件名)
        save_path = self.ensure_directory(self.format_path(保存路径))
        
        # 确定文件名
        if not sanitized_filename:
            # 使用当前时间作为文件名
            sanitized_filename = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
        html_filename = sanitized_filename + ".html"
        full_path = os.path.join(save_path, html_filename)
        
        # 确保文件名唯一
        final_path = self.get_unique_filepath(full_path)
        
        try:
            # 处理主图像
            base64_str = ""
            is_gif = False
            
            if 图像.size(0) > 1:
                # 多张图像 - 创建GIF
                base64_str = self.create_gif(图像, frame_duration)
                is_gif = True
            else:
                # 单张图像
                image_tensor = 图像[0]
                base64_str = self.image_to_base64(image_tensor, max_size=0)
            
            # 处理附加图像（只有在禁用纯图片输出时才使用）
            extra_image_html = ""
            if 附加图像 is not None and 附加图像.size(0) > 0 and 纯图片输出 == "禁用":
                if 附加图像.size(0) > 1:
                    # 多张附加图像 - 创建GIF
                    extra_base64 = self.create_gif(附加图像, frame_duration, max_size=max_logo_size)
                else:
                    # 单张附加图像
                    extra_image_tensor = 附加图像[0]
                    extra_base64 = self.image_to_base64(extra_image_tensor, max_size=max_logo_size)
                
                # 创建附加图像HTML
                extra_image_html = f"""
        <div class="logo-container">
            <img src="data:image/{'gif' if 附加图像.size(0) > 1 else 'png'};base64,{extra_base64}" alt="附加图像">
        </div>"""
            
            if 纯图片输出 == "启用":
                # 纯图片模式 - 只有图片
                html_content = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
</head>
<body>
    <img src="data:image/{'gif' if is_gif else 'png'};base64,{base64_str}" style="max-width:100%;height:auto">
</body>
</html>"""
            else:
                # 处理标题（限制30字符，转义特殊字符）
                sanitized_title = html.escape(标题[:30]) if 标题 else ""
                
                # 包含提示信息的模式
                html_content = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body {{
            font-family: Arial, sans-serif;
            background-color: #f5f5f5;
            margin: 0;
            padding: 20px;
        }}
        .container {{
            max-width: 800px;
            margin: 0 auto;
            background-color: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
        }}
        .header {{
            margin-bottom: 20px;
            color: #333;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 15px;
        }}
        .header-content {{
            text-align: left;
        }}
        .logo-container {{
            width: {max_logo_size}px;
            height: {max_logo_size}px;
            display: flex;
            align-items: center;
            justify-content: center;
        }}
        .logo-container img {{
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
        }}
        .image-container {{
            max-width: 100%;
            margin: 20px auto;
        }}
        img {{
            max-width: 100%;
            height: auto;
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 5px;
        }}
        .custom-title {{
            font-size: 18px;
            font-weight: bold;
            margin-top: 10px;
            color: #2c3e50;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            {extra_image_html}
            <div class="header-content">
                <h2>你好，很高兴你使用ZML节点</h2>
                <p>到目前为止，你通过此节点总共转化了{total_count}次图像！祝你天天开心。</p>
                {f'<p class="custom-title">{sanitized_title}</p>' if sanitized_title else ''}
            </div>
        </div>
        
        <div class="image-container">
            <img src="data:image/{'gif' if is_gif else 'png'};base64,{base64_str}">
        </div>
    </div>
</body>
</html>"""
            
            # 保存HTML文件
            with open(final_path, "w", encoding="utf-8") as f:
                f.write(html_content)
            
            # 返回输出接口值
            return {"result": (help_output,)}
        
        except Exception as e:
            error_help = f"保存HTML时出错: {str(e)}"
            return {"result": (error_help,)}

# ============================== GIF文件路径节点 ==============================
class ZML_GIFLoader:
    """ZML GIF文件路径节点"""
    
    def __init__(self):
        pass
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "文件路径": ("STRING", {"default": "", "placeholder": "输入GIF文件路径"}),
            }
        }
    
    RETURN_TYPES = ("IMAGE", "INT", "STRING")
    RETURN_NAMES = ("图像", "帧率", "Help")
    FUNCTION = "load_gif"
    CATEGORY = "image/ZML_图像/图像"
    
    def load_gif(self, 文件路径):
        """加载GIF文件并分解为图像序列"""
        help_output = "你好，欢迎使用ZML节点~\n你需要使用文件路径而非文件夹路径来指定GIF文件，此节点会自动拆分指定的GIF文件并输出图像和帧率，且会自动处理透明通道，此节点与图片转HTML节点一起使用效果最佳~\n祝你生活愉快~天天开心~"
        
        # 清理文件路径
        文件路径 = 文件路径.strip().strip('"').strip("'")
        
        if not 文件路径:
            return (torch.zeros(0), 0, help_output)
        
        if not os.path.exists(文件路径):
            return (torch.zeros(0), 0, help_output)
        
        try:
            # 打开GIF文件
            gif = Image.open(文件路径)
            
            # 获取帧率信息
            frame_duration = 100
            try:
                # 尝试获取第一帧的持续时间
                frame_duration = gif.info.get('duration', 100)
                if frame_duration == 0:
                    frame_duration = 100
            except:
                frame_duration = 100
            
            # 计算帧率 (帧/秒)
            fps = max(1, min(60, int(1000 / frame_duration)))
            
            # 提取所有帧
            frames = []
            frame_count = 0
            while True:
                try:
                    # 转换为RGBA模式以处理透明度
                    frame = gif.convert("RGBA")
                    
                    # 转换为RGB模式（去除透明度）
                    rgb_frame = Image.new("RGB", frame.size, (255, 255, 255))
                    rgb_frame.paste(frame, mask=frame.split()[3])  # 使用alpha通道作为mask
                    
                    # 转换为numpy数组
                    frame_array = np.array(rgb_frame).astype(np.float32) / 255.0
                    frame_tensor = torch.from_numpy(frame_array)[None,]
                    frames.append(frame_tensor)
                    
                    # 移动到下一帧
                    frame_count += 1
                    gif.seek(frame_count)
                except EOFError:
                    break
            
            # 如果没有提取到帧
            if not frames:
                return (torch.zeros(0), fps, help_output)
            
            # 合并所有帧
            images = torch.cat(frames, dim=0)
            
            return (images, fps, help_output)
        
        except Exception as e:
            print(f"加载GIF失败: {str(e)}")
            return (torch.zeros(0), 0, help_output)

# ============================== 双整数节点 (New) ==============================
class ZML_DualInteger:
    """
    ZML 双整数节点
    提供两个可自由调节的整数值作为宽和高。
    """
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "A": ("INT", {"default": 1024, "min": 0, "max": 16384, "step": 1}),
                "B": ("INT", {"default": 1024, "min": 0, "max": 16384, "step": 1}),
            }
        }

    RETURN_TYPES = ("INT", "INT")
    RETURN_NAMES = ("A", "B")
    FUNCTION = "get_simple_dimensions"
    CATEGORY = "image/ZML_图像/整数"

    def get_simple_dimensions(self, A, B):
        return (A, B)

# ============================== 双整数V2节点 (MODIFIED) ==============================
class ZML_DualIntegerV2:
    """
    ZML 双整数V2节点
    提供固定的宽和高，以及从文本列表中按索引或随机选择的宽和高。
    """
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "预设宽": ("STRING", {
                    "multiline": False,
                    "default": "832,1024,1216",
                    "placeholder": "用英文逗号,分隔多个宽度值"
                }),
                "预设高": ("STRING", {
                    "multiline": False,
                    "default": "1216,1024,832",
                    "placeholder": "用英文逗号,分隔多个高度值"
                }),
                "索引值": ("INT", {"default": 0, "min": 0, "max": 114514, "step": 1}),
                "随机宽高对应": ("BOOLEAN", {"default": True, "label_on": "开启对应", "label_off": "独立随机"}),
            }
        }

    RETURN_TYPES = ("INT", "INT", "STRING")
    RETURN_NAMES = ("预设宽", "预设高", "help")
    FUNCTION = "get_dimensions"
    CATEGORY = "image/ZML_图像/整数"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # 强制节点在每次执行时都重新运行，以确保随机性
        return float("nan")

    def get_dimensions(self, 预设宽, 预设高, 索引值, 随机宽高对应):
        help_text = "你好，欢迎使用ZML节点~\n你可以在预设宽高框里输入你想要的分辨率，然后用英文逗号‘,’来隔开它们。当索引值为‘0’或大于预设宽高框里值得总数时（默认有三个），预设宽高的输出接口会随机输出预设宽高框里的值，如果索引值没有超过预设宽高里值得总数，则按照对应得索引来输出预设宽和预设高。\n当你开启‘随机宽高对应’的时候宽和高是使用同一个索引值的，比如随机到了默认预设下的第一个值，则输出为‘832*1216’，随机到第三个值输出为‘1216*832’，关闭‘随机宽高对应’的时候宽和高是独立索引，你可能会随机到‘832*832’或‘1216*1216’。\n好啦~就那么简单！感谢你使用ZML节点，祝你使用愉快~天天开心~"
        
        # --- 解析文本输入 ---
        valid_widths = []
        for item in 预设宽.split(','):
            try:
                valid_widths.append(int(item.strip()))
            except ValueError:
                pass
        
        valid_heights = []
        for item in 预设高.split(','):
            try:
                valid_heights.append(int(item.strip()))
            except ValueError:
                pass

        # 提供一个默认的回退值
        preset_width = 1024
        preset_height = 1024
        
        use_random = True
        # --- 根据索引值决定是索引还是随机 ---
        if 索引值 > 0 and valid_widths and valid_heights:
            # 将1-based索引转换为0-based
            actual_index = 索引值 - 1
            
            # 检查索引是否在两个列表的有效范围内
            if actual_index < len(valid_widths) and actual_index < len(valid_heights):
                preset_width = valid_widths[actual_index]
                preset_height = valid_heights[actual_index]
                use_random = False # 找到了有效索引，不再随机

        # --- 如果需要随机 (索引为0或超出范围) ---
        if use_random:
            if 随机宽高对应 and valid_widths and valid_heights:
                # 开启对应模式，且两个列表都有效
                # 使用较短的列表长度作为随机范围，以避免索引越界
                min_len = min(len(valid_widths), len(valid_heights))
                if min_len > 0:
                    rand_index = random.randint(0, min_len - 1)
                    preset_width = valid_widths[rand_index]
                    preset_height = valid_heights[rand_index]
            else:
                # 独立随机模式（或当任一列表无效时的后备模式）
                if valid_widths:
                    preset_width = random.choice(valid_widths)
                if valid_heights:
                    preset_height = random.choice(valid_heights)
            
        return (preset_width, preset_height, help_text)

# ============================== 双整数V3（判断）节点 (MODIFIED) ==============================
class ZML_DualIntegerV3:
    """
    ZML 双整数V3（判断）节点
    根据输入的宽和高的比较结果，从预设列表中输出不同的尺寸和信号值。
    """
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "宽": ("INT", {"forceInput": True}),
                "高": ("INT", {"forceInput": True}),
                "阈值": ("INT", {"default": 0, "min": 0, "max": 16384, "step": 1}),
                "宽列表": ("STRING", {
                    "multiline": False,
                    "default": "832,1024,1216"
                }),
                "高列表": ("STRING", {
                    "multiline": False,
                    "default": "1216,1024,832"
                }),
            }
        }

    RETURN_TYPES = ("INT", "INT", "INT", "FLOAT", "BOOLEAN")
    RETURN_NAMES = ("宽", "高", "整数", "浮点", "布尔")
    FUNCTION = "process_comparison"
    CATEGORY = "image/ZML_图像/整数"

    def process_comparison(self, 宽, 高, 阈值, 宽列表, 高列表):
        # -- 解析输入的列表字符串 --
        try:
            widths = [int(x.strip()) for x in 宽列表.split(',')]
            if len(widths) < 3:
                raise ValueError()
        except:
            widths = [832, 1024, 1216]

        try:
            heights = [int(x.strip()) for x in 高列表.split(',')]
            if len(heights) < 3:
                raise ValueError()
        except:
            heights = [1216, 1024, 832]

        # -- 新的判断逻辑 --
        if abs(宽 - 高) <= 阈值:
            # 当宽高差小于等于阈值时，视为“相等”
            out_w = widths[1]
            out_h = heights[1]
            out_int = 2
            out_float = 2.0
            out_bool = True
        elif 宽 < 高:
            # 视为“小于”
            out_w = widths[0]
            out_h = heights[0]
            out_int = 1
            out_float = 1.0
            out_bool = True
        else: # 宽 > 高
            # 视为“大于”
            out_w = widths[2]
            out_h = heights[2]
            out_int = 3
            out_float = 3.0
            out_bool = True
            
        return (out_w, out_h, out_int, out_float, out_bool)

# ============================== 顺序加载整数节点 (新增) ==============================
class ZML_SequentialIntegerLoader:
    """
    ZML 顺序加载整数节点
    按顺序、间隔和范围加载一个整数，并在达到终点时循环。
    """
    def __init__(self):
        # 找到包含 'zml_w' 的父目录，即 'ComfyUI-ZML-Image'
        node_dir = os.path.dirname(os.path.abspath(__file__))
        # 在 'ComfyUI-ZML-Image' 根目录下创建 'zml_w/counter'
        self.counter_dir = os.path.join(node_dir, "counter")
        os.makedirs(self.counter_dir, exist_ok=True)
        self.counter_file = os.path.join(self.counter_dir, "顺序加载整数.txt")

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "起始数": ("INT", {"default": 1, "min": -999999, "max": 999999, "step": 1}),
                "最终数": ("INT", {"default": 3, "min": -999999, "max": 999999, "step": 1}),
                "间隔": ("INT", {"default": 1, "min": 1, "max": 999999, "step": 1}),
            }
        }

    RETURN_TYPES = ("INT", "FLOAT")
    RETURN_NAMES = ("整数", "浮点")
    FUNCTION = "load_sequentially"
    CATEGORY = "image/ZML_图像/整数"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # 强制每次都运行
        return float("nan")

    def load_sequentially(self, 起始数, 最终数, 间隔):
        # 确保起始数不大于最终数
        if 起始数 > 最终数:
            起始数, 最终数 = 最终数, 起始数
        
        # 确保间隔是正数
        间隔 = max(1, 间隔)

        current_params = {"start": 起始数, "end": 最终数, "step": 间隔}
        
        # 尝试读取旧状态
        try:
            with open(self.counter_file, 'r', encoding='utf-8') as f:
                state = json.load(f)
            last_value = state.get("current_value")
            last_params = state.get("last_params")
        except (FileNotFoundError, json.JSONDecodeError):
            last_value = None
            last_params = None
            
        # 检查参数是否变化，如果变化则重置
        if current_params != last_params:
            next_value = 起始数
        else:
            # 参数未变，继续计算
            if last_value is None or last_value >= 最终数:
                # 如果没有记录或已达到终点，则从头开始
                next_value = 起始数
            else:
                # 加上间隔
                next_value = last_value + 间隔
                # 如果超过最终数，则取最终数
                if next_value > 最终数:
                    next_value = 最终数
        
        # 保存新状态
        new_state = {"current_value": next_value, "last_params": current_params}
        try:
            with open(self.counter_file, 'w', encoding='utf-8') as f:
                json.dump(new_state, f)
        except Exception as e:
            print(f"ZML_SequentialIntegerLoader 错误: 无法写入计数文件: {e}")

        return (int(next_value), float(next_value))

# ============================== 双浮点节点==============================
class ZML_DualFloat:
    """
    ZML 双浮点节点
    提供两个可自由调节的浮点值。
    """
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "A": ("FLOAT", {"default": 10.0, "min": 0.0, "max": 16384.0, "step": 0.1}),
                "B": ("FLOAT", {"default": 10.0, "min": 0.0, "max": 16384.0, "step": 0.1}),
            }
        }

    RETURN_TYPES = ("FLOAT", "FLOAT")
    RETURN_NAMES = ("A", "B")
    FUNCTION = "get_floats"
    CATEGORY = "image/ZML_图像/整数"

    def get_floats(self, A, B):
        return (A, B)

# ============================== 预设分辨率节点 (新增) ==============================
# 定义预设分辨率文件的路径
PRESET_RESOLUTION_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "txt", "Preset integer", "Preset integer.txt")

class ZML_PresetResolution:
    """
    ZML 预设分辨率节点
    从预设文件中加载分辨率选项 (宽,高)
    """
    _resolutions_map = {}
    _resolution_names = []

    @classmethod
    def _load_resolutions(cls):
        """从文本文件中加载、解析分辨率预设。"""
        preset_dir = os.path.dirname(PRESET_RESOLUTION_PATH)
        # 如果目录或文件不存在，则创建它们并填入默认内容
        if not os.path.exists(preset_dir):
            os.makedirs(preset_dir, exist_ok=True)
        if not os.path.exists(PRESET_RESOLUTION_PATH):
            with open(PRESET_RESOLUTION_PATH, 'w', encoding='utf-8') as f:
                f.write("# 这是注释行，将被忽略\n")
                f.write("1024,768\n")
                f.write("768,1024\n")

        try:
            with open(PRESET_RESOLUTION_PATH, 'r', encoding='utf-8') as f:
                lines = f.readlines()

            # 每次加载前清空旧数据
            cls._resolutions_map.clear()
            cls._resolution_names.clear()

            for line in lines:
                line = line.strip()
                # 跳过空行或以'#'开头的注释行
                if not line or line.startswith('#'):
                    continue

                parts = line.split(',')
                if len(parts) == 2:
                    try:
                        # 将字符串转换为整数
                        width = int(parts[0].strip())
                        height = int(parts[1].strip())
                        # 创建显示名称，例如 "1024x768"
                        name = f"{width}x{height}"
                        # 存储预设
                        if name not in cls._resolution_names: # 避免重复名称
                            cls._resolutions_map[name] = (width, height)
                            cls._resolution_names.append(name)
                    except ValueError:
                        # 如果转换失败，则忽略此行
                        print(f"ZML_PresetResolution 警告: 忽略格式错误的行: {line}")
                        continue

            # 如果加载后列表仍为空，提供一个提示选项
            if not cls._resolution_names:
                cls._resolution_names.append("文件为空或格式错误")
                cls._resolutions_map["文件为空或格式错误"] = (1024, 1024)

        except Exception as e:
            print(f"ZML_PresetResolution 错误: 无法加载预设文件: {e}")
            cls._resolution_names = ["错误：无法加载文件"]
            cls._resolutions_map = {"错误：无法加载文件": (1024, 1024)}

    @classmethod
    def INPUT_TYPES(cls):
        # 加载预设以填充下拉菜单
        cls._load_resolutions()
        return {
            "required": {
                "预设": (cls._resolution_names, ),
            }
        }

    RETURN_TYPES = ("INT", "INT", "STRING")
    RETURN_NAMES = ("宽", "高", "help")
    FUNCTION = "get_resolution"
    CATEGORY = "image/ZML_图像/整数"

    def get_resolution(self, 预设):
        # 从已加载的映射中获取宽和高
        width, height = self._resolutions_map.get(预设, (1024, 1024))
        help_text = "你好~欢迎使用ZML节点~\n此节点会读取 ‘/txt/Preset integer/Preset integer.txt’ 的文件。\n文件格式为“宽,高”，例如“1024,768”，每行一个分辨率。\n你可以通过点击“添加预设”按钮来快捷添加新的分辨率。\n祝你生活愉快，天天开心~"
        return (width, height, help_text)

# ============================== 节点注册 ==============================
NODE_CLASS_MAPPINGS = {
    "ZML_TextInput": ZML_TextInput,
    "ZML_WriteText": ZML_WriteText,
    "ZML_PresetText": ZML_PresetText,
    "ZML_ImageToHTML": ZML_ImageToHTML,
    "ZML_GIFLoader": ZML_GIFLoader,
    "ZML_DualFloat": ZML_DualFloat,
    "ZML_DualInteger": ZML_DualInteger,          
    "ZML_DualIntegerV2": ZML_DualIntegerV2,
    "ZML_DualIntegerV3": ZML_DualIntegerV3,
    "ZML_PresetResolution": ZML_PresetResolution,
    "ZML_SequentialIntegerLoader": ZML_SequentialIntegerLoader, 
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_TextInput": "ZML_文本输入",
    "ZML_WriteText": "ZML_写入文本",
    "ZML_PresetText": "ZML_预设文本",
    "ZML_ImageToHTML": "ZML_图片转HTML",
    "ZML_GIFLoader": "ZML_GIF文件路径",
    "ZML_DualFloat": "ZML_双浮点",
    "ZML_DualInteger": "ZML_双整数",             
    "ZML_DualIntegerV2": "ZML_双整数V2",
    "ZML_DualIntegerV3": "ZML_双整数V3（判断）",
    "ZML_PresetResolution": "ZML_预设分辨率",
    "ZML_SequentialIntegerLoader": "ZML_顺序加载整数", 
}