import os
import shutil
import server
import folder_paths
import comfy.utils
import comfy.sd
from aiohttp import web
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
import copy

try:
    from nunchaku.lora.flux import to_diffusers
except ImportError:
    print("警告: 无法导入 nunchaku.lora.flux.to_diffusers。ZML_名称加载lora(nunchaku) 节点将无法使用，请确保 nunchaku 库已安装（不使用nunchaku的用户可忽略）。")
    def to_diffusers(path): # 提供一个临时的替代函数以避免崩溃
        print(f"警告: to_diffusers 功能缺失，无法解析 {path}")
        return {}

ZML_API_PREFIX = "/zml/lora"

# 用一个元组来表示数据结构，尽管它内部还是字符串，但这向节点图表示了更复杂的数据。
ZML_LORA_STACK_TYPE = ( "LORA_STACK", ) # 使用元组来定义一个自定义类型名

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
    # 按照ComfyUI官方哈希计算方法
    # https://github.com/comfyanonymous/ComfyUI/blob/master/server.py#L93
    # 官方使用分块读取，这里也采用分块读取
    chunk_size = 4096
    with open(filepath, 'rb') as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            sha256.update(chunk)
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
                        data['model'] = {} # No model info if that request fails
                return data
            else:
                print(f"[ZML_Parser] Civitai API请求失败: 状态码 {response.status} (Hash: {hash_string})")
    except urllib.error.HTTPError as e:
        print(f"[ZML_Parser] Civitai API请求失败: {e} (Hash: {hash_string})")
    except Exception as e:
        print(f"[ZML_Parser] 解析Civitai数据时出错: {e}")
    return None

def download_file(url, destination_path):
    """下载文件到指定路径，如果是视频则同时保存第一帧和视频本身"""
    import cv2
    import os
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'}
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req) as response:
            if response.status == 200:
                # 获取文件类型
                content_type = response.getheader('Content-Type', '')
                is_video = content_type.startswith('video/') or url.lower().endswith(('.mp4', '.avi', '.mov', '.mkv'))
                
                # 如果是视频，提取第一帧并保存视频
                if is_video:
                    # 先保存视频文件
                    video_ext = os.path.splitext(url)[1].lower()
                    if not video_ext in ['.mp4', '.avi', '.mov', '.mkv']:
                        video_ext = '.mp4'  # 默认使用mp4格式
                    video_path = os.path.splitext(destination_path)[0] + video_ext
                    
                    with open(video_path, 'wb') as out_file:
                        shutil.copyfileobj(response, out_file)
                    
                    # 使用OpenCV提取第一帧
                    cap = cv2.VideoCapture(video_path)
                    if cap.isOpened():
                        ret, frame = cap.read()
                        if ret:
                            # 确保目标路径是图片格式
                            img_ext = os.path.splitext(destination_path)[1].lower()
                            if img_ext not in ['.png', '.jpg', '.jpeg', '.webp']:
                                destination_path = os.path.splitext(destination_path)[0] + '.jpg'
                            
                            # 保存第一帧为图片
                            cv2.imwrite(destination_path, frame)
                        else:
                            print(f"[ZML_Parser] 无法读取视频帧: {video_path}")
                            return False
                        cap.release()
                    else:
                        print(f"[ZML_Parser] 无法打开视频文件: {video_path}")
                        return False
                    
                    return True
                else:
                    # 非视频文件，直接保存
                    with open(destination_path, 'wb') as out_file:
                        shutil.copyfileobj(response, out_file)
                    return True
            else:
                print(f"[ZML_Parser] 下载文件前 Civitai 响应状态码不为200: {response.status} (URL: {url})")
    except Exception as e:
        print(f"[ZML_Parser] 下载文件时出错 {url}: {e}")
    return False

