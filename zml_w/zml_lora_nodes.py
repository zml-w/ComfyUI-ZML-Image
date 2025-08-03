import os
import shutil
import server
import folder_paths
import comfy.utils
import comfy.sd
from aiohttp import web
from nodes import LoraLoader, LoraLoaderModelOnly
import torch
import numpy as np
from PIL import Image
from typing import List, Tuple
import hashlib
import json
import urllib.request
import urllib.error
import urllib.parse
import re # 导入正则表达式模块

ZML_API_PREFIX = "/zml/lora"

# --- 辅助函数：查找LoRA根路径 ---
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

# --- 元数据解析辅助函数 ---
def clean_html(raw_html):
    """使用正则表达式移除HTML标签，并进行基本的换行处理"""
    if not raw_html:
        return ""
    # 将</p>和<br>等标签转换成换行符
    text = re.sub(r'</p>|<br\s*/?>', '\n', raw_html, flags=re.IGNORECASE)
    # 移除所有剩下的HTML标签
    text = re.sub(r'<.*?>', '', text)
    # 移除多余的空行
    text = re.sub(r'\n\s*\n', '\n', text).strip()
    return text

def calculate_sha256(filepath):
    """计算文件的SHA256哈希值"""
    sha256 = hashlib.sha256()
    with open(filepath, 'rb') as f:
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256.update(byte_block)
    return sha256.hexdigest()

def fetch_civitai_data_by_hash(hash_string):
    """通过哈希值从Civitai API获取模型版本信息"""
    url = f"https://civitai.com/api/v1/model-versions/by-hash/{hash_string}"
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'}
    
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req) as response:
            if response.status == 200:
                data = json.loads(response.read().decode('utf-8'))
                model_url = f"https://civitai.com/api/v1/models/{data['modelId']}"
                model_req = urllib.request.Request(model_url, headers=headers)
                with urllib.request.urlopen(model_req) as model_response:
                    if model_response.status == 200:
                        data['model'] = json.loads(model_response.read().decode('utf-8'))
                    else:
                        data['model'] = {}
                return data
    except urllib.error.HTTPError as e:
        print(f"[ZML_Parser] Civitai API请求失败: {e} (Hash: {hash_string})")
    except Exception as e:
        print(f"[ZML_Parser] 解析Civitai数据时出错: {e}")
    return None

def download_file(url, destination_path):
    """下载文件到指定路径"""
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'}
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req) as response, open(destination_path, 'wb') as out_file:
            if response.status == 200:
                shutil.copyfileobj(response, out_file)
                print(f"[ZML_Parser] 文件已保存: {destination_path}")
                return True
    except Exception as e:
        print(f"[ZML_Parser] 下载文件时出错 {url}: {e}")
    return False

# --- API 路由（保持不变） ---
@server.PromptServer.instance.routes.get(ZML_API_PREFIX + "/view/{name:.*}")
async def view(request):
    name = request.match_info["name"]
    pos = name.find("/")
    type = name[0:pos]
    relative_path = name[pos+1:]
    
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

