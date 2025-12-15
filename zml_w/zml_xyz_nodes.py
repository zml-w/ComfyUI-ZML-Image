import torch
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import math
import os
import re
import folder_paths
import comfy.sd
import comfy.utils

# ==========================================
# 工具函数
# ==========================================

# 1. 递归查找字体文件
def find_font_files():
    current_dir = os.path.dirname(os.path.abspath(__file__))
    font_dir = os.path.join(current_dir, "Font")
    
    font_files = []
    
    if os.path.exists(font_dir):
        for root, dirs, files in os.walk(font_dir):
            for file in files:
                if file.lower().endswith(('.ttf', '.otf', '.ttc')):
                    rel_path = os.path.relpath(os.path.join(root, file), font_dir)
                    font_files.append(rel_path)
    
    if not font_files:
        font_files = ["arial.ttf", "simhei.ttf", "msyh.ttf"]
    
    return font_files, font_dir

# 2. 字体加载
def get_font(font_name, size, font_dir):
    if font_dir:
        try:
            font_path = os.path.join(font_dir, font_name)
            if os.path.exists(font_path):
                return ImageFont.truetype(font_path, size)
        except: pass

    try:
        return ImageFont.truetype(font_name, size)
    except: pass

    system_fonts = [
        "simhei.ttf", "msyh.ttf", "simsun.ttc", 
        "arial.ttf", "segoeui.ttf", 
        "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
        "/System/Library/Fonts/PingFang.ttc"
    ]
    for path in system_fonts:
        try:
            return ImageFont.truetype(path, size)
        except: continue
            
    try:
        return ImageFont.load_default()
    except:
        return None

def text_size(draw, text, font):
    if hasattr(draw, "textbbox"):
        bbox = draw.textbbox((0, 0), text, font=font)
        return bbox[2] - bbox[0], bbox[3] - bbox[1]
    else:
        return draw.textsize(text, font=font)

COLOR_MAP = {
    "白色": "white", "黑色": "black", "红色": "red", 
    "绿色": "green", "蓝色": "blue", "黄色": "yellow", 
    "灰色": "gray", "透明": (0, 0, 0, 0)
}

# ==========================================
# 节点 1: ZML_XY_LoRA加载器
# ==========================================
class ZML_XY_LoRA_Loader:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "模型": ("MODEL",),
                "LoRA文件夹路径": ("STRING", {"default": "E:\\Models\\Loras", "multiline": False}),
                "LoRA数量": ("INT", {"default": 3, "min": 1, "step": 1}),
                "LoRA权重数量": ("INT", {"default": 2, "min": 1, "step": 1}),
                "权重起始值": ("FLOAT", {"default": 0.5, "min": -10.0, "max": 10.0, "step": 0.1}),
                "权重结束值": ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.1}),
                "XY互换": ("BOOLEAN", {"default": False, "label_on": "(X=权重, Y=LoRA)", "label_off": "(X=LoRA, Y=权重)"}),
            },
            "optional": {
                "CLIP": ("CLIP",),
            }
        }

    RETURN_TYPES = ("MODEL", "CLIP", "ZML_GRID_INFO")
    RETURN_NAMES = ("模型", "CLIP", "图表信息")
    OUTPUT_IS_LIST = (True, True, False)
    FUNCTION = "load_batch_loras"
    CATEGORY = "image/ZML_图像/XYZ"

    def load_batch_loras(self, 模型, LoRA文件夹路径, LoRA数量, LoRA权重数量, 权重起始值, 权重结束值, XY互换, CLIP=None):
        folder_path = LoRA文件夹路径.strip().strip('"')
        found_loras = []
        if os.path.exists(folder_path) and os.path.isdir(folder_path):
            valid_ext = {'.safetensors', '.pt', '.ckpt'}
            try:
                files = os.listdir(folder_path)
                files.sort()
                for f in files:
                    if os.path.splitext(f)[1].lower() in valid_ext:
                        found_loras.append(os.path.join(folder_path, f))
            except: pass
        
        lora_files = found_loras[:LoRA数量]
        if not lora_files: lora_files = [None]

        weights = []
        if LoRA权重数量 <= 1:
            weights = [权重起始值]
        else:
            step = (权重结束值 - 权重起始值) / (LoRA权重数量 - 1)
            for i in range(LoRA权重数量):
                weights.append(round(权重起始值 + i * step, 2))

        lora_labels = []
        for p in lora_files:
            if p:
                name = os.path.splitext(os.path.basename(p))[0]
                lora_labels.append(f"LoRA: {name}")
            else:
                lora_labels.append("无LoRA")
        
        weight_labels = [f"LoRA权重: {w}" for w in weights]

        if not XY互换:
            x_labels = lora_labels
            y_labels = weight_labels
            outer_loop = weights
            inner_loop = lora_files
            def get_args(inner_item, outer_item): return inner_item, outer_item
        else:
            x_labels = weight_labels
            y_labels = lora_labels
            outer_loop = lora_files
            inner_loop = weights
            def get_args(inner_item, outer_item): return outer_item, inner_item

        out_models = []
        out_clips = []
        loaded_cache = {}

        for outer_item in outer_loop:
            for inner_item in inner_loop:
                current_lora, current_weight = get_args(inner_item, outer_item)
                
                if current_lora is None:
                    out_models.append(模型)
                    out_clips.append(CLIP)
                    continue
                
                try:
                    if current_lora not in loaded_cache:
                        loaded_cache[current_lora] = comfy.utils.load_torch_file(current_lora)
                    lora_data = loaded_cache[current_lora]
                    
                    if CLIP is not None:
                        m, c = comfy.sd.load_lora_for_models(模型, CLIP, lora_data, current_weight, current_weight)
                        out_models.append(m)
                        out_clips.append(c)
                    else:
                        new_model = 模型.clone()
                        new_model.patch_model_lora(lora_data, current_weight)
                        out_models.append(new_model)
                        out_clips.append(None)
                except:
                    out_models.append(模型)
                    out_clips.append(CLIP)
                    
        del loaded_cache

        grid_info = {
            "x_labels": x_labels,
            "y_labels": y_labels,
            "count_x": len(inner_loop),
            "count_y": len(outer_loop),
            "total_images": len(out_models)
        }

        return (out_models, out_clips, grid_info)


