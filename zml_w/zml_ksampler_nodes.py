import comfy.samplers
import comfy.sample
from nodes import KSamplerAdvanced, VAEDecode
from comfy.cli_args import args
from contextlib import contextmanager
import numpy as np
import torch
import server
import latent_preview as core_latent_preview
from latent_preview import LatentPreviewMethod
import functools
from PIL import Image, PngImagePlugin
import time
import datetime
import io
import struct
import os
import json
import re
import folder_paths
import comfy.utils
from threading import Thread
import torch.nn.functional as F

serv = server.PromptServer.instance

# ===============================================
#  全局配置区
# ===============================================

DEFAULT_TEXT_BLOCK_KEY = "comfy_text_block"
RECURSION_DEPTH_LIMIT = 30

TEXT_SEARCH_KEYS = [
    "文本", "text", "string", "value", 
    "positive_prompt", "positive", "negative_prompt", "negative",
    "txt_内容", "提示词"
]

TEXT_NODE_PATTERNS = [
    "TextInput", "文本输入", "Primitive", "String", "ShowText",
    "Merge", "合并", "Concatenate",
    "Condition", "条件", "CLIPText"
]

# ===============================================
# Philox RNG 部分
# ===============================================
philox_m = [0xD2511F53, 0xCD9E8D57]
philox_w = [0x9E3779B9, 0xBB67AE85]

two_pow32_inv = np.array([2.3283064e-10], dtype=np.float32)
two_pow32_inv_2pi = np.array([2.3283064e-10 * 6.2831855], dtype=np.float32)

def uint32(x):
    return x.view(np.uint32).reshape(-1, 2).transpose(1, 0)

def philox4_round(counter, key):
    v1 = uint32(counter[0].astype(np.uint64) * philox_m[0])
    v2 = uint32(counter[2].astype(np.uint64) * philox_m[1])
    counter[0] = v2[1] ^ counter[1] ^ key[0]
    counter[1] = v2[0]
    counter[2] = v1[1] ^ counter[3] ^ key[1]
    counter[3] = v1[0]

def philox4_32(counter, key, rounds=10):
    for _ in range(rounds - 1):
        philox4_round(counter, key)
        key[0] += philox_w[0]
        key[1] += philox_w[1]
    philox4_round(counter, key)
    return counter

def box_muller(x, y):
    u = x * two_pow32_inv + two_pow32_inv / 2
    v = y * two_pow32_inv_2pi + two_pow32_inv_2pi / 2
    s = np.sqrt(-2.0 * np.log(u))
    return (s * np.sin(v)).astype(np.float32)

class Generator:
    def __init__(self, seed):
        self.seed = seed if seed >= 0 else seed + (1 << 64)
        self.offset = 0

    def randn(self, shape):
        n = np.prod(shape)
        counter = np.zeros((4, n), dtype=np.uint32)
        counter[0] = self.offset
        counter[2] = np.arange(n, dtype=np.uint32)
        self.offset += 1
        key = np.full(n, self.seed, dtype=np.uint64)
        key = uint32(key)
        g = philox4_32(counter, key)
        return box_muller(g[0], g[1]).reshape(shape)

import comfy.sample
_original_prepare_noise = comfy.sample.prepare_noise
def rng_rand_source(rand_source='cpu'):
    def prepare_noise(latent_image, seed, noise_inds=None):
        generator = torch.Generator("cpu").manual_seed(seed)
        if rand_source == 'nv':
            rng = Generator(seed)

        if noise_inds is None:
            shape = latent_image.size()
            if rand_source == 'nv':
                return torch.asarray(rng.randn(shape), device=latent_image.device)
            else:
                return torch.randn(shape, dtype=latent_image.dtype, layout=latent_image.layout,
                                   generator=generator, device="cpu").to(latent_image.device)

        unique_inds, inverse = np.unique(noise_inds, return_inverse=True)
        noises = []
        for i in range(unique_inds[-1] + 1):
            shape = [1] + list(latent_image.size())[1:]
            if rand_source == 'nv':
                noise = torch.asarray(rng.randn(shape), device=latent_image.device)
            else:
                noise = torch.randn(shape, dtype=latent_image.dtype, layout=latent_image.layout,
                                    generator=generator, device="cpu").to(latent_image.device)
            noises.append(noise)
        return torch.cat(noises)[inverse]

    comfy.sample.prepare_noise = prepare_noise

# ===============================================
# 预览 contextmanager
# ===============================================
@contextmanager
def zml_preview(preview_method, video_preview_enabled):
    # 建立字符串到枚举的映射。注意：此处必须是 NoPreviews (带s)
    method_map = {
        "auto": LatentPreviewMethod.Auto,
        "latent2rgb": LatentPreviewMethod.Latent2RGB,
        "taesd": LatentPreviewMethod.TAESD,
        "none": LatentPreviewMethod.NoPreviews,
    }
    
    old_method = args.preview_method
    target_method = method_map.get(preview_method, LatentPreviewMethod.Auto)
    
    should_override = True
    if preview_method == "auto" and not video_preview_enabled:
        should_override = False

    try:
        if should_override:
            args.preview_method = target_method
        yield
    finally:
        if should_override:
            args.preview_method = old_method

# ===============================================
# ZML 动态预览逻辑 (Hook)
# ===============================================
def zml_hook(obj, attr):
    def dec(f):
        f = functools.update_wrapper(f, getattr(obj, attr))
        setattr(obj, attr, f)
        return f
    return dec

zml_rates_table = {
    'Mochi': 24//6, 'LTXV': 24//8, 'HunyuanVideo': 24//4,
    'Cosmos1CV8x8x8': 24//8, 'Wan21': 16//4, 'Wan22': 24//4,
}

