# custom_nodes/zml_image_nodes.py

import os
import time
import torch
import folder_paths
from PIL import Image, ImageOps, ImageSequence, PngImagePlugin
import numpy as np
import datetime
import re
import json
import random

# 获取所有支持的图像扩展名
if hasattr(folder_paths, 'supported_image_extensions'):
    supported_image_extensions = folder_paths.supported_image_extensions
else:
    # 兼容旧版本ComfyUI
    supported_image_extensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.webp']

# ============================== 保存图像节点 (使用PNG文本块存储) ==============================
class ZML_SaveImage:
    """ZML 图像保存节点（使用PNG文本块存储）"""
    
    def __init__(self):
        self.output_dir = folder_paths.get_output_directory()
        self.type = "output"
        self.node_dir = os.path.dirname(os.path.abspath(__file__))
        
        # 将计数器文件路径移动到 "counter" 子文件夹
        self.counter_dir = os.path.join(self.node_dir, "counter")
        os.makedirs(self.counter_dir, exist_ok=True)
        self.counter_file = os.path.join(self.counter_dir, "counter.txt")
        self.total_counter_file = os.path.join(self.counter_dir, "总次数.txt")
        
        # 确保计数器文件存在并重置重启计数器
        self.ensure_counter_files()
    
    def ensure_counter_files(self):
        """确保计数器文件存在，并重置重启计数器"""
        try:
            # 重置重启计数器（每次启动归零）
            if not os.path.exists(self.counter_file):
                with open(self.counter_file, "w", encoding="utf-8") as f:
                    f.write("0")
            else:
                # 重置为0
                with open(self.counter_file, "w", encoding="utf-8") as f:
                    f.write("0")
            
            # 确保总次数文件存在
            if not os.path.exists(self.total_counter_file):
                with open(self.total_counter_file, "w", encoding="utf-8") as f:
                    f.write("0")
        except Exception:
            pass
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "optional": {
                "图像": ("IMAGE", {}),  # 将图像改为可选输入
            },
            "required": {
                "操作模式": (["保存图像", "仅预览图像"], {"default": "保存图像"}), # 新增操作模式
                "文件名前缀": ("STRING", {"default": "ZML", "placeholder": "文件名前缀"}),
                "保存路径": ("STRING", {"default": "output/ZML/%Y-%m-%d", "placeholder": "相对/绝对路径 (留空使用output)"}),
                "使用时间戳": (["启用", "禁用"], {"default": "禁用"}),
                "使用计数器": (["启用", "禁用"], {"default": "启用"}),
                "文件名后缀": ("STRING", {"default": "", "placeholder": "可选后缀"}),
                "生成预览": (["启用", "禁用"], {"default": "启用"}),
                "文本块存储": ("STRING", {"default": "", "placeholder": "存储到PNG文本块的文本内容"}),
                "保存同名txt文件": (["启用", "禁用"], {"default": "禁用"}),
                "缩放图像": (["禁用", "启用"], {"default": "禁用"}), # 新增缩放图像选项
                "缩放比例": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 10.0, "step": 0.1}), # 新增缩放比例
                "清除元数据": (["禁用", "启用"], {"default": "禁用"}), # 新增清除元数据选项
            },
            "hidden": {
                "prompt": "PROMPT", 
                "extra_pnginfo": "EXTRA_PNGINFO",
                "unique_id": "UNIQUE_ID", # ComfyUI 内部使用的唯一ID，用于避免打印 "Prompt executed in..."
            },
        }
    
    # 添加输出接口
    RETURN_TYPES = ("IMAGE", "STRING",)
    RETURN_NAMES = ("图像", "Help",)
    FUNCTION = "save_images"
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
    
    def get_next_counter(self):
        """获取下一个重启计数器值（每次启动归零）"""
        try:
            if os.path.exists(self.counter_file):
                with open(self.counter_file, "r", encoding="utf-8") as f:
                    counter = int(f.read().strip()) + 1
            else:
                counter = 1
            with open(self.counter_file, "w", encoding="utf-8") as f:
                f.write(str(counter))
            return counter
        except Exception:
            return int(time.time())
    
    def increment_total_counter(self):
        """增加总次数计数器（永久保存）"""
        try:
            if os.path.exists(self.total_counter_file):
                with open(self.total_counter_file, "r", encoding="utf-8") as f:
                    total_count = int(f.read().strip()) + 1
            else:
                total_count = 1
            with open(self.total_counter_file, "w", encoding="utf-8") as f:
                f.write(str(total_count))
            return total_count
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

    def save_images(self, 图像=None, **kwargs):
        """
        保存图像的主要函数（使用PNG文本块存储）
        修改：支持无图像输入，增加缩放和清除元数据功能，更新txt保存格式
        """
        # 从kwargs中获取其他参数
        操作模式 = kwargs.get("操作模式", "保存图像")
        文件名前缀 = kwargs.get("文件名前缀", "ZML")
        保存路径 = kwargs.get("保存路径", "")
        保存路径 = datetime.datetime.now().strftime(保存路径)
        使用时间戳 = kwargs.get("使用时间戳", "禁用")
        使用计数器 = kwargs.get("使用计数器", "启用")
        文件名后缀 = kwargs.get("文件名后缀", "")
        生成预览 = kwargs.get("生成预览", "启用")
        文本块存储 = kwargs.get("文本块存储", "")
        保存同名txt文件 = kwargs.get("保存同名txt文件", "禁用")
        缩放图像 = kwargs.get("缩放图像", "禁用")
        缩放比例 = kwargs.get("缩放比例", 1.0)
        清除元数据 = kwargs.get("清除元数据", "禁用")
        prompt = kwargs.get("prompt", None)
        extra_pnginfo = kwargs.get("extra_pnginfo", None)
        unique_id = kwargs.get("unique_id", None) # 获取 unique_id

        # 仅在“保存图像”模式下增加总次数计数器
        total_count = 0
        if 操作模式 == "保存图像":
            total_count = self.increment_total_counter()
        else:
            try: # 预览模式下只读取总数，不增加
                 if os.path.exists(self.total_counter_file):
                    with open(self.total_counter_file, "r", encoding="utf-8") as f:
                        total_count = int(f.read().strip())
            except Exception:
                total_count = 0

        help_output = f"你好，欢迎使用ZML节点~到目前为止，你通过此节点总共保存了{total_count}次图像！\n默认的保存路径是在output文件夹下新建一个‘ZML’文件夹，然后根据当前的日期再创建一个子文件夹来保存图像。如果清空路径，则默认保存在output文件里。自定义路径支持保存到comfyui外的文件夹里。\n文本块是对图像写入文本，可以帮忙储存提示词，提取的时候只需要用加载图像节点来提取文本块就好了。\n清除元数据可以降低图像占用，清除元数据和存储文本块同时开启时，是先执行清除元数据再写入储存文本块的，所以结果是图像不含工作流但有写入的文本块，搭配上图像缩放的功能可以做到以极低的占用来保存图像和提示词。\n保存同名txt会保存图像的名称、分辨率、是否含有元数据（工作流）、以及文本块内容的信息。\n以下是图像名称规则和正规选项的介绍：\n图像名称的分割符号为“#-#”，正规就是只读取图像名称里第一个分隔符前面的文本，比如图像名称为“动作#-#000001#-#在梦里.PNG”那正规后的输出为“动作”，而反向就是只读取图像名称最后一个分隔符后的文本，再次以之前的图像名称为例，选择反向后输出的就是最后一个分隔符“#-#”后的文本“在梦里”了。\n感谢你使用ZML节点，祝你天天开心~"
        
        # 如果没有图像输入，创建白色占位图像
        if 图像 is None or 图像.size(0) == 0:
            # 创建一个1x1的白色占位图像
            placeholder_image = torch.ones((1, 1, 1, 3), dtype=torch.float32)
            # 对于OUTPUT_NODE，如果不需要UI显示，可以返回空字典或None。
            # 如果需要保留help_output，可以这样返回
            return {"result": (placeholder_image, help_output)}
        
        filename_prefix = self.sanitize_filename(文件名前缀)
        filename_suffix = self.sanitize_filename(文件名后缀)
        text_content = 文本块存储.strip()  # 清理文本内容
        
        # 根据操作模式设置保存路径和UI类型
        if 操作模式 == "仅预览图像":
            save_path = folder_paths.get_temp_directory()
            ui_type = "temp"
        else:
            save_path = self.ensure_directory(self.format_path(保存路径))
            ui_type = "output"

        result_paths = []
        saved_txt_files = []  # 保存的txt文件列表
        
        # 如果有图像输入，则处理图像
        if 图像 is not None and 图像.size(0) > 0:
            components = []
            
            if filename_prefix:
                components.append(filename_prefix)
            
            if 使用时间戳 == "启用":
                timestamp = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
                components.append(timestamp)
            
            if 使用计数器 == "启用":
                # 仅在“保存图像”模式下增加计数器
                if 操作模式 == "保存图像":
                    counter_value = self.get_next_counter()
                    components.append(f"{counter_value:05d}")
            
            if filename_suffix:
                components.append(filename_suffix)
            
            # 使用"#-#"作为分隔符
            if components:
                filename = "#-#".join(components) + ".png"
            else:
                filename = datetime.datetime.now().strftime("%Y%m%d%H%M%S") + ".png"
            
            for index, image_tensor in enumerate(图像):
                if len(图像) > 1:
                    file_parts = filename.split('.')
                    base_name = ".".join(file_parts[:-1])
                    ext = file_parts[-1]
                    batch_filename = f"{base_name}#{index+1:03d}.{ext}"
                else:
                    batch_filename = filename
                
                full_path = os.path.join(save_path, batch_filename)
                
                # 确保文件名唯一
                final_image_path = self.get_unique_filepath(full_path)
                
                image_array = 255. * image_tensor.cpu().numpy()
                pil_image = Image.fromarray(np.clip(image_array, 0, 255).astype(np.uint8))

                original_width, original_height = pil_image.size # 获取原始分辨率

                # 处理图像缩放
                if 缩放图像 == "启用" and 缩放比例 > 0:
                    new_width = int(pil_image.width * 缩放比例)
                    new_height = int(pil_image.height * 缩放比例)
                    pil_image = pil_image.resize((new_width, new_height), Image.LANCZOS)
                
                # 获取最终保存图像的分辨率
                saved_width, saved_height = pil_image.size

                # 创建元数据对象
                metadata = PngImagePlugin.PngInfo()

                # 判断是否含有元数据（根据清除元数据选项）
                has_metadata = "是" if 清除元数据 == "禁用" else "否"

                # 如果启用清除元数据，则不添加标准ComfyUI元数据，只添加文本块
                if 清除元数据 == "禁用":
                    # 添加标准ComfyUI元数据
                    if prompt is not None:
                        try:
                            metadata.add_text("prompt", json.dumps(prompt))
                        except Exception:
                            pass
                    
                    if extra_pnginfo is not None:
                        # 单独添加workflow信息
                        if "workflow" in extra_pnginfo:
                            try:
                                metadata.add_text("workflow", json.dumps(extra_pnginfo["workflow"]))
                            except Exception:
                                pass
                        
                        # 添加其他额外信息
                        for key, value in extra_pnginfo.items():
                            if key == "workflow":
                                continue
                            try:
                                metadata.add_text(key, json.dumps(value))
                            except Exception:
                                pass
                
                # 添加文本块到元数据（如果文本非空）
                if text_content:
                    try:
                        # 使用zTXt块存储（压缩存储）
                        metadata.add_text("comfy_text_block", text_content, zip=True)
                    except Exception:
                        pass
                
                try:
                    # 保存图像
                    pil_image.save(final_image_path, pnginfo=metadata, compress_level=4)
                    
                    # 仅在“保存图像”模式下保存同名txt文件
                    if 操作模式 == "保存图像" and 保存同名txt文件 == "启用":
                        txt_path = os.path.splitext(final_image_path)[0] + ".txt"
                        unique_txt_path = self.get_unique_filepath(txt_path)
                        
                        # 创建txt内容
                        file_name = os.path.basename(final_image_path)
                        txt_content_to_save = (
                            f"图片名称: {file_name}\n"
                            f"图片分辨率: {saved_width}x{saved_height}\n"
                            f"是否含有元数据: {has_metadata}\n"
                            f"保存时间: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
                            f"文本块存储: \n{text_content}" # 文本块存储内容放到下一行
                        )
                        
                        with open(unique_txt_path, "w", encoding="utf-8") as f:
                            f.write(txt_content_to_save)
                        
                        saved_txt_files.append({
                            "filename": os.path.basename(unique_txt_path),
                            "subfolder": os.path.relpath(os.path.dirname(unique_txt_path), self.output_dir).replace("\\", "/"),
                            "type": "output"
                        })
                    
                    # 计算预览路径
                    try:
                        # 获取文件的基本信息
                        file_basename = os.path.basename(final_image_path)
                        file_dir = os.path.dirname(final_image_path)
                        
                        # 计算相对路径
                        base_dir_for_relpath = self.output_dir if ui_type == "output" else folder_paths.get_temp_directory()
                        
                        # 确保路径是绝对的，以进行安全比较
                        abs_file_dir = os.path.abspath(file_dir)
                        abs_base_dir = os.path.abspath(base_dir_for_relpath)

                        rel_dir = ""
                        if abs_file_dir.startswith(abs_base_dir):
                            rel_dir = os.path.relpath(abs_file_dir, abs_base_dir)

                        # 标准化路径分隔符
                        rel_dir = rel_dir.replace("\\", "/")
                        if rel_dir == ".":
                            rel_dir = ""
                        
                        # 添加到结果列表
                        result_paths.append({
                            "filename": file_basename,
                            "subfolder": rel_dir,
                            "type": ui_type
                        })
                    except Exception:
                        pass
                    
                except Exception:
                    pass
        
        # 返回输出接口值
        output_image = 图像  # 直接返回输入图像
        
        # 根据预览选项返回结果
        if 生成预览 == "启用" and result_paths:
            ui_output = {
                "images": [
                    {
                        "filename": p["filename"],
                        "subfolder": p["subfolder"],
                        "type": p["type"]
                    } for p in result_paths
                ]
            }
            if 操作模式 == "保存图像" and saved_txt_files:
                ui_output["texts"] = [
                    {
                        "filename": t["filename"],
                        "subfolder": t["subfolder"],
                        "type": "output"
                    } for t in saved_txt_files
                ]
            
            # 使用 unique_id 确保 ComfyUI 不会打印 "Prompt executed in..."
            # 这个是ComfyUI内部的机制，通过返回带有"node_id"的字典来阻止默认的控制台输出
            # 只有当unique_id存在时才启用此机制
            if unique_id is not None:
                return {
                    "ui": ui_output,
                    "result": (output_image, help_output),
                    "node_id": unique_id
                }
            else:
                return {
                    "ui": ui_output,
                    "result": (output_image, help_output)
                }
        else:
            # 如果不生成预览，同样考虑 unique_id
            if unique_id is not None:
                return {"result": (output_image, help_output), "node_id": unique_id}
            else:
                return {"result": (output_image, help_output)}