# --- 解析LoRA元数据节点 ---
class ZmlLoraMetadataParser:
    def __init__(self):
        pass
    
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "lora_名称": (folder_paths.get_filename_list("loras"),),
                "保存首张图像": ("BOOLEAN", {"default": False}),
                "保存触发词为txt": ("BOOLEAN", {"default": False}),
                "保存介绍为log": ("BOOLEAN", {"default": False}),
            }
        }
    
    RETURN_TYPES = ("IMAGE", "STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("图像", "txt", "log", "解析", "help")
    FUNCTION = "parse_and_save_metadata"
    CATEGORY = "图像/ZML_图像/lora加载器"
    
    def parse_and_save_metadata(self, lora_名称, 保存首张图像, 保存触发词为txt, 保存介绍为log):
        lora_full_path = folder_paths.get_full_path("loras", lora_名称)
        if not lora_full_path or not os.path.exists(lora_full_path):
            return (torch.zeros((1, 64, 64, 3), dtype=torch.float32), "", "", "错误: LoRA文件未找到", "")

        lora_dir = os.path.dirname(lora_full_path)
        lora_basename_no_ext = os.path.splitext(os.path.basename(lora_名称))[0]
        zml_dir = os.path.join(lora_dir, "zml")
        
        parsed_info_str = f"LoRA: {lora_名称}\n"
        
        if 保存首张图像 or 保存触发词为txt or 保存介绍为log:
            print(f"[ZML_Parser] 正在处理 {lora_名称}...")
            os.makedirs(zml_dir, exist_ok=True)
            
            lora_hash = calculate_sha256(lora_full_path)
            parsed_info_str += f"SHA256: {lora_hash[:12]}...\n"
            civitai_data = fetch_civitai_data_by_hash(lora_hash)
            
            if civitai_data:
                print(f"[ZML_Parser] 已从Civitai获取到 '{civitai_data.get('model', {}).get('name', 'N/A')}' 的信息")
                
                if 保存首张图像 and civitai_data.get('images'):
                    first_image = civitai_data['images'][0]
                    img_url = first_image.get('url')
                    img_ext = os.path.splitext(urllib.parse.urlparse(img_url).path)[1]
                    if not img_ext in ['.png', '.jpg', '.jpeg', '.webp']:
                        img_ext = '.jpg'
                    img_dest_path = os.path.join(zml_dir, f"{lora_basename_no_ext}{img_ext}")
                    download_file(img_url, img_dest_path)
                
                if 保存触发词为txt and civitai_data.get('trainedWords'):
                    words_content = ", ".join(civitai_data['trainedWords'])
                    txt_dest_path = os.path.join(zml_dir, f"{lora_basename_no_ext}.txt")
                    with open(txt_dest_path, 'w', encoding='utf-8') as f:
                        f.write(words_content)
                    print(f"[ZML_Parser] 触发词已保存: {txt_dest_path}")
                
                if 保存介绍为log:
                    raw_model_desc = civitai_data.get('model', {}).get('description', '')
                    raw_version_desc = civitai_data.get('description', '')
                    model_desc = clean_html(raw_model_desc)
                    version_desc = clean_html(raw_version_desc)
                    base_model = civitai_data.get('baseModel', 'N/A')
                    model_id = civitai_data.get('modelId')
                    version_id = civitai_data.get('id')
                    civitai_link = f"https://civitai.com/models/{model_id}?modelVersionId={version_id}" if model_id and version_id else "链接不可用"

                    # --- 修改：调整log文件格式 ---
                    log_content = (
                        f"--- 基础信息 ---\n"
                        f"基础模型: {base_model}\n"
                        f"C站链接: {civitai_link}\n\n"
                        f"--- 模型介绍 ---\n\n{model_desc if model_desc else '无模型介绍。'}\n\n"
                        f"--- 版本信息 ---\n\n{version_desc if version_desc else '无版本信息。'}\n"
                    )
                    log_dest_path = os.path.join(zml_dir, f"{lora_basename_no_ext}.log")
                    with open(log_dest_path, 'w', encoding='utf-8') as f:
                        f.write(log_content)
                    print(f"[ZML_Parser] 介绍已保存: {log_dest_path}")
                
                parsed_info_str += "\n--- Civitai 信息 ---\n"
                parsed_info_str += f"模型名称: {civitai_data.get('model', {}).get('name', 'N/A')}\n"
                parsed_info_str += f"创作者: {civitai_data.get('model', {}).get('creator', {}).get('username', 'N/A')}\n"
                parsed_info_str += f"基础模型: {civitai_data.get('baseModel', 'N/A')}\n"
                parsed_info_str += f"触发词: {', '.join(civitai_data.get('trainedWords', []))}\n"
                
            else:
                parsed_info_str += "\n无法从Civitai获取此LoRA的信息（可能未上传或哈希不匹配）。"
        else:
            parsed_info_str = "未执行任何保存操作。\n请开启至少一个保存选项后重新运行。"

        # --- 修改：为“解析”输出添加更多信息 ---
        try:
            lora_meta = comfy.utils.load_torch_file(lora_full_path, safe_load=True)
            if lora_meta and '__metadata__' in lora_meta:
                metadata = lora_meta['__metadata__']
                parsed_info_str += "\n\n--- 训练详情 (来自文件) ---\n"
                network_args = json.loads(metadata.get('ss_network_args', '{}'))
                parsed_info_str += f"算法 (Algorithm): {network_args.get('algo', 'N/A')}\n"
                parsed_info_str += f"学习率 (LR): {metadata.get('ss_learning_rate', 'N/A')}\n"
                parsed_info_str += f"优化器 (Optimizer): {metadata.get('ss_optimizer_type', 'N/A')}\n"
                
                parsed_info_str += "\n--- 文件元数据 (原始) ---\n"
                parsed_info_str += json.dumps(metadata, indent=2, ensure_ascii=False)
            else:
                parsed_info_str += "\n\n--- 训练详情 (来自文件) ---\n文件中不包含元数据。"
        except Exception as e:
            parsed_info_str += f"\n\n--- 训练详情 (来自文件) ---\n无法解析文件元数据: {e}"


        # 读取本地文件作为输出
        preview_image_tensor = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
        txt_content, log_content = "", ""
        for ext in ['.png', '.jpg', '.jpeg', '.webp']:
            preview_path = os.path.join(zml_dir, f"{lora_basename_no_ext}{ext}")
            if os.path.isfile(preview_path):
                try:
                    img = Image.open(preview_path).convert("RGB")
                    img_array = np.array(img).astype(np.float32) / 255.0
                    preview_image_tensor = torch.from_numpy(img_array).unsqueeze(0)
                    break
                except Exception as e:
                    print(f"[ZML_Parser] 读取预览图时出错 {preview_path}: {e}")
        txt_filepath = os.path.join(zml_dir, f"{lora_basename_no_ext}.txt")
        if os.path.isfile(txt_filepath):
            with open(txt_filepath, 'r', encoding='utf-8') as f:
                txt_content = f.read()
        log_filepath = os.path.join(zml_dir, f"{lora_basename_no_ext}.log")
        if os.path.isfile(log_filepath):
            with open(log_filepath, 'r', encoding='utf-8') as f:
                log_content = f.read()
        help_content = "此节点用于解析LoRA模型文件，并从Civitai.com获取关联的元数据。\n1. 选择一个LoRA模型。\n2. 勾选需要保存的项目（图像、触发词、介绍）。\n3. 运行节点。\n4. 节点会自动计算文件哈希，访问Civitai API，并将获取到的文件保存到LoRA所在目录的 'zml' 子文件夹中。"
        return (preview_image_tensor, txt_content, log_content, parsed_info_str, help_content)

# --- ZML LoraLoader 节点 (已修正) ---
class ZmlLoraLoader:
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "模型": ("MODEL",),
                "CLIP": ("CLIP",),
                "lora_名称": (folder_paths.get_filename_list("loras"),),
                "模型_强度": ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01}),
                "CLIP_强度": ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01}),
            }
        }

    RETURN_TYPES = ("MODEL", "CLIP", "IMAGE", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("输出_模型", "输出_CLIP", "预览_图", "txt_内容", "log_内容", "help")
    FUNCTION = "zml_load_lora"
    CATEGORY = "图像/ZML_图像/lora加载器"

    def zml_load_lora(self, 模型, CLIP, lora_名称, 模型_强度, CLIP_强度):
        lora_path = folder_paths.get_full_path("loras", lora_名称)
        if lora_path:
            lora = comfy.utils.load_torch_file(lora_path, safe_load=True)
            model_out, clip_out = comfy.sd.load_lora_for_models(模型, CLIP, lora, 模型_强度, CLIP_强度)
        else:
            model_out, clip_out = (模型, CLIP)

        txt_content = ""
        log_content = ""
        help_content = "你好~\n加载lora的节点是基于ComfyUI-Custom-Scripts里的lora节点进行二次修改的，GitHub链接：https://github.com/pythongosssss/ComfyUI-Custom-Scripts。\n感谢作者的付出~\n在lora目录创建一个子文件夹‘zml’，里面放上和lora文件同名的图片、txt、log文件即可使用节点读取对应信息，选择lora时鼠标悬停可以预览图片，且会根据文件夹来分类lora文件。\n文件夹结构应该是这样的：lora/zml。lora里放着lora文件，比如111.safetensors，zml文件夹里放着111.png、111.txt、111.log。\n这真是一个伟大的创意，再次感谢原作者的付出。"
        preview_image_tensor = None
        
        lora_full_path = folder_paths.get_full_path("loras", lora_名称)
        if lora_full_path:
            lora_basename_no_ext = os.path.splitext(os.path.basename(lora_名称))[0]
            lora_dir = os.path.dirname(lora_full_path)
            
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

        if preview_image_tensor is None:
            preview_image_tensor = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
        
        return (model_out, clip_out, preview_image_tensor, txt_content, log_content, help_content)

# --- ZML 原始 LoraLoaderModelOnly 节点（保留） ---
class ZmlLoraLoaderModelOnly:
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "模型": ("MODEL",),
                "lora_名称": (folder_paths.get_filename_list("loras"),),
                "模型_强度": ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01}),
            }
        }

    RETURN_TYPES = ("MODEL", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("输出_模型", "txt_内容", "log_内容", "help")
    FUNCTION = "zml_load_lora_model_only"
    CATEGORY = "图像/ZML_图像/lora加载器"

    def zml_load_lora_model_only(self, 模型, lora_名称, 模型_强度):
        lora_path = folder_paths.get_full_path("loras", lora_名称)
        lora = comfy.utils.load_torch_file(lora_path, safe_load=True) if lora_path else None
        
        model_out, _ = comfy.sd.load_lora_for_models(模型, None, lora, 模型_强度, 0.0) 
        
        txt_content = ""
        log_content = ""
        help_content = "你好~\n加载lora的节点是基于ComfyUI-Custom-Scripts里的lora节点进行二次修改的，GitHub链接：https://github.com/pythongosssss/ComfyUI-Custom-Scripts。\n感谢作者的付出~\n在lora目录创建一个子文件夹‘zml’，里面放上和lora文件同名的图片、txt、log文件即可使用节点读取对应信息，选择lora时鼠标悬停可以预览图片，且会根据文件夹来分类lora文件。\n文件夹结构应该是这样的：lora/zml。lora里放着lora文件，比如111.safetensors，zml文件夹里放着111.png、111.txt、111.log。\n这真是一个伟大的创意，再次感谢原作者的付出。"
        
        lora_full_path = folder_paths.get_full_path("loras", lora_名称)
        if lora_full_path:
            lora_basename_no_ext = os.path.splitext(os.path.basename(lora_名称))[0]
            lora_dir = os.path.dirname(lora_full_path)
            
            txt_filepath = os.path.join(lora_dir, "zml", f"{lora_basename_no_ext}.txt")
            if os.path.isfile(txt_filepath):
                try:
                    with open(txt_filepath, 'r', encoding='utf-8') as f:
                        txt_content = f.read()
                except Exception as e:
                    print(f"ZmlLoraLoaderModelOnly: 读取txt文件时出错 {txt_filepath}: {e}")

            log_filepath = os.path.join(lora_dir, "zml", f"{lora_basename_no_ext}.log")
            if os.path.isfile(log_filepath):
                try:
                    with open(log_filepath, 'r', encoding='utf-8') as f:
                        log_content = f.read()
                except Exception as e:
                    print(f"ZmlLoraLoaderModelOnly: 读取log文件时出错 {log_filepath}: {e}")

        return (model_out, txt_content, log_content, help_content)

# --- ZML 原始 LoraLoaderFive 节点（保留） ---
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
            inputs["required"][f"lora_{i}_名称"] = (lora_list,) 
            inputs["required"][f"权重_{i}_强度"] = ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01}) 
        return inputs

    RETURN_TYPES = ("MODEL", "CLIP", "STRING")
    RETURN_NAMES = ("输出_模型", "输出_CLIP", "txt_内容")
    FUNCTION = "load_five_loras"
    CATEGORY = "图像/ZML_图像/lora加载器"

    def load_five_loras(self, 模型, CLIP=None, **kwargs):
        model_out = 模型
        clip_out = CLIP
        all_txt_content = []

        for i in range(1, 6):
            lora_name = kwargs.get(f"lora_{i}_名称") 
            weight = kwargs.get(f"权重_{i}_强度", 1.0) 

            if lora_name == "None" or lora_name is None:
                continue
            
            lora_path = folder_paths.get_full_path("loras", lora_name)
            if not lora_path:
                print(f"ZmlLoraLoaderFive: LoRA not found '{lora_name}'")
                continue

            try:
                lora = comfy.utils.load_torch_file(lora_path, safe_load=True)
                model_out, clip_out = comfy.sd.load_lora_for_models(model_out, clip_out, lora, weight, weight)

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

        final_txt_output = ", ".join(filter(None, all_txt_content))
        return (model_out, clip_out, final_txt_output)


