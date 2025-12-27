import torch
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import math
import os
import re
import folder_paths
import comfy.sd
import comfy.utils
import random

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
                "权重起始值": ("FLOAT", {"default": 0.8, "min": -10.0, "max": 10.0, "step": 0.05}),
                "权重结束值": ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.05}),
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

        # 修改：移除前缀，只保留核心信息
        lora_labels = []
        for p in lora_files:
            if p:
                name = os.path.splitext(os.path.basename(p))[0]
                lora_labels.append(name) # 只保留名称
            else:
                lora_labels.append("None")
        
        # 修改：移除前缀
        weight_labels = [f"{w}" for w in weights]

        if not XY互换:
            x_labels = lora_labels
            y_labels = weight_labels
            x_title = "LoRA"
            y_title = "权重"
            outer_loop = weights
            inner_loop = lora_files
            def get_args(inner_item, outer_item): return inner_item, outer_item
        else:
            x_labels = weight_labels
            y_labels = lora_labels
            x_title = "权重"
            y_title = "LoRA"
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
            "x_title": x_title, # 新增
            "y_title": y_title, # 新增
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
            raw_prompts = [""]

        # 2. 生成权重
        weights = []
        if 权重数量 <= 1:
            weights = [权重起始值]
        else:
            step = (权重结束值 - 权重起始值) / (权重数量 - 1)
            for i in range(权重数量):
                weights.append(round(权重起始值 + i * step, 2))

        # 3. 准备标签 (移除前缀)
        prompt_labels = [p if len(p) < 20 else p[:17]+"..." for p in raw_prompts]
        weight_labels = [f"{w}" for w in weights]

        # 4. 确定 XY 逻辑
        if not XY互换:
            # 默认: X=提示词, Y=权重
            x_labels = prompt_labels
            y_labels = weight_labels
            x_title = "提示词"
            y_title = "权重"
            outer_loop = weights        # 行 (Y)
            inner_loop = raw_prompts    # 列 (X)
            def get_args(inner_item, outer_item): return inner_item, outer_item 
        else:
            # 互换: X=权重, Y=提示词
            x_labels = weight_labels
            y_labels = prompt_labels
            x_title = "权重"
            y_title = "提示词"
            outer_loop = raw_prompts    # 行 (Y)
            inner_loop = weights        # 列 (X)
            def get_args(inner_item, outer_item): return outer_item, inner_item

        out_conds = []

        # 5. 循环生成
        for outer_item in outer_loop:
            for inner_item in inner_loop:
                current_text, current_weight = get_args(inner_item, outer_item)
                
                if current_text:
                    part_xy = f"({current_text}:{current_weight})"
                    final_text = f"{固定提示词}{分隔符}{part_xy}"
                else:
                    final_text = 固定提示词
                
                # CLIP 编码
                tokens = CLIP.tokenize(final_text)
                cond, pooled = CLIP.encode_from_tokens(tokens, return_pooled=True)
                
                out_conds.append([[cond, {"pooled_output": pooled}]])

        grid_info = {
            "x_labels": x_labels,
            "y_labels": y_labels,
            "x_title": x_title,
            "y_title": y_title,
            "count_x": len(inner_loop),
            "count_y": len(outer_loop),
            "total_images": len(out_conds)
        }

        return (out_conds, grid_info)


