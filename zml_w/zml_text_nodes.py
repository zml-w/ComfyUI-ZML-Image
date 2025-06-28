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
    
    CATEGORY = "image/ZML_图像"
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
        self.output_dir = folder_paths.get_output_directory()
        self.type = "output"
        self.default_file = os.path.join(self.output_dir, "文本输入.txt")
        self.help_text = "你好，欢迎使用ZML节点~\n写入文本是将输入的文本写入到TXT文件的下一行文本中，且会格式化文本结尾符号，如果你不指定TXT文本路径的话，它会自动在output文件夹里创建一个“文本输入.txt”；\n如果你指定的路径为文件夹路径，它会尝试读取文件夹里名为“写入文件”的TXT格式文件作为写入文件，如果不存在此文件的话,它会自动创建；\n如果指定的是文件路径，但指定的文件格式不是txt的，那它也会在文件夹里自动创“写入文件.txt”；好啦~感谢你使用ZML节点，祝你使用愉快~天天开心~"
        
    @classmethod
    def INPUT_TYPES(cls):
        # 紧凑型输入接口
        return {
            "required": {
                "文本": ("STRING", {"default": "", "placeholder": "输入要写入的文本"}),
                "保存路径": ("STRING", {"default": "", "placeholder": "文件或文件夹路径 (可选)"}),
            }
        }
    
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("Help",)
    FUNCTION = "write_text"
    OUTPUT_NODE = True
    CATEGORY = "image/ZML_图像"
    
    # 设置节点显示尺寸为小型
    @classmethod
    def IS_CHANGED(cls):
        return float("nan")
    
    def format_path(self, path):
        """格式化用户输入的路径"""
        if not path:
            return self.default_file
        
        path = path.strip().strip('"').strip("'")
        
        if not path:
            return self.default_file
        
        # 如果用户输入的是文件路径（以.txt结尾）
        if path.lower().endswith(".txt"):
            return path
        
        # 否则视为文件夹路径
        if os.path.isabs(path):
            save_dir = path
        else:
            comfyui_root = os.path.dirname(self.output_dir)
            save_dir = os.path.join(comfyui_root, path)
        
        # 确保目录存在
        os.makedirs(save_dir, exist_ok=True)
        
        # 创建文件名"文本输入.txt"，如果已存在则添加(1)等
        base_path = os.path.join(save_dir, "文本输入.txt")
        counter = 1
        new_path = base_path
        
        while os.path.exists(new_path):
            new_path = os.path.join(save_dir, f"文本输入({counter}).txt")
            counter += 1
            
        return new_path
    
    def ensure_directory(self, file_path):
        """确保文件所在目录存在"""
        dir_path = os.path.dirname(file_path)
        if not os.path.exists(dir_path):
            os.makedirs(dir_path, exist_ok=True)
        return file_path
    
    def write_text(self, 文本, 保存路径):
        """将文本写入文件"""
        # 始终输出help文本
        help_output = self.help_text
        
        # 处理文件路径
        file_path = self.format_path(保存路径)
        file_path = self.ensure_directory(file_path)
        
        # 获取实际写入路径
        abs_path = os.path.abspath(file_path)
        
        # 如果文本为空，不写入任何内容
        if not 文本:
            return {"result": (help_output,), "ui": {"text": [f"文本为空，没有写入内容\n文件位置: {abs_path}"]}}
        
        try:
            # 处理文本结尾
            last_char = 文本[-1]
            if last_char in ["，", "。", " "]:
                文本 = 文本[:-1] + ","
            
            # 检查文件是否存在以及是否为空
            file_exists = os.path.exists(file_path)
            file_is_empty = not file_exists or os.path.getsize(file_path) == 0
            
            # 追加模式写入文本
            with open(file_path, "a", encoding="utf-8") as f:
                # 如果文件非空，添加换行符
                if not file_is_empty:
                    f.write("\n")
                # 写入处理后的文本
                f.write(文本)
            
            # 操作成功消息
            msg = "文本已写入"
            if file_is_empty:
                msg += "（空文件，无换行）"
            else:
                msg += "（文件非空，已添加换行）"
            
            return {"result": (help_output,), "ui": {"text": [f"{msg}\n文件位置: {abs_path}"]}}
        
        except Exception as e:
            # 错误处理
            error_msg = f"写入失败: {str(e)}"
            return {"result": (help_output,), "ui": {"text": [error_msg]}}

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
    CATEGORY = "image/ZML_图像"
    
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
    CATEGORY = "image/ZML_图像"
    
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
    CATEGORY = "image/ZML_图像"

    def get_simple_dimensions(self, A, B):
        return (A, B)