# --- 抽象基类，用于处理分层逻辑 (保留) ---
class _LayeredLoraLoader(LoraLoader): 
    DEFAULT_WEIGHTS = ""
    LAYER_DESCRIPTION = "" # 将作为 hidden input 存在，同时用于 help output
    LAYER_OFFSET = 0 

    def __init__(self):
        super().__init__()

    @classmethod
    def INPUT_TYPES(s):
        inputs = {
            "required": {}, 
            "optional": {},
            "hidden": {}
        }
        
        inputs["optional"]["模型"] = ("MODEL",) 
        inputs["optional"]["CLIP"] = ("CLIP",)
        inputs["optional"]["lora_名称"] = (folder_paths.get_filename_list("loras"),)
        inputs["optional"]["模型_强度"] = ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01})
        inputs["optional"]["CLIP_强度"] = ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01})
        inputs["optional"]["层_规格"] = ("STRING", {"default": "", "multiline": False, "placeholder": "指定层，如2,5-7,9"})
        inputs["optional"]["层_权重"] = ("FLOAT", {"default": 0.0, "min": -5.0, "max": 5.0, "step": 0.1})
        inputs["optional"]["输入_权重_字符串"] = ("STRING", {"default": "", "multiline": False, "placeholder": "串联输入的权重字符串"})
        
        inputs["hidden"]["层_描述"] = ("STRING", {"default": s.LAYER_DESCRIPTION, "multiline": True, "editable": False})
        
        return inputs

    RETURN_TYPES = ("MODEL", "CLIP", "STRING", "STRING") 
    RETURN_NAMES = ("输出_模型", "输出_CLIP", "分层_权重", "help") 
    FUNCTION = "load_layered_lora"
    CATEGORY = "图像/ZML_图像/lora加载器" 

    def parse_layers(self, 层_规格: str) -> List[int]:
        layers = []
        parts = 层_规格.split(',')
        for part in parts:
            part = part.strip()
            if not part:
                continue
            if '-' in part:
                try:
                    start, end = map(int, part.split('-'))
                    layers.extend(range(start, end + 1))
                except ValueError:
                    pass
            else:
                try:
                    layers.append(int(part))
                except ValueError:
                    pass
        return layers

    def control_lora_weights_str(self, 层_规格: str, 层_权重: float, 输入_权重_字符串: str = "") -> str:
        current_weights = 输入_权重_字符串.strip() if 输入_权重_字符串.strip() else self.DEFAULT_WEIGHTS
        weights_list = current_weights.split(',')

        layers_to_adjust = self.parse_layers(层_规格)

        for layer in layers_to_adjust:
            index = layer - self.LAYER_OFFSET 
            
            if 0 <= index < len(weights_list):
                weight_str = f"{层_权重:.1f}" if 层_权重 % 1 != 0 else f"{int(层_权重)}"
                weights_list[index] = weight_str
        
        return ','.join(weights_list)

    def load_layered_lora(self, 模型=None, lora_名称=None, 模型_强度=1.0, 层_规格="", 层_权重=0.0, CLIP=None, CLIP_强度=1.0, 输入_权重_字符串=""):
        
        calculated_layered_weights_str = self.control_lora_weights_str(层_规格, 层_权重, 输入_权重_字符串)
        
        lora_full_path = None
        lora = None

        if lora_名称:
            lora_full_path = folder_paths.get_full_path("loras", lora_名称)
            lora = comfy.utils.load_torch_file(lora_full_path, safe_load=True) if lora_full_path else None

        try:
            lora_stack_weights = [float(w) for w in calculated_layered_weights_str.split(',')]
        except ValueError:
            print(f"警告: 分层权重字符串 '{calculated_layered_weights_str}' 格式不正确，将使用默认权重。")
            lora_stack_weights = None 
        
        model_out = 模型
        clip_out = CLIP
        if 模型 is not None and lora is not None:
            model_out, clip_out = comfy.sd.load_lora_for_models(
                model=模型, 
                clip=CLIP, 
                lora=lora, 
                strength_model=模型_强度, 
                strength_clip=CLIP_强度,
                lora_stack_weights=lora_stack_weights 
            )
        else:
            if 模型 is None:
                print(f"警告: {self.__class__.__name__} 未提供模型输入，LoRA未加载。")
            if lora_名称 and lora is None:
                print(f"警告: {self.__class__.__name__} 找不到LoRA文件 '{lora_名称}'，LoRA未加载。")

        help_info = self.LAYER_DESCRIPTION

        return (model_out, clip_out, calculated_layered_weights_str, help_info)