_original_get_previewer = core_latent_preview.get_previewer

class ZMLWrappedPreviewer(core_latent_preview.LatentPreviewer):
    def __init__(self, previewer, rate=8):
        self.first_preview = True
        self.last_time = time.time()
        self.c_index = 0
        self.rate = rate
        if hasattr(previewer, 'taesd'):
            self.taesd = previewer.taesd
        elif hasattr(previewer, 'latent_rgb_factors'):
            self.latent_rgb_factors = previewer.latent_rgb_factors
            self.latent_rgb_factors_bias = previewer.latent_rgb_factors_bias
            self.latent_rgb_factors_reshape = getattr(previewer, 'latent_rgb_factors_reshape', None)
        else:
            raise Exception('不支持的预览类型')

    def decode_latent_to_preview_image(self, preview_format, x0):
        if x0.ndim == 5:
            x0 = x0.movedim(2, 1).reshape((-1,) + x0.shape[-3:])

        num_images = x0.size(0)

        new_time = time.time()
        num_previews = int((new_time - self.last_time) * self.rate)
        self.last_time = new_time

        if num_previews <= 0:
            return None
        if num_previews > num_images:
            num_previews = num_images

        if self.first_preview:
            self.first_preview = False
            serv.send_sync('VHS_latentpreview', {
                'length': num_images,
                'rate': self.rate,
                'id': serv.last_node_id
            })

        start_idx = self.c_index
        batch = x0[start_idx:start_idx + num_previews]
        if batch.size(0) < num_previews:
            batch = torch.cat([batch, x0[:num_previews - batch.size(0)]], dim=0)

        Thread(target=self._send_frames, args=(batch, start_idx % num_images, num_images)).start()

        self.c_index = (self.c_index + num_previews) % num_images
        return None

    def _send_frames(self, tensor, start_ind, total):
        tensor = tensor.clone().detach()

        decoded = self._decode(tensor)
        if decoded.size(1) > 512 or decoded.size(2) > 512:
            decoded = decoded.movedim(-1, 0)
            h, w = decoded.shape[2:]
            if h < w:
                new_h = 512 * h // w
                decoded = F.interpolate(decoded, (new_h, 512), mode='bilinear')
            else:
                new_w = 512 * w // h
                decoded = F.interpolate(decoded, (512, new_w), mode='bilinear')
            decoded = decoded.movedim(0, -1)

        imgs = ((decoded + 1.0) / 2.0).clamp(0, 1).mul(255).byte().cpu()

        ind = start_ind
        for img in imgs:
            pil = Image.fromarray(img.numpy())
            buf = io.BytesIO()
            buf.write(b'\x01\x00\x00\x00\x01\x00\x00\x00')
            buf.write(ind.to_bytes(4, 'big'))
            buf.write(struct.pack('16p', serv.last_node_id.encode()))
            pil.save(buf, format="JPEG", quality=95)
            serv.send_sync(server.BinaryEventTypes.PREVIEW_IMAGE, buf.getvalue(), serv.client_id)
            ind = (ind + 1) % total

    def _decode(self, x0):
        with torch.no_grad():
            x0 = x0.clone()
            if hasattr(self, 'taesd') and args.preview_method == core_latent_preview.LatentPreviewMethod.TAESD:
                return self.taesd.decode(x0).movedim(1, 3)
            elif hasattr(self, 'latent_rgb_factors'):
                if self.latent_rgb_factors_reshape:
                    x0 = self.latent_rgb_factors_reshape(x0)
                self.latent_rgb_factors = self.latent_rgb_factors.to(x0.device, x0.dtype)
                bias = self.latent_rgb_factors_bias.to(x0.device, x0.dtype) if self.latent_rgb_factors_bias is not None else None
                return F.linear(x0.movedim(1, -1), self.latent_rgb_factors, bias)
            else:
                raise Exception('不支持的预览类型')

@zml_hook(core_latent_preview, 'get_previewer')
def zml_get_previewer(device, latent_format, *args, **kwargs):
    previewer = _original_get_previewer(device, latent_format, *args, **kwargs)
    if not hasattr(previewer, "decode_latent_to_preview"):
        return previewer
    rate = zml_rates_table.get(latent_format.__class__.__name__, 8)
    if getattr(serv, 'zml_video_preview_enabled', False):
        return ZMLWrappedPreviewer(previewer, getattr(serv, 'zml_video_preview_rate', rate))
    else:
        return previewer


# ===============================================
# 智能发现提示词与元数据
# ===============================================

def extract_text_from_conditioning(conditioning):
    texts = []
    if conditioning is None: return None
    for item in conditioning:
        if len(item) > 1 and isinstance(item[1], dict):
            t = item[1].get("zml_text", "")
            if t: texts.append(t)
    return "\n".join(texts) if texts else None

def find_upstream_text(prompt, current_node_id, input_key, depth=0):
    if depth > RECURSION_DEPTH_LIMIT: return None 
    current_node = prompt.get(str(current_node_id))
    if not current_node: return None
    inputs = current_node.get("inputs", {})
    source = inputs.get(input_key)

    if isinstance(source, str):
        return source

    if isinstance(source, list) and len(source) == 2:
        source_node_id = str(source[0])
        source_node = prompt.get(source_node_id)
        if not source_node: return None
        class_type = source_node.get("class_type", "")
        source_inputs = source_node.get("inputs", {})

        if any(p in class_type for p in ["Merge", "合并", "Concatenate"]):
            merged_text = []
            delimiter = source_inputs.get("delimiter") or source_inputs.get("分隔符") or "\n"
            if delimiter == "\\n": delimiter = "\n"
            
            sorted_keys = sorted(source_inputs.keys())
            for key in sorted_keys:
                if any(k in key for k in ["delimiter", "分隔符"]): continue
                val = find_upstream_text(prompt, source_node_id, key, depth + 1)
                if val and isinstance(val, str) and val.strip():
                    merged_text.append(val)
            return delimiter.join(merged_text) if merged_text else None

        is_target = any(p in class_type for p in TEXT_NODE_PATTERNS)
        if is_target:
            for key in TEXT_SEARCH_KEYS:
                val = source_inputs.get(key)
                if val and isinstance(val, str): return val

        if "CLIPTextEncode" in class_type:
            return find_upstream_text(prompt, source_node_id, "text", depth + 1)
        if "Reroute" in class_type:
            for k, v in source_inputs.items():
                if isinstance(v, list):
                    return find_upstream_text(prompt, source_node_id, k, depth + 1)
    return None

