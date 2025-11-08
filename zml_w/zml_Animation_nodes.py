import torch
import numpy as np
from PIL import Image, ImageDraw, ImageOps, PngImagePlugin
import random
import math
import os
import folder_paths
from pathlib import Path
import uuid
import json

#==========================图像过度动画==========================

class ZML_ImageTransition:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像A": ("IMAGE", {"label": "起始图像"}),
                "图像B": ("IMAGE", {"label": "结束图像"}),
                "帧数": ("INT", {"default": 10, "min": 2, "max": 100, "step": 1, "display": "number"}),
                "过渡方向": (["从左到右", "从右到左", "从上到下", "从下到上", "从中心向外", "从外向中心", "对角线"], {"default": "从左到右"}),
                "过渡曲线": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 5.0, "step": 0.1, "display": "slider", "tooltip": "控制过渡速度的非线性。小于1加速，大于1减速。"}),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("过渡批次", "遮罩批次")
    FUNCTION = "generate_transition"
    CATEGORY = "image/ZML_图像/图像"

    def _tensor_to_pil(self, image_tensor: torch.Tensor) -> Image.Image:
        """Helper to convert ComfyUI IMAGE tensor to PIL Image (RGBA)."""
        # Ensure image is in 0-255 range and convert to uint8
        img_np = np.clip(255. * image_tensor.cpu().numpy().squeeze(0), 0, 255).astype(np.uint8)
        
        # Handle grayscale (2D) or 3-channel (RGB) images, convert to RGBA
        if img_np.ndim == 2:
            return Image.fromarray(img_np, 'L').convert('RGBA')
        elif img_np.ndim == 3:
            if img_np.shape[2] == 3:
                return Image.fromarray(img_np, 'RGB').convert('RGBA')
            elif img_np.shape[2] == 4:
                return Image.fromarray(img_np, 'RGBA')
        raise ValueError("Unsupported image tensor format")

    def _pil_to_tensor(self, pil_image: Image.Image) -> torch.Tensor:
        """Helper to convert PIL Image (RGBA) to ComfyUI IMAGE tensor."""
        if pil_image.mode != 'RGBA':
            pil_image = pil_image.convert('RGBA')
        return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)

    def generate_transition(self, 图像A: torch.Tensor, 图像B: torch.Tensor, 帧数: int, 过渡方向: str, 过渡曲线: float):
        # 将输入图像Tensor转换为PIL Image
        pil_image_a = self._tensor_to_pil(图像A)
        pil_image_b = self._tensor_to_pil(图像B)

        width, height = pil_image_a.size

        # 将图像B缩放到与图像A相同的尺寸 (如果不同)
        if pil_image_b.size != (width, height):
            pil_image_b = pil_image_b.resize((width, height), Image.LANCZOS)
        
        transition_frames = []
        mask_frames = []

        # 预计算坐标网格，避免在循环中重复计算
        y_coords, x_coords = np.indices((height, width))
        normalized_x = x_coords / (width - 1e-6)  # 避免除以零，确保0到1
        normalized_y = y_coords / (height - 1e-6) # 避免除以零，确保0到1
        
        # 预计算对角线渐变图，范围大致从 0 (左上) 到 1 (右下)
        diagonal_gradient_map = (normalized_x + normalized_y) / 2.0


        for i in range(帧数):
            # 计算归一化进度 (0到1之间)
            progress = i / (帧数 - 1) if 帧数 > 1 else 0.0
            
            # 应用过渡曲线
            eased_progress = progress ** 过渡曲线

            # 创建当前帧的遮罩
            # mask = Image.new('L', (width, height), 0) # 初始全黑 (0)
            # draw = ImageDraw.Draw(mask) # ImageDraw 只适合简单的几何图形

            # 使用Numpy创建遮罩，更灵活和高效
            mask_np_current = np.zeros((height, width), dtype=np.uint8)

            if 过渡方向 == "从左到右":
                fill_width = int(width * eased_progress)
                mask_np_current[:, :fill_width] = 255
            elif 过渡方向 == "从右到左":
                fill_width = int(width * eased_progress)
                mask_np_current[:, width - fill_width:] = 255
            elif 过渡方向 == "从上到下":
                fill_height = int(height * eased_progress)
                mask_np_current[:fill_height, :] = 255
            elif 过渡方向 == "从下到上":
                fill_height = int(height * eased_progress)
                mask_np_current[height - fill_height:, :] = 255
            elif 过渡方向 == "从中心向外":
                center_x, center_y = width // 2, height // 2
                max_dist = np.sqrt(max(center_x, width - center_x)**2 + max(center_y, height - center_y)**2)
                
                dist_map = np.sqrt((x_coords - center_x)**2 + (y_coords - center_y)**2)
                current_threshold_dist = eased_progress * max_dist
                mask_np_current = (dist_map <= current_threshold_dist).astype(np.uint8) * 255
            elif 过渡方向 == "从外向中心":
                center_x, center_y = width // 2, height // 2
                max_dist = np.sqrt(max(center_x, width - center_x)**2 + max(center_y, height - center_y)**2)
                
                dist_map = np.sqrt((x_coords - center_x)**2 + (y_coords - center_y)**2)
                current_threshold_dist = (1.0 - eased_progress) * max_dist # 反向阈值
                mask_np_current = (dist_map >= current_threshold_dist).astype(np.uint8) * 255
            elif 过渡方向 == "对角线":
                # 使用预计算的对角线渐变图
                # 如果渐变值小于等于 eased_progress，则遮罩为白色 (255)，显示图像B
                mask_np_current = (diagonal_gradient_map <= eased_progress).astype(np.uint8) * 255
            
            mask = Image.fromarray(mask_np_current, 'L')
            
            # 将遮罩转换为张量并添加到遮罩批次中
            # 遮罩使用单通道格式以符合ComfyUI的MASK标准
            mask_tensor = torch.from_numpy(np.array(mask).astype(np.float32) / 255.0).unsqueeze(0).unsqueeze(0)  # 添加批次和通道维度
            mask_frames.append(mask_tensor)

            # 使用 composite 方法进行图像B到图像A的过渡
            # mask 为 255 的地方显示 pil_image_b，为 0 的地方显示 pil_image_a
            current_frame_pil = Image.composite(pil_image_b, pil_image_a, mask)
            transition_frames.append(self._pil_to_tensor(current_frame_pil))

        # 将所有帧合并为一个图像批次
        output_batch = torch.cat(transition_frames, dim=0)
        # 合并遮罩批次，保持单通道格式
        mask_batch = torch.cat(mask_frames, dim=1).squeeze(0)  # 合并通道维度并移除批次维度
        
        return (output_batch, mask_batch)

