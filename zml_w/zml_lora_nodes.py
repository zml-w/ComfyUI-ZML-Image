import os
import shutil
import server
import folder_paths
import comfy.utils
import comfy.sd
from aiohttp import web
from nodes import LoraLoader
# [新增] 导入必要的库
import torch
import numpy as np
from PIL import Image

ZML_API_PREFIX = "/zml/lora"

def find_lora_root_path_for_file(lora_filename):
    """辅助函数，根据lora的相对文件名找到其所在的绝对根目录"""
    lora_full_path = folder_paths.get_full_path("loras", lora_filename)
    if not lora_full_path:
        return None
    
    for root_dir in folder_paths.get_folder_paths("loras"):
        normalized_root = os.path.normpath(root_dir)
        normalized_lora_path = os.path.normpath(lora_full_path)
        if os.path.commonpath([normalized_lora_path, normalized_root]) == normalized_root:
            return root_dir
            
    return None

@server.PromptServer.instance.routes.get(ZML_API_PREFIX + "/view/{name:.*}")
async def view(request):
    name = request.match_info["name"]
    pos = name.find("/")
    type = name[0:pos]
    relative_path = name[pos+1:]
    
    # 寻找预览图的绝对路径
    lora_filename_no_ext = os.path.splitext(relative_path.replace("zml/", ""))[0]
    
    for ext in [".safetensors", ".pt", ".bin", ".ckpt"]:
        lora_file = f"{lora_filename_no_ext}{ext}"
        lora_full_path = folder_paths.get_full_path(type, lora_file)
        if lora_full_path:
            lora_dir = os.path.dirname(lora_full_path)
            preview_filename = os.path.basename(relative_path)
            target_path = os.path.join(lora_dir, "zml", preview_filename)
            if os.path.isfile(target_path):
                 return web.FileResponse(target_path, headers={"Content-Disposition": f"filename=\"{os.path.basename(target_path)}\""})

    return web.Response(status=404)

@server.PromptServer.instance.routes.post(ZML_API_PREFIX + "/save/{name:.*}")
async def save_preview(request):
    name = request.match_info["name"]
    pos = name.find("/")
    type = name[0:pos]
    lora_relative_path = name[pos+1:]
    body = await request.json()

    source_dir = folder_paths.get_directory_by_type(body.get("type", "output"))
    source_subfolder = body.get("subfolder", "")
    source_filepath = os.path.join(source_dir, os.path.normpath(source_subfolder), body.get("filename", ""))

    if os.path.commonpath((source_dir, os.path.abspath(source_filepath))) != source_dir:
        return web.Response(status=400, text="源文件路径不合法")

    lora_root_dir = find_lora_root_path_for_file(lora_relative_path)
    if not lora_root_dir:
         lora_root_dir = folder_paths.get_folder_paths("loras")[0]

    zml_dir = os.path.join(lora_root_dir, "zml")
    lora_path_no_ext = os.path.splitext(lora_relative_path)[0]
    source_ext = os.path.splitext(source_filepath)[1]
    destination_path = os.path.join(zml_dir, f"{lora_path_no_ext}{source_ext}")
    os.makedirs(os.path.dirname(destination_path), exist_ok=True)
    shutil.copyfile(source_filepath, destination_path)
    relative_image_path = os.path.join("zml", f"{lora_path_no_ext}{source_ext}").replace("\\", "/")
    return web.json_response({"image": relative_image_path})

@server.PromptServer.instance.routes.get(ZML_API_PREFIX + "/images/{type}")
async def get_images(request):
    type = request.match_info["type"]
    if type != "loras":
        return web.json_response({})
        
    lora_files = folder_paths.get_filename_list(type)
    images = {}
    
    for lora_filename in lora_files:
        lora_full_path = folder_paths.get_full_path("loras", lora_filename)
        if not lora_full_path:
            continue

        lora_dir = os.path.dirname(lora_full_path)
        zml_dir = os.path.join(lora_dir, "zml")
        if not os.path.isdir(zml_dir):
            continue
            
        lora_basename_no_ext = os.path.splitext(os.path.basename(lora_filename))[0]
        for ext in [".png", ".jpg", ".jpeg", ".webp"]:
            preview_path_abs = os.path.join(zml_dir, f"{lora_basename_no_ext}{ext}")
            if os.path.isfile(preview_path_abs):
                lora_dir_relative = os.path.dirname(lora_filename)
                preview_basename = os.path.basename(preview_path_abs)
                relative_path_for_frontend = os.path.join(lora_dir_relative, "zml", preview_basename).replace("\\", "/")
                images[lora_filename] = relative_path_for_frontend
                break
        
    return web.json_response(images)


