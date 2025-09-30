# custom_nodes/ComfyUI-ZML-Image/zml_w/zml_image_nodes.py

import server
from aiohttp import web
from PIL import Image, PngImagePlugin, ImageOps, ImageSequence
import os
import time
import torch
import folder_paths
import numpy as np
import datetime
import re
import json
import random
import urllib.parse
from pathlib import Path
import cv2 

# ============================== 支持的视频扩展名 ==============================
supported_video_extensions = ['.mp4', '.mov', '.avi', '.webm', '.mkv', '.flv', '.wmv', '.gif'] # 添加.gif支持，虽然gif本质上是图像序列，但通常也被视为短视频

# ZML节点用于存储文本块的特定键名 (所有相关节点统一使用此常量)
DEFAULT_TEXT_BLOCK_KEY = "comfy_text_block"

# 获取所有支持的图像扩展名
if hasattr(folder_paths, 'supported_image_extensions'):
    supported_image_extensions = folder_paths.supported_image_extensions
else:
    # 兼容旧版本ComfyUI
    supported_image_extensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.webp']

# 获取ComfyUI的根目录 (用于处理相对路径)
COMFYUI_ROOT = Path(folder_paths.base_path).resolve()


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
                "图像": ("IMAGE", {}), 
            },
            "required": {
                "操作模式": (["保存图像", "仅预览图像"], {"default": "保存图像"}), 
                "保存路径": ("STRING", {"default": "output/ZML/%Y-%m-%d", "placeholder": "相对/绝对路径 (留空使用output)"}),
                "文本块存储": ("STRING", {"default": "", "placeholder": "存储到PNG文本块的文本内容"}),
                "文件名前缀": ("STRING", {"default": "", "placeholder": "文件名前缀"}),
                "文件名后缀": ("STRING", {"default": "", "placeholder": "可选后缀"}),
                "使用时间戳": ("BOOLEAN", {"default": True}),  # 按钮样式，默认开启
                "使用计数器": ("BOOLEAN", {"default": False}),  # 按钮样式，默认关闭
                "生成预览": (["启用", "禁用"], {"default": "启用"}),
                "保存同名txt文件": (["启用", "禁用"], {"default": "禁用"}),
                "限制图像大小": (["禁用", "启用"], {"default": "禁用"}), 
                "最大分辨率": ("INT", {"default": 1024, "min": 8, "max": 8888, "step": 8}),
                "清除元数据": (["禁用", "启用"], {"default": "禁用"}),
            },
            "hidden": {
                "prompt": "PROMPT", 
                "extra_pnginfo": "EXTRA_PNGINFO",
                "unique_id": "UNIQUE_ID",
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
        """
        # 从kwargs中获取其他参数
        操作模式 = kwargs.get("操作模式", "保存图像")
        保存路径 = kwargs.get("保存路径", "")
        保存路径 = datetime.datetime.now().strftime(保存路径)
        文本块存储 = kwargs.get("文本块存储", "")
        文件名前缀 = kwargs.get("文件名前缀", "")
        文件名后缀 = kwargs.get("文件名后缀", "")
        使用时间戳 = kwargs.get("使用时间戳", True)
        使用计数器 = kwargs.get("使用计数器", False)
        生成预览 = kwargs.get("生成预览", "启用")
        保存同名txt文件 = kwargs.get("保存同名txt文件", "禁用")
        限制图像大小 = kwargs.get("限制图像大小", "禁用")
        最大分辨率 = kwargs.get("最大分辨率", 1024)
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
        
        # 定义一个占位图像，用于不保存时的返回
        placeholder_image = torch.ones((1, 1, 1, 3), dtype=torch.float32)

        # 检查是否应该跳过保存
        skip_save = False
        skip_reason = ""

        if 图像 is None or 图像.size(0) == 0:
            skip_save = True
            skip_reason = "无图像输入"
        elif 图像.shape[1] == 1 and 图像.shape[2] == 1:
            skip_save = True
            skip_reason = "图像尺寸为1x1像素"
        elif 图像.shape[1] == 64 and 图像.shape[2] == 64:
            # 检查是否为纯黑图像 (像素值接近0)
            # 使用一个小的容差值来判断是否为纯黑，因为浮点数比较可能不精确
            if torch.all(torch.abs(图像 - 0.0) < 1e-6): # 如果所有像素值都接近于0
                skip_save = True
                skip_reason = "图像尺寸为64x64像素且为纯黑"

        if skip_save:
            if unique_id is not None:
                 return {"result": (placeholder_image, help_output), "node_id": unique_id}
            else:
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
        
        # 如果有图像输入，则处理图像 (这里在前面已经做了1x1和64x64纯黑检查)
        components = []
        
        if filename_prefix:
            components.append(filename_prefix)
        
        if 使用时间戳:
            timestamp = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
            components.append(timestamp)
        
        if 使用计数器:
            # 仅在"保存图像"模式下增加计数器
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

            # 处理图像缩放（根据最大分辨率等比缩放）
            if 限制图像大小 == "启用" and 最大分辨率 > 0:
                # 计算缩放比例，使图像的长边不超过最大分辨率
                max_dim = max(pil_image.width, pil_image.height)
                if max_dim > 最大分辨率:
                    scale_factor = 最大分辨率 / max_dim
                    new_width = int(pil_image.width * scale_factor)
                    new_height = int(pil_image.height * scale_factor)
                    # 确保宽高都是8的倍数（符合某些模型的要求）
                    new_width = (new_width // 8) * 8
                    new_height = (new_height // 8) * 8
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
                    
                    # 只有当文本块内容不为空时才保存txt文件
                    if text_content:
                        # 只保存文本块内容到txt文件
                        with open(unique_txt_path, "w", encoding="utf-8") as f:
                            f.write(text_content)
                    
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

# ============================== 简易保存图像节点 ==============================
class ZML_SimpleSaveImage:
    """ZML 简易图像保存节点"""

    def __init__(self):
        self.output_dir = folder_paths.get_output_directory()
        self.type = "output"
        self.node_dir = os.path.dirname(os.path.abspath(__file__))

        # 与 ZML_SaveImage 共享相同的计数器文件以保持一致性
        self.counter_dir = os.path.join(self.node_dir, "counter")
        os.makedirs(self.counter_dir, exist_ok=True)
        self.counter_file = os.path.join(self.counter_dir, "counter.txt")
        self.total_counter_file = os.path.join(self.counter_dir, "总次数.txt")

        # 确保计数器文件存在并遵循与原节点相同的重置逻辑
        self.ensure_counter_files()

    def ensure_counter_files(self):
        """确保计数器文件存在，并重置重启计数器"""
        try:
            # 每次启动时将重启计数器重置为0
            if not os.path.exists(self.counter_file):
                with open(self.counter_file, "w", encoding="utf-8") as f:
                    f.write("0")
            else:
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
            "required": {
                "图像": ("IMAGE", {}),
            },
            "optional": {
                 "操作模式": (["保存图像", "仅预览图像"], {"default": "保存图像"}),
                 "保存路径": ("STRING", {"default": "output/ZML/%Y-%m-%d", "placeholder": "相对/绝对路径 (留空使用output)"}),
                 "文本块存储": ("STRING", {"default": "", "placeholder": "存储到PNG文本块的文本内容"}),
            },
            "hidden": {
                "prompt": "PROMPT", 
                "extra_pnginfo": "EXTRA_PNGINFO",
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ()
    RETURN_NAMES = ()
    FUNCTION = "save_images"
    OUTPUT_NODE = True
    CATEGORY = "image/ZML_图像/图像"

    def format_path(self, path):
        """格式化用户输入的路径"""
        if not path:
            return self.output_dir
        path = path.strip().strip('"').strip("'")
        if path.startswith("./"):
            path = path[2:]
        if not path:
            return self.output_dir
        
        # 使用 pathlib 规范化路径处理
        full_path = Path(path)
        if not full_path.is_absolute():
            full_path = COMFYUI_ROOT / full_path # 相对于ComfyUI根目录
        
        return str(full_path.resolve()) # 返回解析后的绝对路径字符串

    def ensure_directory(self, path):
        """确保目录存在"""
        try:
            Path(path).mkdir(parents=True, exist_ok=True)
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

    def save_images(self, 图像, 操作模式="保存图像", 保存路径="", 文本块存储="", prompt=None, extra_pnginfo=None, unique_id=None):
        # 检查并跳过1x1像素或64x64纯黑图像
        skip_save = False
        if 图像.shape[1] == 1 and 图像.shape[2] == 1:
            skip_save = True
        elif 图像.shape[1] == 64 and 图像.shape[2] == 64:
            if torch.all(torch.abs(图像 - 0.0) < 1e-6):
                skip_save = True

        if skip_save:
            return {"node_id": unique_id} if unique_id is not None else {}

        # 仅在“保存图像”模式下增加总次数计数器
        if 操作模式 == "保存图像":
            self.increment_total_counter()

        text_content = 文本块存储.strip()
        full_save_path_str = datetime.datetime.now().strftime(保存路径)

        # 根据操作模式设置保存路径和UI类型
        if 操作模式 == "仅预览图像":
            temp_dir = folder_paths.get_temp_directory()
            if not Path(temp_dir).resolve().is_relative_to(COMFYUI_ROOT):
                temp_dir = str(COMFYUI_ROOT / "temp")
                Path(temp_dir).mkdir(parents=True, exist_ok=True)
            save_path = temp_dir
            ui_type = "temp"
        else:
            save_path = self.ensure_directory(self.format_path(full_save_path_str))
            ui_type = "output" # 这里假定 output/temp 作为基准目录

        result_paths = []
        filename_prefix = "ZML"

        for index, image_tensor in enumerate(图像):
            # 构建文件名: "ZML#-#<计数器>.png"
            components = [filename_prefix]
            if 操作模式 == "保存图像":
                counter_value = self.get_next_counter()
                components.append(f"{counter_value:05d}")
            
            base_filename = "#-#".join(components)

            # 为批处理中的每个图像添加索引
            if len(图像) > 1:
                batch_filename = f"{base_filename}#{index+1:03d}.png"
            else:
                batch_filename = f"{base_filename}.png"

            full_path = os.path.join(save_path, batch_filename)
            final_image_path = self.get_unique_filepath(full_path)

            # 图像处理与保存
            image_array = 255. * image_tensor.cpu().numpy()
            pil_image = Image.fromarray(np.clip(image_array, 0, 255).astype(np.uint8))

            metadata = PngImagePlugin.PngInfo()

            # 添加标准的ComfyUI元数据（工作流等）
            if prompt is not None:
                try:
                    metadata.add_text("prompt", json.dumps(prompt))
                except Exception: pass
            if extra_pnginfo is not None:
                for key, value in extra_pnginfo.items():
                    try:
                        metadata.add_text(key, json.dumps(value))
                    except Exception: pass
            
            # 添加自定义文本块
            if text_content:
                try:
                    metadata.add_text(DEFAULT_TEXT_BLOCK_KEY, text_content, zip=True)
                except Exception: pass

            try:
                # 保存图像
                pil_image.save(final_image_path, pnginfo=metadata, compress_level=4)
                
                # 准备用于UI预览的结果
                abs_file_path = Path(final_image_path).resolve()
                if abs_file_path.is_relative_to(COMFYUI_ROOT):
                    rel_path_from_comfy = abs_file_path.relative_to(COMFYUI_ROOT)
                    result_paths.append({
                        "filename": rel_path_from_comfy.name,
                        "subfolder": str(rel_path_from_comfy.parent).replace("\\", "/"),
                        "type": "custom"
                    })
                else:
                    print(f"警告: 图像 '{final_image_path}' 不在ComfyUI根目录内，无法通过标准接口预览。")

            except Exception as e:
                print(f"ZML_SimpleSaveImage Error: Failed to save image {final_image_path}, error: {e}")
                pass
        
        # 为UI预览准备返回数据
        ui_output = { "images": result_paths }
        return {"ui": ui_output, "node_id": unique_id} if unique_id is not None else {"ui": ui_output}


# ============================== 加载图像节点 (读取PNG文本块)==============================
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
                "输出透明": (["启用", "禁用"], {"default": "启用"}),
            }
        }
    
    CATEGORY = "image/ZML_图像/图像"
    
    RETURN_TYPES = ("IMAGE", "STRING", "STRING",)
    RETURN_NAMES = ("图像", "文本块", "Name",)
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
    
    def load_image(self, 图像, 正规化, 读取文本块, 输出透明):
        """
        加载图像的主要函数
        读取PNG文本块内容并支持透明通道
        """
        image_path = folder_paths.get_annotated_filepath(图像)
        
        try:
            with Image.open(image_path) as img:
                text_content = "未读取"
                if 读取文本块 == "启用":
                    if hasattr(img, 'text') and DEFAULT_TEXT_BLOCK_KEY in img.text:
                        text_content = img.text[DEFAULT_TEXT_BLOCK_KEY]
                    else:
                        text_content = "未找到文本块内容"
                
                img = ImageOps.exif_transpose(img)
                
                # 根据“输出透明”选项处理图像模式
                if 输出透明 == "启用" and (img.mode == 'RGBA' or img.mode == 'LA' or (img.mode == 'P' and 'transparency' in img.info)):
                    image = img.convert('RGBA')  # 转换为RGBA以保留透明通道
                else:
                    image = img.convert('RGB')   # 转换为RGB（不含透明通道）
                
                image_np = np.array(image).astype(np.float32) / 255.0
                image_tensor = torch.from_numpy(image_np)[None,]
                
                normalized_name = self.normalize_name(os.path.basename(image_path), 正规化)
                
                return (image_tensor, text_content, normalized_name)
        
        except Exception as e:
            # 这里的 print 语句用于真正的加载错误，建议保留以进行调试
            print(f"ZML_LoadImage Error: {e}") 
            error_image = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
            return (error_image, "加载失败", "加载失败")
    
    @classmethod
    def IS_CHANGED(cls, 图像, 正规化="正规", 读取文本块="禁用", 输出透明="启用"):
        image_path = folder_paths.get_annotated_filepath(图像)
        return float("nan")
    
    @classmethod
    def VALIDATE_INPUTS(cls, 图像, 正规化="正规", 读取文本块="禁用", 输出透明="启用"):
        if not folder_paths.exists_annotated_filepath(图像):
            return "无效图像文件: {}".format(图像)
        return True

# ============================== 从路径加载图像节点  ==============================
class ZML_LoadImageFromPath:
    """
    ZML 从路径加载图像节点
    支持随机、顺序、全部索引和读取PNG文本块。
    新增 '图像路径' 输出，提供加载图像的文件路径。
    新增 '图像数量' 输出，提供文件夹内图像的总数量。
    """
    
    def __init__(self):
        self.cached_files = []
        self.cached_path = ""
        self.cache_time = 0
        self.node_dir = os.path.dirname(os.path.abspath(__file__))

        self.counter_dir = os.path.join(self.node_dir, "counter")
        os.makedirs(self.counter_dir, exist_ok=True)
        self.counter_file = os.path.join(self.counter_dir, "路径图像计数.json")
        
        self.reset_counters_on_startup()
    
    def reset_counters_on_startup(self):
        try:
            with open(self.counter_file, "w", encoding="utf-8") as f:
                json.dump({}, f)
        except Exception as e:
            # 这里的 print 语句用于严重的初始化错误，建议保留以进行调试
            print(f"重置路径加载图像计数JSON文件失败: {str(e)}")

    def get_all_counts(self):
        try:
            with open(self.counter_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    def get_sequential_count(self, node_id):
        return self.get_all_counts().get(node_id, 0)

    def increment_sequential_count(self, node_id):
        all_counts = self.get_all_counts()
        current_count = all_counts.get(node_id, 0)
        all_counts[node_id] = current_count + 1
        try:
            with open(self.counter_file, "w", encoding="utf-8") as f:
                json.dump(all_counts, f, indent=4)
        except Exception as e:
            # 这里的 print 语句用于严重的计数器更新错误，建议保留以进行调试
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
    
    # 修改返回类型和名称：新增一个 "图像路径" 输出 和 "图像数量" 输出
    RETURN_TYPES = ("IMAGE", "STRING", "STRING", "STRING", "INT")
    RETURN_NAMES = ("图像列表", "文本块", "Name", "图像路径", "图像数量")
    FUNCTION = "load_image"
    CATEGORY = "image/ZML_图像/图像"

    # 新增 OUTPUT_IS_LIST 属性，声明 "图像列表" 和 "图像路径" 是列表
    OUTPUT_IS_LIST = (True, False, False, True, False)
    
    def _load_single_image_from_path(self, image_path, read_text_block):
        with Image.open(image_path) as img:
            text_content = "未读取"
            if read_text_block == "启用":
                if hasattr(img, 'text') and DEFAULT_TEXT_BLOCK_KEY in img.text:
                    text_content = img.text[DEFAULT_TEXT_BLOCK_KEY]
                else:
                    text_content = "未找到文本块内容"
            
            img = ImageOps.exif_transpose(img)
            
            if img.mode == 'RGBA' or img.mode == 'LA' or (img.mode == 'P' and 'transparency' in img.info):
                image = img.convert('RGBA')
            else:
                image = img.convert('RGB')
            
            image_np = np.array(image).astype(np.float32) / 255.0
            image_tensor = torch.from_numpy(image_np)[None,]
            
            return (image_tensor, text_content)

    def normalize_name(self, filename, level):
        if not filename: return ""
        base_name = os.path.splitext(filename)[0]
        if level == "禁用": return filename
        elif level == "仅名称": return base_name
        elif level == "正规": return base_name.split("#-#", 1)[0].strip()
        elif level == "反向":
            parts = base_name.split("#-#")
            return parts[-1].strip() if len(parts) > 0 else base_name

    def scan_directory(self, folder_path_str):
        if not folder_path_str: # 如果路径为空，返回空列表
            return []

        # 使用 pathlib 处理路径
        folder_path = Path(folder_path_str)

        # 检查是否为绝对路径，如果不是，则相对于ComfyUI根目录
        if not folder_path.is_absolute():
            folder_path = COMFYUI_ROOT / folder_path
        
        real_folder_path = folder_path.resolve() # 解析为真实的绝对路径

        # 安全检查: 确保路径在 COMFYUI_ROOT 内部或是一个明确允许的外部路径
        # 这里简单检查是否在 ComfyUI 根目录内，更严格的应该有白名单机制
        # if not real_folder_path.is_relative_to(COMFYUI_ROOT):
        #     print(f"警告: 尝试访问ComfyUI根目录外的路径: {real_folder_path}")
        #     return [] # 禁止访问外部路径

        if not real_folder_path.is_dir(): return []

        files = [f.name for f in real_folder_path.iterdir() if f.is_file() and f.suffix.lower() in supported_image_extensions]
        files.sort()
        return files

    def load_image(self, 文件夹路径, 索引模式, 图像索引, 正规化, 读取文本块, unique_id, prompt):
        current_time = time.time()
        # 优化缓存逻辑: 只有当路径改变或缓存过期时才重新扫描
        if (文件夹路径 != self.cached_path or current_time - self.cache_time > 60):
            self.cached_files = self.scan_directory(文件夹路径)
            self.cached_path = 文件夹路径
            self.cache_time = current_time
        
        num_files = len(self.cached_files) # 获取图像总数量

        # 如果找不到文件，返回空的列表和0数量
        if not self.cached_files:
            return ([], "未找到图像", "没有找到图像", 0, 0, [], 0) # 图像路径也返回空列表，数量为0

        # 解析实际的文件夹路径，用于构建完整的图片路径
        actual_folder_path = Path(文件夹路径)
        if not actual_folder_path.is_absolute():
            actual_folder_path = COMFYUI_ROOT / actual_folder_path
        actual_folder_path = actual_folder_path.resolve()


        if 索引模式 == "全部":
            image_tensors = []
            all_image_paths_list = [] # 新增列表存储所有图像路径
            all_text_blocks = [] # 收集所有文本块
            
            # 使用一个默认值，以防 first_image_meta 无法初始化 (例如，所有图片都加载失败)
            first_image_text = "N/A"
            first_normalized_name = "N/A"

            for filename in self.cached_files:
                image_path = str(actual_folder_path / filename) # 使用 pathlib 拼接路径
                try:
                    (tensor, text) = self._load_single_image_from_path(image_path, 读取文本块)
                    image_tensors.append(tensor)
                    all_image_paths_list.append(image_path) # 添加路径
                    all_text_blocks.append(text) # 添加文本块

                    # 如果这是第一个成功加载的图像，更新其元数据用于标量输出
                    # 确保只设置一次，且仅在成功加载后
                    if len(image_tensors) == 1: 
                        first_image_text = text
                        first_normalized_name = self.normalize_name(filename, 正规化)
                except Exception as e:
                    # 这里的 print 语句用于真正的加载错误，建议保留以进行调试
                    print(f"ZML_LoadImageFromPath: 加载图像失败: {filename}, 错误: {e}")
                    continue
            
            if not image_tensors:
                # 返回空的图像列表和空的图像路径列表，以及总数量
                return ([], "加载失败", "文件夹中所有图像均加载失败", [], num_files) 
            
            return (image_tensors, first_image_text, first_normalized_name, all_image_paths_list, num_files)

        # 处理单图模式 (固定、随机、顺序)
        index = 0
        if 索引模式 == "固定索引": index = 图像索引 % num_files
        elif 索引模式 == "随机索引": index = random.randint(0, num_files - 1)
        elif 索引模式 == "顺序":
            count = self.get_sequential_count(unique_id)
            index = count % num_files
            self.increment_sequential_count(unique_id)

        selected_filename = self.cached_files[index]
        image_path = str(actual_folder_path / selected_filename) # 使用 pathlib 拼接路径

        try:
            (tensor, text) = self._load_single_image_from_path(image_path, 读取文本块)
            normalized_name = self.normalize_name(selected_filename, 正规化)
            return ([tensor], text, normalized_name, [image_path], num_files) # 将单个路径也包装在列表中
        except Exception as e:
            # 这里的 print 语句用于真正的加载错误，建议保留以进行调试
            print(f"ZML_LoadImageFromPath: 加载图片失败: {selected_filename}, 错误: {e}")
            return ([], "加载失败", f"加载失败: {selected_filename}, {e}", [], num_files) 
    
    @classmethod
    def IS_CHANGED(cls, 文件夹路径, 索引模式, 图像索引, 正规化, 读取文本块, unique_id, prompt):
        # 确保每次运行时都更新文件列表，因为文件夹内容可能变化。
        # 依赖于 load_image 内部的缓存机制来避免频繁的磁盘扫描。
        # 对于 "顺序" 或 "随机索引" 模式，每次执行都返回 nan 强制执行
        if 索引模式 == "顺序" or 索引模式 == "随机索引":
            return float("nan")
        # 对于其他模式，只要路径或索引改变，就重新加载
        return (文件夹路径, 索引模式, 图像索引, 正规化, 读取文本块)



# ============================== API 路由设置 ==============================

def get_base_path(custom_path_str: str | None = None) -> Path:
    """
    根据 custom_path_str 获取文件操作的基准路径。
    如果 custom_path_str 为空，则回退到 ComfyUI 的 output 目录。
    支持相对路径 (相对于 ComfyUI 根目录) 和绝对路径。
    """
    if custom_path_str:
        # 使用 pathlib 处理自定义路径
        path_obj = Path(custom_path_str)
        if not path_obj.is_absolute():
            path_obj = COMFYUI_ROOT / path_obj # 相对于 ComfyUI 根目录
        
        final_path = path_obj.resolve() # 解析真实路径
        
        # 验证路径是否存在且是目录，如果不是，则返回 None 或抛出错误
        if not final_path.is_dir():
            print(f"警告: 提供的自定义路径不是有效目录: {final_path}")
            return None # 返回None表示路径无效
        
        return final_path
    else:
        return Path(folder_paths.get_output_directory()).resolve()


@server.PromptServer.instance.routes.get("/zml/get_output_images")
async def get_output_images(request):
    # 从请求中获取 custom_path 参数
    custom_path_str = request.query.get("custom_path", "")
    
    # 动态获取 base_dir
    base_dir = get_base_path(custom_path_str)
    
    if base_dir is None or not base_dir.is_dir():
        # 返回一个带有错误信息的结构，前端可以据此更新UI
        return web.json_response({"files": [], "base_path_display": f"无效路径: {custom_path_str or 'output'}"})

    image_files_list = []
    
    for root, dirs, files in os.walk(base_dir, followlinks=True):
        for file in files:
            if os.path.splitext(file)[1].lower() in supported_image_extensions:
                # 计算图片相对于 base_dir 的子文件夹路径
                subfolder = Path(root).relative_to(base_dir)
                image_files_list.append({
                    "filename": file,
                    "subfolder": str(subfolder).replace("\\", "/") # 统一路径分隔符
                })

    # 按完整路径排序
    image_files_list.sort(key=lambda x: os.path.join(x['subfolder'], x['filename']))

    # 返回包含文件列表和实际解析路径的字典
    return web.json_response({
        "files": image_files_list,
        "base_path_display": str(base_dir.relative_to(COMFYUI_ROOT)) if base_dir.is_relative_to(COMFYUI_ROOT) else str(base_dir)
    })

# API 2: 根据文件名获取图片中的文本块 (此API目前只用于TextBlockLoader，仍从Output读取)
@server.PromptServer.instance.routes.get("/zml/get_image_text_block")
async def get_image_text_block(request):
    if "filename" not in request.query:
        return web.Response(status=400, text="Filename parameter is missing")
    
    filename = request.query.get("filename")
    subfolder = request.query.get("subfolder", "")

    # 安全检查: 防止路径穿越
    if ".." in filename or "/" in filename or "\\" in filename or ".." in subfolder:
        return web.Response(status=400, text="Invalid filename or subfolder")

    # 注意：ZML_TextBlockLoader 仍然只从 output 目录加载，所以这里仍然使用 folder_paths.get_output_directory()
    image_path = os.path.join(folder_paths.get_output_directory(), subfolder, filename)

    if not os.path.exists(image_path):
        return web.Response(status=404, text="Image not found")

    try:
        with Image.open(image_path) as img:
            text_content = img.text.get(DEFAULT_TEXT_BLOCK_KEY, "未在此图片中找到'comfy_text_block'。")
            return web.json_response({"text": text_content})
    except Exception as e:
        return web.Response(status=500, text=f"Error reading image: {e}")

# API 3: 用于预览图像
@server.PromptServer.instance.routes.get("/zml/view_image")
async def view_image(request):
    if "filename" not in request.query:
        return web.Response(status=400, text="Filename parameter is missing")

    filename = request.query.get("filename")
    subfolder = request.query.get("subfolder", "")
    custom_path_str = request.query.get("custom_path", "") # 获取自定义路径参数

    # 安全检查
    if ".." in filename or "/" in filename or "\\" in filename or ".." in subfolder:
        return web.Response(status=400, text="Invalid filename or subfolder")
    
    # 动态获取 base_dir
    base_dir = get_base_path(custom_path_str)
    
    if base_dir is None: # 如果 base_dir 无效
        return web.Response(status=404, text=f"Directory not found for preview: {custom_path_str}")

    # 构建安全的文件路径
    image_path = base_dir / subfolder / filename
    image_path = image_path.resolve() # 转换为绝对路径

    # 再次确认文件存在且是文件
    if image_path.is_file(): # 使用 Path().is_file() 检查文件是否存在
        return web.FileResponse(image_path)
    else:
        return web.Response(status=404, text="Image not found")

# API 4: 用于获取缩略图 (新增)
@server.PromptServer.instance.routes.get("/zml/view_image_thumb")
async def view_image_thumb(request):
    if "filename" not in request.query:
        return web.Response(status=400, text="Filename parameter is missing")

    filename = request.query.get("filename")
    subfolder = request.query.get("subfolder", "")
    custom_path_str = request.query.get("custom_path", "")
    
    # 安全检查
    if ".." in filename or "/" in filename or "\\" in filename or ".." in subfolder:
        return web.Response(status=400, text="Invalid filename or subfolder")
    
    base_dir = get_base_path(custom_path_str)
    
    if base_dir is None:
        return web.Response(status=404, text=f"Directory not found for thumbnail: {custom_path_str}")

    image_path = base_dir / subfolder / filename
    image_path = image_path.resolve()

    if not image_path.is_file():
        return web.Response(status=404, text="Image not found for thumbnail")

    try:
        with Image.open(image_path) as img:
            img = ImageOps.exif_transpose(img).convert('RGB')
            # 缩略图大小
            thumb_size = (120, 120) 
            img.thumbnail(thumb_size)
            
            # 使用BytesIO将图片输出到内存
            from io import BytesIO
            buffer = BytesIO()
            img.save(buffer, format="JPEG", quality=85) # 以JPEG格式保存，提高加载速度
            buffer.seek(0)
            
            return web.Response(body=buffer.getvalue(), content_type="image/jpeg", status=200)

    except Exception as e:
        print(f"Error generating thumbnail for {image_path}: {e}")
        return web.Response(status=500, text=f"Error generating thumbnail: {e}")

# ============================== 新增的API代码 START ==============================
# API 5: 根据文件名从自定义路径获取单个图片的文本块 (为标签加载器新增)
@server.PromptServer.instance.routes.get("/zml/get_single_text_block")
async def get_single_text_block(request):
    filename = request.query.get("filename")
    subfolder = request.query.get("subfolder", "")
    custom_path_str = request.query.get("custom_path", "")

    # 安全检查
    if not filename or ".." in filename or "/" in filename or "\\" in filename or ".." in subfolder:
        return web.Response(status=400, text="无效的文件名或子文件夹路径")

    base_dir = get_base_path(custom_path_str)
    if base_dir is None:
        return web.Response(status=404, text=f"基准目录未找到: {custom_path_str}")

    image_path = (base_dir / subfolder / filename).resolve()

    if not image_path.is_file():
        return web.Response(status=404, text="图片文件未找到")

    try:
        with Image.open(image_path) as img:
            text_content = img.text.get(DEFAULT_TEXT_BLOCK_KEY, "") # 如果未找到则返回空字符串
            return web.json_response({"text_content": text_content})
    except Exception as e:
        return web.Response(status=500, text=f"读取图片信息时发生错误: {e}")

# API 6: 写入文本块到指定的图片 (为标签加载器新增)
@server.PromptServer.instance.routes.post("/zml/write_text_block")
async def write_text_block(request):
    try:
        data = await request.json()
        filename = data.get("filename")
        subfolder = data.get("subfolder", "")
        custom_path_str = data.get("custom_path", "")
        text_content = data.get("text_content", "")
    except Exception:
        return web.json_response({"error": "无效的请求数据"}, status=400)

    # 安全检查
    if not filename or ".." in filename or "/" in filename or "\\" in filename or ".." in subfolder:
        return web.json_response({"error": "无效的文件名或子文件夹路径"}, status=400)

    base_dir = get_base_path(custom_path_str)
    if base_dir is None:
        return web.json_response({"error": f"基准目录未找到: {custom_path_str}"}, status=404)

    image_path = (base_dir / subfolder / filename).resolve()

    if not image_path.is_file():
        return web.json_response({"error": "图片文件未找到"}, status=404)

    try:
        with Image.open(image_path) as img:
            # 加载原始图像数据以重新保存
            img.load() 
            
            # 创建或更新元数据
            metadata = PngImagePlugin.PngInfo()
            # 复制原始元数据（如果有）
            if img.info:
                for key, value in img.info.items():
                    if key != DEFAULT_TEXT_BLOCK_KEY: # 避免重复添加旧的文本块
                        metadata.add_text(key, str(value))
            
            # 添加或更新我们的文本块
            if text_content: # 只有当新内容不为空时才写入
                metadata.add_text(DEFAULT_TEXT_BLOCK_KEY, text_content, zip=True)

            # 重新保存图片，覆盖原文件
            img.save(image_path, pnginfo=metadata, compress_level=4)
            
        return web.json_response({"success": True, "message": "文本块写入成功！"})
    except Exception as e:
        print(f"写入文本块失败: {e}")
        return web.json_response({"error": f"写入文本块失败: {e}"}, status=500)
# ============================== 新增的API代码 END ================================


# ============================== 标签化图片加载器 ==============================
class ZML_TagImageLoader:
    """
    ZML 标签化图片加载器
    - 图像输出为列表，以支持不同分辨率。
    - 文本块输出为单个字符串，用分隔符连接。
    - 新增文本块加载状态的验证输出。
    """
    def __init__(self):
        # 默认使用ComfyUI的output目录作为基准，但会由get_base_path函数动态决定
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "selected_files_json": ("STRING", {"multiline": False, "default": "[]"}),
                "文本块输出": ("BOOLEAN", {"default": True, "label_on": "启用", "label_off": "禁用"}),
                "text_blocks_input": ("STRING", {"multiline": True, "default": ""}),
            },
            # 移除 '自定义路径' 节点输入口
            "hidden": {
                "prompt": "PROMPT",
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("IMAGE", "STRING", "STRING", "STRING",)
    RETURN_NAMES = ("图像列表", "文本块", "文本块验证", "文件夹路径",) 
    FUNCTION = "load_images_by_tags"
    CATEGORY = "image/ZML_图像/工具"

    OUTPUT_IS_LIST = (True, False, False, False,)

    # --- 🔴 MODIFICATION START: 添加占位符图像创建函数 ---
    def _create_placeholder_image(self, size=1) -> torch.Tensor:
        """创建一个 1x1 像素的黑色占位符图像张量"""
        return torch.zeros((1, size, size, 3), dtype=torch.float32, device="cpu")
    # --- 🔴 MODIFICATION END ---

    def load_images_by_tags(self, selected_files_json="[]", text_blocks_input="", 文本块输出=True, **kwargs): # 自定义路径不再作为参数
        # --- 🔴 MODIFICATION START: 在所有失败路径上返回占位符 ---
        placeholder_image = self._create_placeholder_image()

        # 根据文本块输出开关决定是否输出文本框内容
        if 文本块输出:
            # 只输出文本框里的内容，忽略从图像中提取的文本块
            final_text_output = text_blocks_input
        else:
            # 开关关闭时，不输出任何内容
            final_text_output = ""

        if not selected_files_json or selected_files_json == "[]":
            # 即使没有选择文件，也返回默认的输出目录绝对路径
            default_base_path = str(get_base_path().resolve()) if get_base_path() else ""
            return ([placeholder_image], final_text_output, "未选择任何文件。", default_base_path)

        try:
            data = json.loads(selected_files_json)
        except json.JSONDecodeError:
            print("ZML_TagImageLoader: JSON解析失败。")
            # 即使JSON解析失败，也返回默认的输出目录绝对路径
            default_base_path = str(get_base_path().resolve()) if get_base_path() else ""
            return ([placeholder_image], final_text_output, "JSON解析失败", default_base_path)
        # --- 🔴 MODIFICATION END ---

        file_list = []
        current_custom_base_path = ""

        # 智能判断数据格式，兼容新旧两种格式
        if isinstance(data, dict) and "files" in data:
            # 这是新格式: {"files": [...], "_base_path": "..."}
            file_list = data.get("files", [])
            current_custom_base_path = data.get("_base_path", "")
        elif isinstance(data, list):
            # 这是旧格式: [...]
            file_list = data
        
        # --- 🔴 MODIFICATION START: 在所有失败路径上返回占位符 ---
        if not file_list:
            # 获取并返回绝对路径
            base_dir = get_base_path(current_custom_base_path)
            base_path_str = str(base_dir.resolve()) if base_dir else ""
            return ([placeholder_image], final_text_output, "选择列表为空或格式不正确。", base_path_str)
        # --- 🔴 MODIFICATION END ---

        image_tensors = []
        text_blocks = []
        validation_messages = []

        base_dir = get_base_path(current_custom_base_path)
        
        # --- 🔴 MODIFICATION START: 在所有失败路径上返回占位符 ---
        if base_dir is None or not base_dir.is_dir():
            print(f"ZML_TagImageLoader: 基准目录无效或不存在: {current_custom_base_path or 'output'}")
            # 即使基准目录无效，也返回尝试解析的路径
            attempted_path = str(Path(current_custom_base_path).resolve()) if current_custom_base_path else ""
            return ([placeholder_image], final_text_output, f"基准目录无效或不存在: {current_custom_base_path or 'output'}", attempted_path)
        # --- 🔴 MODIFICATION END ---

        for item in file_list:
            # 忽略内部 base_path 字段，只处理实际的文件信息
            if item.get("filename") is None:
                continue

            subfolder = item.get("subfolder", "")
            filename = item.get("filename", "")

            # 尽管前端和API有校验，这里仍然进行最终的安全检查
            if ".." in filename or "/" in filename or "\\" in filename or ".." in subfolder:
                validation_messages.append(f"{filename}：无效路径，已跳过")
                continue
            
            # 使用 pathlib 更安全地拼接路径
            image_path = base_dir / subfolder / filename
            image_path = image_path.resolve() # 解析为最终的绝对路径

            if not image_path.is_file(): # 使用 Path().is_file() 检查文件是否存在
                validation_messages.append(f"{filename}：文件不存在，已跳过")
                continue

            try:
                with Image.open(image_path) as img:
                    has_text_block = False
                    text_content = "" # 默认空，如果没找到文本块
                    
                    if hasattr(img, 'text') and DEFAULT_TEXT_BLOCK_KEY in img.text:
                        text_content = img.text[DEFAULT_TEXT_BLOCK_KEY]
                        has_text_block = True
                    
                    text_blocks.append(text_content)
                    
                    if has_text_block:
                        validation_messages.append(f"{filename}：含有文本块")
                    else:
                        validation_messages.append(f"{filename}：不含文本块")

                    img = ImageOps.exif_transpose(img)
                    if img.mode != 'RGB':
                        img = img.convert('RGB')
                    
                    image_np = np.array(img).astype(np.float32) / 255.0
                    image_tensor = torch.from_numpy(image_np)[None,]
                    image_tensors.append(image_tensor)
                    
            except Exception as e:
                validation_messages.append(f"{filename}：加载失败 ({e})")
                print(f"ZML_TagImageLoader: 加载图片 '{image_path}' 失败: {e}")

        # --- 🔴 MODIFICATION START: 在所有失败路径上返回占位符 ---
        if not image_tensors:
            final_validation_output = "\n".join(validation_messages)
            # 确保返回绝对路径
            return ([placeholder_image], final_text_output, final_validation_output, str(base_dir.resolve()))
        # --- 🔴 MODIFICATION END ---
        
        validation_separator = "\n\n" + ("-"*25) + "\n\n"
        final_validation_output = validation_separator.join(validation_messages)
        
        # 确保返回绝对路径
        # 当用户打开了"记住打开位置"选项时，返回用户实际打开的路径
        return (image_tensors, final_text_output, final_validation_output, str(base_dir.resolve()))

    @classmethod
    def IS_CHANGED(cls, selected_files_json, **kwargs):
        # 只有当 selected_files_json 改变时才强制执行
        return (selected_files_json,)


# ============================== ZML_分类图像 节点 ==============================
class ZML_ClassifyImage:
    """
    ZML_分类图像 节点：根据图片的元数据和特定文本块的存在与否进行分类。
    必须连接有效的 '图像路径' (STRING) 才能正确检测元数据。
    """
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                # image_path是必须的，用于读取元数据。
                "图像路径": ("STRING", {"multiline": False, "default": ""}),
                # 图像 tensor 是要作为输出传递的图像数据。
                "图像": ("IMAGE",), 
            }
        }

    RETURN_TYPES = ("IMAGE", "IMAGE", "IMAGE",)
    RETURN_NAMES = ("无数据", "元数据", "文本块",)
    FUNCTION = "classify"
    CATEGORY = "image/ZML_图像/工具" 
    DISPLAY_NAME = "ZML_分类图像" 

    def _create_placeholder_image(self, size=1) -> torch.Tensor:
        """Helper: 创建一个 1x1 像素的黑色占位符图像张量"""
        return torch.zeros((1, size, size, 3), dtype=torch.float32, device="cpu")

    def classify(self, 图像路径: str, 图像: torch.Tensor):
        placeholder_image = self._create_placeholder_image(size=1)
        
        output_no_data = placeholder_image
        output_metadata = placeholder_image
        output_text_block = placeholder_image

        has_info = False
        has_text_block_content = False
        
        # 使用 pathlib 进行路径解析和检查
        image_path_obj = Path(图像路径).resolve()
        
        if image_path_obj.is_file():
            try:
                with Image.open(image_path_obj) as img:
                    has_info = bool(img.info)
                    if has_info:
                        has_text_block_content = DEFAULT_TEXT_BLOCK_KEY in img.info
            except Exception as e:
                print(f"ZML_ClassifyImage: 读取图像元数据失败 '{图像路径}': {e}")
                # 这里的 print 语句用于真正的加载错误
                pass

        if not has_info:
            output_no_data = 图像 
        elif has_text_block_content:
            output_text_block = 图像 
        else:
            output_metadata = 图像 

        return (output_no_data, output_metadata, output_text_block,)

# ============================== 从路径加载视频节点 ==============================
class ZML_LoadVideoFromPath:
    """
    ZML 从路径加载视频节点：从指定文件夹路径加载视频文件，逐帧输出图像。
    支持索引模式、帧率限制和读取帧数上限。
    """
    def __init__(self):
        self.cached_files = [] # 缓存当前路径下的视频文件列表
        self.cached_path = ""  # 缓存的路径
        self.cache_time = 0    # 缓存时间戳
        self.node_dir = os.path.dirname(os.path.abspath(__file__))

        # 视频文件计数器，与ZML_LoadImageFromPath共享计数器文件
        self.counter_dir = os.path.join(self.node_dir, "counter")
        os.makedirs(self.counter_dir, exist_ok=True)
        self.counter_file = os.path.join(self.counter_dir, "路径视频计数.json")
        
        # 启动时重置计数器
        self.reset_counters_on_startup()
        
    def reset_counters_on_startup(self):
        """在ComfyUI启动时重置所有节点的顺序计数器"""
        try:
            with open(self.counter_file, "w", encoding="utf-8") as f:
                json.dump({}, f)
        except Exception as e:
            print(f"ZML_LoadVideoFromPath: 重置路径视频计数JSON文件失败: {str(e)}")

    def get_all_counts(self):
        """读取所有节点的顺序计数器"""
        try:
            with open(self.counter_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    def get_sequential_count(self, node_id):
        """获取特定节点的顺序计数"""
        return self.get_all_counts().get(node_id, 0)

    def increment_sequential_count(self, node_id):
        """增加特定节点的顺序计数并保存"""
        all_counts = self.get_all_counts()
        current_count = all_counts.get(node_id, 0)
        all_counts[node_id] = current_count + 1
        try:
            with open(self.counter_file, "w", encoding="utf-8") as f:
                json.dump(all_counts, f, indent=4)
        except Exception as e:
            print(f"ZML_LoadVideoFromPath: 更新路径视频计数JSON文件失败: {str(e)}")

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "文件夹路径": ("STRING", {"default": "", "placeholder": "包含视频文件的文件夹路径"}),
                "索引模式": (["固定索引", "随机索引", "顺序"], {"default": "固定索引"}), # 视频通常一次处理一个，不设“全部”
                "索引值": ("INT", {"default": 0, "min": 0, "step": 1}),
                "读取帧数上限": ("INT", {"default": 0, "min": 0, "step": 1, "max": 999999, "help": "0表示读取所有帧"}),
                "帧率限制": ("INT", {"default": 0, "min": 0, "step": 1, "max": 999, "help": "0表示不限制，保留原视频帧率"}),
            },
            "hidden": {
                "prompt": "PROMPT",
                "unique_id": "UNIQUE_ID"
            },
        }

    RETURN_TYPES = ("IMAGE", "INT", "INT")
    RETURN_NAMES = ("图像", "帧率", "帧数")
    FUNCTION = "load_video"
    CATEGORY = "image/ZML_图像/图像"
    OUTPUT_IS_LIST = (True, False, False) # 图像是PIL列表，其他是单一值

    def scan_directory(self, folder_path_str: str):
        """
        扫描指定目录，返回所有支持的视频文件列表。
        """
        if not folder_path_str:
            return []

        folder_path = Path(folder_path_str)
        if not folder_path.is_absolute():
            folder_path = COMFYUI_ROOT / folder_path
        real_folder_path = folder_path.resolve()

        if not real_folder_path.is_dir():
            print(f"ZML_LoadVideoFromPath: 文件夹路径不存在或不是目录: {real_folder_path}")
            return []

        files = [f.name for f in real_folder_path.iterdir() if f.is_file() and f.suffix.lower() in supported_video_extensions]
        files.sort()
        return files

    def _create_placeholder_image(self, size=1) -> torch.Tensor:
        """Helper: 创建一个 1x1 像素的黑色占位符图像张量"""
        return torch.zeros((1, size, size, 3), dtype=torch.float32, device="cpu")

    def load_video(self, 文件夹路径: str, 索引模式: str, 索引值: int, 读取帧数上限: int, 帧率限制: int, unique_id=None, prompt=None):
        current_time = time.time()
        # 优化缓存逻辑: 只有当路径改变或缓存过期时才重新扫描
        if 文件夹路径 != self.cached_path or current_time - self.cache_time > 60:
            self.cached_files = self.scan_directory(文件夹路径)
            self.cached_path = 文件夹路径
            self.cache_time = current_time
        
        num_files_in_folder = len(self.cached_files) # 文件夹中的视频文件总数

        # 如果没有找到视频文件，返回占位符
        if not self.cached_files:
            print(f"ZML_LoadVideoFromPath: 未在路径 '{文件夹路径}' 中找到任何视频文件。")
            return ([self._create_placeholder_image(64)], 0, 0)
        
        # 根据索引模式选择视频文件
        selected_file_index = 0
        if 索引模式 == "固定索引":
            selected_file_index = 索引值 % num_files_in_folder
        elif 索引模式 == "随机索引":
            selected_file_index = random.randint(0, num_files_in_folder - 1)
        elif 索引模式 == "顺序":
            count = self.get_sequential_count(str(unique_id)) if unique_id is not None else 0
            selected_file_index = count % num_files_in_folder
            if unique_id is not None:
                self.increment_sequential_count(str(unique_id))
        
        selected_filename = self.cached_files[selected_file_index]
        
        # 解析实际的文件夹路径，用于构建完整的视频路径
        actual_folder_path = Path(文件夹路径)
        if not actual_folder_path.is_absolute():
            actual_folder_path = COMFYUI_ROOT / actual_folder_path
        actual_folder_path = actual_folder_path.resolve()
        
        video_path = str(actual_folder_path / selected_filename)

        print(f"ZML_LoadVideoFromPath: 尝试加载视频: {video_path}")

        # 使用 OpenCV 打开视频文件
        cap = cv2.VideoCapture(video_path)

        if not cap.isOpened():
            print(f"ZML_LoadVideoFromPath: 无法打开视频文件: {video_path}")
            return ([self._create_placeholder_image(64)], 0, 0)
        
        frames_output = []
        original_fps = int(cap.get(cv2.CAP_PROP_FPS))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        
        actual_output_fps = original_fps
        frame_read_interval = 1 # 默认每帧都读取

        if 帧率限制 > 0 and original_fps > 帧率限制:
            frame_read_interval = max(1, int(original_fps / 帧率限制))
            # 修正实际输出帧率，避免除数为零或过小
            if frame_read_interval > 0:
                actual_output_fps = original_fps / frame_read_interval
            else:
                 actual_output_fps = original_fps # 实际上不应该发生，但作为安全措施

        frame_count = 0
        read_frame_counter = 0

        while True:
            # 根据 frame_read_interval 跳过不需要的帧
            if read_frame_counter % frame_read_interval != 0:
                ret = cap.grab() # grab only
                if not ret:
                    break
                read_frame_counter += 1
                continue

            ret, frame = cap.read()
            if not ret:
                break # 视频读取完毕或出错

            # 检查读取帧数上限
            if 读取帧数上限 > 0 and frame_count >= 读取帧数上限:
                break

            # 将 OpenCV 的 BGR 格式转换为 RGB
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            
            # 转换为 ComfyUI 的 Tensor 格式 (B, H, W, C)
            frame_tensor = torch.from_numpy(frame_rgb.astype(np.float32) / 255.0)[None,]
            frames_output.append(frame_tensor)
            
            frame_count += 1
            read_frame_counter += 1

        cap.release()
        
        if not frames_output:
            print(f"ZML_LoadVideoFromPath: 未从视频 '{video_path}' 中读取到任何帧。")
            return ([self._create_placeholder_image(64)], 0, 0)

        # 返回帧率使用实际输出的帧率，但如果原始帧率为0（或读取失败），则也返回0
        final_output_fps = int(actual_output_fps) if original_fps > 0 else 0 
        
        return (frames_output, final_output_fps, total_frames)

    @classmethod
    def IS_CHANGED(cls, 文件夹路径: str, 索引模式: str, 索引值: int, 读取帧数上限: int, 帧率限制: int, unique_id=None, prompt=None):
        # 确保每次运行时都更新文件列表，因为文件夹内容可能变化。
        # 依赖于 load_video 内部的缓存机制来避免频繁的磁盘扫描。
        # 对于 "顺序" 模式，每次执行都会改变内部计数器，因此总是返回 nan 强制执行
        if 索引模式 == "顺序":
            return float("nan")
        # 对于其他模式，只要路径或索引改变，就重新加载
        return (文件夹路径, 索引模式, 索引值, 读取帧数上限, 帧率限制)

# ============================== 从路径加载图像V2节点==============================
class ZML_LoadImageFromPathV2:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "模式": (["选择", "随机", "关闭预览"], {"default": "选择"}),
                "selected_files_json": ("STRING", {"multiline": False, "default": '{"path": "", "files": []}'}),
            },
            "hidden": { "unique_id": "UNIQUE_ID", "prompt": "PROMPT" },
        }

    RETURN_TYPES = ("IMAGE", "STRING",)
    RETURN_NAMES = ("图像", "文本块",)
    FUNCTION = "load_images_v2"
    CATEGORY = "image/ZML_图像/图像"
    OUTPUT_IS_LIST = (True, False,)

    def _create_placeholder_image(self, size=64) -> torch.Tensor:
        """创建一个黑色的占位符图像张量"""
        return torch.zeros((1, size, size, 3), dtype=torch.float32, device="cpu")

    def load_images_v2(self, 模式, selected_files_json, **kwargs):
        try:
            data = json.loads(selected_files_json)
            folder_path = data.get("path", "")
        except (json.JSONDecodeError, TypeError):
            return ([self._create_placeholder_image()], "")

        selected_files = []

        if 模式 == "选择":
            selected_files = data.get("files", [])
        
        elif 模式 == "随机" or 模式 == "关闭预览":
            if not folder_path:
                print("[ZMLv2-随机模式] 警告: 文件夹路径为空。")
                return ([self._create_placeholder_image()], "")
            
            try:
                target_path = Path(folder_path).resolve()
                if target_path.is_dir():
                    all_images = [f for f in target_path.iterdir() if f.is_file() and f.suffix.lower() in supported_image_extensions]
                    if all_images:
                        random_file = random.choice(all_images)
                        selected_files.append(str(random_file.resolve()))
                    else:
                        print(f"[ZMLv2-随机模式] 警告: 文件夹 '{target_path}' 中没有找到任何支持的图像。")
                else:
                    print(f"[ZMLv2-随机模式] 警告: 路径 '{target_path}' 不是一个有效的目录。")
            except Exception as e:
                print(f"[ZMLv2-随机模式] 扫描文件夹时出错: {e}")

        if not selected_files:
            return ([self._create_placeholder_image()], "")

        image_tensors = []
        text_blocks = []

        for full_path_str in selected_files:
            try:
                image_path = Path(full_path_str).resolve()
                if not image_path.is_file():
                    print(f"[ZMLv2] 警告: 跳过不存在的文件: {image_path}")
                    continue

                with Image.open(image_path) as img:
                    text_content = img.text.get(DEFAULT_TEXT_BLOCK_KEY, "")
                    if text_content:
                        text_blocks.append(text_content)
                    
                    img = ImageOps.exif_transpose(img).convert("RGB")
                    image_np = np.array(img).astype(np.float32) / 255.0
                    image_tensor = torch.from_numpy(image_np)[None,]
                    image_tensors.append(image_tensor)

            except Exception as e:
                print(f"[ZMLv2] 加载图像时出错 '{full_path_str}': {e}")
                continue
        
        if not image_tensors:
            return ([self._create_placeholder_image()], "")

        final_text = "\n\n".join(text_blocks)
        
        return (image_tensors, final_text)

    @classmethod
    def IS_CHANGED(cls, 模式, selected_files_json, **kwargs):
        # "随机" 和 "关闭预览" 模式都需要每次强制刷新
        if 模式 == "随机" or 模式 == "关闭预览":
            return float("nan")
        
        return (selected_files_json,)

# ============================== V2 节点所需的 API 路由 ==============================

@server.PromptServer.instance.routes.get("/zml/v2/list_images")
async def list_images_v2(request):
    """API: 根据绝对路径列出目录中的图像文件"""
    path_param = request.query.get("path", "")
    if not path_param:
        return web.json_response({"error": "缺少路径参数"}, status=400)

    try:
        # 安全性: 解析路径以防止目录遍历攻击 (如 ../)
        target_path = Path(path_param).resolve()

        # 安全性: 确保路径是一个存在的目录
        if not target_path.is_dir():
            return web.json_response({"error": "路径不是一个有效的目录"}, status=404)
        
        # 扫描目录中所有支持的图像文件
        files = [f.name for f in target_path.iterdir() if f.is_file() and f.suffix.lower() in supported_image_extensions]
        
        files.sort() # 按名称排序
        
        return web.json_response({"path": str(target_path), "files": files})

    except Exception as e:
        return web.json_response({"error": f"发生错误: {str(e)}"}, status=500)

@server.PromptServer.instance.routes.get("/zml/v2/view_thumb")
async def view_thumb_v2(request):
    """API: 根据绝对路径获取图像的缩略图"""
    path_param = request.query.get("path", "")
    if not path_param:
        return web.Response(status=400, text="缺少路径参数")

    try:
        # 安全性: 解码并解析路径
        image_path = Path(urllib.parse.unquote(path_param)).resolve()

        # 安全性: 确保它是一个文件且存在
        if not image_path.is_file():
            return web.Response(status=404, text="图像文件未找到")
        
        # 安全性: 确保它是一个图像文件
        if image_path.suffix.lower() not in supported_image_extensions:
            return web.Response(status=400, text="不支持的文件类型")

        # 生成并返回缩略图
        with Image.open(image_path) as img:
            img = ImageOps.exif_transpose(img).convert('RGB')
            img.thumbnail((128, 128)) # 缩略图尺寸
            
            from io import BytesIO
            buffer = BytesIO()
            img.save(buffer, format="JPEG", quality=85)
            buffer.seek(0)
            
            return web.Response(body=buffer.getvalue(), content_type="image/jpeg")

    except Exception as e:
        print(f"为 {path_param} 生成v2缩略图时出错: {e}")
        return web.Response(status=500, text=f"生成缩略图时出错: {e}")

# ============================== 节点注册==============================
NODE_CLASS_MAPPINGS = {
    "ZML_SaveImage": ZML_SaveImage,
    "ZML_SimpleSaveImage": ZML_SimpleSaveImage,
    "ZML_LoadImage": ZML_LoadImage,
    "ZML_LoadImageFromPath": ZML_LoadImageFromPath,
    "ZML_LoadImageFromPathV2": ZML_LoadImageFromPathV2,
    "ZML_LoadVideoFromPath": ZML_LoadVideoFromPath,
    "ZML_TagImageLoader": ZML_TagImageLoader,
    "ZML_ClassifyImage": ZML_ClassifyImage, 
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_SaveImage": "ZML_保存图像",
    "ZML_SimpleSaveImage": "ZML_简易_保存图像",
    "ZML_LoadImage": "ZML_加载图像",
    "ZML_LoadImageFromPath": "ZML_从路径加载图像",
    "ZML_LoadImageFromPathV2": "ZML_从路径加载图像V2",
    "ZML_LoadVideoFromPath": "ZML_从路径加载视频",
    "ZML_TagImageLoader": "ZML_标签化图像加载器", 
    "ZML_ClassifyImage": "ZML_分类图像", 
}