# --- SDXL 分层控制 LoRA 加载器 (保留) ---
class ZML_SDXLLayeredLoraLoader(_LayeredLoraLoader):
    DEFAULT_WEIGHTS = "1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1"
    LAYER_DESCRIPTION = (
        "SDXL LoRA 分层控制器说明：\n"
        "层1：BASE(基础层)，数值1代表权重开启，LoRA 权重生效\n"
        "层2-7：IN(输入层)，共6层，控制服装局部细节、姿态等输入特征\n"
        "层8：MID(中间层)，控制姿态、细节等中间特征融合\n"
        "层9-17：OUT(输出层)，共9层，控制背景、色彩、服装细节等输出效果\n"
        "可指定层（如 2,5-7,9 ）调整权重，范围 -5 到 5 ，支持串联组合控制"
    )
    LAYER_OFFSET = 1 

    @classmethod
    def INPUT_TYPES(s):
        inputs = super().INPUT_TYPES()
        
        inputs["optional"]["模型"] = ("MODEL",) 
        inputs["optional"]["CLIP"] = ("CLIP",)
        inputs["optional"]["CLIP_强度"] = ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01}) 
        
        s.RETURN_TYPES = ("MODEL", "CLIP", "STRING", "STRING") 
        s.RETURN_NAMES = ("输出_模型", "输出_CLIP", "分层_权重", "help")

        return inputs
    