# ============================== 双整数V2节点 (Renamed) ==============================
class ZML_DualIntegerV2:
    """
    ZML 双整数V2节点
    提供固定的宽和高，以及从文本列表中随机选择的宽和高。
    新增“随机宽高对应”功能，并修复了随机问题。
    """
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "宽": ("INT", {"default": 1024, "min": 64, "max": 8192, "step": 8}),
                "高": ("INT", {"default": 1024, "min": 64, "max": 8192, "step": 8}),
                "随机宽文本": ("STRING", {
                    "multiline": False,
                    "default": "832,1024,1216",
                    "placeholder": "用英文逗号,分隔多个宽度值"
                }),
                "随机高文本": ("STRING", {
                    "multiline": False,
                    "default": "832,1024,1216",
                    "placeholder": "用英文逗号,分隔多个高度值"
                }),
                "随机宽高对应": ("BOOLEAN", {"default": True, "label_on": "开启对应", "label_off": "独立随机"}),
            }
        }

    RETURN_TYPES = ("INT", "INT", "INT", "INT")
    RETURN_NAMES = ("宽", "高", "随机宽", "随机高")
    FUNCTION = "get_dimensions"
    CATEGORY = "image/ZML_图像"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # 强制节点在每次执行时都重新运行，以确保随机性
        return float("nan")

    def get_dimensions(self, 宽, 高, 随机宽文本, 随机高文本, 随机宽高对应):
        # --- 解析文本输入 ---
        valid_widths = []
        for item in 随机宽文本.split(','):
            try:
                valid_widths.append(int(item.strip()))
            except ValueError:
                pass
        
        valid_heights = []
        for item in 随机高文本.split(','):
            try:
                valid_heights.append(int(item.strip()))
            except ValueError:
                pass

        random_width = 宽
        random_height = 高

        # --- 根据模式决定随机方式 ---
        if 随机宽高对应 and valid_widths and valid_heights:
            # 开启对应模式，且两个列表都有效
            # 使用较短的列表长度作为随机范围，以避免索引越界
            min_len = min(len(valid_widths), len(valid_heights))
            rand_index = random.randint(0, min_len - 1)
            random_width = valid_widths[rand_index]
            random_height = valid_heights[rand_index]
        else:
            # 独立随机模式（或当任一列表无效时的后备模式）
            if valid_widths:
                random_width = random.choice(valid_widths)
            if valid_heights:
                random_height = random.choice(valid_heights)
            
        return (宽, 高, random_width, random_height)


# ============================== 节点注册 ==============================
NODE_CLASS_MAPPINGS = {
    "ZML_TextInput": ZML_TextInput,
    "ZML_WriteText": ZML_WriteText,
    "ZML_ImageToHTML": ZML_ImageToHTML,
    "ZML_GIFLoader": ZML_GIFLoader,
    "ZML_DualInteger": ZML_DualInteger,          # 新增节点
    "ZML_DualIntegerV2": ZML_DualIntegerV2,      # 重命名后的节点
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_TextInput": "ZML_文本输入",
    "ZML_WriteText": "ZML_写入文本",
    "ZML_ImageToHTML": "ZML_图片转HTML",
    "ZML_GIFLoader": "ZML_GIF文件路径",
    "ZML_DualInteger": "ZML_双整数",             # 新增节点显示名称
    "ZML_DualIntegerV2": "ZML_双整数V2",         # 重命名后的节点显示名称
}