# ============================== 加载图像节点 (读取PNG文本块) (已修改) ==============================
class ZML_LoadImage:
    """
    ZML 加载图像节点
    读取PNG文本块内容并支持透明通道
    """
    
    def __init__(self):
        self.input_dir = folder_paths.get_input_directory()
        self.type = "input"
    
    @classmethod
    def INPUT_TYPES(cls):
        input_dir = folder_paths.get_input_directory()
        files = [f for f in os.listdir(input_dir) if os.path.splitext(f)[1].lower() in supported_image_extensions]
        
        return {
            "required": {
                "图像": (sorted(files), {"image_upload": True}),
                "正规化": (["禁用", "仅名称", "正规", "反向"], {"default": "正规"}),
                "读取文本块": (["启用", "禁用"], {"default": "禁用"}),
            }
        }
    
    CATEGORY = "image/ZML_图像/图像"
    
    RETURN_TYPES = ("IMAGE", "STRING", "STRING", "INT", "INT")
    RETURN_NAMES = ("图像", "文本块", "Name", "宽", "高")
    FUNCTION = "load_image"
    
    def normalize_name(self, filename, level):
        """根据正规等级处理图像名称"""
        if not filename:
            return ""
        
        base_name = os.path.splitext(filename)[0]
        if level == "禁用":
            return filename
        elif level == "仅名称":
            return base_name
        elif level == "正规":
            parts = base_name.split("#-#", 1)
            return parts[0].strip() if len(parts) > 0 else base_name
        elif level == "反向":
            parts = base_name.split("#-#")
            return parts[-1].strip() if len(parts) > 0 else base_name
    
    def load_image(self, 图像, 正规化, 读取文本块):
        """
        加载图像的主要函数
        读取PNG文本块内容并支持透明通道
        """
        image_path = folder_paths.get_annotated_filepath(图像)
        
        try:
            with Image.open(image_path) as img:
                text_content = "未读取"
                if 读取文本块 == "启用":
                    if hasattr(img, 'text') and "comfy_text_block" in img.text:
                        text_content = img.text["comfy_text_block"]
                    else:
                        text_content = "未找到文本块内容"
                
                img = ImageOps.exif_transpose(img)
                width, height = img.size
                
                # [修改] 检查图像是否包含透明通道，并相应地进行转换
                if img.mode == 'RGBA' or img.mode == 'LA' or (img.mode == 'P' and 'transparency' in img.info):
                    image = img.convert('RGBA')  # 转换为RGBA以保留透明通道
                else:
                    image = img.convert('RGB')   # 转换为RGB（不含透明通道）
                
                image_np = np.array(image).astype(np.float32) / 255.0
                image_tensor = torch.from_numpy(image_np)[None,]
                
                normalized_name = self.normalize_name(os.path.basename(image_path), 正规化)
                
                return (image_tensor, text_content, normalized_name, int(width), int(height))
        
        except Exception as e:
            print(f"ZML_LoadImage Error: {e}")
            error_image = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
            return (error_image, "加载失败", "加载失败", 64, 64)
    
    @classmethod
    def IS_CHANGED(cls, 图像, 正规化="正规", 读取文本块="禁用"):
        image_path = folder_paths.get_annotated_filepath(图像)
        return float("nan")
    
    @classmethod
    def VALIDATE_INPUTS(cls, 图像, 正规化="正规", 读取文本块="禁用"):
        if not folder_paths.exists_annotated_filepath(图像):
            return "无效图像文件: {}".format(图像)
        return True