# --- Flux 分层控制 LoRA 加载器 (保留) ---
class ZML_FluxLayeredLoraLoader(_LayeredLoraLoader):
    DEFAULT_WEIGHTS = "1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1" # 58个 '1'
    
    LAYER_DESCRIPTION = (
        "Flux LoRA 分层控制器说明：\n"
        "层号范围对应模块功能描述\n"
        "0：CLIP文本编码器\n"
        "1：T5增强文本编码\n"
        "2：IN输入层\n"
        "3-21：D000-D018 (19层) 核心扩散过程\n"
        "22-59：S000-S037 (38层) 风格控制层\n"
        "60：OUT输出层\n"
        "可指定层（如 7,10-12,17 ）调整权重，范围 -5 到 5 ，支持串联组合控制"
    )
    LAYER_OFFSET = 3 

    @classmethod
    def INPUT_TYPES(s):
        inputs = super().INPUT_TYPES()
        
        inputs["optional"]["模型"] = ("MODEL",)
        
        if "CLIP" in inputs["optional"]:
            del inputs["optional"]["CLIP"]
        if "CLIP_强度" in inputs["optional"]:
            del inputs["optional"]["CLIP_强度"]

        s.RETURN_TYPES = ("MODEL", "CLIP", "STRING", "STRING") 
        s.RETURN_NAMES = ("输出_模型", "输出_CLIP", "分层_权重", "help")

        return inputs
    
# 注册节点
NODE_CLASS_MAPPINGS = {
    "ZmlLoraLoader": ZmlLoraLoader,
    "ZmlLoraLoaderModelOnly": ZmlLoraLoaderModelOnly,
    "ZmlLoraLoaderFive": ZmlLoraLoaderFive,
    "ZmlLoraMetadataParser": ZmlLoraMetadataParser,
    "ZML_SDXLLayeredLoraLoader": ZML_SDXLLayeredLoraLoader, 
    "ZML_FluxLayeredLoraLoader": ZML_FluxLayeredLoraLoader,   
}

# 节点显示名称映射
NODE_DISPLAY_NAME_MAPPINGS = {
    "ZmlLoraLoader": "ZML_LoRA加载器",
    "ZmlLoraLoaderModelOnly": "ZML_LoRA加载器（仅模型）",
    "ZmlLoraLoaderFive": "ZML_LoRA加载器_五",
    "ZmlLoraMetadataParser": "ZML_解析LoRA元数据",
    "ZML_SDXLLayeredLoraLoader": "ZML_SDXL分层控制LoRA", 
    "ZML_FluxLayeredLoraLoader": "ZML_FLUX分层控制LoRA",   
}