# ==========================================
# 节点 2: ZML_XY_提示词
# ==========================================
class ZML_XY_Prompt_Loader:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "CLIP": ("CLIP",),
                "固定提示词": ("STRING", {"multiline": False, "default": "masterpiece, best quality, 1girl"}),
                "多行变量": ("STRING", {"multiline": True, "default": "red dress\nblue dress\nwhite dress"}),
                "分隔符": ("STRING", {"default": ", "}),
                "权重数量": ("INT", {"default": 2, "min": 1, "step": 1}),
                "权重起始值": ("FLOAT", {"default": 1.0, "min": -5, "max": 10.0, "step": 0.05}),
                "权重结束值": ("FLOAT", {"default": 1.2, "min": -5, "max": 10.0, "step": 0.05}),
                "XY互换": ("BOOLEAN", {"default": False, "label_on": "(X=权重, Y=提示词)", "label_off": "(X=提示词, Y=权重)"}),
            }
        }

    RETURN_TYPES = ("CONDITIONING", "ZML_GRID_INFO")
    RETURN_NAMES = ("条件(Conditioning)", "图表信息")
    OUTPUT_IS_LIST = (True, False)
    FUNCTION = "load_batch_prompts"
    CATEGORY = "image/ZML_图像/XYZ"

    def load_batch_prompts(self, CLIP, 固定提示词, 多行变量, 分隔符, 权重数量, 权重起始值, 权重结束值, XY互换):
        # 1. 解析 XY 提示词
        raw_prompts = [p.strip() for p in 多行变量.strip().split('\n') if p.strip()]
        if not raw_prompts:
            raw_prompts = [""] # 防止空列表

        # 2. 生成权重
        weights = []
        if 权重数量 <= 1:
            weights = [权重起始值]
        else:
            step = (权重结束值 - 权重起始值) / (权重数量 - 1)
            for i in range(权重数量):
                weights.append(round(权重起始值 + i * step, 2))

        # 3. 准备标签
        prompt_labels = [p if len(p) < 20 else p[:17]+"..." for p in raw_prompts]
        weight_labels = [f"权重: {w}" for w in weights]

        # 4. 确定 XY 逻辑
        if not XY互换:
            # 默认: X=提示词, Y=权重
            x_labels = prompt_labels
            y_labels = weight_labels
            outer_loop = weights        # 行 (Y)
            inner_loop = raw_prompts    # 列 (X)
            def get_args(inner_item, outer_item): return inner_item, outer_item # text, weight
        else:
            # 互换: X=权重, Y=提示词
            x_labels = weight_labels
            y_labels = prompt_labels
            outer_loop = raw_prompts    # 行 (Y)
            inner_loop = weights        # 列 (X)
            def get_args(inner_item, outer_item): return outer_item, inner_item # text, weight

        out_conds = []

        # 5. 循环生成
        for outer_item in outer_loop:
            for inner_item in inner_loop:
                current_text, current_weight = get_args(inner_item, outer_item)
                
                # 组合提示词: 固定 + (变量:权重)
                # 如果权重是 1.0 且不需要强调，虽然 Comfy 支持 (text:1.0)，但为了清晰我们保持格式
                if current_text:
                    part_xy = f"({current_text}:{current_weight})"
                    final_text = f"{固定提示词}{分隔符}{part_xy}"
                else:
                    final_text = 固定提示词
                
                # CLIP 编码
                tokens = CLIP.tokenize(final_text)
                cond, pooled = CLIP.encode_from_tokens(tokens, return_pooled=True)
                
                # 包装成 Condition List (ComfyUI 格式: [[cond_tensor, {"pooled_output": ...}]])
                out_conds.append([[cond, {"pooled_output": pooled}]])

        grid_info = {
            "x_labels": x_labels,
            "y_labels": y_labels,
            "count_x": len(inner_loop),
            "count_y": len(outer_loop),
            "total_images": len(out_conds)
        }

        return (out_conds, grid_info)