def traverse_model_chain(prompt, start_node_id):
    current_id = start_node_id
    start_node = prompt.get(str(start_node_id))
    if not start_node: return None
    first_link = start_node.get("inputs", {}).get("模型") or start_node.get("inputs", {}).get("model")
    if not first_link or not isinstance(first_link, list): return None
    
    current_id = str(first_link[0])
    for _ in range(RECURSION_DEPTH_LIMIT):
        node = prompt.get(current_id)
        if not node: break
        class_type, inputs = node.get("class_type", ""), node.get("inputs", {})
        if "CheckpointLoader" in class_type:
            return inputs.get("ckpt_name")
        next_link = inputs.get("model") or inputs.get("模型")
        if next_link and isinstance(next_link, list): current_id = str(next_link[0])
        else: break
    return None

def auto_discover_metadata(prompt, unique_id, pos_cond, neg_cond):
    ckpt_name = traverse_model_chain(prompt, unique_id)
    positive = extract_text_from_conditioning(pos_cond)
    if not positive:
        positive = find_upstream_text(prompt, unique_id, "正面条件") or find_upstream_text(prompt, unique_id, "positive")
    negative = extract_text_from_conditioning(neg_cond)
    if not negative:
        negative = find_upstream_text(prompt, unique_id, "负面条件") or find_upstream_text(prompt, unique_id, "negative")
    return ckpt_name, positive, negative

def generate_webui_metadata_base(steps, sampler_name, scheduler, cfg, seed, latent, denoise=None, model_name=None, positive=None, negative=None):
    width, height = latent["samples"].shape[3] * 8, latent["samples"].shape[2] * 8
    data = {
        "steps": steps, "sampler": sampler_name, "scheduler": scheduler, "cfg": cfg,
        "seed": seed, "width": width, "height": height, "model": model_name,
        "denoise": denoise, "positive": str(positive).strip() if positive else "",
        "negative": str(negative).strip() if negative else "",
    }
    return json.dumps(data)


# ===============================================
# 图像处理辅助函数 (模糊/锐化)
# ===============================================

def apply_gaussian_blur(x, sigma):
    # x: (B, C, H, W)
    if sigma <= 0: return x
    kernel_size = int(2 * 4.0 * sigma + 1)
    if kernel_size % 2 == 0: kernel_size += 1
    
    # 构建高斯核
    k_range = torch.arange(kernel_size, device=x.device, dtype=x.dtype) - (kernel_size - 1) / 2
    k = torch.exp(-0.5 * (k_range / sigma) ** 2)
    k = k / k.sum()
    
    # 扩展为 (C, 1, K, 1) 和 (C, 1, 1, K) 进行分离卷积
    C = x.shape[1]
    k_x = k.view(1, 1, kernel_size, 1).repeat(C, 1, 1, 1)
    k_y = k.view(1, 1, 1, kernel_size).repeat(C, 1, 1, 1)
    
    # 填充
    pad = kernel_size // 2
    x_pad = F.pad(x, (0, 0, pad, pad), mode='reflect')
    out = F.conv2d(x_pad, k_x, groups=C)
    out_pad = F.pad(out, (pad, pad, 0, 0), mode='reflect')
    out = F.conv2d(out_pad, k_y, groups=C)
    return out

# ===============================================
# 采样辅助函数 (支持多种脚本指令，含动态CFG)
# ===============================================