#==========================图像加密解密==========================

class ZML_ImageEncryption:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "密码": ("STRING", {"default": "在梦里w", "multiline": False}),
                "切割数": ("INT", {"default": 16, "min": 4, "max": 128, "step": 1, "display": "number", "tooltip": "推荐值为4、8、16、32、64、128"}),
            },
            "optional": {
                "加密": ("IMAGE", {"label": "要加密的图像"}),
                "解密": ("IMAGE", {"label": "要解密的图像"}),
            }
        }

    RETURN_TYPES = ("IMAGE", "IMAGE")
    RETURN_NAMES = ("加密", "解密")
    FUNCTION = "process_image"
    CATEGORY = "image/ZML_图像/工具"

    def _tensor_to_pil(self, image_tensor: torch.Tensor) -> Image.Image:
        """将ComfyUI的IMAGE张量转换为PIL图像"""
        img_np = np.clip(255. * image_tensor.cpu().numpy().squeeze(0), 0, 255).astype(np.uint8)
        
        if img_np.ndim == 2:
            return Image.fromarray(img_np, 'L').convert('RGB')
        elif img_np.ndim == 3:
            if img_np.shape[2] == 3:
                return Image.fromarray(img_np, 'RGB')
            elif img_np.shape[2] == 4:
                return Image.fromarray(img_np, 'RGBA').convert('RGB')
        raise ValueError("不支持的图像张量格式")

    def _pil_to_tensor(self, pil_image: Image.Image) -> torch.Tensor:
        """将PIL图像转换为ComfyUI的IMAGE张量"""
        if pil_image.mode != 'RGB':
            pil_image = pil_image.convert('RGB')
        return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)

    def split_image_into_blocks(self, image, block_size):
        """将图像分割成指定大小的矩形块"""
        img_width, img_height = image.size
        num_cols = math.ceil(img_width / block_size)
        num_rows = math.ceil(img_height / block_size)
        blocks = []
        for r in range(num_rows):
            for c in range(num_cols):
                left = c * block_size
                top = r * block_size
                right = min((c + 1) * block_size, img_width) 
                bottom = min((r + 1) * block_size, img_height) 
                block = image.crop((left, top, right, bottom))
                blocks.append(block)
        return blocks, img_width, img_height, num_rows, num_cols, block_size

    def combine_blocks_into_image(self, blocks, img_width, img_height, num_rows, num_cols, block_size):
        """将图像块重新组合成完整图像"""
        new_image = Image.new('RGB', (img_width, img_height))
        for i, block in enumerate(blocks):
            r = i // num_cols
            c = i % num_cols
            left = c * block_size
            top = r * block_size
            new_image.paste(block, (left, top))
        return new_image

    def encrypt_image(self, image, password, block_size):
        """对图像进行块打乱加密"""
        # 调整图像尺寸，确保宽度和高度都能被block_size整除
        img_width, img_height = image.size
        new_width = (img_width // block_size) * block_size
        new_height = (img_height // block_size) * block_size
        
        # 如果尺寸发生变化，裁剪图像到合适大小
        if new_width != img_width or new_height != img_height:
            # 计算裁剪区域的左上角坐标，从中心裁剪
            left = (img_width - new_width) // 2
            top = (img_height - new_height) // 2
            right = left + new_width
            bottom = top + new_height
            image = image.crop((left, top, right, bottom))
        
        blocks, img_width, img_height, num_rows, num_cols, actual_block_size = self.split_image_into_blocks(image, block_size)
        num_blocks = len(blocks)

        # 使用密码设置随机种子，确保相同密码得到相同的打乱顺序
        random.seed(password)
        shuffled_indices = list(range(num_blocks))
        random.shuffle(shuffled_indices)
        
        encrypted_blocks = [None] * num_blocks
        for original_index in range(num_blocks):
            new_position_index = shuffled_indices[original_index]
            encrypted_blocks[new_position_index] = blocks[original_index]

        encrypted_image = self.combine_blocks_into_image(
            encrypted_blocks, 
            img_width, img_height, 
            num_rows, num_cols, 
            actual_block_size
        )
        return encrypted_image

    def decrypt_image(self, image, password, block_size):
        """对图像进行解密还原"""
        # 调整图像尺寸，确保宽度和高度都能被block_size整除
        img_width, img_height = image.size
        new_width = (img_width // block_size) * block_size
        new_height = (img_height // block_size) * block_size
        
        # 如果尺寸发生变化，裁剪图像到合适大小
        if new_width != img_width or new_height != img_height:
            # 计算裁剪区域的左上角坐标，从中心裁剪
            left = (img_width - new_width) // 2
            top = (img_height - new_height) // 2
            right = left + new_width
            bottom = top + new_height
            image = image.crop((left, top, right, bottom))
        
        blocks, img_width, img_height, num_rows, num_cols, actual_block_size = self.split_image_into_blocks(image, block_size)
        num_blocks = len(blocks)

        # 使用相同的密码和种子，获取相同的打乱顺序用于解密
        random.seed(password)
        shuffled_indices = list(range(num_blocks))
        random.shuffle(shuffled_indices)
        
        # 创建解密索引映射：shuffled_indices中的索引 -> 原始位置
        decrypted_indices = [0] * num_blocks
        for i, index in enumerate(shuffled_indices):
            decrypted_indices[index] = i
        
        decrypted_blocks = [None] * num_blocks
        for encrypted_index in range(num_blocks):
            original_index = decrypted_indices[encrypted_index]
            decrypted_blocks[original_index] = blocks[encrypted_index]

        decrypted_image = self.combine_blocks_into_image(
            decrypted_blocks, 
            img_width, img_height, 
            num_rows, num_cols, 
            actual_block_size
        )
        return decrypted_image

    def process_image(self, 密码, 切割数, 加密=None, 解密=None):
        """处理图像加密和解密"""
        # 初始化输出结果
        encrypted_output = None
        decrypted_output = None
        
        # 处理加密
        if 加密 is not None:
            try:
                pil_image = self._tensor_to_pil(加密)
                encrypted_pil = self.encrypt_image(pil_image, 密码, 切割数)
                encrypted_output = self._pil_to_tensor(encrypted_pil)
            except Exception as e:
                print(f"加密过程出错: {e}")
        
        # 处理解密
        if 解密 is not None:
            try:
                pil_image = self._tensor_to_pil(解密)
                decrypted_pil = self.decrypt_image(pil_image, 密码, 切割数)
                decrypted_output = self._pil_to_tensor(decrypted_pil)
            except Exception as e:
                print(f"解密过程出错: {e}")
        
        # 如果其中一个输出未生成，返回输入作为默认值
        if encrypted_output is None and 加密 is not None:
            encrypted_output = 加密
        if decrypted_output is None and 解密 is not None:
            decrypted_output = 解密
            
        # 确保至少有一个有效输出
        if encrypted_output is None and decrypted_output is None:
            # 如果两个输入都没有，返回空张量
            return (torch.zeros((1, 1, 1, 3)), torch.zeros((1, 1, 1, 3)))
        
        return (encrypted_output, decrypted_output)

#==========================布尔开关节点==========================

class ZML_BooleanSwitch:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "启用": ("BOOLEAN", {"default": True}),
            }
        }

    RETURN_TYPES = ("BOOLEAN",)
    RETURN_NAMES = ("开关状态",)
    FUNCTION = "get_value"
    CATEGORY = "image/ZML_图像/逻辑"

    def get_value(self, 启用):
        return (启用,)

# ============================== 预览图像节点 ==============================
class ZML_PreviewImage:
    """ZML 预览图像节点 - 支持暂存多次图像的预览功能"""

    # 类变量，用于在节点实例之间共享缓存
    _image_cache = {}
    _counter_cache = {}

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像": ("IMAGE", {}),
                "暂存次数": ("INT", {"default": 1, "min": 1, "max": 10, "step": 1, "display": "number", "tooltip": "设置需要累积的图像数量，达到此数量时才刷新展示"}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ()
    RETURN_NAMES = ()
    FUNCTION = "preview_image"
    OUTPUT_NODE = True
    CATEGORY = "image/ZML_图像/图像"

    def preview_image(self, 图像, 暂存次数=1, unique_id=None):
        """预览图像的主要函数，支持暂存多次图像"""
        # 检查是否应该跳过预览
        skip_preview = False
        
        if 图像 is None or 图像.size(0) == 0:
            skip_preview = True
        elif 图像.shape[1] == 1 and 图像.shape[2] == 1:
            skip_preview = True
        elif 图像.shape[1] == 64 and 图像.shape[2] == 64:
            # 检查是否为纯黑图像
            if torch.all(torch.abs(图像 - 0.0) < 1e-6):
                skip_preview = True

        if skip_preview:
            # 如果需要跳过预览，但有缓存的图像，仍然返回缓存的图像
            if unique_id and unique_id in self._image_cache:
                return {"ui": {"images": self._image_cache[unique_id]}, "node_id": unique_id}
            return {"node_id": unique_id} if unique_id is not None else {}

        # 使用临时目录进行预览
        temp_dir = folder_paths.get_temp_directory()
        os.makedirs(temp_dir, exist_ok=True)
        ui_type = "temp"

        # 当前图像的路径列表
        current_image_paths = []

        for index, image_tensor in enumerate(图像):
            # 生成预览文件名
            timestamp = os.path.basename(temp_dir).replace("_", "")[:8]  # 使用临时目录名的一部分作为时间戳
            if len(图像) > 1:
                batch_filename = f"preview_{timestamp}_{index+1:03d}.png"
            else:
                batch_filename = f"preview_{timestamp}.png"

            full_path = os.path.join(temp_dir, batch_filename)
            
            # 确保文件名唯一
            counter = 1
            base, ext = os.path.splitext(full_path)
            final_image_path = full_path
            while os.path.exists(final_image_path):
                final_image_path = f"{base}_{counter}{ext}"
                counter += 1

            # 处理图像并保存到临时目录
            try:
                image_array = 255. * image_tensor.cpu().numpy()
                pil_image = Image.fromarray(np.clip(image_array, 0, 255).astype(np.uint8))
                
                # 保存图像（不添加元数据，仅用于预览）
                pil_image.save(final_image_path, compress_level=1)  # 使用较低的压缩级别以加快预览速度
                
                # 准备用于UI预览的结果
                try:
                    file_basename = os.path.basename(final_image_path)
                    file_dir = os.path.dirname(final_image_path)
                    
                    # 计算相对路径
                    base_dir_for_relpath = folder_paths.get_temp_directory()
                    
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
                    
                    # 添加到当前图像路径列表
                    current_image_paths.append({
                        "filename": file_basename,
                        "subfolder": rel_dir,
                        "type": ui_type
                    })
                except Exception:
                    pass
                    
            except Exception:
                pass

        # 处理暂存逻辑
        if unique_id:
            # 初始化计数器和缓存（如果不存在）
            if unique_id not in self._counter_cache:
                self._counter_cache[unique_id] = 0
            if unique_id not in self._image_cache:
                self._image_cache[unique_id] = []
            
            # 增加计数器
            self._counter_cache[unique_id] += 1
            
            # 添加当前图像到缓存
            self._image_cache[unique_id].extend(current_image_paths)
            
            # 检查是否达到暂存次数
            if self._counter_cache[unique_id] >= 暂存次数:
                # 达到次数，返回所有缓存的图像并重置计数器
                result_paths = self._image_cache[unique_id]
                # 重置缓存和计数器
                self._image_cache[unique_id] = []
                self._counter_cache[unique_id] = 0
            else:
                # 未达到次数，返回所有缓存的图像（包括之前的和当前的）
                result_paths = self._image_cache[unique_id]
        else:
            # 如果没有唯一ID，直接返回当前图像
            result_paths = current_image_paths

        # 为UI预览准备返回数据
        ui_output = { "images": result_paths }
        return {"ui": ui_output, "node_id": unique_id} if unique_id is not None else {"ui": ui_output}

#==========================遮罩描边节点==========================

class ZML_MaskStroke:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "遮罩": ("MASK",),
                "描边大小": ("INT", {"default": 3, "min": 1, "max": 20, "step": 1}),
            },
            "optional": {
                "图像": ("IMAGE",),
            }
        }

    RETURN_TYPES = ("MASK", "IMAGE")
    RETURN_NAMES = ("遮罩描边", "描边图像")
    FUNCTION = "generate_mask_stroke"
    CATEGORY = "image/ZML_图像/遮罩"

    def _tensor_to_pil(self, tensor, is_mask=False):
        """将ComfyUI的张量转换为PIL图像"""
        if is_mask:
            # 遮罩是单通道的，形状为 (1, height, width) 或 (height, width)
            if len(tensor.shape) == 3:
                tensor = tensor.squeeze(0)
            mask_np = np.clip(255. * tensor.cpu().numpy(), 0, 255).astype(np.uint8)
            return Image.fromarray(mask_np, 'L')
        else:
            # 图像是多通道的，形状为 (1, height, width, channels) 或 (height, width, channels)
            if len(tensor.shape) == 4:
                tensor = tensor.squeeze(0)
            img_np = np.clip(255. * tensor.cpu().numpy(), 0, 255).astype(np.uint8)
            if img_np.ndim == 2:
                return Image.fromarray(img_np, 'L').convert('RGB')
            elif img_np.shape[2] == 3:
                return Image.fromarray(img_np, 'RGB')
            elif img_np.shape[2] == 4:
                return Image.fromarray(img_np, 'RGBA').convert('RGB')
            raise ValueError("不支持的图像张量格式")

    def _pil_to_tensor(self, pil_image, is_mask=False):
        """将PIL图像转换为ComfyUI的张量"""
        if is_mask:
            # 遮罩转换为单通道张量
            if pil_image.mode != 'L':
                pil_image = pil_image.convert('L')
            return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)
        else:
            # 图像转换为3通道张量
            if pil_image.mode != 'RGB':
                pil_image = pil_image.convert('RGB')
            return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)

    def generate_mask_stroke(self, 遮罩, 描边大小, 图像=None):
        """生成遮罩的描边"""
        # 将遮罩转换为PIL图像
        mask_pil = self._tensor_to_pil(遮罩, is_mask=True)
        width, height = mask_pil.size
        
        # 创建一个空白图像用于绘制描边
        stroke_mask = Image.new('L', (width, height), 0)
        draw = ImageDraw.Draw(stroke_mask)
        
        # 将PIL遮罩转换为numpy数组以便处理
        mask_np = np.array(mask_pil)
        
        # 使用PIL的find_edges查找边缘
        from PIL import ImageFilter
        edges = mask_pil.filter(ImageFilter.FIND_EDGES)
        
        # 如果需要更厚的描边，使用膨胀操作
        if 描边大小 > 1:
            # 使用PIL的膨胀滤镜或者手动实现
            for _ in range(描边大小 - 1):
                edges = edges.filter(ImageFilter.MaxFilter(3))
        
        # 将边缘转换为numpy数组
        edges_np = np.array(edges)
        
        # 创建最终的描边遮罩（只有描边，没有原遮罩）
        stroke_mask = Image.fromarray(edges_np, 'L')
        
        # 准备描边图像
        if 图像 is not None:
            # 如果提供了图像，在图像上绘制红色描边
            image_pil = self._tensor_to_pil(图像, is_mask=False)
            # 创建一个可编辑的副本
            stroke_image = image_pil.copy()
            # 创建红色描边图层
            red_stroke = Image.new('RGBA', (width, height), (0, 0, 0, 0))
            red_draw = ImageDraw.Draw(red_stroke)
            
            # 找到所有边缘像素并绘制红色
            y_coords, x_coords = np.where(edges_np > 0)
            for y, x in zip(y_coords, x_coords):
                red_draw.ellipse([(x - 描边大小, y - 描边大小), (x + 描边大小, y + 描边大小)], fill=(255, 0, 0, 255))
            
            # 将红色描边合并到原图上
            stroke_image.paste(red_stroke, (0, 0), red_stroke)
        else:
            # 如果没有提供图像，创建一个黑色背景的红色描边图像
            stroke_image = Image.new('RGB', (width, height), (0, 0, 0))
            stroke_draw = ImageDraw.Draw(stroke_image)
            
            # 找到所有边缘像素并绘制红色
            y_coords, x_coords = np.where(edges_np > 0)
            for y, x in zip(y_coords, x_coords):
                stroke_draw.ellipse([(x - 描边大小, y - 描边大小), (x + 描边大小, y + 描边大小)], fill=(255, 0, 0))
        
        # 将结果转换回张量
        stroke_mask_tensor = self._pil_to_tensor(stroke_mask, is_mask=True)
        stroke_image_tensor = self._pil_to_tensor(stroke_image, is_mask=False)
        
        return (stroke_mask_tensor, stroke_image_tensor)

