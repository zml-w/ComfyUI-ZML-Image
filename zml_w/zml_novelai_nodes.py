# custom_nodes/ComfyUI-ZML-Image/zml_w/zml_novelai_nodes.py

import requests
import base64
import io
import torch
import numpy as np
from PIL import Image
import json
import time
import urllib3
from typing import List, Optional

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


# ============================== 辅助函数 ==============================

def tensor_to_base64(image_tensor, max_size=1024):
    """将ComfyUI的tensor转换为base64"""
    if image_tensor is None:
        return None
    
    try:
        if isinstance(image_tensor, torch.Tensor):
            image_np = image_tensor.cpu().numpy()
            
            if len(image_np.shape) == 4:
                image_np = image_np[0]
            
            if len(image_np.shape) == 3 and image_np.shape[0] in [1, 3, 4]:
                image_np = np.transpose(image_np, (1, 2, 0))
            
            if image_np.shape[-1] == 1:
                image_np = np.repeat(image_np, 3, axis=-1)
            elif image_np.shape[-1] == 4:
                image_np = image_np[:, :, :3]
            
            if image_np.max() <= 1.0:
                image_np = (image_np * 255).astype(np.uint8)
            else:
                image_np = image_np.astype(np.uint8)
            
            pil_image = Image.fromarray(image_np, mode='RGB')
            
            # 压缩到max_size
            if max(pil_image.size) > max_size:
                ratio = max_size / max(pil_image.size)
                new_size = (int(pil_image.width * ratio), int(pil_image.height * ratio))
                pil_image = pil_image.resize(new_size, Image.Resampling.LANCZOS)
            
            buffered = io.BytesIO()
            pil_image.save(buffered, format="PNG", optimize=True)
            return base64.b64encode(buffered.getvalue()).decode()
            
    except Exception as e:
        print(f"[ZML NovelAI] 图片转换错误: {e}")
        return None
    return None


def base64_to_tensor(base64_string):
    """base64转ComfyUI tensor"""
    try:
        image_data = base64.b64decode(base64_string)
        image = Image.open(io.BytesIO(image_data)).convert('RGB')
        image_np = np.array(image).astype(np.float32) / 255.0
        return torch.from_numpy(image_np)[None,]
    except Exception as e:
        print(f"[ZML NovelAI] Base64解码错误: {e}")
        raise ValueError(f"无法解码图片: {e}")


def get_center_coords(position):
    """将位置字符串转换为坐标"""
    pos_map = {
        "left": {"x": 0.25, "y": 0.5},
        "right": {"x": 0.75, "y": 0.5},
        "center": {"x": 0.5, "y": 0.5},
        "top": {"x": 0.5, "y": 0.25},
        "bottom": {"x": 0.5, "y": 0.75},
        "top-left": {"x": 0.25, "y": 0.25},
        "top-right": {"x": 0.75, "y": 0.25},
        "bottom-left": {"x": 0.25, "y": 0.75},
        "bottom-right": {"x": 0.75, "y": 0.75}
    }
    return pos_map.get(position, {"x": 0.5, "y": 0.5})


# ============================== 图片上传器 ==============================