def run_zml_sampler(model, seed, steps, cfg, sampler_name, scheduler, positive, negative, latent, denoise=1.0, disable_noise=False, start_step=None, last_step=None, force_full_denoise=False, script=None):
    device = model.load_device
    latent_image = latent["samples"]

    # 1. 脚本解析与预计算
    script_map = {}
    
    # 共享状态容器 (CFG)
    cfg_state = {"val": cfg}
    
    if script:
        total_len = steps 
        for instruction in script:
            trigger_step = int(total_len * instruction['timing'])
            trigger_step = min(trigger_step, total_len - 1)
            
            # 处理 0.0 时机：立即生效 (CFG)
            if instruction['timing'] <= 0.0 and instruction.get('type') == 'dynamic_cfg':
                cfg_state["val"] = instruction['target_cfg']
            
            if trigger_step not in script_map:
                script_map[trigger_step] = []
            script_map[trigger_step].append(instruction)

    # 2. 模型补丁：动态 CFG
    # 克隆模型以避免污染全局缓存，并注入 CFG 计算函数
    model_cloned = model.clone()
    
    def zml_cfg_patch(args):
        # args 包含 {"cond": cond, "uncond": uncond, "cond_scale": ..., "input": ..., "sigma": ...}
        # 标准 CFG 公式: uncond + (cond - uncond) * cfg
        cond = args["cond"]
        uncond = args["uncond"]
        current_cfg = cfg_state["val"]
        return uncond + (cond - uncond) * current_cfg
    
    model_cloned.set_model_sampler_cfg_function(zml_cfg_patch)

    # 3. 获取 ComfyUI 原生回调
    comfy_callback = core_latent_preview.prepare_callback(model_cloned, steps)

    # 4. 定义高性能复合回调
    def zml_callback(step, x0, x, total_steps):
        # A. 执行脚本逻辑
        if step in script_map:
            instructions = script_map[step]
            for instr in instructions:
                op_type = instr.get('type', 'noise') 
                
                if op_type == 'noise':
                    strength = instr['noise']
                    if strength != 0:
                        noise = torch.randn_like(x, device=x.device) * strength
                        x.add_(noise)
                
                elif op_type == 'blur_sharpen':
                    mode = instr['mode']
                    strength = instr['strength']
                    if mode == "模糊":
                        blurred = apply_gaussian_blur(x, strength)
                        x.copy_(blurred)
                    elif mode == "锐化":
                        blurred = apply_gaussian_blur(x, 1.0)
                        detail = x - blurred
                        x.add_(detail * strength)
                
                elif op_type == 'contrast':
                    c_factor = instr['contrast']
                    b_offset = instr['brightness']
                    vignette = instr.get('vignette', 0.0)
                    
                    if c_factor != 1.0:
                        mean = x.mean(dim=(2, 3), keepdim=True)
                        x.sub_(mean).mul_(c_factor).add_(mean)
                    
                    if b_offset != 0.0:
                        x[:, 0, :, :].add_(b_offset)
                    
                    if vignette > 0.0:
                        B, C, H, W = x.shape
                        y_range = torch.linspace(-1, 1, H, device=x.device)
                        x_range = torch.linspace(-1, 1, W, device=x.device)
                        yy, xx = torch.meshgrid(y_range, x_range, indexing='ij')
                        dist = torch.sqrt(xx**2 + yy**2)
                        mask = dist * vignette
                        x[:, 0, :, :] = x[:, 0, :, :] - mask
                
                elif op_type == 'dynamic_cfg':
                    # 更新共享状态，下一步采样时模型会自动读取
                    cfg_state["val"] = instr['target_cfg']

        # B. 执行原生回调
        if comfy_callback:
            comfy_callback(step, x0, x, total_steps)

    if disable_noise:
        noise = torch.zeros(latent_image.size(), dtype=latent_image.dtype, layout=latent_image.layout, device="cpu")
    else:
        batch_inds = latent.get("batch_index") if latent.get("batch_index") is not None else None
        noise = comfy.sample.prepare_noise(latent_image, seed, batch_inds)

    noise = noise.to(device)
    latent_image = latent_image.to(device)

    # 初始化采样器实例 (使用 Clone 的模型)
    sampler = comfy.samplers.KSampler(model_cloned, steps=steps, device=device, sampler=sampler_name, scheduler=scheduler, denoise=denoise, model_options=model_cloned.model_options)
    
    # 执行采样
    samples = sampler.sample(noise, positive, negative, cfg=cfg, latent_image=latent_image, start_step=start_step, last_step=last_step, force_full_denoise=force_full_denoise, denoise_mask=latent.get("noise_mask"), callback=zml_callback, sigmas=None, seed=seed)
    
    out = latent.copy()
    out["samples"] = samples
    return (out, )

# ===============================================
# ZML 核心功能节点
# ===============================================

class ZML_ConditionNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "clip": ("CLIP", ),
                "text": ("STRING", {"multiline": True, "dynamicPrompts": True, "tooltip": "在此输入提示词，ZML_K采样器会自动读取提示词并注入到生成的元数据中。"}), 
            }
        }
    RETURN_TYPES = ("CONDITIONING",)
    RETURN_NAMES = ("条件",)
    FUNCTION = "encode"
    CATEGORY = "image/ZML_图像/采样器相关"

    def encode(self, clip, text):
        tokens = clip.tokenize(text)
        cond, pooled = clip.encode_from_tokens(tokens, return_pooled=True)
        return ([[cond, {"pooled_output": pooled, "zml_text": text}]], )

class ZML_NoiseScriptNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "触发时机": ("FLOAT", {"default": 0.6, "min": 0.0, "max": 1.0, "step": 0.1, "tooltip": "在进度的百分之多少时触发 (0.0=开始, 1.0=结束)"}),
                "噪波强度": ("FLOAT", {"default": 0.4, "min": 0.0, "max": 10.0, "step": 0.01, "tooltip": "注入的额外高斯噪波强度 (0-10)"}),
            },
            "optional": {
                "上一个脚本": ("ZML_SCRIPT", {"tooltip": "连接上一个脚本节点以串联多个操作"}),
            }
        }
    RETURN_TYPES = ("ZML_SCRIPT",)
    RETURN_NAMES = ("脚本",)
    FUNCTION = "create_script"
    CATEGORY = "image/ZML_图像/采样器相关"

    def create_script(self, 触发时机, 噪波强度, 上一个脚本=None):
        script = []
        if 上一个脚本:
            script.extend(上一个脚本)
        script.append({"type": "noise", "timing": 触发时机, "noise": 噪波强度})
        script.sort(key=lambda x: x['timing'])
        return (script,)

class ZML_BlurSharpenScriptNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "触发时机": ("FLOAT", {"default": 0.2, "min": 0.0, "max": 1.0, "step": 0.1}),
                "模式": (["模糊", "锐化"],),
                "强度": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 10.0, "step": 0.1, "tooltip": "模糊模式下代表模糊半径(Sigma)，锐化模式下代表锐化强度因子"}),
            },
            "optional": {
                "上一个脚本": ("ZML_SCRIPT",),
            }
        }
    RETURN_TYPES = ("ZML_SCRIPT",)
    RETURN_NAMES = ("脚本",)
    FUNCTION = "create_script"
    CATEGORY = "image/ZML_图像/采样器相关"

    def create_script(self, 触发时机, 模式, 强度, 上一个脚本=None):
        script = []
        if 上一个脚本:
            script.extend(上一个脚本)
        script.append({"type": "blur_sharpen", "timing": 触发时机, "mode": 模式, "strength": 强度})
        script.sort(key=lambda x: x['timing'])
        return (script,)