# 定义惰性执行选项
lazy_options = {
    "lazy": True
}

# 尝试导入ExecutionBlocker以支持输出控制
ExecutionBlocker = None
try:
    from comfy_execution.graph import ExecutionBlocker
except ImportError:
    # 如果导入失败，创建一个简单的替代类
    class ExecutionBlocker:
        def __init__(self, value):
            self.value = value

# ============================== 桥接预览图象V2 ==============================
class ZML_ImageMemory:
    # 启用OUTPUT_NODE，使其能在UI中预览图像。
    OUTPUT_NODE = True

    def __init__(self):
        self.stored_image = None
        # 定义临时预览图像子目录
        self.temp_subfolder = "zml_image_memory_previews"
        self.temp_output_dir = folder_paths.get_temp_directory()
        # 本地持久化文件路径
        self.persistence_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "image_memory_cache.png")
        # 元数据
        self.prompt = None
        self.extra_pnginfo = None

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "关闭输入": ("BOOLEAN", {"default": False, "tooltip": "开启后不执行上游节点"}),
                "关闭输出": ("BOOLEAN", {"default": False, "tooltip": "开启后不执行下游节点"}),
                "选择输出索引": ("INT", {"default": 0, "min": 0, "max": 50, "step": 1, "label": "选择输出索引(0=全部)", "tooltip": "0=输出所有图像，1-50=选择输出特定索引的单张图像"}),
            },
            "optional": {
                "输入图像": ("IMAGE", lazy_options),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
                "unique_id": "UNIQUE_ID",
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("图像",)
    FUNCTION = "store_and_retrieve_image"
    CATEGORY = "image/ZML_图像/工具"
    
    def check_lazy_status(self, 关闭输入, **kwargs):
        """告诉系统是否需要输入图像"""
        # 如果关闭输入，则不需要执行上游节点
        if 关闭输入:
            return None
        # 否则需要输入图像
        elif "输入图像" in kwargs:
            return ["输入图像"]
        return None

    def store_and_retrieve_image(self, 关闭输入, 关闭输出, 选择输出索引, 输入图像=None, prompt=None, extra_pnginfo=None, unique_id=None):
        # 保存元数据到实例变量
        self.prompt = prompt
        self.extra_pnginfo = extra_pnginfo
        
        image_to_output = None

        if 关闭输入:
            # 关闭输入时，从内存获取图像
            image_to_output = self.stored_image
        elif 输入图像 is not None:
            # 有新输入图像时，存储到内存
            self.stored_image = 输入图像
            image_to_output = 输入图像
        else:
            # 无新输入图像时，从内存获取
            image_to_output = self.stored_image

        if image_to_output is None:
            default_size = 1
            image_to_output = torch.zeros((1, default_size, default_size, 3), dtype=torch.float32, device="cpu")

        # ====== 处理UI预览图像 ======
        subfolder_path = os.path.join(self.temp_output_dir, self.temp_subfolder)
        os.makedirs(subfolder_path, exist_ok=True)

        # 准备UI所需的数据列表
        ui_image_data = []
        
        # 获取批次大小
        batch_size = image_to_output.shape[0]
        
        # 处理每个批次的图像
        for i in range(batch_size):
            # 提取当前批次的图像
            current_image = image_to_output[i:i+1]
            
            # 将 tensor 转换为 PIL Image
            # 确保尺寸正确，如果 tensor 是 (1, 1, 1, 3)，PIL无法处理
            if current_image.shape[1] == 1 and current_image.shape[2] == 1:
                # 对于1x1的黑图，创建一个可见的小图用于预览，例如 32x32
                preview_image_tensor = torch.zeros((1, 32, 32, 3), dtype=torch.float32, device=current_image.device)
                pil_image = Image.fromarray((preview_image_tensor.squeeze(0).cpu().numpy() * 255).astype(np.uint8))
            else:
                # 正常图像处理
                pil_image = Image.fromarray((current_image.squeeze(0).cpu().numpy() * 255).astype(np.uint8))

            # 生成唯一文件名，包含批次索引
            filename = f"zml_image_memory_batch_{i}_{uuid.uuid4()}.png"
            file_path = os.path.join(subfolder_path, filename)

            # 创建元数据对象
            metadata = PngImagePlugin.PngInfo()

            # 添加标准的ComfyUI元数据（工作流等）
            if self.prompt is not None:
                try:
                    metadata.add_text("prompt", json.dumps(self.prompt))
                except Exception:
                    pass
            if self.extra_pnginfo is not None:
                for key, value in self.extra_pnginfo.items():
                    try:
                        metadata.add_text(key, json.dumps(value))
                    except Exception:
                        pass

            # 保存图像和元数据
            pil_image.save(file_path, pnginfo=metadata, compress_level=4)

            # 添加到UI数据列表
            ui_image_data.append({"filename": filename, "subfolder": self.temp_subfolder, "type": "temp"})
        
        # 根据选择的索引提取输出图像
        # 当索引为0时，输出所有图像
        if 选择输出索引 == 0:
            selected_image = image_to_output
        else:
            # 由于用户索引从1开始，需要减1以适应Python数组索引从0开始的特性
            zero_based_index = 选择输出索引 - 1
            # 确保索引在有效范围内
            selected_index = min(zero_based_index, batch_size - 1) if batch_size > 0 else 0
            # 从批次中提取选择的图像
            selected_image = image_to_output[selected_index:selected_index+1]

        # 如果关闭输出，使用ExecutionBlocker阻止下游节点执行
        if 关闭输出 and ExecutionBlocker is not None:
            output = ExecutionBlocker(None)
        else:
            # 输出选择的图像
            output = selected_image
            
        # 返回结果：(图像,), 同时返回UI信息
        return {"ui": {"images": ui_image_data}, "result": (output,)}

    def _save_to_local(self, image_tensor):
        """将图像张量保存到本地文件"""
        try:
            pil_image = Image.fromarray((image_tensor.squeeze(0).cpu().numpy() * 255).astype(np.uint8))
            pil_image.save(self.persistence_file, "PNG")
        except Exception as e:
            print(f"保存图像到本地失败: {e}")

    def _load_from_local(self):
        """从本地文件加载图像张量"""
        if os.path.exists(self.persistence_file):
            try:
                pil_image = Image.open(self.persistence_file).convert('RGB')
                image_np = np.array(pil_image).astype(np.float32) / 255.0
                return torch.from_numpy(image_np).unsqueeze(0)
            except Exception as e:
                print(f"从本地加载图像失败: {e}")
        return None

class ZML_PromptTokenBalancer:
    """
    提示词token统一节点
    - 输入：正面条件、负面条件（可选接口，文本，逗号分隔），填充正面、填充负面（必填文本框，分别用于补齐对应一侧）
    - 输出：正面条件、负面条件（按逗号分隔的tag数量尽量保持一致）
    示例：
      填充负面 = "nsfw"，正面 = "1girl,solo,hug"，负面 = "sex"  => 负面输出："sex,nsfw,nsfw"
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "填充正面": ("STRING", {"multiline": False, "default": "", "placeholder": "用于填充正面，例如: pretty"}),
                "填充负面": ("STRING", {"multiline": False, "default": "", "placeholder": "用于填充负面，例如: nsfw"}),
            },
            "optional": {
                "正面条件": ("STRING", {"forceInput": True}),
                "负面条件": ("STRING", {"forceInput": True}),
            }
        }

    CATEGORY = "image/ZML_图像/文本"
    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("正面条件", "负面条件")
    FUNCTION = "balance"

    def _split_tags(self, text: str):
        t = (text or "").replace("\n", ",").replace("\r", ",").replace("，", ",")
        return [p.strip() for p in t.split(",") if p.strip()]

    def _join_tags(self, tags):
        return ",".join(tags)

    def balance(self, 填充正面, 填充负面, 正面条件=None, 负面条件=None):
        pos = self._split_tags(正面条件 or "")
        neg = self._split_tags(负面条件 or "")
        pos_fillers = self._split_tags(填充正面)
        neg_fillers = self._split_tags(填充负面)
        pos_filler = pos_fillers[0] if pos_fillers else ""
        neg_filler = neg_fillers[0] if neg_fillers else ""

        # 如果正负长度不同，分别使用对应的填充项进行补齐
        if len(pos) > len(neg):
            diff = len(pos) - len(neg)
            if neg_filler:
                neg.extend([neg_filler] * diff)
        elif len(neg) > len(pos):
            diff = len(neg) - len(pos)
            if pos_filler:
                pos.extend([pos_filler] * diff)

        return (self._join_tags(pos), self._join_tags(neg))

NODE_CLASS_MAPPINGS = {
    "ZML_ImageTransition": ZML_ImageTransition,
    "ZML_ImageEncryption": ZML_ImageEncryption,
    "ZML_BooleanSwitch": ZML_BooleanSwitch,
    "ZML_MaskStroke": ZML_MaskStroke,
    "ZML_PreviewImage": ZML_PreviewImage,
    "ZML_ImageMemory": ZML_ImageMemory,
    "ZML_PromptTokenBalancer": ZML_PromptTokenBalancer,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_ImageTransition": "ZML_图像过渡动画",
    "ZML_ImageEncryption": "ZML_图像加密",
    "ZML_BooleanSwitch": "ZML_布尔开关",
    "ZML_MaskStroke": "ZML_遮罩描边",
    "ZML_PreviewImage": "ZML_预览图像",
    "ZML_ImageMemory": "ZML_桥接预览图像",
    "ZML_PromptTokenBalancer": "ZML_提示词token统一",
}