class NovelAIImageUploader:
    """上传图片获取 Cache Key"""
    
    UPLOAD_ENDPOINTS = [
        "https://api.novelai.net/ai/upload-image",
        "https://api.novelai.net/ai/images/upload", 
        "https://api.novelai.net/ai/auction-house/validate-or-upload-image",
        "https://api.novelai.net/ai/reference-upload",
        "https://image.novelai.net/ai/upload-image",
        "https://image.novelai.net/ai/auction-house/validate-or-upload-image",
    ]
    
    @staticmethod
    def upload_image(base64_data: str, api_token: str, proxy_url: str = "") -> Optional[str]:
        """
        尝试上传图片获取 cache_secret_key
        返回 None 表示所有端点都失败
        """
        headers = {
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Referer": "https://novelai.net/",
            "Origin": "https://novelai.net"
        }
        
        proxies = {"https": proxy_url} if proxy_url else None
        
        # 尝试多种 payload 格式
        payload_formats = [
            {"image": base64_data, "type": "reference"},
            {"image": f"data:image/png;base64,{base64_data}", "type": "reference"},
            {"image": base64_data},
            {"file": base64_data, "name": "reference.png"},
            {"data": base64_data, "content_type": "image/png"}
        ]
        
        for endpoint in NovelAIImageUploader.UPLOAD_ENDPOINTS:
            for i, payload in enumerate(payload_formats):
                try:
                    print(f"[ZML NovelAI] 上传尝试: {endpoint} (格式{i+1})")
                    
                    response = requests.post(
                        endpoint,
                        headers=headers,
                        json=payload,
                        proxies=proxies,
                        timeout=30,
                        verify=False
                    )
                    
                    print(f"[ZML NovelAI]   状态码: {response.status_code}")
                    
                    if response.status_code == 200:
                        try:
                            data = response.json()
                            print(f"[ZML NovelAI]   响应: {json.dumps(data, indent=2)[:200]}...")
                            
                            # 提取 cache key 的多种可能路径
                            cache_key = (
                                data.get("cache_secret_key") or 
                                data.get("cache_key") or 
                                data.get("key") or
                                data.get("image", {}).get("cache_secret_key") or
                                data.get("id") or
                                data.get("secret_key")
                            )
                            
                            if cache_key and len(str(cache_key)) >= 32:
                                print(f"[ZML NovelAI] 成功! Cache Key: {str(cache_key)[:20]}...")
                                return str(cache_key)
                                
                        except Exception as e:
                            print(f"[ZML NovelAI]   解析响应失败: {e}")
                            
                    elif response.status_code == 401:
                        print(f"[ZML NovelAI]   401 未授权: Token 可能无效")
                    elif response.status_code == 404:
                        print(f"[ZML NovelAI]   404 端点不存在")
                    elif response.status_code == 400:
                        print(f"[ZML NovelAI]   400 请求错误: {response.text[:100]}")
                        
                except requests.exceptions.ProxyError as e:
                    print(f"[ZML NovelAI]   代理错误: {e}")
                except requests.exceptions.Timeout:
                    print(f"[ZML NovelAI]   超时")
                except Exception as e:
                    print(f"[ZML NovelAI]   错误: {str(e)[:100]}")
                    continue
        
        return None


# ============================== NovelAI V4/V4.5 节点 ==============================

