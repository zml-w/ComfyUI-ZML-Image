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

# 新增：文本自动换行计算函数
def get_wrapped_text(draw, text, font, max_width):
    if not text:
        return [], 0
    
    # 估算单行高度
    _, line_height = text_size(draw, "Wg", font)
    
    lines = []
    
    # 简单的分词策略：优先按空格分，长文件名可能没空格，需要按字符分
    # 这里采用一种混合策略，逐字符累加，超过宽度就换行
    current_line = ""
    for char in text:
        test_line = current_line + char
        w, h = text_size(draw, test_line, font)
        if w <= max_width:
            current_line = test_line
        else:
            if current_line:
                lines.append(current_line)
            current_line = char
    if current_line:
        lines.append(current_line)
    
    if not lines: lines = [text]
    
    # 计算总高度 (行高 + 行间距)
    line_spacing = int(line_height * 0.1) # 10% 行间距
    total_height = len(lines) * line_height + (len(lines) - 1) * line_spacing
    
    return lines, total_height

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
                "无LoRA对比": ("BOOLEAN", {"default": False, "label_on": "开启", "label_off": "关闭", "tooltip": "开启后，会额外跑一次没有LoRA的图，多个权重时不会重复生成无LoRA的图。比如LoRA数量3，权重数量2，那就是2*3=6次有LoRA图，无LoRA的图跑一次，剩下的一个通过复制图像来生成。总共跑2*3+1=7张图。"}),
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

    def load_batch_loras(self, 模型, LoRA文件夹路径, LoRA数量, LoRA权重数量, 权重起始值, 权重结束值, 无LoRA对比, XY互换, CLIP=None):
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
        
        # 核心逻辑：如果开启对比，且None不在列表里，就插到第一位
        if  无LoRA对比:
            if None not in  lora_files:
                lora_files.insert(0, None )
        
        if not lora_files: lora_files = [None ]

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
        cell_image_counts = [] # 这个列表记录每个格子跑几张图。1=正常采样，0=不采样直接复用
        base_model_added = False # 标记原始模型是否已经进过采样队列
        loaded_cache = {}

        for outer_item in outer_loop:
            for inner_item in inner_loop:
                current_lora, current_weight = get_args(inner_item, outer_item)
                
                # 如果是“无LoRA”的格子
                if current_lora is None :
                    if not  base_model_added:
                        # 第一次遇到：输出模型到列表，进行一次采样
                        out_models.append(模型)
                        out_clips.append(CLIP)
                        cell_image_counts.append(1 )
                        base_model_added = True
                    else:
                        # 之后遇到：不再输出模型，标记为0告知Grid节点直接复用第一张图
                        cell_image_counts.append(0 )
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
                    cell_image_counts.append(1)
                except:
                    out_models.append(模型)
                    out_clips.append(CLIP)
                    cell_image_counts.append(1)
                    
        del loaded_cache

        grid_info = {
            "x_labels": x_labels,
            "y_labels": y_labels,
            "x_title": x_title, # 新增
            "y_title": y_title, # 新增
            "count_x": len(inner_loop),
            "count_y": len(outer_loop),
            "cell_image_counts" : cell_image_counts,
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
                "字体大小": ("INT", {"default": 96, "min": 12}),
                "网格间距": ("INT", {"default": 30, "min": 0}),
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
        
        # --- 第一步：先计算所有图片单元格的尺寸 (不含文字) ---
        # 我们必须先知道每个格子的图片宽度，才能决定文字什么时候换行
        
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

        # --- 第二步：计算头部(X轴)和侧边栏(Y轴)尺寸 (含文字换行逻辑) ---

        # 准备左上角文本 (Y \ X)
        corner_text = ""
        if x_title or y_title:
            corner_text = f"{y_title} \\ {x_title}"
        
        corner_w, corner_h = 0, 0
        if corner_text:
             corner_w, corner_h = text_size(dummy_draw, corner_text, font)

        # 1. 计算X轴表头高度 (支持换行)
        header_h = 0
        # 缓存一下每个X标签的换行结果，避免绘制时重复计算
        x_label_layouts = [] 
        
        if x_labels or corner_text:
            max_header_label_h = 0
            for i, label in enumerate(x_labels):
                str_label = str(label)
                # 获取该列的最大宽度作为文字的限制宽度
                # 减去一点margin防止贴边
                max_txt_width = cell_actual_widths[i] - margin 
                if max_txt_width < font_size: max_txt_width = font_size # 保护机制
                
                lines, total_h = get_wrapped_text(dummy_draw, str_label, font, max_txt_width)
                x_label_layouts.append({"lines": lines, "h": total_h})
                max_header_label_h = max(max_header_label_h, total_h)
            
            # 头部高度至少要容纳最长的标签高度，也要考虑角标文本的高度
            header_h = max(max_header_label_h, corner_h) + margin * 2

        # 2. 计算Y轴侧边栏宽度 (支持换行)
        # 通常Y轴不需要太宽，但如果Y也是长文件名，也需要处理
        sidebar_w = 0
        y_label_layouts = []
        
        if y_labels or corner_text:
            max_sidebar_label_w = 0
            
            # 这里Y轴的逻辑稍微不同，我们可以给它设定一个最大宽度限制（比如图片的1/2或者固定值），或者让它自然生长
            # 考虑到用户提到拥挤，我们假设Y轴让它自然宽一点，或者限制在一定范围内换行
            # 这里先不做强制限制，只对极长文本做换行，避免侧边栏宽得离谱
            limit_sidebar_w = 600 # 假设一个最大侧边栏宽度
            
            for i, label in enumerate(y_labels):
                str_label = str(label)
                tw, th = text_size(dummy_draw, str_label, font)
                
                if tw > limit_sidebar_w:
                    lines, total_h = get_wrapped_text(dummy_draw, str_label, font, limit_sidebar_w)
                    # 重新计算实际最宽的那一行
                    real_w = 0
                    for line in lines:
                        lw, _ = text_size(dummy_draw, line, font)
                        real_w = max(real_w, lw)
                    max_sidebar_label_w = max(max_sidebar_label_w, real_w)
                    y_label_layouts.append({"lines": lines, "h": total_h, "w": real_w})
                else:
                    max_sidebar_label_w = max(max_sidebar_label_w, tw)
                    y_label_layouts.append({"lines": [str_label], "h": th, "w": tw})
            
            sidebar_w = max(max_sidebar_label_w, corner_w) + margin * 2


        # --- 第三步：构建画布并绘制 ---

        grid_content_w = sum(cell_actual_widths) + margin * max(0, cols - 1)
        grid_content_h = sum(cell_actual_heights) + margin * max(0, rows - 1)

        canvas_w = sidebar_w + grid_content_w + margin * 2
        canvas_h = header_h + grid_content_h + margin * 2
        
        bg_col = COLOR_MAP.get(bg_name, "white")
        txt_col = COLOR_MAP.get(txt_name, "black")
        
        canvas = Image.new("RGB", (canvas_w, canvas_h), bg_col)
        draw = ImageDraw.Draw(canvas)
        
        _, one_line_h = text_size(draw, "Mg", font)
        line_spacing = int(one_line_h * 0.1)

        # === 绘制左上角角标 ===
        if corner_text and sidebar_w > 0 and header_h > 0:
            cx = margin + (sidebar_w - margin*2 - corner_w) // 2
            cy = margin + (header_h - margin*2 - corner_h) // 2
            cx = max(cx, 0)
            cy = max(cy, 0)
            draw.text((cx, cy), corner_text, fill=txt_col, font=font)

        # 绘制 X 轴标签 (应用换行逻辑)
        current_x = sidebar_w + margin
        for i, layout in enumerate(x_label_layouts):
            lines = layout["lines"]
            total_text_h = layout["h"]
            col_width = cell_actual_widths[i]
            
            # 文字块垂直居中
            block_y_start = margin + (header_h - margin*2 - total_text_h) // 2
            
            current_line_y = block_y_start
            for line in lines:
                lw, lh = text_size(draw, line, font)
                # 水平居中
                line_x = current_x + (col_width - lw) // 2
                draw.text((line_x, current_line_y), line, fill=txt_col, font=font)
                current_line_y += one_line_h + line_spacing

            current_x += col_width + margin

        # 绘制 Y 轴标签
        current_y = header_h + margin
        for j, layout in enumerate(y_label_layouts):
            lines = layout["lines"]
            total_text_h = layout["h"]
            # 若Y标签换行导致高度增加，这里目前逻辑是不撑开行高的（行高由图片决定）。
            # 如果文字非常多导致高度超过图片高度，文字会和下面的重叠。
            # 但通常图片高度远大于文字高度。
            
            row_height = cell_actual_heights[j]
            
            # 文字块垂直居中于行
            block_y_start = current_y + (row_height - total_text_h) // 2
            
            current_line_y = block_y_start
            for line in lines:
                lw, lh = text_size(draw, line, font)
                # 水平居中于Sidebar
                line_x = margin + (sidebar_w - margin*2 - lw) // 2 
                draw.text((line_x, current_line_y), line, fill=txt_col, font=font)
                current_line_y += one_line_h + line_spacing
                
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
                
                if num_images_in_cell == 0:
                    # 复用第一张图
                    canvas.paste(pil_images_batch[0], (cell_start_x + (current_cell_actual_w-first_img_w)//2, cell_start_y + (current_cell_actual_h-first_img_h)//2 ))
                else:
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
                "无LoRA对比": ("BOOLEAN", {"default": False, "label_on": "开启", "label_off": "关闭", "tooltip": "开启后，会额外跑一次没有LoRA的图，多个权重时不会重复生成无LoRA的图。比如LoRA数量3，权重数量2，那就是2*3=6次有LoRA图，无LoRA的图跑一次，剩下的一个通过复制图像来生成。总共跑2*3+1=7张图。"}),
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

    def load_batch_loras_v2(self, 模型, CLIP, LoRA文件夹路径, LoRA数量, LoRA权重数量, 权重起始值, 权重结束值, 无LoRA对比, 多行文本, txt联结方式, XY互换):
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
        
        # 核心逻辑：如果开启对比，且None不在列表里，就插到第一位
        if  无LoRA对比:
            if None not in  lora_files:
                lora_files.insert(0, None )
        
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
        base_model_added = False # 标记原始模型是否已经进过采样队列

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
                
                # 如果是“无LoRA”的格子
                if current_lora is None :
                    if not  base_model_added:
                        # 第一次遇到：正常处理
                        prompts_to_process = get_prompt_list(current_lora)
                        if not prompts_to_process: prompts_to_process = [""]
                        
                        cell_image_count = len(prompts_to_process)
                        cell_image_counts.append(cell_image_count)
                        base_model_added = True
                    else:
                        # 之后遇到：不再输出模型，标记为0告知Grid节点直接复用第一张图
                        cell_image_counts.append(0 )
                        continue
                else:
                    # 正常LoRA格子
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
                "多行文本": ("STRING", {"multiline": True, "default": "", "placeholder": "每行对应一张图 (类型选字符串时生效)，输入字符串列表也可以，都可以处理的"}),
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

# ==========================================
# 节点 5: ZML_XY_LoRA加载器V3
# ==========================================
class ZML_XY_LoRA_Loader_V3:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "模型": ("MODEL",),
                "CLIP": ("CLIP",),
                "LoRA文件夹路径": ("STRING", {"default": "E:\\Models\\Loras", "multiline": False}),
                "LoRA数量": ("INT", {"default": 3, "min": 1, "step": 1}),
                "LoRA权重": ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.05}),
                "无LoRA对比": ("BOOLEAN", {"default": False, "label_on": "开启", "label_off": "关闭"}),
                "固定提示词": ("STRING", {"default": "", "multiline": False}),
                "多行变量提示词": ("STRING", {"default": "", "multiline": True}),
                "分隔符": ("STRING", {"default": ", "}),
                "XY互换": ("BOOLEAN", {"default": False, "label_on": "(X=提示词, Y=LoRA)", "label_off": "(X=LoRA, Y=提示词)"}),
            }
        }

    RETURN_TYPES = ("MODEL", "CONDITIONING", "ZML_GRID_INFO")
    RETURN_NAMES = ("模型", "条件", "图表信息")
    OUTPUT_IS_LIST = (True, True, False)
    FUNCTION = "load_batch_loras_v3"
    CATEGORY = "image/ZML_图像/XYZ"

    def load_batch_loras_v3(self, 模型, CLIP, LoRA文件夹路径, LoRA数量, LoRA权重, 无LoRA对比, 固定提示词, 多行变量提示词, XY互换):
        # 1. 扫描 LoRA 文件
        folder_path = LoRA文件夹路径.strip().strip('"')
        found_loras = []
        if os.path.exists(folder_path) and os.path.isdir(folder_path):
            valid_ext = {'.safetensors', '.pt', '.ckpt'}
            try:
                files = [f for f in os.listdir(folder_path) if os.path.splitext(f)[1].lower() in valid_ext]
                files.sort()
                for f in files:
                    found_loras.append(os.path.join(folder_path, f))
            except: pass
        
        lora_files = found_loras[:LoRA数量]
        if 无LoRA对比:
            if None not in lora_files:
                lora_files.insert(0, None)
        if not lora_files: lora_files = [None]

        # 2. 处理多行提示词
        prompt_lines = [p.strip() for p in 多行变量提示词.strip().split('\n') if p.strip()]
        if not prompt_lines:
            prompt_lines = [""]

        # 3. 准备标签 (用于图表显示)
        lora_labels = []
        for p in lora_files:
            if p:
                name = os.path.splitext(os.path.basename(p))[0]
                lora_labels.append(name)
            else:
                lora_labels.append("None")
        
        prompt_labels = [p if len(p) < 20 else p[:17]+"..." for p in prompt_lines]

        # 4. 确定 XY 逻辑
        if not XY互换:
            # X=LoRA, Y=提示词
            x_labels = lora_labels
            y_labels = prompt_labels
            x_title = "LoRA"
            y_title = "提示词变量"
            outer_loop = prompt_lines  # 行 (Y)
            inner_loop = lora_files    # 列 (X)
            def get_args(inner_item, outer_item): return inner_item, outer_item # (lora, prompt)
        else:
            # X=提示词, Y=LoRA
            x_labels = prompt_labels
            y_labels = lora_labels
            x_title = "提示词变量"
            y_title = "LoRA"
            outer_loop = lora_files    # 行 (Y)
            inner_loop = prompt_lines  # 列 (X)
            def get_args(inner_item, outer_item): return outer_item, inner_item # (lora, prompt)

        out_models = []
        out_conds = []
        loaded_cache = {}

        # 5. 循环生成模型和条件对
        for outer_item in outer_loop:
            for inner_item in inner_loop:
                current_lora, current_line = get_args(inner_item, outer_item)
                
                # 处理模型和CLIP
                current_model = 模型
                current_clip = CLIP
                
                if current_lora is not None:
                    try:
                        if current_lora not in loaded_cache:
                            loaded_cache[current_lora] = comfy.utils.load_torch_file(current_lora)
                        lora_data = loaded_cache[current_lora]
                        
                        m, c = comfy.sd.load_lora_for_models(模型, CLIP, lora_data, LoRA权重, LoRA权重)
                        current_model = m
                        current_clip = c
                    except Exception as e:
                        print(f"加载LoRA失败: {current_lora}, 错误: {e}")

                # 拼接提示词
                if current_line:
                    final_text = f"{固定提示词}{current_line}"
                else:
                    final_text = 固定提示词
                
                # 编码提示词
                tokens = current_clip.tokenize(final_text)
                cond, pooled = current_clip.encode_from_tokens(tokens, return_pooled=True)
                
                out_models.append(current_model)
                out_conds.append([[cond, {"pooled_output": pooled}]])

        del loaded_cache

        grid_info = {
            "x_labels": x_labels,
            "y_labels": y_labels,
            "x_title": x_title,
            "y_title": y_title,
            "count_x": len(inner_loop),
            "count_y": len(outer_loop),
            "total_images": len(out_models)
        }

        return (out_models, out_conds, grid_info)