# ==========================================
# 节点 3: ZML_XY_图表拼接
# ==========================================
class ZML_XY_Grid_Drawer:
    @classmethod
    def INPUT_TYPES(cls):
        font_list, _ = find_font_files()
        
        return {
            "required": {
                "图像": ("IMAGE",), 
                "图表信息": ("ZML_GRID_INFO",),
                "字体": (font_list,),
                "字体大小": ("INT", {"default": 48, "min": 48}),
                "网格间距": ("INT", {"default": 10, "min": 0}),
                "背景颜色": (list(COLOR_MAP.keys()), {"default": "白色"}),
                "文字颜色": (list(COLOR_MAP.keys()), {"default": "黑色"}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("XYZ图表",)
    INPUT_IS_LIST = (True, False, False, False, False, False, False)
    FUNCTION = "draw_grid"
    CATEGORY = "image/ZML_图像/XYZ"

    def draw_grid(self, 图像, 图表信息, 字体, 字体大小, 网格间距, 背景颜色, 文字颜色):
        def to_scalar(v):
            if isinstance(v, list): return v[0]
            return v
            
        font_size = to_scalar(字体大小)
        margin = to_scalar(网格间距)
        bg_name = to_scalar(背景颜色)
        txt_name = to_scalar(文字颜色)
        font_name = to_scalar(字体)

        try:
            if isinstance(图像, torch.Tensor):
                image_batch = 图像
            else:
                image_batch = torch.cat(图像, dim=0)
        except:
            image_batch = 图像[0] if isinstance(图像, list) else 图像
            print("[ZML] 警告：图片尺寸不一致，可能导致拼接失败。")

        info = 图表信息[0] if isinstance(图表信息, list) else 图表信息
        x_labels = info.get("x_labels", [])
        y_labels = info.get("y_labels", [])
        cols = info.get("count_x", 1)
        rows = info.get("count_y", 1)
        
        _, font_dir = find_font_files()
        font = get_font(font_name, font_size, font_dir)
        if font is None: font = ImageFont.load_default()
        
        dummy_draw = ImageDraw.Draw(Image.new("RGB", (1, 1)))
        batch_size, img_h, img_w, _ = image_batch.shape
        
        header_h = 0
        if x_labels:
            try:
                max_h = max([text_size(dummy_draw, str(l), font)[1] for l in x_labels] + [0])
            except: max_h = 20
            header_h = max_h + margin * 2

        sidebar_w = 0
        if y_labels:
            try:
                max_w = max([text_size(dummy_draw, str(l), font)[0] for l in y_labels] + [0])
            except: max_w = 50
            sidebar_w = max_w + margin * 2

        grid_w = sidebar_w + (img_w + margin) * cols - margin
        grid_h = header_h + (img_h + margin) * rows - margin
        
        bg_col = COLOR_MAP.get(bg_name, "white")
        txt_col = COLOR_MAP.get(txt_name, "black")
        
        try:
            canvas = Image.new("RGB", (grid_w + margin*2, grid_h + margin*2), bg_col)
        except:
            canvas = Image.new("RGB", (grid_w + margin*2, grid_h + margin*2), "white")
            
        draw = ImageDraw.Draw(canvas)

        if header_h > 0:
            for i, text in enumerate(x_labels):
                str_text = str(text)
                tw, th = text_size(draw, str_text, font)
                x = margin + sidebar_w + i * (img_w + margin) + (img_w - tw) // 2
                y = margin + (header_h - th) // 2
                draw.text((x, y), str_text, fill=txt_col, font=font)

        if sidebar_w > 0:
            for j, text in enumerate(y_labels):
                str_text = str(text)
                tw, th = text_size(draw, str_text, font)
                x = margin + (sidebar_w - tw) // 2
                y = margin + header_h + j * (img_h + margin) + (img_h - th) // 2
                draw.text((x, y), str_text, fill=txt_col, font=font)

        for idx in range(batch_size):
            if idx >= cols * rows: break
            c = idx % cols
            r = idx // cols
            
            pil_img = Image.fromarray(np.clip(255. * image_batch[idx].cpu().numpy(), 0, 255).astype(np.uint8))
            
            x = margin + sidebar_w + c * (img_w + margin)
            y = margin + header_h + r * (img_h + margin)
            
            canvas.paste(pil_img, (x, y))

        return (torch.from_numpy(np.array(canvas).astype(np.float32) / 255.0)[None,],)

# ==========================================
# 节点 4: ZML_XY_采样参数 (CFG & Steps)
# ==========================================
class ZML_XY_Sampler_Params:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "步数数量": ("INT", {"default": 3, "min": 1, "step": 1}),
                "步数起始值": ("INT", {"default": 20, "min": 1, "max": 10000}),
                "步数结束值": ("INT", {"default": 30, "min": 1, "max": 10000}),
                
                "CFG数量": ("INT", {"default": 3, "min": 1, "step": 1}),
                "CFG起始值": ("FLOAT", {"default": 6.0, "min": 0.0, "max": 100.0, "step": 0.1}),
                "CFG结束值": ("FLOAT", {"default": 8.0, "min": 0.0, "max": 100.0, "step": 0.1}),
                
                "XY互换": ("BOOLEAN", {"default": False, "label_on": "(X=CFG, Y=步数)", "label_off": "(X=步数, Y=CFG)"}),
            }
        }

    RETURN_TYPES = ("INT", "FLOAT", "ZML_GRID_INFO")
    RETURN_NAMES = ("步数(Steps)", "CFG", "图表信息")
    OUTPUT_IS_LIST = (True, True, False)
    FUNCTION = "gen_batch_params"
    CATEGORY = "image/ZML_图像/XYZ"

    def gen_batch_params(self, 步数数量, 步数起始值, 步数结束值, CFG数量, CFG起始值, CFG结束值, XY互换):
        # 1. 生成步数列表
        steps_list = []
        if 步数数量 <= 1:
            steps_list = [步数起始值]
        else:
            # 线性插值并取整
            raw_steps = np.linspace(步数起始值, 步数结束值, 步数数量)
            steps_list = [int(round(s)) for s in raw_steps]
            # 去重保护（如果范围太小导致重复）- 暂时保留重复以维持网格结构
        
        # 2. 生成 CFG 列表
        cfg_list = []
        if CFG数量 <= 1:
            cfg_list = [CFG起始值]
        else:
            raw_cfgs = np.linspace(CFG起始值, CFG结束值, CFG数量)
            cfg_list = [round(float(c), 2) for c in raw_cfgs]

        # 3. 准备标签
        step_labels = [f"Steps: {s}" for s in steps_list]
        cfg_labels = [f"CFG: {c}" for c in cfg_list]

        # 4. 确定 XY 逻辑
        if not XY互换:
            # 默认: X=步数, Y=CFG
            x_labels = step_labels
            y_labels = cfg_labels
            outer_loop = cfg_list    # 行 (Y)
            inner_loop = steps_list  # 列 (X)
            def get_vals(inner_item, outer_item): return inner_item, outer_item # step, cfg
        else:
            # 互换: X=CFG, Y=步数
            x_labels = cfg_labels
            y_labels = step_labels
            outer_loop = steps_list  # 行 (Y)
            inner_loop = cfg_list    # 列 (X)
            def get_vals(inner_item, outer_item): return outer_item, inner_item # step, cfg

        out_steps = []
        out_cfgs = []

        # 5. 循环生成输出列表
        for outer_item in outer_loop:
            for inner_item in inner_loop:
                s, c = get_vals(inner_item, outer_item)
                out_steps.append(s)
                out_cfgs.append(c)

        grid_info = {
            "x_labels": x_labels,
            "y_labels": y_labels,
            "count_x": len(inner_loop),
            "count_y": len(outer_loop),
            "total_images": len(out_steps)
        }

        return (out_steps, out_cfgs, grid_info)

# ============================== 注册节点 ==============================
NODE_CLASS_MAPPINGS = {
    "ZML_XY_LoRA_Loader": ZML_XY_LoRA_Loader,
    "ZML_XY_Prompt_Loader": ZML_XY_Prompt_Loader,
    "ZML_XY_Sampler_Params": ZML_XY_Sampler_Params, 
    "ZML_XY_Grid_Drawer": ZML_XY_Grid_Drawer
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_XY_LoRA_Loader": "ZML_XY_LoRA加载器",
    "ZML_XY_Prompt_Loader": "ZML_XY_提示词",
    "ZML_XY_Sampler_Params": "ZML_XY_采样参数", 
    "ZML_XY_Grid_Drawer": "ZML_XY_图表拼接"
}