class ZML_NovelAI_V4:
    """
    ZML NovelAI V4/V4.5 图像生成节点
    支持自动上传获取 Precise Reference Cache Key
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "提示词": ("STRING", {
                    "multiline": True, 
                    "default": "masterpiece, best quality, 1girl, solo",
                }),
                "负面提示词": ("STRING", {
                    "multiline": True, 
                    "default": "lowres, bad anatomy, bad hands, text, error, missing fingers",
                }),
                "模型": (["nai-diffusion-4-5-full", "nai-diffusion-4-full", "nai-diffusion-3"], {
                    "default": "nai-diffusion-4-5-full"
                }),
                "宽度": ("INT", {"default": 832, "min": 512, "max": 2048, "step": 64}),
                "高度": ("INT", {"default": 1216, "min": 512, "max": 2048, "step": 64}),
                "步数": ("INT", {"default": 28, "min": 1, "max": 50, "step": 1}),
                "CFG": ("FLOAT", {"default": 5.1, "min": 1.0, "max": 20.0, "step": 0.1}),
                "采样器": (["k_euler", "k_euler_ancestral", "k_dpmpp_2m", "k_dpmpp_sde", "k_dpmpp_2s_ancestral"], {
                    "default": "k_euler_ancestral"
                }),
                "种子": ("INT", {"default": -1, "min": -1, "max": 4294967295}),
                "API_Token": ("STRING", {"default": ""}),
            },
            "optional": {
                "角色1_提示词": ("STRING", {"multiline": True, "default": ""}),
                "角色1_负面": ("STRING", {"default": ""}),
                "角色1_位置": (["center", "left", "right", "top", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"], {
                    "default": "center"
                }),
                "角色2_提示词": ("STRING", {"multiline": True, "default": ""}),
                "角色2_位置": (["center", "left", "right", "top", "bottom"], {"default": "center"}),
                "角色3_提示词": ("STRING", {"multiline": True, "default": ""}),
                "角色3_位置": (["center", "left", "right", "top", "bottom"], {"default": "center"}),
                "Vibe图片": ("IMAGE", {"tooltip": "Vibe Transfer 图片"}),
                "Vibe强度": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.05}),
                "参考图": ("IMAGE", {"tooltip": "Precise Reference 图片"}),
                "参考模式": (["character&style", "character", "style"], {
                    "default": "character&style"
                }),
                "参考强度": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.05}),
                "参考图_CacheKey": ("STRING", {
                    "default": "",
                    "tooltip": "可选：手动输入 cache key（如果自动上传失败）"
                }),
                "基础图": ("IMAGE", {"tooltip": "Img2Img 基础图像"}),
                "Img2Img强度": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 1.0, "step": 0.01}),
                "VarietyBoost": ("BOOLEAN", {"default": False}),
                "使用坐标": ("BOOLEAN", {"default": False}),
                "CFG重缩放": ("FLOAT", {"default": 0.61, "min": 0.0, "max": 1.0, "step": 0.01}),
                "自动上传参考图": ("BOOLEAN", {
                    "default": True, 
                    "tooltip": "关闭则必须手动提供 cache key"
                }),
                "代理地址": ("STRING", {"default": "", "tooltip": "可选：http://localhost:7890"}),
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("图像", "生成信息")
    FUNCTION = "generate"
    CATEGORY = "image/ZML_图像/NovelAI"
    OUTPUT_NODE = True

    def generate(self, 提示词, 负面提示词, 模型, 宽度, 高度, 步数, CFG, 采样器, 种子, API_Token,
                 角色1_提示词="", 角色1_负面="", 角色1_位置="center",
                 角色2_提示词="", 角色2_位置="center",
                 角色3_提示词="", 角色3_位置="center",
                 Vibe图片=None, Vibe强度=0.5,
                 参考图=None, 参考模式="character&style", 参考强度=1.0, 参考图_CacheKey="",
                 基础图=None, Img2Img强度=0.7,
                 VarietyBoost=False, 使用坐标=False, CFG重缩放=0.61,
                 自动上传参考图=True, 代理地址=""):
        
        if not API_Token:
            raise ValueError("[ZML NovelAI] 必须提供 NovelAI API Token！")
        
        is_v45 = "4-5" in 模型
        is_v4 = 模型.startswith("nai-diffusion-4") and not is_v45
        
        current_seed = 种子 if 种子 != -1 else int(time.time() * 1000) % (2**32)
        
        params = {
            "params_version": 3,
            "width": 宽度,
            "height": 高度,
            "scale": CFG,
            "sampler": 采样器,
            "steps": 步数,
            "seed": current_seed,
            "n_samples": 1,
            "ucPreset": 4,
            "qualityToggle": False,
            "autoSmea": False,
            "dynamic_thresholding": False,
            "controlnet_strength": 1,
            "legacy": False,
            "add_original_image": True,
            "cfg_rescale": CFG重缩放,
            "noise_schedule": "karras",
            "legacy_v3_extend": False,
            "skip_cfg_above_sigma": None,
            "use_coords": 使用坐标,
            "normalize_reference_strength_multiple": False,
            "legacy_uc": False,
            "image_format": "png",
            "deliberate_euler_ancestral_bug": False,
            "prefer_brownian": True,
            "inpaintImg2ImgStrength": 1 if 基础图 is not None else 0,
        }

        # 构建角色数据
        characters = []
        for cp, cup, cpos in [(角色1_提示词, 角色1_负面, 角色1_位置),
                              (角色2_提示词, "", 角色2_位置),
                              (角色3_提示词, "", 角色3_位置)]:
            if cp.strip():
                center = get_center_coords(cpos)
                characters.append({"prompt": cp, "uc": cup, **center})
        
        if is_v4 or is_v45:
            params["v4_prompt"] = {
                "caption": {
                    "base_caption": 提示词,
                    "char_captions": [
                        {
                            "char_caption": c["prompt"],
                            "uc": c["uc"],
                            "centers": [{"x": c["x"], "y": c["y"]}]
                        } for c in characters
                    ]
                },
                "use_coords": 使用坐标 and len(characters) > 0,
                "use_order": True
            }
            
            params["v4_negative_prompt"] = {
                "caption": {
                    "base_caption": 负面提示词,
                    "char_captions": [
                        {"char_caption": c["uc"], "centers": [{"x": c["x"], "y": c["y"]}]}
                        for c in characters
                    ]
                },
                "legacy_uc": False
            }
            
            params["characterPrompts"] = [
                {"prompt": c["prompt"], "uc": c["uc"], "center": {"x": c["x"], "y": c["y"]}, "enabled": True}
                for c in characters
            ]
            
            if is_v45:
                params["variety_boost"] = VarietyBoost
                params["decrisp_mode"] = False
        else:
            params["uc"] = 负面提示词

        # Vibe Transfer
        if Vibe图片 is not None:
            vibe_b64 = tensor_to_base64(Vibe图片)
            if vibe_b64:
                params["reference_images"] = [{
                    "image": vibe_b64,
                    "strength": Vibe强度,
                    "type": "vibe"
                }]

        # Precise Reference
        cache_key = 参考图_CacheKey
        
        if 参考图 is not None:
            if 自动上传参考图 and not cache_key:
                print("[ZML NovelAI] 正在自动上传 Reference 图片获取 Cache Key...")
                ref_b64 = tensor_to_base64(参考图)
                if ref_b64:
                    cache_key = NovelAIImageUploader.upload_image(ref_b64, API_Token, 代理地址)
                
                if not cache_key:
                    print("[ZML NovelAI] 自动上传失败！")
                    if not 参考图_CacheKey:
                        raise ValueError(
                            "[ZML NovelAI] 自动上传 Reference 图片失败！\n"
                            "解决方案：\n"
                            "1. 在 NovelAI 网页版上传参考图，F12 抓取 generate-image 请求中的 cache_secret_key\n"
                            "2. 将 cache key 填入 参考图_CacheKey 参数\n"
                            "3. 或关闭 自动上传参考图，手动提供 cache key"
                        )
            
            if cache_key:
                params["director_reference_descriptions"] = [{
                    "caption": {
                        "base_caption": 参考模式,
                        "char_captions": []
                    },
                    "legacy_uc": False
                }]
                params["director_reference_information_extracted"] = [1]
                params["director_reference_strength_values"] = [参考强度]
                params["director_reference_secondary_strength_values"] = [0]
                params["director_reference_images_cached"] = [
                    {"cache_secret_key": cache_key}
                ]
                print(f"[ZML NovelAI] Precise Reference 已启用: mode={参考模式}, strength={参考强度}")

        # Img2Img
        action = "generate"
        if 基础图 is not None:
            base_b64 = tensor_to_base64(基础图)
            if base_b64:
                params["image"] = base_b64
                params["strength"] = Img2Img强度
                action = "img2img"

        payload = {
            "input": 提示词,
            "model": 模型,
            "action": action,
            "parameters": params,
            "use_new_shared_trial": True
        }

        print(f"[ZML NovelAI] 生成参数: {json.dumps({'model': 模型, 'seed': current_seed, 'chars': len(characters), 'ref': 参考图 is not None}, indent=2)}")

        # 发送请求
        headers = {
            "Authorization": f"Bearer {API_Token}",
            "Content-Type": "application/json",
            "Accept": "application/x-zip-compressed"
        }
        
        proxies = {"https": 代理地址} if 代理地址 else None
        
        try:
            response = requests.post(
                "https://image.novelai.net/ai/generate-image",
                headers=headers,
                json=payload,
                proxies=proxies,
                timeout=(30, 300),
                verify=False
            )
            
            if response.status_code == 200:
                from zipfile import ZipFile
                zip_file = ZipFile(io.BytesIO(response.content))
                
                image_files = [f for f in zip_file.namelist() if f.endswith(('.png', '.jpg', '.webp'))]
                if not image_files:
                    raise ValueError(f"[ZML NovelAI] ZIP中没有图片文件: {zip_file.namelist()}")
                
                with zip_file.open(image_files[0]) as img_file:
                    img_data = base64.b64encode(img_file.read()).decode()
                    tensor = base64_to_tensor(img_data)
                    
                    info = json.dumps({
                        "model": 模型,
                        "seed": current_seed,
                        "size": f"{宽度}x{高度}",
                        "steps": 步数,
                        "cfg": CFG,
                        "characters": len(characters),
                        "precise_reference": cache_key is not None,
                        "reference_mode": 参考模式 if cache_key else None,
                        "cache_key_prefix": cache_key[:16] if cache_key else None
                    }, ensure_ascii=False, indent=2)
                    
                    return (tensor, info)
            
            elif response.status_code == 400:
                error_detail = response.text[:500]
                raise ValueError(f"[ZML NovelAI] Bad Request (400): {error_detail}\n可能原因：Cache Key 格式错误或已过期")
            elif response.status_code == 401:
                raise ValueError("[ZML NovelAI] Unauthorized (401): Token无效")
            else:
                raise ValueError(f"[ZML NovelAI] HTTP {response.status_code}: {response.text[:500]}")
                
        except Exception as e:
            raise ValueError(f"[ZML NovelAI] 生成失败: {str(e)}")


# ============================== 节点映射 ==============================

NODE_CLASS_MAPPINGS = {
    "ZML_NovelAI_V4": ZML_NovelAI_V4,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_NovelAI_V4": "🎨 ZML_NovelAI V4/V4.5",
}