# --- API 路由 ---
@server.PromptServer.instance.routes.get(ZML_API_PREFIX + "/view/{name:.*}")
async def view_lora_preview(request):
    """
    接收来自前端的预览图请求，如 /zml/lora/view/loras/subdir/image.png
    """
    name = request.match_info["name"] # name will be like "loras/subdir/image.png"
    pos = name.find("/")
    file_type_str = name[0:pos] # "loras"
    relative_path_within_type = name[pos+1:] # "subdir/image.png"
    
    # 从请求的路径中提取LoRA的“基础文件名”，不带路径和扩展名 (e.g. "image")
    lora_basename_no_ext = os.path.splitext(os.path.basename(relative_path_within_type))[0]
    
    # 尝试在所有ComfyUI的loras路径中找到原始LoRA文件（.safetensors, .ckpt等）的绝对路径
    found_lora_full_path = None
    # 从传递的"subdir/image.png"中获取LoRA文件所在的逻辑目录，例如"subdir"
    lora_logic_dir = os.path.dirname(relative_path_within_type)
    
    for ext in [".safetensors", ".pt", ".bin", ".ckpt"]: # 遍历可能的LoRA文件扩展名
        # 构造原始LoRA的相对路径: "subdir/lora_basename_no_ext.ext"
        possible_lora_relative_filename = os.path.join(lora_logic_dir, f"{lora_basename_no_ext}{ext}")
        found_lora_full_path = folder_paths.get_full_path("loras", possible_lora_relative_filename)
        if found_lora_full_path and os.path.exists(found_lora_full_path):
            break

    if not found_lora_full_path:
        return web.Response(status=404, text=f"相关LoRA文件未找到. (Requested path: {relative_path_within_type})")

    # 根据找到的LoRA文件的绝对路径，构建其对应的zml预览图的绝对路径
    actual_lora_dir = os.path.dirname(found_lora_full_path)
    # 请求的预览图文件名，包含扩展名 (e.g., "image.png")
    preview_filename_with_ext = os.path.basename(relative_path_within_type) 
    target_path = os.path.join(actual_lora_dir, "zml", preview_filename_with_ext) # 构建zml预览图的绝对路径

    if os.path.isfile(target_path):
        return web.FileResponse(target_path, headers={"Content-Disposition": f"filename=\"{os.path.basename(target_path)}\""})

    return web.Response(status=404, text=f"预览图未找到: {target_path}")


@server.PromptServer.instance.routes.post(ZML_API_PREFIX + "/save/{name:.*}")
async def save_preview(request):
    """
    保存用户生成的图像作为LoRA的预览图。
    name参数示例: "loras/subdir/mylora.safetensors"
    """
    name = request.match_info["name"] # 例如 "loras/subdir/mylora.safetensors"
    # file_type_str = name[0:name.find("/")] # "loras"
    lora_relative_path = name[name.find("/")+1:] # "subdir/mylora.safetensors"
    body = await request.json()

    source_dir = folder_paths.get_directory_by_type(body.get("type", "output"))
    source_subfolder = body.get("subfolder", "")
    source_filepath = os.path.join(source_dir, os.path.normpath(source_subfolder), body.get("filename", ""))

    if os.path.commonpath((source_dir, os.path.abspath(source_filepath))) != source_dir:
        return web.Response(status=400, text="源文件路径不合法")

    lora_root_dir = find_lora_root_path_for_file(lora_relative_path)
    if not lora_root_dir:
         lora_root_dir = folder_paths.get_folder_paths("loras")[0] if folder_paths.get_folder_paths("loras") else None
         if not lora_root_dir:
             return web.Response(status=500, text="无法确定LoRA根目录来保存预览图。")

    zml_dir = os.path.join(lora_root_dir, "zml")
    lora_path_no_ext = os.path.splitext(lora_relative_path)[0]
    source_ext = os.path.splitext(source_filepath)[1]
    destination_path = os.path.join(zml_dir, f"{lora_path_no_ext}{source_ext}")
    os.makedirs(os.path.dirname(destination_path), exist_ok=True)
    shutil.copyfile(source_filepath, destination_path)

    # 返回给前端的图片路径应是其在LoRA根目录下的相对路径，不包含“zml/”，因为/view API会处理
    # 例如：`subdir/mylora.png`
    lora_dir_relative_path = os.path.dirname(lora_relative_path)
    saved_image_basename = os.path.basename(destination_path) # e.g. "mylora.png"
    final_relative_image_path_for_frontend = os.path.join(lora_dir_relative_path, saved_image_basename).replace("\\", "/")

    return web.json_response({"image": final_relative_image_path_for_frontend})


@server.PromptServer.instance.routes.get(ZML_API_PREFIX + "/images/{type}")
async def get_images(request):
    """
    获取所有LoRA文件及其对应的预览图的映射。
    """
    file_type_str = request.match_info["type"]
    if file_type_str != "loras":
        return web.json_response({})
        
    lora_files = folder_paths.get_filename_list(file_type_str)
    images = {}
    
    for lora_filename in lora_files: # lora_filename is like "subdir/mylora.safetensors"
        lora_full_path = folder_paths.get_full_path("loras", lora_filename)
        if not lora_full_path:
            continue

        lora_dir = os.path.dirname(lora_full_path)
        zml_dir = os.path.join(lora_dir, "zml")
        if not os.path.isdir(zml_dir):
            continue
            
        lora_basename_no_ext = os.path.splitext(os.path.basename(lora_filename))[0]
        # Look for existing preview images in zml subfolder (e.g., lora_dir/zml/mylora.png)
        for ext in [".png", ".jpg", ".jpeg", ".webp"]:
            preview_path_abs = os.path.join(zml_dir, f"{lora_basename_no_ext}{ext}")
            if os.path.isfile(preview_path_abs):
                lora_dir_relative = os.path.dirname(lora_filename) # e.g. "subdir"
                preview_basename = os.path.basename(preview_path_abs) # e.g. "mylora.png"
                relative_path_for_frontend = os.path.join(lora_dir_relative, preview_basename).replace("\\", "/")
                images[lora_filename] = relative_path_for_frontend
                break
        
    return web.json_response(images)