# ============================== 注册节点 ==============================
NODE_CLASS_MAPPINGS = {
    "ZML_XY_LoRA_Loader": ZML_XY_LoRA_Loader,
    "ZML_XY_LoRA_Loader_V2": ZML_XY_LoRA_Loader_V2,
    "ZML_XY_LoRA_Loader_V3": ZML_XY_LoRA_Loader_V3,
    "ZML_XY_Prompt_Loader": ZML_XY_Prompt_Loader,
    "ZML_XY_Sampler_Params": ZML_XY_Sampler_Params, 
    "ZML_XY_Grid_Drawer": ZML_XY_Grid_Drawer,
    "ZML_XY_Custom_Grid": ZML_XY_Custom_Grid
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_XY_LoRA_Loader": "ZML_XY_LoRA加载器",
    "ZML_XY_LoRA_Loader_V2": "ZML_XY_LoRA加载器V2",
    "ZML_XY_LoRA_Loader_V3": "ZML_XY_LoRA加载器V3",
    "ZML_XY_Prompt_Loader": "ZML_XY_提示词",
    "ZML_XY_Sampler_Params": "ZML_XY_采样参数",
    "ZML_XY_Grid_Drawer": "ZML_XY_图表拼接",
    "ZML_XY_Custom_Grid": "ZML_XY_自定义图表"
}