class ZML_ContrastScriptNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "触发时机": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.1}),
                "对比度": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 3.0, "step": 0.05, "tooltip": "1.0为原样，大于1增加对比度"}),
                "亮度": ("FLOAT", {"default": 0.0, "min": -10.0, "max": 10.0, "step": 0.1, "tooltip": "0.0为原样，正数变亮，负数变暗(大幅度调节Channel 0)"}),
                "暗角强度": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 10.0, "step": 0.1, "tooltip": "值越大，四周越暗 (建议 0.5-2.0)"}),
            },
            "optional": {
                "上一个脚本": ("ZML_SCRIPT",),
            }
        }
    RETURN_TYPES = ("ZML_SCRIPT",)
    RETURN_NAMES = ("脚本",)
    FUNCTION = "create_script"
    CATEGORY = "image/ZML_图像/采样器相关"

    def create_script(self, 触发时机, 对比度, 亮度, 暗角强度, 上一个脚本=None):
        script = []
        if 上一个脚本:
            script.extend(上一个脚本)
        script.append({"type": "contrast", "timing": 触发时机, "contrast": 对比度, "brightness": 亮度, "vignette": 暗角强度})
        script.sort(key=lambda x: x['timing'])
        return (script,)

class ZML_DynamicCFGScriptNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "触发时机": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.1, "tooltip": "在该进度时切换CFG"}),
                "目标CFG": ("FLOAT", {"default": 4.0, "min": 0.0, "max": 100.0, "step": 0.5, "tooltip": "触发后，采样CFG将变更为此数值并保持"}),
            },
            "optional": {
                "上一个脚本": ("ZML_SCRIPT",),
            }
        }
    RETURN_TYPES = ("ZML_SCRIPT",)
    RETURN_NAMES = ("脚本",)
    FUNCTION = "create_script"
    CATEGORY = "image/ZML_图像/采样器相关"

    def create_script(self, 触发时机, 目标CFG, 上一个脚本=None):
        script = []
        if 上一个脚本:
            script.extend(上一个脚本)
        script.append({"type": "dynamic_cfg", "timing": 触发时机, "target_cfg": 目标CFG})
        script.sort(key=lambda x: x['timing'])
        return (script,)

class ZML_KSampler:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "模型": ("MODEL",), "种子": ("INT", {"default": -1}), "步数": ("INT", {"default": 20}),
                "CFG": ("FLOAT", {"default": 8.0}), "采样器": (comfy.samplers.KSampler.SAMPLERS,),
                "调度器": (comfy.samplers.KSampler.SCHEDULERS,), "正面条件": ("CONDITIONING",),
                "负面条件": ("CONDITIONING",), "Latent": ("LATENT",),
                "降噪": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01, "tooltip": "降噪强度，1.0表示完全降噪，0.0表示不降噪"}),
                "预览方式": (["auto", "latent2rgb", "taesd", "none"], {"default": "auto"}),
                "噪波模式": (["cpu", "gpu"], {"default": "cpu"}), 
                "视频预览": (["enable", "disable"], {"default": "disable"}),
            },
            "optional": { 
                "VAE": ("VAE",), 
                "视频预览帧率": ("INT", {"default": 8, "min": 1, "max": 30}),
                "脚本": ("ZML_SCRIPT", {"tooltip": "添加额外的参数"}),
            },
            "hidden": {"prompt": "PROMPT", "unique_id": "UNIQUE_ID"},
        }
    RETURN_TYPES, RETURN_NAMES, FUNCTION, CATEGORY = ("LATENT", "IMAGE", "STRING"), ("LATENT", "图像", "生成信息"), "sample", "image/ZML_图像/采样器相关"

    def sample(self, 模型, 种子, 步数, CFG, 采样器, 调度器, 正面条件, 负面条件, Latent, 降噪, 预览方式, 噪波模式, 视频预览, VAE=None, 视频预览帧率=8, 脚本=None, prompt=None, unique_id=None):
        rng_rand_source("nv" if 噪波模式 == "gpu" else "cpu")
        video_preview_enabled = (视频预览 == "enable")
        serv.zml_video_preview_enabled, serv.zml_video_preview_rate = video_preview_enabled, 视频预览帧率
        
        with zml_preview(预览方式, video_preview_enabled):
            samples = run_zml_sampler(模型, 种子, 步数, CFG, 采样器, 调度器, 正面条件, 负面条件, Latent, denoise=降噪, disable_noise=False, start_step=0, last_step=步数, force_full_denoise=False, script=脚本)[0]
            
        # 修正：不论预览方式如何，只要有 VAE，永远输出真实的解码图像供后续节点使用
        if VAE: 
            image = VAEDecode().decode(VAE, samples)[0]
        else: 
            image = torch.zeros(1, 1, 3, dtype=torch.float32)
            
        if not video_preview_enabled: serv.send_sync('VHS_cleanup_preview', {'id': serv.last_node_id})
        if hasattr(serv, 'zml_video_preview_enabled'): del serv.zml_video_preview_enabled
        if hasattr(serv, 'zml_video_preview_rate'): del serv.zml_video_preview_rate
        auto_model, auto_pos, auto_neg = auto_discover_metadata(prompt, unique_id, 正面条件, 负面条件)
        gen_info = generate_webui_metadata_base(步数, 采样器, 调度器, CFG, 种子, Latent, model_name=auto_model, positive=auto_pos, negative=auto_neg)
        return samples, image, gen_info