@server.PromptServer.instance.routes.post(ZML_API_PREFIX + "/get_lora_file")
async def get_lora_file(request):
    """
    获取指定LoRA文件的内容
    期望接收 JSON body: {"lora_filename": "relative/path/to/lora.safetensors", "file_type": "txt|log"}
    返回 JSON body: {"status": "success", "content": "文件内容"} 或 {"status": "error", "message": "错误信息"}
    """
    try:
        body = await request.json()
        lora_relative_filename = body.get("lora_filename")
        file_type = body.get("file_type", "txt")

        if not lora_relative_filename:
            return web.json_response({"status": "error", "message": "缺少 'lora_filename' 参数"}, status=400)

        lora_full_path = folder_paths.get_full_path("loras", lora_relative_filename)
        if not lora_full_path or not os.path.exists(lora_full_path):
            return web.json_response({"status": "error", "message": f"LoRA文件未找到: {lora_relative_filename}"}, status=404)

        lora_dir = os.path.dirname(lora_full_path)
        lora_basename_no_ext = os.path.splitext(os.path.basename(lora_relative_filename))[0]
        zml_dir = os.path.join(lora_dir, "zml")
        file_ext = ".txt" if file_type == "txt" else ".log"
        file_path = os.path.join(zml_dir, f"{lora_basename_no_ext}{file_ext}")

        if not os.path.exists(file_path):
            # 如果文件不存在，返回空内容
            return web.json_response({"status": "success", "content": ""})

        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        return web.json_response({"status": "success", "content": content})

    except Exception as e:
        print(f"[ZML_Parser] 处理获取LoRA文件请求时出错: {e}")
        return web.json_response({"status": "error", "message": f"服务器内部错误: {e}"}, status=500)


@server.PromptServer.instance.routes.post(ZML_API_PREFIX + "/save_lora_file")
async def save_lora_file(request):
    """
    保存指定LoRA文件的内容
    期望接收 JSON body: {"lora_filename": "relative/path/to/lora.safetensors", "file_type": "txt|log", "content": "文件内容"}
    返回 JSON body: {"status": "success", "message": "保存成功"} 或 {"status": "error", "message": "错误信息"}
    """
    try:
        body = await request.json()
        lora_relative_filename = body.get("lora_filename")
        file_type = body.get("file_type", "txt")
        content = body.get("content", "")

        if not lora_relative_filename:
            return web.json_response({"status": "error", "message": "缺少 'lora_filename' 参数"}, status=400)

        lora_full_path = folder_paths.get_full_path("loras", lora_relative_filename)
        if not lora_full_path or not os.path.exists(lora_full_path):
            return web.json_response({"status": "error", "message": f"LoRA文件未找到: {lora_relative_filename}"}, status=404)

        lora_dir = os.path.dirname(lora_full_path)
        lora_basename_no_ext = os.path.splitext(os.path.basename(lora_relative_filename))[0]
        zml_dir = os.path.join(lora_dir, "zml")
        os.makedirs(zml_dir, exist_ok=True)

        file_ext = ".txt" if file_type == "txt" else ".log"
        file_path = os.path.join(zml_dir, f"{lora_basename_no_ext}{file_ext}")

        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)

        return web.json_response({"status": "success", "message": f"{file_type}文件保存成功"})

    except Exception as e:
        print(f"[ZML_Parser] 处理保存LoRA文件请求时出错: {e}")
        return web.json_response({"status": "error", "message": f"服务器内部错误: {e}"}, status=500)


