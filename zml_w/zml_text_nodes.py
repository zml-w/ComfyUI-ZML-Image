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
from aiohttp import web # 导入web模块
import server # 导入server模块

# ============================== 整数字符串互转节点 ==============================
class ZML_IntegerStringConverter:
    """
    ZML 整数字符串互转节点
    将整数的输入输出为字符串，将字符串的输入输出为整数
    两个接口都是可选的
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "optional": {
                "整数": ("INT", {"forceInput": True}),
                "字符串": ("STRING", {"forceInput": True})
            }
        }
    
    CATEGORY = "image/ZML_图像/整数"
    RETURN_TYPES = ("STRING", "INT")
    RETURN_NAMES = ("字符串", "整数")
    FUNCTION = "convert"
    
    def convert(self, 整数=None, 字符串=None):
        """将整数转换为字符串，将字符串转换为整数"""
        # 处理整数转字符串
        if 整数 is not None:
            str_result = str(整数)
        else:
            str_result = ""
        
        # 处理字符串转整数
        int_result = 0
        if 字符串 is not None:
            try:
                int_result = int(字符串)
            except ValueError:
                # 如果无法转换为整数，返回0
                pass
        
        return (str_result, int_result)


# ============================== 文本输入节点 ==============================

# 定义 API 前缀
ZML_API_PREFIX = "/zml" 

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
        self.help_text = "你好，欢迎使用ZML节点~\n本节点会将文本A和文本B结合后写入指定的TXT文件。如果你不指定路径，它会自动保存在插件的 'zml_w/txt/Text input' 文件夹中。\n如果路径为文件夹，则会写入该文件夹下的“文本输入.txt”里，没有此文件会自动创建。\n也可以指定路径为一个txt文件，但仅支持txt格式。/n祝你使用愉快~天天开心~"
        
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
# 定义预设文件的路径 (JSON格式)
PRESET_TEXT_FILE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "txt", "Preset text", "Preset text.json")
# 定义固定的类别名称
FIXED_TEXT_CATEGORIES = ["预设1", "预设2", "预设3", "预设4", "预设5"]

class ZML_PresetText:
    """
    ZML 预设文本节点
    从JSON预设文件中加载五个固定分类的文本选项
    """
    _categories_data = {cat: [] for cat in FIXED_TEXT_CATEGORIES} # 存储 { "分类名": [{"name": "预设名", "value": "预设内容"}, ...] }
    _indexed_category_preset_names = [[] for _ in range(5)] # 对应五个下拉列表的预设名称列表

    def __init__(self):
        preset_dir = os.path.dirname(PRESET_TEXT_FILE_PATH)
        if not os.path.exists(preset_dir):
            os.makedirs(preset_dir, exist_ok=True)
        
        # 如果文件不存在，创建空JSON文件并初始化五个固定分类
        if not os.path.exists(PRESET_TEXT_FILE_PATH):
            initial_data = {cat: [] for cat in FIXED_TEXT_CATEGORIES}
            with open(PRESET_TEXT_FILE_PATH, 'w', encoding='utf-8') as f:
                json.dump(initial_data, f, ensure_ascii=False, indent=4) 

    @classmethod
    def _load_presets(cls):
        """从JSON文件中加载、解析和准备预设。"""
        # 初始化 _categories_data 为空（或者默认结构），并清空 _indexed_category_preset_names
        cls._categories_data = {cat: [] for cat in FIXED_TEXT_CATEGORIES}
        for i in range(5):
            cls._indexed_category_preset_names[i] = []

        if not os.path.exists(PRESET_TEXT_FILE_PATH):
            # 如果文件不存在，提供默认空状态
            for i in range(5):
                cls._indexed_category_preset_names[i].append("")
            return

        try:
            with open(PRESET_TEXT_FILE_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            if not isinstance(data, dict):
                raise ValueError("JSON文件根目录不是一个字典。")

            # 将加载的数据填充到cls._categories_data，并确保包含所有固定分类
            for cat_name in FIXED_TEXT_CATEGORIES:
                cls._categories_data[cat_name] = data.get(cat_name, [])

            # 填充 _indexed_category_preset_names
            for i, cat_name in enumerate(FIXED_TEXT_CATEGORIES):
                presets_list = cls._categories_data.get(cat_name, [])
                preset_names_for_category = [p.get("name") for p in presets_list if isinstance(p, dict) and "name" in p]
                
                if not preset_names_for_category:
                    cls._indexed_category_preset_names[i].append("无")
                else:
                    cls._indexed_category_preset_names[i] = sorted(preset_names_for_category)

        except (FileNotFoundError, json.JSONDecodeError, ValueError) as e:
            print(f"ZML_PresetText 错误: 无法加载预设文件: {e}")
            for i in range(5):
                cls._indexed_category_preset_names[i] = ["错误：无法加载文件"]
    
    @classmethod
    def INPUT_TYPES(cls):
        # 每次 INPUT_TYPES 调用时重新加载预设，以确保下拉列表最新
        cls._load_presets() 
        
        # 为五个预设类别创建输入
        inputs = {
            "required": {
                FIXED_TEXT_CATEGORIES[0]: (cls._indexed_category_preset_names[0],),
                FIXED_TEXT_CATEGORIES[1]: (cls._indexed_category_preset_names[1],),
                FIXED_TEXT_CATEGORIES[2]: (cls._indexed_category_preset_names[2],),
                FIXED_TEXT_CATEGORIES[3]: (cls._indexed_category_preset_names[3],),
                FIXED_TEXT_CATEGORIES[4]: (cls._indexed_category_preset_names[4],),
            }
        }
        return inputs
    
    # 只有一个输出接口 "合并文本"
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("合并文本",)
    FUNCTION = "get_combined_text"
    CATEGORY = "image/ZML_图像/文本"

    def get_combined_text(self, 预设1, 预设2, 预设3, 预设4, 预设5):
        combined_texts = []
        selected_preset_names_by_category = {
            "预设1": 预设1,
            "预设2": 预设2,
            "预设3": 预设3,
            "预设4": 预设4,
            "预设5": 预设5,
        }

        # 遍历每个固定分类，获取其选中的预设值
        for category_idx, category_name in enumerate(FIXED_TEXT_CATEGORIES):
            selected_preset_name = selected_preset_names_by_category[category_name]
            
            if selected_preset_name.startswith(("没有预设", "错误：无法加载")):
                continue # 跳过占位符或错误项
            
            # 在对应分类下找到预设内容
            found_value = ""
            presets_in_category = self._categories_data.get(category_name, [])
            for preset_item in presets_in_category:
                if isinstance(preset_item, dict) and preset_item.get("name") == selected_preset_name:
                    found_value = preset_item.get("value", "")
                    break
            
            if found_value:
                combined_texts.append(found_value)
        
        return (" ".join(combined_texts).strip(),) # 将所有文本用空格连接，并去除首尾空格


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
                "图像": ("IMAGE", {}), # 图像作为可选输入
                "附加图像": ("IMAGE", {}), # 附加图像作为可选输入
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
        if image_array.shape[-1] == 4: # RGBA
            return Image.fromarray(image_array, 'RGBA')
        else: # RGB
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
    
    def convert_to_html(self, 图像=None, 附加图像=None, 文件名="", 保存路径="", 纯图片输出="禁用", 标题="", 附加图像分辨率="200*200", GIF帧率=16):
        """将图像转换为HTML文件（支持GIF合成）"""
        
        # 计算帧间隔时间（毫秒）
        frame_duration = int(1000 / GIF帧率) if GIF帧率 > 0 else 100
        
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
                base64_str = self.create_gif(图像, frame_duration)
                is_gif = True
            else:
                image_tensor = 图像[0]
                base64_str = self.image_to_base64(image_tensor, max_size=0)
            
            # 处理附加图像（只有在禁用纯图片输出时才使用）
            extra_image_html = ""
            if 附加图像 is not None and 附加图像.size(0) > 0 and 纯图片输出 == "禁用":
                if 附加图像.size(0) > 1:
                    extra_base64 = self.create_gif(附加图像, frame_duration, max_size=max_logo_size)
                else:
                    extra_image_tensor = 附加图像[0]
                    extra_base64 = self.image_to_base64(extra_image_tensor, max_size=max_logo_size)
                
                extra_image_html = f"""
        <div class="logo-container">
            <img src="data:image/{'gif' if 附加图像.size(0) > 1 else 'png'};base64,{extra_base64}" alt="附加图像">
        </div>"""
            
            if 纯图片输出 == "启用":
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
                sanitized_title = html.escape(标题[:30]) if 标题 else ""
                
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
            
            with open(final_path, "w", encoding="utf-8") as f:
                f.write(html_content)
            
            return {"result": (help_output,)}
        
        except Exception as e:
            error_help = f"保存HTML时出错: {str(e)}"
            return {"result": (error_help,)}

# ============================== 双整数节点 ==============================
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

# ============================== 双整数V2节点 ==============================
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

        preset_width = 1024
        preset_height = 1024
        
        use_random = True
        if 索引值 > 0 and valid_widths and valid_heights:
            actual_index = 索引值 - 1
            
            if actual_index < len(valid_widths) and actual_index < len(valid_heights):
                preset_width = valid_widths[actual_index]
                preset_height = valid_heights[actual_index]
                use_random = False

        if use_random:
            if 随机宽高对应 and valid_widths and valid_heights:
                min_len = min(len(valid_widths), len(valid_heights))
                if min_len > 0:
                    rand_index = random.randint(0, min_len - 1)
                    preset_width = valid_widths[rand_index]
                    preset_height = valid_heights[rand_index]
            else:
                if valid_widths:
                    preset_width = random.choice(valid_widths)
                if valid_heights:
                    preset_height = random.choice(valid_heights)
            
        return (preset_width, preset_height, help_text)

# ============================== 双整数V3（判断） ==============================
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
            out_w = widths[1]
            out_h = heights[1]
            out_int = 2
            out_float = 2.0
            out_bool = True
        elif 宽 < 高:
            out_w = widths[0]
            out_h = heights[0]
            out_int = 1
            out_float = 1.0
            out_bool = True
        else: # 宽 > 高
            out_w = widths[2]
            out_h = heights[2]
            out_int = 3
            out_float = 3.0
            out_bool = True
            
        return (out_w, out_h, out_int, out_float, out_bool)

# ============================== 顺序加载整数节点 ==============================
class ZML_SequentialIntegerLoader:
    """
    ZML 顺序加载整数节点
    按顺序、间隔和范围加载一个整数，并在达到终点时循环。
    """
    def __init__(self):
        node_dir = os.path.dirname(os.path.abspath(__file__))
        self.counter_dir = os.path.join(node_dir, "counter")
        os.makedirs(self.counter_dir, exist_ok=True)
        self.counter_file = os.path.join(self.counter_dir, "顺序加载整数.txt")

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "起始数": ("INT", {"default": 0, "min": -999999, "max": 999999, "step": 1}),
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
        return float("nan")

    def load_sequentially(self, 起始数, 最终数, 间隔):
        if 起始数 > 最终数:
            起始数, 最终数 = 最终数, 起始数
        
        间隔 = max(1, 间隔)

        current_params = {"start": 起始数, "end": 最终数, "step": 间隔}
        
        try:
            with open(self.counter_file, 'r', encoding='utf-8') as f:
                state = json.load(f)
            last_value = state.get("current_value")
            last_params = state.get("last_params")
        except (FileNotFoundError, json.JSONDecodeError):
            last_value = None
            last_params = None
            
        if current_params != last_params:
            next_value = 起始数
        else:
            if last_value is None or last_value >= 最终数:
                next_value = 起始数
            else:
                next_value = last_value + 间隔
                if next_value > 最终数:
                    next_value = 最终数
        
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

# ============================== 预设分辨率节点==============================
PRESET_RESOLUTION_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "txt", "Preset integer", "Preset integer.txt")

class ZML_PresetResolution:
    """
    ZML 预设分辨率节点
    从预设文件中加载分辨率选项 (名称_宽,高 或 宽,高)
    """
    _resolutions_map = {} 
    _resolution_display_names = [] 

    def __init__(self):
        preset_dir = os.path.dirname(PRESET_RESOLUTION_PATH)
        if not os.path.exists(preset_dir):
            os.makedirs(preset_dir, exist_ok=True)
        # 如果文件不存在，创建只包含注释的空文件
        if not os.path.exists(PRESET_RESOLUTION_PATH):
            with open(PRESET_RESOLUTION_PATH, 'w', encoding='utf-8') as f:
                f.write("# 这是注释行，将被忽略\n")

    @classmethod
    def _load_resolutions(cls):
        """从文本文件中加载、解析分辨率预设。"""
        cls._resolutions_map.clear()
        cls._resolution_display_names.clear()

        if not os.path.exists(PRESET_RESOLUTION_PATH):
            cls._resolution_display_names.append("没有预设 (请添加)")
            cls._resolutions_map["没有预设 (请添加)"] = (1024, 1024, "没有预设 (请添加)")
            return

        try:
            with open(PRESET_RESOLUTION_PATH, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            
            for original_line in lines:
                line = original_line.strip()
                if not line or line.startswith('#'):
                    continue
                
                width = None
                height = None
                display_name = None
                raw_file_string = line 

                match_named = re.match(r"(?P<name>[^_]+)_(?P<width>\d+),(?P<height>\d+)", line)
                if match_named:
                    try:
                        name = match_named.group("name").strip()
                        width = int(match_named.group("width"))
                        height = int(match_named.group("height"))
                        display_name = f"{name}_{width}x{height}"
                    except ValueError:
                        print(f"ZML_PresetResolution 警告: 忽略格式错误的行 (非整数宽高): {line}")
                        continue
                else:
                    parts = line.split(',', 1) 
                    if len(parts) == 2:
                        try:
                            width = int(parts[0].strip())
                            height = int(parts[1].strip())
                            display_name = f"{width}x{height}" 
                        except ValueError:
                            print(f"ZML_PresetResolution 警告: 忽略格式错误的行 (非整数宽高): {line}")
                            continue
                    else:
                        print(f"ZML_PresetResolution 警告: 忽略无法解析的行: {line}")
                        continue
                
                if width is not None and height is not None and display_name is not None:
                    if display_name not in cls._resolution_display_names: 
                        cls._resolutions_map[display_name] = (width, height, raw_file_string)
                        cls._resolution_display_names.append(display_name)

            if not cls._resolution_display_names:
                cls._resolution_display_names.append("没有预设 (请添加)")
                cls._resolutions_map["没有预设 (请添加)"] = (1024, 1024, "没有预设 (请添加)")

        except Exception as e:
            print(f"ZML_PresetResolution 错误: 无法加载预设文件: {e}")
            cls._resolution_display_names = ["错误：无法加载文件"]
            cls._resolutions_map = {"错误：无法加载文件": (1024, 1024, "错误：无法加载文件")}

    @classmethod
    def INPUT_TYPES(cls):
        cls._load_resolutions()
        return {
            "required": {
                "预设": (cls._resolution_display_names, {"default": cls._resolution_display_names[0] if cls._resolution_display_names else "没有预设 (请添加)"}),
            }
        }

    RETURN_TYPES = ("INT", "INT", "LATENT")
    RETURN_NAMES = ("宽", "高", "latent")
    FUNCTION = "get_resolution"
    CATEGORY = "image/ZML_图像/整数"

    def get_resolution(self, 预设):
        width, height, _ = self._resolutions_map.get(预设, (1024, 1024, "没有预设 (请添加)"))
        
        latent = torch.zeros([1, 4, height // 8, width // 8], device="cpu") 
        latent_dict = {"samples": latent}
        
        return (width, height, latent_dict)

# ============================== API 路由（用于处理前端的添加预设请求）==============================

@server.PromptServer.instance.routes.post(ZML_API_PREFIX + "/get_fixed_text_categories")
async def get_fixed_text_categories_route(request):
    """获取所有固定文本预设分类名"""
    return web.json_response({"categories": FIXED_TEXT_CATEGORIES}, status=200)

@server.PromptServer.instance.routes.post(ZML_API_PREFIX + "/get_text_presets_in_category")
async def get_text_presets_in_category_route(request):
    """获取指定分类下的预设名"""
    try:
        data = await request.json()
        category_name = data.get("category_name")
        if not category_name or category_name not in FIXED_TEXT_CATEGORIES:
            return web.json_response({"presets": ["选择无效分类"]}, status=400)

        ZML_PresetText._load_presets() # 重新加载以确保最新
        presets_list = ZML_PresetText._categories_data.get(category_name, [])
        preset_names = [p.get("name") for p in presets_list if p.get("name")]
        
        if not preset_names :
             preset_names = ["没有预设 (请添加)"]

        return web.json_response({"presets": preset_names}, status=200)
    except Exception as e:
        return web.Response(status=500, text=f"无法获取分类预设: {str(e)}")

@server.PromptServer.instance.routes.post(ZML_API_PREFIX + "/add_text_preset")
async def add_text_preset_route(request):
    """处理前端的文本预设添加请求 (针对固定分类)"""
    try:
        data = await request.json()
        category_name = data.get("category_name").strip()
        preset_name = data.get("preset_name").strip()
        preset_value = data.get("preset_value").strip()
        
        if not category_name or category_name not in FIXED_TEXT_CATEGORIES or not preset_name or not preset_value:
            return web.Response(status=400, text="分类名、预设名称和内容不能为空，且分类名必须是固定类别之一。")

        # 确保目录存在
        preset_dir = os.path.dirname(PRESET_TEXT_FILE_PATH)
        os.makedirs(preset_dir, exist_ok=True)

        ZML_PresetText._load_presets() # 确保加载最新数据
        current_data = ZML_PresetText._categories_data # 获取当前数据

        if category_name not in current_data: # 这不应该发生，因为我们初始化了所有固定分类
            current_data[category_name] = [] 
        
        # 检查预设名称是否已存在于该分类下
        existing_names = {p.get("name") for p in current_data[category_name] if p.get("name")}
        if preset_name in existing_names:
            return web.Response(status=409, text=f"该分类下已存在名为 '{preset_name}' 的预设。")

        current_data[category_name].append({"name": preset_name, "value": preset_value})

        with open(PRESET_TEXT_FILE_PATH, 'w', encoding='utf-8') as f:
            json.dump(current_data, f, ensure_ascii=False, indent=4)

        return web.Response(status=200, text="文本预设已成功添加")
    except Exception as e:
        print(f"添加文本预设错误: {e}")
        return web.Response(status=500, text=f"处理请求时发生错误: {str(e)}")

@server.PromptServer.instance.routes.post(ZML_API_PREFIX + "/delete_text_preset")
async def delete_text_preset_route(request):
    """处理前端的文本预设删除请求 (针对固定分类)"""
    try:
        data = await request.json()
        category_name = data.get("category_name").strip()
        preset_name = data.get("preset_name").strip()

        if not category_name or category_name not in FIXED_TEXT_CATEGORIES or not preset_name:
            return web.Response(status=400, text="分类名和预设名称不能为空，且分类名必须是固定类别之一。")
        
        # 确保目录存在
        preset_dir = os.path.dirname(PRESET_TEXT_FILE_PATH)
        os.makedirs(preset_dir, exist_ok=True)

        ZML_PresetText._load_presets() # 确保加载最新数据
        current_data = ZML_PresetText._categories_data # 获取当前数据

        if category_name not in current_data:
            return web.Response(status=404, text=f"未找到分类: '{category_name}'")
        
        original_length = len(current_data[category_name])
        # 过滤掉要删除的预设
        current_data[category_name] = [
            p for p in current_data[category_name] 
            if not (isinstance(p, dict) and p.get("name") == preset_name)
        ]

        if len(current_data[category_name]) == original_length: # 如果列表长度没变，说明没找到
            return web.Response(status=404, text=f"在分类 '{category_name}' 中未找到名为 '{preset_name}' 的预设。")
            
        with open(PRESET_TEXT_FILE_PATH, 'w', encoding='utf-8') as f:
            json.dump(current_data, f, ensure_ascii=False, indent=4)

        return web.Response(status=200, text="文本预设已成功删除")
    except Exception as e:
        print(f"删除文本预设错误: {e}")
        return web.Response(status=500, text=f"处理请求时发生错误: {str(e)}")

@server.PromptServer.instance.routes.post(ZML_API_PREFIX + "/add_resolution_preset")
async def add_resolution_preset_route(request):
    """处理前端的分辨率预设添加请求"""
    try:
        data = await request.json()
        preset_name = data.get("preset_name") 
        width = data.get("width")
        height = data.get("height")

        if not width or not height:
            return web.Response(status=400, text="宽度和高度不能为空")

        try:
            int(width)
            int(height)
        except ValueError:
            return web.Response(status=400, text="宽度和高度必须是整数")
        
        # 确保目录存在
        preset_dir = os.path.dirname(PRESET_RESOLUTION_PATH)
        os.makedirs(preset_dir, exist_ok=True)

        if preset_name:
            new_resolution_line = f"\n{preset_name}_{width},{height}" 
        else:
            new_resolution_line = f"\n{width},{height}" 
        
        with open(PRESET_RESOLUTION_PATH, 'a', encoding='utf-8') as f:
            f.write(new_resolution_line)

        return web.Response(status=200, text="分辨率预设已成功添加")
    except Exception as e:
        return web.Response(status=500, text=f"处理请求时发生错误: {str(e)}")

@server.PromptServer.instance.routes.post(ZML_API_PREFIX + "/delete_resolution_preset")
async def delete_resolution_preset_route(request):
    """处理前端的分辨率预设删除请求"""
    try:
        data = await request.json()
        display_name_to_delete = data.get("display_name") 

        if not display_name_to_delete:
            return web.Response(status=400, text="要删除的预设名称不能为空")
        
        # 确保目录存在
        preset_dir = os.path.dirname(PRESET_RESOLUTION_PATH)
        os.makedirs(preset_dir, exist_ok=True)

        ZML_PresetResolution._load_resolutions()
        
        original_entry_tuple = ZML_PresetResolution._resolutions_map.get(display_name_to_delete)
        if not original_entry_tuple:
            return web.Response(status=404, text=f"未找到预设: {display_name_to_delete}")
        
        raw_file_string_to_delete = original_entry_tuple[2] 

        updated_lines = []
        found = False
        with open(PRESET_RESOLUTION_PATH, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        
        for line in lines:
            stripped_line = line.strip()
            if stripped_line == raw_file_string_to_delete:
                found = True
                continue 
            updated_lines.append(line)
        
        if not found:
            return web.Response(status=404, text=f"在文件中未找到匹配项: '{display_name_to_delete}' (原始文件行: '{raw_file_string_to_delete}')")

        if not updated_lines:
            with open(PRESET_RESOLUTION_PATH, 'w', encoding='utf-8') as f:
                 f.write("# 这是注释行，将被忽略\n") 
        else:
            cleaned_lines = []
            for i, line in enumerate(updated_lines):
                if line.strip() or i == 0 or (i > 0 and cleaned_lines and cleaned_lines[-1].strip()):
                    cleaned_lines.append(line.rstrip('\n'))
            
            final_output = []
            for i, line in enumerate(cleaned_lines):
                if i < len(cleaned_lines) - 1 and line.strip(): 
                    final_output.append(line + '\n')
                else: 
                    final_output.append(line) 

            with open(PRESET_RESOLUTION_PATH, 'w', encoding='utf-8') as f:
                 f.writelines(final_output)

        return web.Response(status=200, text="分辨率预设已成功删除")
    except Exception as e:
        return web.Response(status=500, text=f"处理删除请求时发生错误: {str(e)}")


# ============================== 节点注册 ==============================
NODE_CLASS_MAPPINGS = {
    "ZML_TextInput": ZML_TextInput,
    "ZML_WriteText": ZML_WriteText,
    "ZML_PresetText": ZML_PresetText,
    "ZML_ImageToHTML": ZML_ImageToHTML,
    "ZML_DualFloat": ZML_DualFloat,
    "ZML_DualInteger": ZML_DualInteger,          
    "ZML_DualIntegerV2": ZML_DualIntegerV2,
    "ZML_DualIntegerV3": ZML_DualIntegerV3,
    "ZML_PresetResolution": ZML_PresetResolution,
    "ZML_SequentialIntegerLoader": ZML_SequentialIntegerLoader, 
    "ZML_IntegerStringConverter": ZML_IntegerStringConverter,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_TextInput": "ZML_文本输入",
    "ZML_WriteText": "ZML_写入文本",
    "ZML_PresetText": "ZML_预设文本",
    "ZML_ImageToHTML": "ZML_图片转HTML",
    "ZML_DualFloat": "ZML_双浮点",
    "ZML_DualInteger": "ZML_双整数",             
    "ZML_DualIntegerV2": "ZML_双整数V2",
    "ZML_DualIntegerV3": "ZML_双整数V3（判断）",
    "ZML_PresetResolution": "ZML_预设分辨率",
    "ZML_SequentialIntegerLoader": "ZML_顺序加载整数", 
    "ZML_IntegerStringConverter": "ZML_整数字符串互转",
}