class ZmlLoraLoaderModelOnly:
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "模型": ("MODEL",),
                "lora_name": (folder_paths.get_filename_list("loras"),),
                "模型强度": ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01}),
            }
        }

    RETURN_TYPES = ("MODEL", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("模型", "txt", "log", "help")
    FUNCTION = "zml_load_lora_model_only"
    CATEGORY = "图像/ZML_图像/lora加载器"

    def zml_load_lora_model_only(self, 模型, lora_name, 模型强度):
        lora_path = folder_paths.get_full_path("loras", lora_name)
        lora = comfy.utils.load_torch_file(lora_path, safe_load=True) if lora_path else None
        
        model_out, _ = comfy.sd.load_lora_for_models(模型, None, lora, 模型强度, 0.0)
        
        txt_content = ""
        log_content = ""
        help_content = "你好~\n加载lora的节点是基于ComfyUI-Custom-Scripts里的lora节点进行二次修改的，GitHub链接：https://github.com/pythongosssss/ComfyUI-Custom-Scripts。\n感谢作者的付出~/n在lora目录创建一个子文件夹‘zml’，里面放上和lora文件同名的图片、txt、log文件即可使用节点读取对应信息，选择lora时鼠标悬停可以预览图片，且会根据文件夹来分类lora文件。\n文件夹结构应该是这样的：lora/zml。lora里放着lora文件，比如111.safetensors，zml文件夹里放着111.png、111.txt、111.log。\n这真是一个伟大的创意，再次感谢原作者的付出。"
        
        lora_full_path = folder_paths.get_full_path("loras", lora_name)
        if lora_full_path:
            lora_basename_no_ext = os.path.splitext(os.path.basename(lora_name))[0]
            lora_dir = os.path.dirname(lora_full_path)
            
            # --- 文本文件读取逻辑 ---
            # 读取 .txt 文件
            txt_filepath = os.path.join(lora_dir, "zml", f"{lora_basename_no_ext}.txt")
            if os.path.isfile(txt_filepath):
                try:
                    with open(txt_filepath, 'r', encoding='utf-8') as f:
                        txt_content = f.read()
                except Exception as e:
                    print(f"ZmlLoraLoaderModelOnly: 读取txt文件时出错 {txt_filepath}: {e}")

            # 读取 .log 文件 (确保使用与 .txt 文件完全相同的逻辑)
            log_filepath = os.path.join(lora_dir, "zml", f"{lora_basename_no_ext}.log")
            if os.path.isfile(log_filepath):
                try:
                    with open(log_filepath, 'r', encoding='utf-8') as f:
                        log_content = f.read()
                except Exception as e:
                    print(f"ZmlLoraLoaderModelOnly: 读取log文件时出错 {log_filepath}: {e}")

        return (model_out, txt_content, log_content, help_content)


class ZmlLoraLoader(LoraLoader):
    def __init__(self):
        super().__init__()

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "lora_name": (folder_paths.get_filename_list("loras"),),
                "模型强度": ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01}),
                "CLIP强度": ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01}),
            },
            "optional": {
                "模型": ("MODEL",),
                "CLIP": ("CLIP",),
            }
        }

    RETURN_TYPES = ("MODEL", "CLIP", "IMAGE", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("模型", "CLIP", "预览图", "txt", "log", "help")
    FUNCTION = "zml_load_lora"
    CATEGORY = "图像/ZML_图像/lora加载器"

    def zml_load_lora(self, lora_name, 模型强度, CLIP强度, 模型=None, CLIP=None):
        model_out, clip_out = super().load_lora(model=模型, clip=CLIP, lora_name=lora_name, strength_model=模型强度, strength_clip=CLIP强度)
        
        txt_content = ""
        log_content = ""
        help_content = "你好~\n加载lora的节点是基于ComfyUI-Custom-Scripts里的lora节点进行二次修改的，GitHub链接：https://github.com/pythongosssss/ComfyUI-Custom-Scripts。\n感谢作者的付出~/n在lora目录创建一个子文件夹‘zml’，里面放上和lora文件同名的图片、txt、log文件即可使用节点读取对应信息，选择lora时鼠标悬停可以预览图片，且会根据文件夹来分类lora文件。\n文件夹结构应该是这样的：lora/zml。lora里放着lora文件，比如111.safetensors，zml文件夹里放着111.png、111.txt、111.log。\n这真是一个伟大的创意，再次感谢原作者的付出。"
        
        # [新增] 图像加载逻辑
        preview_image_tensor = None
        
        lora_full_path = folder_paths.get_full_path("loras", lora_name)
        if lora_full_path:
            lora_basename_no_ext = os.path.splitext(os.path.basename(lora_name))[0]
            lora_dir = os.path.dirname(lora_full_path)
            
            # --- 图像文件读取逻辑 ---
            for ext in ['.png', '.jpg', '.jpeg', '.webp']:
                preview_path = os.path.join(lora_dir, "zml", f"{lora_basename_no_ext}{ext}")
                if os.path.isfile(preview_path):
                    try:
                        img = Image.open(preview_path)
                        img_rgb = img.convert("RGB")
                        img_array = np.array(img_rgb).astype(np.float32) / 255.0
                        preview_image_tensor = torch.from_numpy(img_array).unsqueeze(0)
                        break 
                    except Exception as e:
                        print(f"ZmlLoraLoader: 读取预览图时出错 {preview_path}: {e}")
            
            # --- 文本文件读取逻辑 ---
            txt_filepath = os.path.join(lora_dir, "zml", f"{lora_basename_no_ext}.txt")
            if os.path.isfile(txt_filepath):
                try:
                    with open(txt_filepath, 'r', encoding='utf-8') as f:
                        txt_content = f.read()
                except Exception as e:
                    print(f"ZmlLoraLoader: 读取txt文件时出错 {txt_filepath}: {e}")

            log_filepath = os.path.join(lora_dir, "zml", f"{lora_basename_no_ext}.log")
            if os.path.isfile(log_filepath):
                try:
                    with open(log_filepath, 'r', encoding='utf-8') as f:
                        log_content = f.read()
                except Exception as e:
                    print(f"ZmlLoraLoader: 读取log文件时出错 {log_filepath}: {e}")

        # [新增] 如果没找到图片，则创建一个黑色占位图
        if preview_image_tensor is None:
            preview_image_tensor = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
        
        return (model_out, clip_out, preview_image_tensor, txt_content, log_content, help_content)

class ZmlLoraLoaderFive:
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        lora_list = ["None"] + folder_paths.get_filename_list("loras")
        inputs = {
            "required": {
                "模型": ("MODEL",),
            },
            "optional": {
                "CLIP": ("CLIP",),
            }
        }
        for i in range(1, 6):
            inputs["required"][f"lora_{i}"] = (lora_list,)
            inputs["required"][f"权重_{i}"] = ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01})
        return inputs

    RETURN_TYPES = ("MODEL", "CLIP", "STRING")
    RETURN_NAMES = ("模型", "CLIP", "txt")
    FUNCTION = "load_five_loras"
    CATEGORY = "图像/ZML_图像/lora加载器"

    def load_five_loras(self, 模型, CLIP=None, **kwargs):
        model_out = 模型
        clip_out = CLIP
        all_txt_content = []

        for i in range(1, 6):
            lora_name = kwargs.get(f"lora_{i}")
            weight = kwargs.get(f"权重_{i}", 1.0)

            if lora_name == "None" or lora_name is None:
                continue
            
            lora_path = folder_paths.get_full_path("loras", lora_name)
            if not lora_path:
                print(f"ZmlLoraLoaderFive: LoRA not found '{lora_name}'")
                continue

            try:
                # Apply LoRA
                lora = comfy.utils.load_torch_file(lora_path, safe_load=True)
                model_out, clip_out = comfy.sd.load_lora_for_models(model_out, clip_out, lora, weight, weight)

                # Get trigger words
                lora_basename_no_ext = os.path.splitext(os.path.basename(lora_name))[0]
                lora_dir = os.path.dirname(lora_path)
                txt_filepath = os.path.join(lora_dir, "zml", f"{lora_basename_no_ext}.txt")
                
                if os.path.isfile(txt_filepath):
                    with open(txt_filepath, 'r', encoding='utf-8') as f:
                        txt_content = f.read()
                        if txt_content:
                            all_txt_content.append(txt_content.strip())
            except Exception as e:
                print(f"ZmlLoraLoaderFive: Error processing LoRA {lora_name}: {e}")

        # Join all trigger words with a comma and a space
        final_txt_output = ", ".join(filter(None, all_txt_content))
        return (model_out, clip_out, final_txt_output)


# 注册节点
NODE_CLASS_MAPPINGS = {
    "ZmlLoraLoader": ZmlLoraLoader,
    "ZmlLoraLoaderModelOnly": ZmlLoraLoaderModelOnly,
    "ZmlLoraLoaderFive": ZmlLoraLoaderFive,
}

# 节点显示名称映射
NODE_DISPLAY_NAME_MAPPINGS = {
    "ZmlLoraLoader": "ZML_lora加载器",
    "ZmlLoraLoaderModelOnly": "ZML_lora加载器（仅模型）",
    "ZmlLoraLoaderFive": "ZML_lora加载器_五",
}