@server.PromptServer.instance.routes.post(ZML_API_PREFIX + "/fetch_civitai_metadata")
async def fetch_civitai_metadata_api(request): # 重命名函数以避免与内部辅助函数fetch_civitai_data_by_hash混淆
    """
    通过Civitai API为指定的LoRA文件获取并保存元数据和预览图。
    期望接收 JSON body: {"lora_filename": "relative/path/to/lora.safetensors"}
    返回 JSON body: {"status": "success", "message": "...", "image_path_updated": "..."}
    """
    try:
        body = await request.json()
        lora_relative_filename = body.get("lora_filename") # 例如 "subdir/mylora.safetensors"
        
        if not lora_relative_filename:
            return web.json_response({"status": "error", "message": "缺少 'lora_filename' 参数"}, status=400)

        lora_full_path = folder_paths.get_full_path("loras", lora_relative_filename)
        if not lora_full_path or not os.path.exists(lora_full_path):
            return web.json_response({"status": "error", "message": f"LoRA文件未找到: {lora_relative_filename}"}, status=404)

        lora_dir = os.path.dirname(lora_full_path)
        lora_basename_no_ext = os.path.splitext(os.path.basename(lora_relative_filename))[0]
        zml_dir = os.path.join(lora_dir, "zml")
        os.makedirs(zml_dir, exist_ok=True)
        
        lora_hash = calculate_sha256(lora_full_path)
        civitai_data = fetch_civitai_data_by_hash(lora_hash) # 调用辅助函数
        
        downloaded_image_path = None
        message_parts = []

        if civitai_data:
            message_parts.append(f"已从Civitai获取到 '{civitai_data.get('model', {}).get('name', 'N/A')}' 的信息。")
            
            # --- 保存首张图像 ---
            if civitai_data.get('images'):
                first_image = civitai_data['images'][0]
                img_url = first_image.get('url')
                img_ext = os.path.splitext(urllib.parse.urlparse(img_url).path)[1]
                if not img_ext or not img_ext.lower() in ['.png', '.jpg', '.jpeg', '.webp']:
                    img_ext = '.jpg' # Fallback to JPG
                img_dest_path = os.path.join(zml_dir, f"{lora_basename_no_ext}{img_ext}")
                if download_file(img_url, img_dest_path):
                    # 返回的路径应是其在LoRA根目录下的相对路径，不包含“zml/”
                    downloaded_image_path = os.path.join(os.path.dirname(lora_relative_filename), os.path.basename(img_dest_path)).replace("\\", "/")
                    message_parts.append("预览图已下载。")
                else:
                    message_parts.append("预览图下载失败。")
            else:
                message_parts.append("Civitai上没有找到预览图。")

            # --- 保存触发词为txt ---
            if civitai_data.get('trainedWords'):
                words_content = ", ".join(civitai_data['trainedWords'])
                txt_dest_path = os.path.join(zml_dir, f"{lora_basename_no_ext}.txt")
                try:
                    with open(txt_dest_path, 'w', encoding='utf-8') as f:
                        f.write(words_content)
                    message_parts.append("触发词已保存。")
                except Exception as e:
                    print(f"[ZML_Parser] 保存触发词时出错: {e}")
                    message_parts.append("触发词保存失败。")
            else:
                message_parts.append("Civitai上没有找到触发词。")
            
            # --- 保存介绍为log ---
            raw_model_desc = civitai_data.get('model', {}).get('description', '')
            raw_version_desc = civitai_data.get('description', '')
            model_desc = clean_html(raw_model_desc)
            version_desc = clean_html(raw_version_desc)
            base_model = civitai_data.get('baseModel', 'N/A')
            model_id = civitai_data.get('modelId')
            version_id = civitai_data.get('id')
            civitai_link = f"https://civitai.com/models/{model_id}?modelVersionId={version_id}" if model_id and version_id else "链接不可用"

            log_content = (
                f"--- 基础信息 ---\n"
                f"基础模型: {base_model}\n"
                f"C站链接: {civitai_link}\n\n"
                f"--- 模型介绍 ---\n\n{model_desc if model_desc else '无模型介绍。'}\n\n"
                f"--- 版本信息 ---\n\n{version_desc if version_desc else '无版本信息。'}\n"
            )
            log_dest_path = os.path.join(zml_dir, f"{lora_basename_no_ext}.log")
            try:
                with open(log_dest_path, 'w', encoding='utf-8') as f:
                    f.write(log_content)
                message_parts.append("介绍已保存。")
            except Exception as e:
                print(f"[ZML_Parser] 保存介绍时出错: {e}")
                message_parts.append("介绍保存失败。")
        else:
            message_parts.append("无法从Civitai获取此LoRA的信息（可能未上传或哈希不匹配）。")
            
        return web.json_response({
            "status": "success", 
            "message": "\n".join(message_parts), 
            "image_path_updated": downloaded_image_path
        })

    except Exception as e:
        print(f"[ZML_Parser] 处理Civitai元数据请求时出错: {e}")
        return web.json_response({"status": "error", "message": f"服务器内部错误: {e}"}, status=500)