class ZML_KSampler_Advanced:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "模型": ("MODEL",), "添加噪波": (["enable", "disable"],), "随机种子": ("INT", {"default": -1}),
                "步数": ("INT", {"default": 20}), "CFG": ("FLOAT", {"default": 8.0}),
                "采样器": (comfy.samplers.KSampler.SAMPLERS,), "调度器": (comfy.samplers.KSampler.SCHEDULERS,),
                "正面条件": ("CONDITIONING",), "负面条件": ("CONDITIONING",), "Latent": ("LATENT",),
                "开始步数": ("INT", {"default": 0}), "结束步数": ("INT", {"default": 10000}), "返回剩余噪波": (["enable", "disable"],),
                "预览方式": (["auto", "latent2rgb", "taesd", "none"], {"default": "auto"}),
                "噪波模式": (["cpu", "gpu"], {"default": "cpu"}), 
                "视频预览": (["enable", "disable"], {"default": "disable"}),
            },
            "optional": { 
                "VAE": ("VAE",), 
                "视频预览帧率": ("INT", {"default": 8, "min": 1, "max": 30}),
                "脚本": ("ZML_SCRIPT", {"tooltip": "添加额外噪波"}),
            },
            "hidden": {"prompt": "PROMPT", "unique_id": "UNIQUE_ID"},
        }
    RETURN_TYPES, RETURN_NAMES, FUNCTION, CATEGORY = ("LATENT", "IMAGE", "STRING"), ("LATENT", "图像", "生成信息"), "sample", "image/ZML_图像/采样器相关"

    def sample(self, 模型, 添加噪波, 随机种子, 步数, CFG, 采样器, 调度器, 正面条件, 负面条件, Latent, 开始步数, 结束步数, 返回剩余噪波, 预览方式, 噪波模式, 视频预览, VAE=None, 视频预览帧率=8, 脚本=None, prompt=None, unique_id=None):
        rng_rand_source("nv" if 噪波模式 == "gpu" else "cpu")
        video_preview_enabled = (视频预览 == "enable")
        serv.zml_video_preview_enabled, serv.zml_video_preview_rate = video_preview_enabled, 视频预览帧率
        
        disable_noise = (添加噪波 == "disable")
        force_full_denoise = (返回剩余噪波 == "disable")
        
        with zml_preview(预览方式, video_preview_enabled):
            samples = run_zml_sampler(模型, 随机种子, 步数, CFG, 采样器, 调度器, 正面条件, 负面条件, Latent, denoise=1.0, disable_noise=disable_noise, start_step=开始步数, last_step=结束步数, force_full_denoise=force_full_denoise, script=脚本)[0]
            
        # 修正：始终输出正常解码图像
        if VAE: 
            image = VAEDecode().decode(VAE, samples)[0]
        else: 
            image = torch.zeros(1, 1, 3, dtype=torch.float32)
            
        if not video_preview_enabled: serv.send_sync('VHS_cleanup_preview', {'id': serv.last_node_id})
        if hasattr(serv, 'zml_video_preview_enabled'): del serv.zml_video_preview_enabled
        if hasattr(serv, 'zml_video_preview_rate'): del serv.zml_video_preview_rate
        auto_model, auto_pos, auto_neg = auto_discover_metadata(prompt, unique_id, 正面条件, 负面条件)
        gen_info = generate_webui_metadata_base(步数, 采样器, 调度器, CFG, 随机种子, Latent, denoise=1.0, model_name=auto_model, positive=auto_pos, negative=auto_neg)
        return samples, image, gen_info