# ==========================================
# 节点 3: ZML_XY_图表拼接 (核心修改)
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
                "字体大小": ("INT", {"default": 48, "min": 12}),
                "网格间距": ("INT", {"default": 10, "min": 0}),
                "背景颜色": (list(COLOR_MAP.keys()), {"default": "白色"}),
                "文字颜色": (list(COLOR_MAP.keys()), {"default": "黑色"}),
                "单元格图片排布": (["横向排列", "竖向排列"], {"default": "横向排列", "tooltip": "一个单元格内有多张图时，它们的排列方向"}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("XYZ图表",)
    INPUT_IS_LIST = (True, False, False, False, False, False, False, False, False)
    FUNCTION = "draw_grid"
    CATEGORY = "image/ZML_图像/XYZ"

    def draw_grid(self, 图像, 图表信息, 字体, 字体大小, 网格间距, 背景颜色, 文字颜色, 单元格图片排布):
        def to_scalar(v, default=None):
            if isinstance(v, list): return v[0] if len(v) > 0 else default
            return v
            
        font_size = to_scalar(字体大小)
        margin = to_scalar(网格间距)
        bg_name = to_scalar(背景颜色)
        txt_name = to_scalar(文字颜色)
        font_name = to_scalar(字体)
        cell_layout = to_scalar(单元格图片排布)

        pil_images_batch = []
        for img_tensor in 图像:
            if isinstance(img_tensor, torch.Tensor):
                if len(img_tensor.shape) == 4:
                    for i in range(img_tensor.shape[0]):
                        pil_images_batch.append(Image.fromarray(np.clip(255. * img_tensor[i].cpu().numpy(), 0, 255).astype(np.uint8)))
                elif len(img_tensor.shape) == 3:
                    pil_images_batch.append(Image.fromarray(np.clip(255. * img_tensor.cpu().numpy(), 0, 255).astype(np.uint8)))
            else:
                pil_images_batch.append(Image.fromarray(np.clip(255. * img_tensor.cpu().numpy(), 0, 255).astype(np.uint8)))

        if not pil_images_batch:
            return (torch.zeros(1, 64, 64, 3),)

        first_img_h, first_img_w = pil_images_batch[0].height, pil_images_batch[0].width

        info = 图表信息[0] if isinstance(图表信息, list) else 图表信息
        x_labels = info.get("x_labels", [])
        y_labels = info.get("y_labels", [])
        x_title = info.get("x_title", "")
        y_title = info.get("y_title", "")
        
        cols = info.get("count_x", 1)
        rows = info.get("count_y", 1)
        cell_image_counts = info.get("cell_image_counts", [1] * (cols * rows))
        if len(cell_image_counts) != (cols * rows):
            cell_image_counts = [1] * (cols * rows)
        
        _, font_dir = find_font_files()
        font = get_font(font_name, font_size, font_dir)
        if font is None: font = ImageFont.load_default()
        
        dummy_draw = ImageDraw.Draw(Image.new("RGB", (1, 1)))

        # 准备左上角文本 (Y \ X)
        corner_text = ""
        if x_title or y_title:
            corner_text = f"{y_title} \\ {x_title}"
        
        corner_w, corner_h = 0, 0
        if corner_text:
             corner_w, corner_h = text_size(dummy_draw, corner_text, font)

        # 计算头部和侧边栏尺寸
        header_h = 0
        if x_labels or corner_text:
            max_header_label_h = 0
            for label in x_labels:
                _, th = text_size(dummy_draw, str(label), font)
                max_header_label_h = max(max_header_label_h, th)
            
            # 头部高度至少要容纳标签高度，也要考虑角标文本的高度
            header_h = max(max_header_label_h, corner_h) + margin * 2

        sidebar_w = 0
        if y_labels or corner_text:
            max_sidebar_label_w = 0
            for label in y_labels:
                tw, _ = text_size(dummy_draw, str(label), font)
                max_sidebar_label_w = max(max_sidebar_label_w, tw)
            
            # 侧边宽度至少要容纳标签宽度，也要考虑角标文本的宽度
            sidebar_w = max(max_sidebar_label_w, corner_w) + margin * 2

        # 预先计算每个逻辑单元格的实际尺寸
        cell_actual_widths = [0] * cols
        cell_actual_heights = [0] * rows
        
        current_image_idx = 0
        for r_idx in range(rows):
            for c_idx in range(cols):
                linear_idx = r_idx * cols + c_idx
                num_images_in_current_cell = cell_image_counts[linear_idx]
                
                if num_images_in_current_cell == 0:
                    cell_img_w = first_img_w
                    cell_img_h = first_img_h
                elif cell_layout == "横向排列":
                    cell_img_w = first_img_w * num_images_in_current_cell + margin * max(0, num_images_in_current_cell - 1)
                    cell_img_h = first_img_h
                else:
                    cell_img_w = first_img_w
                    cell_img_h = first_img_h * num_images_in_current_cell + margin * max(0, num_images_in_current_cell - 1)
                
                cell_actual_widths[c_idx] = max(cell_actual_widths[c_idx], cell_img_w)
                cell_actual_heights[r_idx] = max(cell_actual_heights[r_idx], cell_img_h)
                
                current_image_idx += cell_image_counts[linear_idx]

        grid_content_w = sum(cell_actual_widths) + margin * max(0, cols - 1)
        grid_content_h = sum(cell_actual_heights) + margin * max(0, rows - 1)

        canvas_w = sidebar_w + grid_content_w + margin * 2
        canvas_h = header_h + grid_content_h + margin * 2
        
        bg_col = COLOR_MAP.get(bg_name, "white")
        txt_col = COLOR_MAP.get(txt_name, "black")
        
        canvas = Image.new("RGB", (canvas_w, canvas_h), bg_col)
        draw = ImageDraw.Draw(canvas)

        # === 绘制左上角角标 ===
        if corner_text and sidebar_w > 0 and header_h > 0:
            # 绘制文字居中
            cx = margin + (sidebar_w - margin*2 - corner_w) // 2
            cy = margin + (header_h - margin*2 - corner_h) // 2
            # 确保不小于0
            cx = max(cx, 0)
            cy = max(cy, 0)
            
            draw.text((cx, cy), corner_text, fill=txt_col, font=font)
            
            # 可选：绘制一条简单的对角线装饰 (左上->右下 of the box)
            # box_w = sidebar_w
            # box_h = header_h
            # draw.line([(0, 0), (box_w, box_h)], fill=txt_col, width=2)

        # 绘制 X 轴标签
        current_x = sidebar_w + margin
        for i, text in enumerate(x_labels):
            str_text = str(text)
            tw, th = text_size(draw, str_text, font)
            col_width = cell_actual_widths[i]
            x_pos = current_x + (col_width - tw) // 2
            y_pos = margin + (header_h - margin*2 - th) // 2 # 垂直居中于header区域
            draw.text((x_pos, y_pos), str_text, fill=txt_col, font=font)
            current_x += col_width + margin

        # 绘制 Y 轴标签
        current_y = header_h + margin
        for j, text in enumerate(y_labels):
            str_text = str(text)
            tw, th = text_size(draw, str_text, font)
            row_height = cell_actual_heights[j]
            x_pos = margin + (sidebar_w - margin*2 - tw) // 2 # 水平居中于sidebar区域
            y_pos = current_y + (row_height - th) // 2
            draw.text((x_pos, y_pos), str_text, fill=txt_col, font=font)
            current_y += row_height + margin

        # 绘制图片
        current_image_batch_idx = 0
        for r_idx in range(rows):
            for c_idx in range(cols):
                linear_idx = r_idx * cols + c_idx
                num_images_in_cell = cell_image_counts[linear_idx]

                cell_start_x = sidebar_w + margin + sum(cell_actual_widths[:c_idx]) + margin * c_idx
                cell_start_y = header_h + margin + sum(cell_actual_heights[:r_idx]) + margin * r_idx
                
                current_cell_actual_w = cell_actual_widths[c_idx]
                current_cell_actual_h = cell_actual_heights[r_idx]

                sub_img_x_offset = 0
                sub_img_y_offset = 0
                
                for k in range(num_images_in_cell):
                    if current_image_batch_idx >= len(pil_images_batch):
                        break
                    
                    pil_img = pil_images_batch[current_image_batch_idx]
                    
                    if cell_layout == "横向排列":
                        paste_x = cell_start_x + sub_img_x_offset
                        paste_y = cell_start_y + (current_cell_actual_h - pil_img.height) // 2
                        sub_img_x_offset += pil_img.width + margin
                    else:
                        paste_x = cell_start_x + (current_cell_actual_w - pil_img.width) // 2
                        paste_y = cell_start_y + sub_img_y_offset
                        sub_img_y_offset += pil_img.height + margin
                    
                    canvas.paste(pil_img, (paste_x, paste_y))
                    current_image_batch_idx += 1
                
                current_image_batch_idx += (cell_image_counts[linear_idx] - num_images_in_cell)
                if current_image_batch_idx < 0 : current_image_batch_idx = 0

        return (torch.from_numpy(np.array(canvas).astype(np.float32) / 255.0).unsqueeze(0),)

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
        steps_list = []
        if 步数数量 <= 1:
            steps_list = [步数起始值]
        else:
            raw_steps = np.linspace(步数起始值, 步数结束值, 步数数量)
            steps_list = [int(round(s)) for s in raw_steps]
        
        cfg_list = []
        if CFG数量 <= 1:
            cfg_list = [CFG起始值]
        else:
            raw_cfgs = np.linspace(CFG起始值, CFG结束值, CFG数量)
            cfg_list = [round(float(c), 2) for c in raw_cfgs]

        # 移除前缀
        step_labels = [f"{s}" for s in steps_list]
        cfg_labels = [f"{c}" for c in cfg_list]

        if not XY互换:
            x_labels = step_labels
            y_labels = cfg_labels
            x_title = "Steps"
            y_title = "CFG"
            outer_loop = cfg_list    # 行 (Y)
            inner_loop = steps_list  # 列 (X)
            def get_vals(inner_item, outer_item): return inner_item, outer_item
        else:
            x_labels = cfg_labels
            y_labels = step_labels
            x_title = "CFG"
            y_title = "Steps"
            outer_loop = steps_list  # 行 (Y)
            inner_loop = cfg_list    # 列 (X)
            def get_vals(inner_item, outer_item): return outer_item, inner_item

        out_steps = []
        out_cfgs = []

        for outer_item in outer_loop:
            for inner_item in inner_loop:
                s, c = get_vals(inner_item, outer_item)
                out_steps.append(s)
                out_cfgs.append(c)

        grid_info = {
            "x_labels": x_labels,
            "y_labels": y_labels,
            "x_title": x_title,
            "y_title": y_title,
            "count_x": len(inner_loop),
            "count_y": len(outer_loop),
            "total_images": len(out_steps)
        }

        return (out_steps, out_cfgs, grid_info)

# ==========================================
# 节点 5: ZML_XY_LoRA加载器V2
# ==========================================
class ZML_XY_LoRA_Loader_V2:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "模型": ("MODEL",),
                "CLIP": ("CLIP",),
                "LoRA文件夹路径": ("STRING", {"default": "E:\\Models\\Loras", "multiline": False}),
                "LoRA数量": ("INT", {"default": 3, "min": 1, "step": 1}),
                "LoRA权重数量": ("INT", {"default": 2, "min": 1, "step": 1}),
                "权重起始值": ("FLOAT", {"default": 0.8, "min": -10.0, "max": 10.0, "step": 0.05}),
                "权重结束值": ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.05}),
                "多行文本": ("STRING", {"default": "", "multiline": True, "placeholder": "节点会读取LoRA的子文件夹'zml'里的同名txt文件。若不存在，则读取LoRA相同目录下的同名txt文件。"}),
                "txt联结方式": (["全部内容", "每行独立"], {"default": "全部内容", "tooltip": "每行独立是将txt里的每一行都独立输出，如果txt里有三行提示词，那就会输出三份条件"}),
                "XY互换": ("BOOLEAN", {"default": False, "label_on": "(X=权重, Y=LoRA)", "label_off": "(X=LoRA, Y=权重)"}),
            }
        }

    RETURN_TYPES = ("MODEL", "CONDITIONING", "ZML_GRID_INFO")
    RETURN_NAMES = ("模型", "条件", "图表信息")
    OUTPUT_IS_LIST = (True, True, False)
    FUNCTION = "load_batch_loras_v2"
    CATEGORY = "image/ZML_图像/XYZ"

    def load_batch_loras_v2(self, 模型, CLIP, LoRA文件夹路径, LoRA数量, LoRA权重数量, 权重起始值, 权重结束值, 多行文本, txt联结方式, XY互换):
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

        # 修改：移除前缀
        lora_labels = []
        for p in lora_files:
            if p:
                name = os.path.splitext(os.path.basename(p))[0]
                lora_labels.append(name)
            else:
                lora_labels.append("None")
        
        weight_labels = [f"{w}" for w in weights]

        if not XY互换:
            x_labels = lora_labels
            y_labels = weight_labels
            x_title = "LoRA"
            y_title = "权重"
            outer_loop_items = weights
            inner_loop_items = lora_files
            def get_args(inner_item, outer_item): return inner_item, outer_item
        else:
            x_labels = weight_labels
            y_labels = lora_labels
            x_title = "权重"
            y_title = "LoRA"
            outer_loop_items = lora_files
            inner_loop_items = weights
            def get_args(inner_item, outer_item): return outer_item, inner_item

        out_models = []
        out_conds = []
        loaded_cache = {}
        
        cell_image_counts = []

        # 获取处理后的文本列表
        def get_prompt_list(lora_path):
            # 基础文本
            base_text = 多行文本.strip()
            
            # 读取文件内容
            file_lines = []
            if lora_path:
                lora_dir = os.path.dirname(lora_path)
                lora_name = os.path.splitext(os.path.basename(lora_path))[0]
                
                zml_txt_path = os.path.join(lora_dir, "zml", f"{lora_name}.txt")
                txt_path = os.path.join(lora_dir, f"{lora_name}.txt")
                
                target_path = None
                if os.path.exists(zml_txt_path):
                    target_path = zml_txt_path
                elif os.path.exists(txt_path):
                    target_path = txt_path
                
                if target_path:
                    try:
                        with open(target_path, 'r', encoding='utf-8') as f:
                            # 读取所有非空行
                            file_lines = [line.strip() for line in f.readlines() if line.strip()]
                    except:
                        pass
            
            prompts = []
            
            if txt联结方式 == "全部内容":
                # 合并模式
                parts = []
                if base_text: parts.append(base_text)
                if file_lines: parts.append(", ".join(file_lines))
                prompts.append(", ".join(parts) if parts else "")
            else:
                # 独立模式
                if not file_lines:
                    prompts.append(base_text)
                else:
                    for line in file_lines:
                        parts = []
                        if base_text: parts.append(base_text)
                        parts.append(line)
                        prompts.append(", ".join(parts))
            
            return [p for p in prompts if p or not base_text and not file_lines]

        # 主循环
        for outer_idx, outer_item in enumerate(outer_loop_items):
            for inner_idx, inner_item in enumerate(inner_loop_items):
                current_lora, current_weight = get_args(inner_item, outer_item)
                
                prompts_to_process = get_prompt_list(current_lora)
                if not prompts_to_process: prompts_to_process = [""]
                
                cell_image_count = len(prompts_to_process)
                cell_image_counts.append(cell_image_count)

                # 准备模型
                current_model = None
                current_patched_clip = CLIP
                
                if current_lora is not None:
                    try:
                        if current_lora not in loaded_cache:
                            loaded_cache[current_lora] = comfy.utils.load_torch_file(current_lora)
                        lora_data = loaded_cache[current_lora]
                        
                        m, c_patched = comfy.sd.load_lora_for_models(模型, CLIP, lora_data, current_weight, current_weight)
                        current_model = m
                        current_patched_clip = c_patched
                    except Exception as e:
                        print(f"Error loading LoRA {current_lora}: {e}")
                        current_model = 模型
                        current_patched_clip = CLIP
                else:
                    current_model = 模型
                    current_patched_clip = CLIP

                for prompt_text in prompts_to_process:
                    out_models.append(current_model)

                    tokens = current_patched_clip.tokenize(prompt_text)
                    cond, pooled = current_patched_clip.encode_from_tokens(tokens, return_pooled=True)
                    out_conds.append([[cond, {"pooled_output": pooled}]])
                    
        del loaded_cache

        grid_info = {
            "x_labels": x_labels,
            "y_labels": y_labels,
            "x_title": x_title,
            "y_title": y_title,
            "count_x": len(inner_loop_items),
            "count_y": len(outer_loop_items),
            "cell_image_counts": cell_image_counts, 
            "total_images": len(out_models) 
        }

        return (out_models, out_conds, grid_info)