@server.PromptServer.instance.routes.post(ZML_API_PREFIX + "/delete_lora_file")
async def delete_lora_file(request):
    """
    删除指定的LoRA文件及其相关的所有文件（txt、log、图像等）
    期望接收 JSON body: {"lora_filename": "relative/path/to/lora.safetensors"}
    返回 JSON body: {"status": "success", "message": "删除成功"} 或 {"status": "error", "message": "错误信息"}
    """
    import os
    import glob
    
    try:
        body = await request.json()
        lora_relative_filename = body.get("lora_filename")

        if not lora_relative_filename:
            return web.json_response({"status": "error", "message": "缺少 'lora_filename' 参数"}, status=400)

        lora_full_path = folder_paths.get_full_path("loras", lora_relative_filename)
        if not lora_full_path or not os.path.exists(lora_full_path):
            return web.json_response({"status": "error", "message": f"LoRA文件未找到: {lora_relative_filename}"}, status=404)

        lora_dir = os.path.dirname(lora_full_path)
        lora_basename_no_ext = os.path.splitext(os.path.basename(lora_relative_filename))[0]
        zml_dir = os.path.join(lora_dir, "zml")

        # 记录要删除的文件
        files_to_delete = [lora_full_path]
        deleted_files = []
        
        # 删除主LoRA文件
        if os.path.exists(lora_full_path):
            try:
                os.remove(lora_full_path)
                deleted_files.append(os.path.basename(lora_full_path))
            except Exception as e:
                return web.json_response({"status": "error", "message": f"无法删除主LoRA文件: {e}"}, status=500)
        
        # 删除zml目录下的相关文件
        if os.path.exists(zml_dir):
            # 查找所有以lora_basename_no_ext开头的文件
            pattern = os.path.join(zml_dir, f"{lora_basename_no_ext}.*")
            zml_files = glob.glob(pattern)
            
            for zml_file in zml_files:
                try:
                    os.remove(zml_file)
                    deleted_files.append(os.path.basename(zml_file))
                except Exception as e:
                    print(f"[ZML_Parser] 删除文件时出错 {zml_file}: {e}")
        
        # 如果zml目录为空，则删除它
        if os.path.exists(zml_dir) and not os.listdir(zml_dir):
            try:
                os.rmdir(zml_dir)
            except Exception as e:
                print(f"[ZML_Parser] 删除空zml目录时出错: {e}")
        
        return web.json_response({
            "status": "success", 
            "message": f"成功删除 {len(deleted_files)} 个文件",
            "deleted_files": deleted_files
        })

    except Exception as e:
        print(f"[ZML_Parser] 处理删除LoRA文件请求时出错: {e}")
        return web.json_response({"status": "error", "message": f"服务器内部错误: {e}"}, status=500)

# --- 解析LoRA元数据节点 ---
class ZmlLoraMetadataParser:
    def __init__(self):
        pass
    
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "lora_名称": (folder_paths.get_filename_list("loras"),),
            },
            "optional": {
                "保存首张图像": ("BOOLEAN", {"default": False}),
                "保存触发词为txt": ("BOOLEAN", {"default": False}),
                "保存介绍为log": ("BOOLEAN", {"default": False}),
            }
        }
    
    RETURN_TYPES = ("IMAGE", "STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("图像", "txt", "log", "解析", "help")
    FUNCTION = "parse_and_save_metadata"
    CATEGORY = "图像/ZML_图像/lora加载器"
    COLOR = "#446699" # 一个更柔和的蓝色
    
    def parse_and_save_metadata(self, lora_名称, 保存首张图像=False, 保存触发词为txt=False, 保存介绍为log=False):
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
                    if download_file(img_url, img_dest_path):
                        parsed_info_str += "预览图已下载。\n"
                    else:
                        parsed_info_str += "预览图下载失败。\n"
                
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
            parsed_info_str += "未执行任何保存操作。\n请开启至少一个保存选项后重新运行。"

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

# --- ZML 原始 LoraLoaderModelOnly 节点 ---
class ZmlLoraLoaderModelOnly:
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "lora_名称": (["None"] + folder_paths.get_filename_list("loras"),),
            },
            "optional": {
                "模型": ("MODEL",),
                "模型_强度": ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01}),
            }
        }

    RETURN_TYPES = ("MODEL",)
    RETURN_NAMES = ("输出_模型",)
    FUNCTION = "zml_load_lora_model_only"
    CATEGORY = "图像/ZML_图像/lora加载器"
    COLOR = "#446699" # 一个更柔和的蓝色


    def zml_load_lora_model_only(self, lora_名称, 模型=None, 模型_强度=1.0):
        model_out = 模型
        
        if 模型 is not None and lora_名称 != "None":
            lora_path = folder_paths.get_full_path("loras", lora_名称)
            lora = comfy.utils.load_torch_file(lora_path, safe_load=True) if lora_path else None
            model_out, _ = comfy.sd.load_lora_for_models(模型, None, lora, 模型_强度, 0.0) 

        return (model_out,)

# --- ZML 原始 LoraLoaderFive 节点 ---
class ZmlLoraLoaderFive:
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        lora_list = ["None"] + folder_paths.get_filename_list("loras")
        inputs = {
            "required": {},
            "optional": {
                "模型": ("MODEL",),
                "CLIP": ("CLIP",),
            }
        }
        for i in range(1, 6):
            inputs["optional"][f"lora_{i}_名称"] = (lora_list,) 
            inputs["optional"][f"权重_{i}_强度"] = ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01}) 
        return inputs

    RETURN_TYPES = ("MODEL", "CLIP", "STRING")
    RETURN_NAMES = ("输出_模型", "输出_CLIP", "txt_内容")
    FUNCTION = "load_five_loras"
    CATEGORY = "图像/ZML_图像/lora加载器"
    COLOR = "#446699" # 一个更柔和的蓝色

    def load_five_loras(self, 模型=None, CLIP=None, **kwargs):
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