class ZML_SaveImageWithMetadata:
    def __init__(self):
        self.output_dir = folder_paths.get_output_directory()
        self.type, self.prefix_append, self.compress_level = "output", "", 4

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "图像": ("IMAGE", {"tooltip": "输入要保存的图像"}),
                "元数据保存格式": (["A1111数据+工作流", "仅工作流", "仅A1111数据", "不保存任何信息"], {"tooltip": "A1111数据+工作流模式下，会将正面提示词自动注入到文本块，以适配其它图像节点。"}),
                "lora保存格式": (["JSON格式", "A1111格式 (<>)"], {"tooltip": "选择附加的LoRA信息是以JSON格式(json格式可以通过'名称加载lora'节点加载使用)还是标准<lora:name:wt>格式保存。\n此接口需要从'ZML_强力_LoRA加载器'节点的'lora名称列表'接口来接入。"}),
                "保存路径": ("STRING", {"default": "./ZML-A1111/%Y-%m-%d", "tooltip": "支持时间代码 (如 %Y-%m-%d)，./ 代表 output 目录"}),
                "文件名": ("STRING", {"default": "ZML-%H%M%S", "tooltip": "文件名模式，支持时间代码"}), 
            },
            "optional": {
                "lora_信息": ("STRING", {"forceInput": True, "tooltip": "输入LoRA列表JSON字符串"}),
                "生成信息": ("STRING", {"forceInput": True, "tooltip": "来自ZML采样器的生成信息"}),
                "正面提示词": ("STRING", {"multiline": False, "default": "", "tooltip": "提示词保存优先级：1. 此输入框(优先使用) -> 2. 'ZML_K采样器'节点从'ZML_CLIP编码'节点获取的提示词 -> 3. 'ZML_K采样器'自动爬网线查找上游的文本输入节点"}),
                "负面提示词": ("STRING", {"multiline": False, "default": "", "tooltip": "提示词保存优先级：1. 此输入框(优先使用) -> 2. 'ZML_K采样器'节点从'ZML_CLIP编码'节点获取的提示词 -> 3. 'ZML_K采样器'自动爬网线查找上游的文本输入节点"}),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }
    RETURN_TYPES, FUNCTION, OUTPUT_NODE, CATEGORY = (), "save_images", True, "image/ZML_图像/采样器相关"

    def save_images(self, 图像, lora保存格式="JSON格式", 元数据保存格式="A1111数据+工作流", 保存路径="./ZML-A111/%Y-%m-%d", 文件名="ZML-%H%M%S", lora_信息=None, 生成信息=None, 正面提示词="", 负面提示词="", prompt=None, extra_pnginfo=None):
        now = datetime.datetime.now()
        try: p_filled, f_filled = now.strftime(保存路径), now.strftime(文件名)
        except: p_filled, f_filled = 保存路径, 文件名
        if p_filled.startswith("./"): abs_path = os.path.join(self.output_dir, p_filled[2:])
        else: abs_path = p_filled if os.path.isabs(p_filled) else os.path.join(self.output_dir, p_filled)
        full_path_prefix = os.path.join(abs_path, f_filled)
        full_output_folder, filename, counter, subfolder, filename_prefix = folder_paths.get_save_image_path(full_path_prefix, self.output_dir, 图像[0].shape[1], 图像[0].shape[0])
        
        parameters_text = ""
        need_a1111 = "A111" in 元数据保存格式
        need_workflow = "工作流" in 元数据保存格式
        save_text_block = "A1111数据+工作流" == 元数据保存格式

        if need_a1111:
            base_info = json.loads(生成信息) if 生成信息 else {}
            f_pos = 正面提示词 if 正面提示词.strip() else base_info.get("positive", "")
            f_neg = 负面提示词 if 负面提示词.strip() else base_info.get("negative", "")
            
            # --- 文本块逻辑 (必须在 LoRA 追加之前执行) ---
            if save_text_block:
                # 获取纯净的正面提示词 (移除潜在的 LoRA 标签)
                pos_for_block = f_pos
                
                # 1. 清理 <lora:name:wt>
                lora_regex = re.compile(r"<lora:([^:>]+)(?::([^:>]+))?(?::([^:>]+))?>")
                pos_for_block = lora_regex.sub("", pos_for_block)
                
                # 2. 清理 LoRA JSON (兼容行首或行内)
                # 移除以 LoRA JSON: 开头的行
                pos_lines = pos_for_block.split('\n')
                pos_for_block = "\n".join([line for line in pos_lines if not line.strip().startswith("LoRA JSON:")])
                
                # 移除行内的 [{"lora_name"...}] 结构
                json_regex = re.compile(r"\[\s*\{\s*\"lora_name\".*?\}\s*\]", re.DOTALL)
                pos_for_block = json_regex.sub("", pos_for_block)

                # 3. 清理多余逗号和空格
                pos_for_block = re.sub(r",\s*,", ",", pos_for_block).strip(" ,")
            # ----------------------------------------

            l_text = ""
            if lora_信息:
                if lora保存格式 == "A1111格式 (<>)":
                    try:
                        l_list = json.loads(lora_信息)
                        tags = [f"<lora:{l['lora_name'].replace('.safetensors','').replace('.ckpt','')}:{l['weight']}>" for l in l_list if l.get('lora_name')]
                        l_text = ", ".join(tags)
                    except: l_text = str(lora_信息)
                else: l_text = str(lora_信息)

            # LoRA 追加到正面提示词
            if l_text:
                if f_pos: f_pos = f"{f_pos}, {l_text}"
                else: f_pos = l_text

            lines = [f_pos] if f_pos else []
            n_part = f"Negative prompt: {f_neg}" if f_neg else ""
            if n_part: lines.append(n_part)

            params = [f"Steps: {base_info.get('steps','')}", f"Sampler: {base_info.get('sampler','')}", f"Schedule type: {base_info.get('scheduler','')}", f"CFG scale: {base_info.get('cfg','')}", f"Seed: {base_info.get('seed','')}", f"Size: {base_info.get('width','')}x{base_info.get('height','')}"]
            m_name = base_info.get('model','')
            if m_name: params.append(f"Model: {m_name.replace('.safetensors','').replace('.ckpt','')}")
            if base_info.get('denoise') and base_info['denoise'] < 1.0: params.append(f"Denoising strength: {base_info['denoise']}")
            params.append(f"Generation time: {now.strftime('%Y-%m-%d %H:%M:%S')}")
            lines.append(", ".join([p for p in params if p.strip()]))
            parameters_text = "\n".join(lines)

        results = []
        for image in 图像:
            img = Image.fromarray(np.clip(255. * image.cpu().numpy(), 0, 255).astype(np.uint8))
            metadata = PngImagePlugin.PngInfo()
            if need_a1111 and parameters_text: metadata.add_text("parameters", parameters_text)
            if need_workflow:
                if prompt: metadata.add_text("prompt", json.dumps(prompt))
                if extra_pnginfo:
                    for x in extra_pnginfo: metadata.add_text(x, json.dumps(extra_pnginfo[x]))
            
            # 写入净化后的文本块 (仅在 A1111+工作流 模式)
            if save_text_block and pos_for_block:
                metadata.add_text(DEFAULT_TEXT_BLOCK_KEY, pos_for_block, zip=True)

            fname = f"{filename}.png" if len(图像) == 1 else f"{filename}_{counter}.png"
            img.save(os.path.join(full_output_folder, fname), pnginfo=metadata, compress_level=self.compress_level)
            results.append({"filename": fname, "subfolder": subfolder, "type": self.type})
            counter += 1
        return {"ui": {"images": results}}