# ==========================================
# 节点 6: ZML_XY_自定义图表 
# ==========================================
class ZML_XY_Custom_Grid:
    @classmethod
    def INPUT_TYPES(cls):
        font_list, _ = find_font_files()
        
        return {
            "required": {
                "类型": (["字符串", "数字", "无"], {"default": "字符串"}),
                "多行文本": ("STRING", {"multiline": True, "default": "", "placeholder": "每行对应一张图 (类型选字符串时生效)"}),
                "拼接方向": (["左", "右", "上", "下"], {"default": "右"}),
                "单行上限": ("INT", {"default": 0, "min": 0, "max": 100, "step": 1, "display": "number", "tooltip": "0表示不限制"}),
                "数字起始数": ("FLOAT", {"default": 0.0, "min": -10000.0, "max": 10000.0, "step": 0.1}),
                "数字步长": ("FLOAT", {"default": 1.0, "min": -10000.0, "max": 1000.0, "step": 0.1}),
                "字体": (font_list,),
                "字体大小": ("INT", {"default": 96, "min": 12}),
                "字体颜色": ("STRING", {"default": "#000000", "tooltip": "留空=透明, ZML=随机"}),
                "背景颜色": ("STRING", {"default": "#FFFFFF", "tooltip": "单元格背景。留空=透明, ZML=随机"}),
                "内边框大小": ("INT", {"default": 30, "min": 0, "display": "number"}),
                "内边框颜色": ("STRING", {"default": "#FFFFFF", "tooltip": "图片间隙颜色。留空=透明, ZML=随机"}),
                "外边框大小": ("INT", {"default": 30, "min": 0, "display": "number"}),
                "外边框颜色": ("STRING", {"default": "#000000", "tooltip": "整体外框颜色。留空=透明, ZML=随机"}),
                "图像": ("IMAGE",),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("自定义图表",)
    INPUT_IS_LIST = (False, False, False, False, False, False, False, False, False, False, False, False, False, False, True)
    FUNCTION = "draw_custom_grid"
    CATEGORY = "image/ZML_图像/XYZ"
    
    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")

    def _parse_color(self, color_str, default_color=(0, 0, 0, 0)):
        if not color_str:
            return default_color
        s = str(color_str).strip().lower()
        if s == "":
            return default_color
        elif s == "zml":
            return (random.randint(0, 255), random.randint(0, 255), random.randint(0, 255), 255)
        else:
            try:
                from PIL import ImageColor
                c = ImageColor.getrgb(str(color_str))
                if len(c) == 3:
                    return c + (255,)
                return c
            except:
                return default_color

    def draw_custom_grid(self, 类型, 多行文本, 拼接方向, 单行上限, 
                         数字起始数, 数字步长,
                         字体, 字体大小, 字体颜色, 背景颜色,
                         内边框大小, 内边框颜色, 外边框大小, 外边框颜色, 
                         图像):
        
        # --- 输入数据清洗 ---
        def clean_text(v):
            if isinstance(v, list):
                return "\n".join([str(x) for x in v if x is not None])
            return str(v) if v is not None else ""

        def to_scalar(v, default=None):
            if isinstance(v, list):
                return v[0] if len(v) > 0 else default
            return v if v is not None else default

        多行文本 = clean_text(多行文本)
        类型 = to_scalar(类型, "字符串")
        数字起始数 = to_scalar(数字起始数, 0.0)
        数字步长 = to_scalar(数字步长, 1.0)
        拼接方向 = to_scalar(拼接方向, "右")
        单行上限 = to_scalar(单行上限, 0)
        
        内边框大小 = to_scalar(内边框大小, 10)
        内边框颜色 = to_scalar(内边框颜色, "") 
        外边框大小 = to_scalar(外边框大小, 20)
        外边框颜色 = to_scalar(外边框颜色, "#FFFFFF")
        
        字体 = to_scalar(字体)
        字体大小 = to_scalar(字体大小, 48)
        字体颜色 = to_scalar(字体颜色, "#000000")
        背景颜色 = to_scalar(背景颜色, "#FFFFFF")
        
        # 颜色解析
        txt_col = self._parse_color(字体颜色, (0, 0, 0, 255))
        bg_col = self._parse_color(背景颜色, (0, 0, 0, 0))
        inner_border_col = self._parse_color(内边框颜色, (0, 0, 0, 0))
        outer_border_col = self._parse_color(外边框颜色, (0, 0, 0, 0))

        # 3. 图像展开
        flattened_images = []
        if not isinstance(图像, list):
            图像 = [图像]
            
        for img in 图像:
            if isinstance(img, torch.Tensor):
                if len(img.shape) == 4:
                    for i in range(img.shape[0]):
                        flattened_images.append(img[i])
                elif len(img.shape) == 3:
                    flattened_images.append(img)
            else:
                pass

        num_images = len(flattened_images)
        if num_images == 0:
            return (torch.zeros(1, 100, 100, 3),)

        labels = []
        if 类型 == "无":
            labels = [None] * num_images
        elif 类型 == "数字":
            labels = [f"{数字起始数 + i * 数字步长:.2f}" for i in range(num_images)]
        else: # 字符串
            if 多行文本.strip():
                lines = [line.strip() for line in 多行文本.strip().split('\n') if line.strip()]
                if lines:
                    labels = lines * ((num_images + len(lines) - 1) // len(lines))
                    labels = labels[:num_images]
            if not labels:
                labels = [str(i) for i in range(num_images)]

        _, font_dir = find_font_files()
        font = get_font(字体, 字体大小, font_dir)
        if font is None: font = ImageFont.load_default()
        dummy_draw = ImageDraw.Draw(Image.new("RGBA", (1, 1)))

        max_img_w, max_img_h = 0, 0
        pil_images = []
        for tensor in flattened_images:
            img_np = np.clip(255. * tensor.cpu().numpy(), 0, 255).astype(np.uint8)
            pil = Image.fromarray(img_np).convert("RGBA")
            pil_images.append(pil)
            max_img_w = max(max_img_w, pil.width)
            max_img_h = max(max_img_h, pil.height)

        max_text_h = 0
        text_padding = 0
        
        if 类型 != "无":
            for txt in labels:
                if txt:
                    _, th = text_size(dummy_draw, str(txt), font)
                    max_text_h = max(max_text_h, th)
            
            if max_text_h > 0:
                text_padding = max(30, int(字体大小 * 0.50))

        # 单元格尺寸
        cell_w = max_img_w
        cell_h = max_img_h + max_text_h + text_padding

        cols = 0
        rows = 0
        limit = 单行上限
        if limit <= 0: limit = num_images

        if 拼接方向 in ["左", "右"]:
            cols = min(num_images, limit)
            rows = math.ceil(num_images / cols)
        else:
            rows = min(num_images, limit)
            cols = math.ceil(num_images / rows)

        # 尺寸计算
        content_w = (cols * cell_w) + (max(0, cols - 1) * 内边框大小)
        content_h = (rows * cell_h) + (max(0, rows - 1) * 内边框大小)
        
        total_w = content_w + (外边框大小 * 2)
        total_h = content_h + (外边框大小 * 2)
        
        # --- 绘制逻辑 ---
        
        content_canvas = Image.new("RGBA", (content_w, content_h), inner_border_col)
        draw_content = ImageDraw.Draw(content_canvas)
        
        for idx, (pil_img, label_text) in enumerate(zip(pil_images, labels)):
            if 拼接方向 == "右": c, r = idx % cols, idx // cols
            elif 拼接方向 == "左": c, r = idx % cols, idx // cols
            elif 拼接方向 in ["下", "上"]: r, c = idx % rows, idx // rows
            
            x = c * (cell_w + 内边框大小)
            y = r * (cell_h + 内边框大小)

            content_canvas.paste((0, 0, 0, 0), (x, y, x + cell_w, y + cell_h))
            if bg_col[3] > 0:
                draw_content.rectangle([x, y, x + cell_w, y + cell_h], fill=bg_col)

            if label_text:
                tw, th = text_size(draw_content, str(label_text), font)
                tx = x + (cell_w - tw) // 2
                ty = y 
                draw_content.text((tx, ty), str(label_text), fill=txt_col, font=font)

            img_x = x + (cell_w - pil_img.width) // 2
            img_y_start = y + max_text_h + text_padding
            img_y = img_y_start + (max_img_h - pil_img.height) // 2
            
            content_canvas.paste(pil_img, (img_x, img_y), pil_img if pil_img.mode == 'RGBA' else None)

        total_slots = cols * rows
        if num_images < total_slots:
            for idx in range(num_images, total_slots):
                if 拼接方向 == "右": c, r = idx % cols, idx // cols
                elif 拼接方向 == "左": c, r = idx % cols, idx // cols
                elif 拼接方向 in ["下", "上"]: r, c = idx % rows, idx // rows
                
                x = c * (cell_w + 内边框大小)
                y = r * (cell_h + 内边框大小)
                
                content_canvas.paste((0, 0, 0, 0), (x, y, x + cell_w, y + cell_h))
                if bg_col[3] > 0:
                    draw_content.rectangle([x, y, x + cell_w, y + cell_h], fill=bg_col)

        final_canvas = Image.new("RGBA", (total_w, total_h), (0, 0, 0, 0))
        draw_final = ImageDraw.Draw(final_canvas)
        
        if outer_border_col[3] > 0 and 外边框大小 > 0:
            draw_final.rectangle([0, 0, total_w, 外边框大小], fill=outer_border_col)
            draw_final.rectangle([0, total_h - 外边框大小, total_w, total_h], fill=outer_border_col)
            draw_final.rectangle([0, 0, 外边框大小, total_h], fill=outer_border_col)
            draw_final.rectangle([total_w - 外边框大小, 0, total_w, total_h], fill=outer_border_col)
        
        final_canvas.paste(content_canvas, (外边框大小, 外边框大小), content_canvas if content_canvas.mode == 'RGBA' else None)

        return (torch.from_numpy(np.array(final_canvas).astype(np.float32) / 255.0).unsqueeze(0),)

# ============================== 注册节点 ==============================
NODE_CLASS_MAPPINGS = {
    "ZML_XY_LoRA_Loader": ZML_XY_LoRA_Loader,
    "ZML_XY_LoRA_Loader_V2": ZML_XY_LoRA_Loader_V2,
    "ZML_XY_Prompt_Loader": ZML_XY_Prompt_Loader,
    "ZML_XY_Sampler_Params": ZML_XY_Sampler_Params, 
    "ZML_XY_Grid_Drawer": ZML_XY_Grid_Drawer,
    "ZML_XY_Custom_Grid": ZML_XY_Custom_Grid
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_XY_LoRA_Loader": "ZML_XY_LoRA加载器",
    "ZML_XY_LoRA_Loader_V2": "ZML_XY_LoRA加载器V2",
    "ZML_XY_Prompt_Loader": "ZML_XY_提示词",
    "ZML_XY_Sampler_Params": "ZML_XY_采样参数", 
    "ZML_XY_Grid_Drawer": "ZML_XY_图表拼接",
    "ZML_XY_Custom_Grid": "ZML_XY_自定义图表"
}