# 强力 Lora 加载器节点 (ZmlPowerLoraLoader)
class ZmlPowerLoraLoader:
    """
    ZML 强力LoRA加载器节点。
    允许用户通过自定义UI动态添加、删除和配置多个LoRA。
    现在增加输出一个已启用LoRA的名称和权重的列表。
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        lora_list = ["None"] + folder_paths.get_filename_list("loras")
        
        return {
            "required": {
                # "model": ("MODEL",), # 模型接口已移除必填
            },
            "optional": { # 模型和CLIP都变为可选
                "model": ("MODEL",), # 模型接口变为可选
                "clip": ("CLIP",), 
            },
            "hidden": {
                "lora_loader_data": ("STRING", {"default": "{}"}),
                "lora_names_hidden": (lora_list, ), # 用于提供给前端下拉列表
            },
        }

    # OUTPUT_IS_LIST 决定了 RETURN_TYPES 中的每个项目是否是一个列表。
    # 对于 `lora名称列表` (ZML_LORA_STACK_TYPE)，它本身就是一个列表（字典的列表），
    # 所以在这个层面上它不是一个“列表的列表”，所以对应的布尔值是 False。
    # 图像输出仍然是列表 (OUTPUT_IS_LIST 的第三个元素，索引为2)。
    OUTPUT_IS_LIST = (False, False, False, True, False, False) # 新增的 lora名称列表 也不是列表输出，因为它自己就是一个列表对象 (字典列表)。
    
    RETURN_TYPES = ("MODEL", "CLIP", "STRING", "IMAGE", "STRING", "STRING") # 增加 ZML_LORA_STACK_TYPE 类型
    RETURN_NAMES = ("MODEL", "CLIP", "lora名称列表", "预览_图", "触发词", "自定义文本") # 增加 "lora名称列表" 的名称
    FUNCTION = "load_loras"
    CATEGORY = "图像/ZML_图像/lora加载器"
    COLOR = "#446699" # 一个更柔和的蓝色


    def load_loras(self, lora_loader_data, model=None, clip=None, lora_names_hidden=None):
        try:
            data = json.loads(lora_loader_data)
            entries = data.get("entries", [])
        except (json.JSONDecodeError, TypeError):
            # 如果JSON解析失败，返回占位图列表避免下游节点报错
            # 同时确保 lora名称列表 返回空列表
            return (model, clip, [], [torch.zeros((1, 64, 64, 3), dtype=torch.float32)], "", "") 

        current_model = model
        current_clip = clip
        
        output_images = [] # 存储收集到的所有真实预览图
        temp_txts = [] 
        output_custom_texts = [] 
        loaded_lora_names_and_weights = [] # 存储已启用LoRA的名称和权重

        # 判断是否应尝试应用LoRA权重 (只要有一个输入是有效的，就尝试应用)
        should_attempt_apply_lora_weights = (current_model is not None) or (current_clip is not None)

        for entry in entries:
            # 过滤掉文件夹条目，只处理lora条目
            if entry.get("item_type") != "lora":
                continue

            is_enabled = entry.get("enabled", False)
            lora_name = entry.get("lora_name")
            
            # 只有当此 LoRA 条目被“启用” (即左侧的启用勾选框选中) 且其“自定义文本”字段不为空时，
            # 才收集其自定义文本。这与 LoRA 本身是否被成功加载或应用于模型/CLIP无关。
            custom_text_content = entry.get("custom_text", "").strip()
            if is_enabled and custom_text_content: 
                output_custom_texts.append(custom_text_content)

            # 仅在条目启用且选定了 LoRA 名称时处理
            if is_enabled and lora_name and lora_name != "None":
                lora_path = folder_paths.get_full_path("loras", lora_name)
                
                if not lora_path or not os.path.exists(lora_path): # 确保文件存在
                    # print(f"ZML_PowerLoraLoader: 警告: LoRA文件 '{lora_name}' 未找到或不存在，跳过处理。", file=sys.stderr) # 打印到stderr
                    continue
                
                try:
                    lora = comfy.utils.load_torch_file(lora_path, safe_load=True)
                    
                    weight = float(entry.get("weight", 1.0)) # 获取当前LoRA的权重
                    
                    # 收集已启用的LoRA名称和权重，无论模型是否为None
                    loaded_lora_names_and_weights.append({"lora_name": lora_name, "weight": weight})

                    # 只有当 `should_attempt_apply_lora_weights` 为 True 时，才尝试应用 LoRA 权重
                    if should_attempt_apply_lora_weights:
                        current_model, current_clip = comfy.sd.load_lora_for_models(
                            current_model, 
                            current_clip, 
                            lora, 
                            weight, 
                            weight
                        )
                    # else:
                        # print(f"ZML_PowerLoraLoader: 模型或CLIP未提供，跳过 '{lora_name}' 的权重应用。")


                    # 尝试收集 LoRA 预览图
                    found_image_tensor = None # 为每个 LoRA 重置
                    lora_basename_no_ext = os.path.splitext(os.path.basename(lora_name))[0]
                    lora_dir = os.path.dirname(lora_path)
                    zml_dir = os.path.join(lora_dir, "zml")
                    
                    for ext in ['.png', '.jpg', '.jpeg', '.webp']:
                        # Corrected path construction for preview_path (absolute path)
                        preview_path = os.path.join(zml_dir, f"{lora_basename_no_ext}{ext}")
                        if os.path.isfile(preview_path):
                            try:
                                img = Image.open(preview_path).convert("RGB")
                                img_array = np.array(img).astype(np.float32) / 255.0
                                found_image_tensor = torch.from_numpy(img_array).unsqueeze(0)
                                break
                            except Exception as e:
                                # 文件损坏或读取出错的错误信息保留（因为它实际的异常）
                                print(f"ZML_PowerLoraLoader: 读取预览图 '{preview_path}' 时出错: {e}")
                    
                    # 只有找到实际的预览图，才将其添加到 output_images 列表中
                    if found_image_tensor is not None:
                        output_images.append(found_image_tensor)
                    
                    # 尝试收集 LoRA 触发词 (txt 文件)
                    txt_filepath = os.path.join(zml_dir, f"{lora_basename_no_ext}.txt")
                    if os.path.isfile(txt_filepath):
                        try:
                            with open(txt_filepath, 'r', encoding='utf-8') as f:
                                content = f.read().strip()
                                if content: 
                                    temp_txts.append(content)
                        except Exception as e:
                            # 文件损坏或读取出错的错误信息保留（因为它实际的异常）
                            print(f"ZML_PowerLoraLoader: 读取txt文件 '{txt_filepath}' 时出错: {e}")
                    
                except Exception as e:
                    # 任何其他 LoRA 处理中的意外错误也保留
                    print(f"ZML_PowerLoraLoader: 处理 LoRA '{lora_name}' 时发生意外错误: {e}")
        
        final_txt_output = ", ".join(temp_txts)
        final_custom_text_output = ", ".join(output_custom_texts) 

        # --- 解决 IndexError 的核心逻辑：只有当 output_images 列表最终为空时才添加一个占位图 ---
        if not output_images: # 如果在处理完所有 LoRA 后，output_images 列表仍然是空的
            # 添加一个黑色占位图像，确保列表不为空，避免下游节点报错
            output_images.append(torch.zeros((1, 1, 1, 3), dtype=torch.float32))
        # --------------------------------------------------------------------------------------

        # 将loaded_lora_names_and_weights列表转换为JSON字符串
        loaded_lora_names_and_weights_str = json.dumps(loaded_lora_names_and_weights, ensure_ascii=False)

        # 返回所有输出
        return (current_model, current_clip, loaded_lora_names_and_weights_str, output_images, final_txt_output, final_custom_text_output)


# --- 新增节点：ZML_名称加载lora ---
class ZmlNameLoraLoader:
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "模型": ("MODEL",),
                "CLIP": ("CLIP",),
                "LoRA名称列表": ("STRING", {"forceInput": True}), 
            }
        }

    RETURN_TYPES = ("MODEL", "CLIP")
    RETURN_NAMES = ("输出_模型", "输出_CLIP")
    FUNCTION = "load_named_loras"
    CATEGORY = "图像/ZML_图像/lora加载器"
    COLOR = "#446699" # 一个更柔和的蓝色
    
    def load_named_loras(self, 模型, CLIP, LoRA名称列表):
        current_model = 模型
        current_clip = CLIP

        # 尝试解析输入的字符串为JSON列表
        try:
            lora_list = json.loads(LoRA名称列表)
            if not isinstance(lora_list, list):
                print(f"ZML_名称加载lora: 'lora名称列表' 输入不是一个有效的列表类型，跳过LoRA加载。")
                return (模型, CLIP) # 返回原始模型和CLIP，不报错
        except json.JSONDecodeError:
            print(f"ZML_名称加载lora: 'lora名称列表' 输入不是有效的JSON格式，跳过LoRA加载。")
            return (模型, CLIP) # 返回原始模型和CLIP，不报错

        for lora_info in lora_list: # 遍历包含字典的列表
            if not isinstance(lora_info, dict) or "lora_name" not in lora_info or "weight" not in lora_info:
                print(f"ZML_名称加载lora: 'lora名称列表' 中的LoRA信息格式不正确: {lora_info}，跳过。")
                continue

            lora_name = lora_info["lora_name"]
            weight = lora_info["weight"]

            if lora_name == "None" or lora_name is None:
                continue

            lora_path = folder_paths.get_full_path("loras", lora_name)
            if not lora_path or not os.path.exists(lora_path): # 确保文件存在
                print(f"ZML_名称加载lora: LoRA文件 '{lora_name}' 未找到或不存在，跳过。")
                continue

            try:
                lora = comfy.utils.load_torch_file(lora_path, safe_load=True)
                current_model, current_clip = comfy.sd.load_lora_for_models(
                    current_model,
                    current_clip,
                    lora,
                    weight,
                    weight
                )
            except Exception as e:
                print(f"ZML_名称加载lora: 处理 LoRA '{lora_name}' 时发生意外错误: {e}")
        
        return (current_model, current_clip)

# --- ZML Nunchaku LoRA 名称加载器---
class ZmlNunchakuNameLoraLoader:
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "model": ("MODEL",),
                "LoRA名称列表": ("STRING", {"forceInput": True}), 
            }
        }

    RETURN_TYPES = ("MODEL",)
    RETURN_NAMES = ("输出_模型",)
    FUNCTION = "load_nunchaku_loras_from_list"
    CATEGORY = "图像/ZML_图像/lora加载器"

    def load_nunchaku_loras_from_list(self, model, LoRA名称列表):
        try:
            # 1. 深入访问到模型包装器对象
            model_wrapper = model.model.diffusion_model

            # 2. 从对象实例中直接获取它的类定义
            ComfyFluxWrapper_class = model_wrapper.__class__

            # 3. 通过类名进行验证，这比 import 更稳定
            if 'ComfyFluxWrapper' not in ComfyFluxWrapper_class.__name__:
                 raise AttributeError("模型包装器的类名不是 'ComfyFluxWrapper'。")

        except AttributeError as e:
            print(f"错误: ZML_名称加载lora(nunchaku) 节点的输入模型结构不正确 ({e})。请确保它是由 Nunchaku FLUX DiT Loader 加载的。")
            return (model,)
        # --------------------------------------------------------------------

        # 尝试解析输入的字符串为JSON列表
        try:
            lora_list = json.loads(LoRA名称列表)
            if not isinstance(lora_list, list):
                print(f"ZML_名称加载lora(nunchaku): 'lora名称列表' 输入不是一个有效的列表类型，跳过LoRA加载。")
                return (model,) # 返回原始模型，不报错
        except json.JSONDecodeError:
            print(f"ZML_名称加载lora(nunchaku): 'lora名称列表' 输入不是有效的JSON格式，跳过LoRA加载。")
            return (model,) # 返回原始模型，不报错

        # 验证输入列表是否有效
        if not lora_list:
            return (model,)

        # 采用 Nunchaku 的高效内存复制策略：只复制一次外壳
        # 注意：这里的 copy 和 to_diffusers 的 import 语句需要保留在文件顶部
        import copy
        try:
            from nunchaku.lora.flux import to_diffusers
        except ImportError:
            def to_diffusers(path): return {}

        transformer = model_wrapper.model
        model_wrapper.model = None
        ret_model = copy.deepcopy(model)
        ret_model_wrapper = ret_model.model.diffusion_model
        model_wrapper.model = transformer
        ret_model_wrapper.model = transformer

        # 循环处理 LoRA 列表 (此部分逻辑不变)
        for lora_info in lora_list:
            if not isinstance(lora_info, dict) or "lora_name" not in lora_info or "weight" not in lora_info:
                continue

            lora_name = lora_info["lora_name"]
            lora_strength = lora_info["weight"]

            if abs(lora_strength) < 1e-5:
                continue

            lora_path = folder_paths.get_full_path("loras", lora_name)
            if not lora_path or not os.path.exists(lora_path):
                print(f"警告: LoRA 文件未找到，已跳过: {lora_name}")
                continue

            ret_model_wrapper.loras.append((lora_path, lora_strength))

            sd = to_diffusers(lora_path)
            if "transformer.x_embedder.lora_A.weight" in sd:
                new_in_channels = sd["transformer.x_embedder.lora_A.weight"].shape[1]
                if new_in_channels % 4 == 0:
                    new_in_channels = new_in_channels // 4
                    old_in_channels = ret_model.model.model_config.unet_config.get("in_channels", 0)
                    if old_in_channels < new_in_channels:
                        ret_model.model.model_config.unet_config["in_channels"] = new_in_channels

        return (ret_model,)

# 注册节点
NODE_CLASS_MAPPINGS = {
    "ZmlLoraLoaderModelOnly": ZmlLoraLoaderModelOnly,
    "ZmlLoraLoaderFive": ZmlLoraLoaderFive,
    "ZmlLoraMetadataParser": ZmlLoraMetadataParser,
    "ZmlPowerLoraLoader": ZmlPowerLoraLoader,
    "ZmlNameLoraLoader": ZmlNameLoraLoader,
    "ZmlNunchakuNameLoraLoader": ZmlNunchakuNameLoraLoader,
}

# 节点显示名称映射
NODE_DISPLAY_NAME_MAPPINGS = {
    "ZmlLoraLoaderModelOnly": "ZML_LoRA加载器（仅模型）",
    "ZmlLoraLoaderFive": "ZML_LoRA加载器_五",
    "ZmlLoraMetadataParser": "ZML_解析LoRA元数据",
    "ZmlPowerLoraLoader": "ZML_强力lora加载器",
    "ZmlNameLoraLoader": "ZML_名称加载lora",
    "ZmlNunchakuNameLoraLoader": "ZML_名称加载lora(nunchaku)",
}