class ZML_LoadA1111Data:
    @classmethod
    def INPUT_TYPES(s):
        input_dir = folder_paths.get_input_directory()
        files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
        # 确保 image 在第一个
        return {
            "required": {
                "image": (sorted(files), {"image_upload": True}),
                "lora_output_format": (["JSON格式", "A1111格式 (<>)"],),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING", "INT", "FLOAT", "STRING", "STRING", "INT", "STRING", "INT", "INT", "STRING")
    RETURN_NAMES = ("正面提示词", "负面提示词", "LoRA", "步数", "CFG", "采样器", "调度器", "种子", "模型", "宽", "高", "完整A1111信息")
    FUNCTION = "load_a1111"
    CATEGORY = "image/ZML_图像/采样器相关"

    def load_a1111(self, image, lora_output_format):
        image_path = folder_paths.get_annotated_filepath(image)
        img = Image.open(image_path)
        
        full_info = ""
        if "parameters" in img.info:
            full_info = img.info["parameters"]
        elif "exif" in img.info:
            try:
                exif_data = img.getexif()
                if 0x9286 in exif_data:
                    full_info = exif_data[0x9286]
                    if isinstance(full_info, bytes):
                        full_info = full_info.decode('utf-8', errors='ignore').replace('\x00', '')
            except: pass
        
        if not full_info:
            return ("", "", "", 20, 8.0, "euler", "normal", 0, "", 512, 512, "")

        pos_part = ""
        neg_part = ""
        rest_part = ""
        
        parts = full_info.split("Negative prompt:")
        if len(parts) > 1:
            pos_part = parts[0].strip()
            remainder = parts[1]
            last_newline = remainder.rfind("\n")
            if last_newline != -1:
                potential_params = remainder[last_newline+1:].strip()
                if potential_params.startswith("Steps:"):
                    neg_part = remainder[:last_newline].strip()
                    rest_part = potential_params
                else:
                    neg_part = remainder.strip()
            else:
                neg_part = remainder.strip()
        else:
            last_newline = full_info.rfind("\n")
            if last_newline != -1:
                potential_params = full_info[last_newline+1:].strip()
                if potential_params.startswith("Steps:"):
                    pos_part = full_info[:last_newline].strip()
                    rest_part = potential_params
                else:
                    pos_part = full_info.strip()
            else:
                pos_part = full_info.strip()

        params = {}
        if rest_part:
            pairs = rest_part.split(", ")
            for p in pairs:
                if ": " in p:
                    k, v = p.split(": ", 1)
                    params[k] = v

        steps = int(params.get("Steps", 20))
        sampler = params.get("Sampler", "euler")
        scheduler = params.get("Schedule type", "normal")
        cfg = float(params.get("CFG scale", 8.0))
        seed = int(params.get("Seed", 0))
        model = params.get("Model", "")
        size = params.get("Size", "512x512")
        try: w, h = map(int, size.split("x"))
        except: w, h = 512, 512

        loras = []
        lora_pattern = re.compile(r"<lora:([^:>]+)(?::([^:>]+))?(?::([^:>]+))?>")
        
        found_tags = lora_pattern.findall(pos_part)
        for name, wt, _ in found_tags:
            weight = 1.0
            if wt:
                try: weight = float(wt)
                except: pass
            loras.append({"lora_name": name, "weight": weight})
            
        try:
            json_start = full_info.find('[{"lora_name"')
            if json_start != -1:
                json_end = full_info.find('}]', json_start) + 2
                json_str = full_info[json_start:json_end]
                json_data = json.loads(json_str)
                for l in json_data:
                    if not any(existing['lora_name'] == l['lora_name'] for existing in loras):
                        loras.append(l)
        except: pass

        pos_part = lora_pattern.sub("", pos_part)
        pos_lines = pos_part.split('\n')
        pos_part = "\n".join([line for line in pos_lines if not line.strip().startswith("LoRA:") and not line.strip().startswith("LoRA JSON:")])
        pos_part = re.sub(r",\s*,", ",", pos_part).strip(" ,")

        lora_out_str = ""
        if lora_output_format == "JSON格式":
            if loras:
                lora_out_str = json.dumps(loras, ensure_ascii=False)
        else: 
            tags = []
            for l in loras:
                tags.append(f"<lora:{l['lora_name']}:{l['weight']}>")
            lora_out_str = ", ".join(tags)

        return (pos_part, neg_part, lora_out_str, steps, cfg, sampler, scheduler, seed, model, w, h, full_info)

NODE_CLASS_MAPPINGS = {
    "ZML_KSampler": ZML_KSampler,
    "ZML_KSampler_Advanced": ZML_KSampler_Advanced,
    "ZML_SaveImageWithMetadata": ZML_SaveImageWithMetadata,
    "ZML_ConditionNode": ZML_ConditionNode,
    "ZML_LoadA1111Data": ZML_LoadA1111Data,
    "ZML_NoiseScriptNode": ZML_NoiseScriptNode,
    "ZML_BlurSharpenScriptNode": ZML_BlurSharpenScriptNode,
    "ZML_ContrastScriptNode": ZML_ContrastScriptNode,
    "ZML_DynamicCFGScriptNode": ZML_DynamicCFGScriptNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_KSampler": "ZML_K采样器",
    "ZML_KSampler_Advanced": "ZML_高级K采样器",
    "ZML_SaveImageWithMetadata": "ZML_保存图像(A1111)",
    "ZML_ConditionNode": "ZML_CLIP文本编码",
    "ZML_LoadA1111Data": "ZML_加载A1111数据",
    "ZML_NoiseScriptNode": "ZML_噪波脚本",
    "ZML_BlurSharpenScriptNode": "ZML_模糊锐化脚本",
    "ZML_ContrastScriptNode": "ZML_对比度脚本",
    "ZML_DynamicCFGScriptNode": "ZML_动态CFG脚本",
}