# ============================== 从路径加载图像节点 (Corrected) ==============================
class ZML_LoadImageFromPath:
    """
    ZML 从路径加载图像节点
    支持随机、顺序、全部索引和读取PNG文本块
    """
    
    def __init__(self):
        self.cached_files = []
        self.cached_path = ""
        self.cache_time = 0
        self.node_dir = os.path.dirname(os.path.abspath(__file__))

        # 将计数器文件路径移动到 "counter" 子文件夹
        self.counter_dir = os.path.join(self.node_dir, "counter")
        os.makedirs(self.counter_dir, exist_ok=True)
        self.counter_file = os.path.join(self.counter_dir, "路径图像计数.json")
        
        self.reset_counters_on_startup()
    
    def reset_counters_on_startup(self):
        """在ComfyUI启动时, 创建一个空的JSON计数器文件."""
        try:
            with open(self.counter_file, "w", encoding="utf-8") as f:
                json.dump({}, f)
        except Exception as e:
            print(f"重置路径加载图像计数JSON文件失败: {str(e)}")

    def get_all_counts(self):
        """读取整个JSON文件并返回所有节点的计数."""
        try:
            with open(self.counter_file, "r", encoding="utf-8") as f: # 修正编码为 utf-8
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    def get_sequential_count(self, node_id):
        """获取指定node_id的当前计数值."""
        return self.get_all_counts().get(node_id, 0)

    def increment_sequential_count(self, node_id):
        """为指定的node_id增加计数并保存回文件."""
        all_counts = self.get_all_counts()
        current_count = all_counts.get(node_id, 0)
        all_counts[node_id] = current_count + 1
        try:
            with open(self.counter_file, "w", encoding="utf-8") as f:
                json.dump(all_counts, f, indent=4)
        except Exception as e:
            print(f"更新路径加载图像计数JSON文件失败: {str(e)}")

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "文件夹路径": ("STRING", {"default": "", "placeholder": "输入图像文件夹路径"}),
                "索引模式": (["固定索引", "随机索引", "顺序", "全部"], {"default": "固定索引"}),
                "图像索引": ("INT", {"default": 0, "min": 0, "step": 1}),
                "正规化": (["禁用", "仅名称", "正规", "反向"], {"default": "正规"}),
                "读取文本块": (["启用", "禁用"], {"default": "禁用"}),
            },
            "hidden": {
                "prompt": "PROMPT",
                "unique_id": "UNIQUE_ID"
            },
        }
    
    RETURN_TYPES = ("IMAGE", "STRING", "STRING", "INT", "INT")
    RETURN_NAMES = ("图像", "文本块", "Name", "宽", "高")
    FUNCTION = "load_image"
    CATEGORY = "image/ZML_图像/图像"
    
    def _load_single_image_from_path(self, image_path, read_text_block):
        """Helper function to load one image and its metadata."""
        with Image.open(image_path) as img:
            text_content = "未读取"
            if read_text_block == "启用":
                text_content = img.text.get("comfy_text_block", "未找到文本块内容")
            
            img = ImageOps.exif_transpose(img)
            width, height = img.size
            
            image = img.convert("RGB")
            image_np = np.array(image).astype(np.float32) / 255.0
            image_tensor = torch.from_numpy(image_np)[None,]
            
            return (image_tensor, text_content, int(width), int(height))

    def normalize_name(self, filename, level):
        """根据正规等级处理图像名称"""
        if not filename:
            return ""
        
        base_name = os.path.splitext(filename)[0]
        if level == "禁用":
            return filename
        elif level == "仅名称":
            return base_name
        elif level == "正规":
            return base_name.split("#-#", 1)[0].strip()
        elif level == "反向":
            parts = base_name.split("#-#")
            return parts[-1].strip() if len(parts) > 0 else base_name

    def scan_directory(self, folder_path):
        """扫描文件夹获取图像文件列表（按名称递增排序）"""
        if not os.path.isdir(folder_path):
            return []
        
        files = [f for f in os.listdir(folder_path) if os.path.splitext(f)[1].lower() in supported_image_extensions]
        files.sort()
        return files

    def load_image(self, 文件夹路径, 索引模式, 图像索引, 正规化, 读取文本块, unique_id, prompt):
        current_time = time.time()
        if (not self.cached_files or 
            文件夹路径 != self.cached_path or 
            current_time - self.cache_time > 60):
            self.cached_files = self.scan_directory(文件夹路径)
            self.cached_path = 文件夹路径
            self.cache_time = current_time
        
        if not self.cached_files:
            return (torch.zeros((1, 64, 64, 3), dtype=torch.float32), "未找到图像", "没有找到图像", 64, 64)

        if 索引模式 == "全部":
            image_tensors = []
            first_image_meta = None

            for filename in self.cached_files:
                image_path = os.path.join(文件夹路径, filename)
                try:
                    (tensor, text, width, height) = self._load_single_image_from_path(image_path, 读取文本块)
                    image_tensors.append(tensor)
                    if first_image_meta is None:
                        # Store metadata from the first image
                        first_image_meta = {
                            "text": text,
                            "name": self.normalize_name(filename, 正规化),
                            "width": width,
                            "height": height
                        }
                except Exception as e:
                    print(f"加载图像失败: {filename}, 错误: {e}")
                    continue
            
            if not image_tensors:
                return (torch.zeros((1, 64, 64, 3), dtype=torch.float32), "加载失败", "文件夹中所有图像均加载失败", 64, 64)

            # Combine all tensors into a single batch
            batch_tensor = torch.cat(image_tensors, dim=0)
            return (batch_tensor, first_image_meta["text"], first_image_meta["name"], first_image_meta["width"], first_image_meta["height"])

        # For all other modes (that select a single image)
        num_files = len(self.cached_files)
        index = 0
        if 索引模式 == "固定索引":
            index = 图像索引 % num_files
        elif 索引模式 == "随机索引":
            index = random.randint(0, num_files - 1)
        elif 索引模式 == "顺序":
            count = self.get_sequential_count(unique_id)
            index = count % num_files
            self.increment_sequential_count(unique_id)

        selected_filename = self.cached_files[index]
        image_path = os.path.join(文件夹路径, selected_filename)

        try:
            (tensor, text, width, height) = self._load_single_image_from_path(image_path, 读取文本块)
            normalized_name = self.normalize_name(selected_filename, 正规化)
            return (tensor, text, normalized_name, width, height)
        except Exception as e:
            return (torch.zeros((1, 64, 64, 3), dtype=torch.float32), "加载失败", f"加载失败: {selected_filename}, {e}", 64, 64)
    
    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")

# ============================== 节点注册 ==============================
NODE_CLASS_MAPPINGS = {
    "ZML_SaveImage": ZML_SaveImage,
    "ZML_LoadImage": ZML_LoadImage,
    "ZML_LoadImageFromPath": ZML_LoadImageFromPath
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_SaveImage": "ZML_保存图像",
    "ZML_LoadImage": "ZML_加载图像",
    "ZML_LoadImageFromPath": "ZML_从路径加载图像"
}