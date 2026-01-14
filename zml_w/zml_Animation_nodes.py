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
import base64
from io import BytesIO

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
                
                # 保存图像，添加元数据用于工作流信息
                metadata = PngImagePlugin.PngInfo()
                metadata.add_text("workflow", "ZML_PreviewImage")
                metadata.add_text("node_id", str(unique_id) if unique_id else "unknown")
                metadata.add_text("image_index", str(index))
                metadata.add_text("timestamp", timestamp)
                pil_image.save(final_image_path, pnginfo=metadata, compress_level=1)  # 使用较低的压缩级别以加快预览速度
                
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

# ============================== 桥接预览图象 ==============================
class ZML_ImageMemory:
    # 启用OUTPUT_NODE，使其能在UI中预览图像。
    OUTPUT_NODE = True

    # 类变量，用于在节点实例之间共享缓存
    _image_cache = {}    # UI预览用的路径缓存
    _counter_cache = {}  # 计数器
    _tensor_buffer = {}  # 【新增】核心数据缓存：用于存储真实的图像数据张量

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
                "关闭输入": ("BOOLEAN", {"default": False, "tooltip": "开启后不执行上游节点，锁定当前状态"}),
                "关闭输出": ("BOOLEAN", {"default": False, "tooltip": "开启后不执行下游节点"}),
                "选择输出索引": ("INT", {"default": 0, "min": 0, "max": 50, "step": 1, "label": "选择输出索引(0=全部)", "tooltip": "0=输出缓存中的所有图像拼接结果，1-50=选择输出缓存队列中特定位置的单张图像"}),
                "暂存次数": ("INT", {"default": 1, "min": 1, "max": 64, "step": 1, "display": "number", "tooltip": "设置缓存队列的大小。例如设为3，节点会保留最近3次运行的图像（或3个批次），并将其合并输出。"}),
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
    OUTPUT_IS_LIST = (True,)
    
    def check_lazy_status(self, 关闭输入, **kwargs):
        """告诉系统是否需要输入图像"""
        if 关闭输入:
            return None
        elif "输入图像" in kwargs:
            return ["输入图像"]
        return None

    def store_and_retrieve_image(self, 关闭输入, 关闭输出, 选择输出索引, 暂存次数=1, 输入图像=None, prompt=None, extra_pnginfo=None, unique_id=None):
        self.prompt = prompt
        self.extra_pnginfo = extra_pnginfo
        
        # 1. 确保唯一ID对应的缓存列表存在
        if unique_id:
            if unique_id not in self._tensor_buffer:
                self._tensor_buffer[unique_id] = []
            if unique_id not in self._image_cache:
                self._image_cache[unique_id] = []

        new_image_received = False
        current_input_image = None

        # 2. 处理输入逻辑
        if not 关闭输入 and 输入图像 is not None:
            current_input_image = 输入图像
            new_image_received = True
            
            # --- 【核心修改】数据累积逻辑 ---
            if unique_id:
                # 不再清空缓存，支持暂存不同分辨率的图像
                # 添加新图像到 Tensor 缓存
                self._tensor_buffer[unique_id].append(current_input_image)
                
                # 维护队列长度（先进先出）
                while len(self._tensor_buffer[unique_id]) > 暂存次数:
                    self._tensor_buffer[unique_id].pop(0) # 移除最旧的

        # 3. 准备生成 UI 预览图 (这一步主要是为了生成缩略图文件)
        # 我们只为"新进来的"图片生成预览文件，旧的已经在以前运行生成过了
        current_image_paths = []
        if new_image_received and current_input_image is not None:
            subfolder_path = os.path.join(self.temp_output_dir, self.temp_subfolder)
            os.makedirs(subfolder_path, exist_ok=True)
            
            batch_size = current_input_image.shape[0]
            for i in range(batch_size):
                img_t = current_input_image[i:i+1]
                # 处理 1x1 黑图等特殊情况
                if img_t.shape[1] <= 1 and img_t.shape[2] <= 1:
                    preview_tensor = torch.zeros((1, 32, 32, 3), dtype=torch.float32, device=img_t.device)
                    pil_img = Image.fromarray((preview_tensor.squeeze(0).cpu().numpy() * 255).astype(np.uint8))
                else:
                    pil_img = Image.fromarray((img_t.squeeze(0).cpu().numpy() * 255).astype(np.uint8))
                
                filename = f"zml_mem_{unique_id}_{uuid.uuid4().hex[:8]}.png"
                file_path = os.path.join(subfolder_path, filename)
                
                metadata = PngImagePlugin.PngInfo()
                if self.prompt: metadata.add_text("prompt", json.dumps(self.prompt))
                
                pil_img.save(file_path, pnginfo=metadata, compress_level=4)
                current_image_paths.append({"filename": filename, "subfolder": self.temp_subfolder, "type": "temp"})

        # 4. 更新 UI 缓存 (路径列表)
        if unique_id:
            if new_image_received:
                self._image_cache[unique_id].append(current_image_paths)
                # 维护 UI 缓存长度
                while len(self._image_cache[unique_id]) > 暂存次数:
                    self._image_cache[unique_id].pop(0)
            
            # 扁平化 UI 列表 (因为 self._image_cache 是 [[paths_run1], [paths_run2]] 结构)
            # 我们需要把它变成一个长列表给前端
            flat_ui_paths = []
            for batch_paths in self._image_cache[unique_id]:
                flat_ui_paths.extend(batch_paths)
        else:
            flat_ui_paths = current_image_paths

        # 5. --- 【核心修改】构建输出数据 ---
        # 默认输出空
        final_output_list = []

        if unique_id and len(self._tensor_buffer[unique_id]) > 0:
            # 检查所有图像的分辨率是否一致
            resolutions = set()
            for tensor in self._tensor_buffer[unique_id]:
                h, w, c = tensor.shape[1:]
                resolutions.add((h, w, c))
            
            if len(resolutions) == 1:
                # 分辨率一致，拼接成一个大的 Batch
                final_output_batch = torch.cat(self._tensor_buffer[unique_id], dim=0)
                final_output_list = [final_output_batch]
            else:
                # 分辨率不同，输出图像列表
                final_output_list = self._tensor_buffer[unique_id].copy()
        elif current_input_image is not None:
            # 如果没有 unique_id (极端情况)，直接透传当前输入
            final_output_list = [current_input_image]
        else:
            # 没有图像，输出空列表
            final_output_list = []

        # 6. 处理索引选择
        if 选择输出索引 > 0 and len(final_output_list) > 0:
            # 输出指定索引的那一张
            # 索引转换：用户输入1代表第1张(idx 0)
            idx = 选择输出索引 - 1
            if 0 <= idx < len(final_output_list):
                final_output_list = [final_output_list[idx]]
            else:
                # 索引越界时，返回最后一张
                print(f"ZML_ImageMemory: 索引 {选择输出索引} 超出范围 (当前共有 {len(final_output_list)} 张), 返回最后一张。")
                final_output_list = [final_output_list[-1]]

        # 7. 处理关闭输出
        if 关闭输出 and ExecutionBlocker is not None:
            return {"ui": {"images": flat_ui_paths}, "result": (ExecutionBlocker(None),)}
            
        return {"ui": {"images": flat_ui_paths}, "result": (final_output_list,)}

    def _save_to_local(self, image_tensor):
        # 此方法保留，虽然逻辑中未深度使用
        pass

    def _load_from_local(self):
        # 此方法保留
        return None

# ============================== 提示词token统一 ==============================
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

#==========================批次到整数==========================

class ZML_ImageBatchToInt:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "图像批次": ("IMAGE",),
                "文本": ("STRING", {"forceInput": True, "multiline": True}),
            }
        }

    RETURN_TYPES = ("INT", "INT")
    RETURN_NAMES = ("图像数量", "文本行数")
    FUNCTION = "count_items"
    CATEGORY = "image/ZML_图像/整数"

    def count_items(self, 图像批次=None, 文本=None):
        # 1. 计算图像数量
        img_count = 0
        if 图像批次 is not None:
            # 这里的 len() 返回的是 Batch 维度的大小
            img_count = len(图像批次)
        
        # 2. 计算文本行数
        txt_count = 0
        if 文本 is not None:
            if isinstance(文本, list):
                # 如果输入被识别为列表对象
                txt_count = len(文本)
            else:
                # 如果是字符串，按换行符计算行数
                s = str(文本).strip()
                if s:
                    # splitlines() 可以自动处理 \n, \r, \r\n 等
                    txt_count = len(s.splitlines())
                else:
                    txt_count = 0

        return (img_count, txt_count)

#==========================图像裁剪节点==========================

class ZML_ImageCrop:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像": ("IMAGE",),
                "裁剪比例": (["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"], {"default": "1:1"}),
                "裁剪方向": (["居中", "顶部", "底部", "左侧", "右侧"], {"default": "居中"}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("裁剪后图像",)
    FUNCTION = "crop_image"
    CATEGORY = "image/ZML_图像/图像"

    def crop_image(self, 图像, 裁剪比例, 裁剪方向):
        # 解析比例
        if 裁剪比例 == "自定义":
            # 如果需要自定义，默认回退到1:1，或者这里可以扩展逻辑
            target_ratio = 1.0
        else:
            try:
                w_ratio, h_ratio = map(float, 裁剪比例.split(":"))
                target_ratio = w_ratio / h_ratio
            except:
                target_ratio = 1.0

        # 获取输入图像尺寸 (Batch, Height, Width, Channels)
        batch_size, height, width, channels = 图像.shape
        current_ratio = width / height

        # 计算新的尺寸
        if current_ratio > target_ratio:
            # 图像太宽，需要裁剪宽度 (高度保持不变)
            new_height = height
            new_width = int(height * target_ratio)
        else:
            # 图像太高，需要裁剪高度 (宽度保持不变)
            new_width = width
            new_height = int(width / target_ratio)

        # 初始化裁剪坐标（默认为居中）
        x_start = (width - new_width) // 2
        y_start = (height - new_height) // 2

        # 根据方向调整坐标
        # 注意：如果裁剪的是宽度，"顶部/底部"选项不起作用（因为高度没变，y_start已经是0），依然保持垂直居中(0)
        # 同理，如果裁剪的是高度，"左侧/右侧"选项不起作用，依然保持水平居中(0)
        
        if 裁剪方向 == "顶部":
            y_start = 0
        elif 裁剪方向 == "底部":
            y_start = height - new_height
        elif 裁剪方向 == "左侧":
            x_start = 0
        elif 裁剪方向 == "右侧":
            x_start = width - new_width
        # "居中" 已经在初始化时计算过了

        # 确保坐标不越界 (虽然计算逻辑上不应该越界，但做个保险)
        x_start = max(0, min(x_start, width - new_width))
        y_start = max(0, min(y_start, height - new_height))

        # 执行裁剪 (切片操作: Batch, Y, X, Channels)
        cropped_image = 图像[:, y_start:y_start + new_height, x_start:x_start + new_width, :]

        return (cropped_image,)

#==========================图像Base64互转节点==========================

class ZML_ImageBase64Converter:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "optional": {
                "图像": ("IMAGE", {"label": "要转换的图像"}),
                "Base64字符串": ("STRING", {"label": "要转换的Base64字符串", "multiline": True}),
            }
        }

    RETURN_TYPES = ("STRING", "IMAGE")
    RETURN_NAMES = ("Base64字符串", "图像")
    FUNCTION = "convert"
    CATEGORY = "image/ZML_图像/图像"

    def convert(self, 图像=None, Base64字符串=None):
        base64_output = None
        image_output = None
        
        # 图像转Base64
        if 图像 is not None:
            try:
                img_np = np.clip(255. * 图像.cpu().numpy().squeeze(0), 0, 255).astype(np.uint8)
                pil_image = Image.fromarray(img_np)
                
                buffer = BytesIO()
                pil_image.save(buffer, format="PNG")
                base64_output = base64.b64encode(buffer.getvalue()).decode("utf-8")
            except Exception as e:
                print(f"图像转Base64出错: {e}")
        
        # Base64转图像
        if Base64字符串 is not None:
            try:
                image_data = base64.b64decode(Base64字符串)
                pil_image = Image.open(BytesIO(image_data))
                
                img_np = np.array(pil_image).astype(np.float32) / 255.0
                image_output = torch.from_numpy(img_np).unsqueeze(0)
            except Exception as e:
                print(f"Base64转图像出错: {e}")
        
        # 如果转换失败，返回输入作为默认值
        if base64_output is None and 图像 is not None:
            base64_output = ""
        if image_output is None and Base64字符串 is not None:
            image_output = torch.zeros((1, 1, 1, 3))
            
        return (base64_output, image_output)

# ==========================================
# 节点 7: ZML_列表转批次
# ==========================================
class ZML_List_To_Batch:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "分隔符": ("STRING", {"default": ",\\n", "multiline": False}),
            },
            "optional": {
                "图像列表": ("IMAGE",),
                "文本列表": ("STRING", {"forceInput": True}),
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("图像批次", "合并文本")
    # 对应输入的列表化状态: 分隔符(否), 图像列表(是), 文本列表(是)
    INPUT_IS_LIST = (False, True, True)
    FUNCTION = "process_lists"
    CATEGORY = "image/ZML_图像/图像"

    def process_lists(self, 分隔符, 图像列表=None, 文本列表=None):
        # 如果分隔符被传入为列表（这种情况在ComfyUI某些连接方式下会发生），取第一个元素
        if isinstance(分隔符, list):
            if len(分隔符) > 0:
                分隔符 = 分隔符[0]
            else:
                分隔符 = ",\\n" # 默认回退值
        
        # 确保分隔符是字符串类型，防止其他意外类型报错
        if not isinstance(分隔符, str):
            分隔符 = str(分隔符)

        # 1. 处理文本
        final_text = ""
        # 处理转义符，将字符串的 "\n" 转换为实际换行符
        sep = 分隔符.replace("\\n", "\n")
        
        if 文本列表:
            str_list = []
            for t in 文本列表:
                if t is not None:
                    # 再次防御：如果列表中的单项还是列表（某些节点输出嵌套列表），取其内容
                    if isinstance(t, list):
                        if len(t) > 0: str_list.append(str(t[0]))
                    else:
                        str_list.append(str(t))
            
            final_text = sep.join(str_list)

        # 2. 处理图像
        final_image = None
        if 图像列表 and len(图像列表) > 0:
            # 这里的图像列表中的元素通常是 Tensor [Batch, H, W, C]
            # 但为了安全起见，我们需要确保它们维度一致
            
            valid_images = []
            base_shape = None # 用于存储基准分辨率 (H, W, C)

            for img in 图像列表:
                if img is None: continue
                
                # 确保图像至少是3维或4维
                if isinstance(img, list): # 防御嵌套列表
                     if len(img) > 0: img = img[0]
                     else: continue

                # 统一转为 [B, H, W, C] 格式以便拼接
                if len(img.shape) == 3:
                    img = img.unsqueeze(0)
                
                # 设定基准分辨率
                if base_shape is None:
                    base_shape = img.shape[1:]
                
                # 检查分辨率是否一致
                if img.shape[1:] == base_shape:
                    valid_images.append(img)
            
            if valid_images:
                # 在 Batch 维度 (dim=0) 进行拼接
                final_image = torch.cat(valid_images, dim=0)
        
        # 如果没有有效图像，生成一个 1x1 黑色占位图防止报错
        if final_image is None:
            final_image = torch.zeros((1, 1, 1, 3), dtype=torch.float32)

        return (final_image, final_text)

# ==========================================
# 辅助类: 通用类型 (Any Type)
# 用于连接任意类型的输入和输出
# ==========================================
class AnyType(str):
    def __ne__(self, __value: object) -> bool:
        return False
    def __eq__(self, __value: object) -> bool:
        return True

ANY = AnyType("*")

# ==========================================
# 节点 8: ZML_获取列表项
# ==========================================
class ZML_Get_Item_From_List:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "输入列表": (ANY,), # 允许连接任意类型
                "索引": ("INT", {"default": 0, "min": 0, "max": 99999, "step": 1}),
            }
        }

    # 增加了一个 INT 类型的输出
    RETURN_TYPES = (ANY, "INT") 
    RETURN_NAMES = ("选定项", "列表总数")
    
    # 第一个参数(输入列表)按列表接收，第二个参数(索引)按单值接收
    INPUT_IS_LIST = (True, False)
    
    FUNCTION = "get_item"
    CATEGORY = "image/ZML_图像/工具"

    def get_item(self, 输入列表, 索引):
        # --- 防御性处理索引输入 ---
        if isinstance(索引, list):
            if len(索引) > 0: 索引 = 索引[0]
            else: 索引 = 0
        
        try:
            target_index = int(索引)
        except:
            target_index = 0
        # ------------------------

        # 1. 计算列表长度
        list_len = len(输入列表) if 输入列表 else 0

        # 2. 检查输入是否为空
        if list_len == 0:
            # 列表为空时，返回 (None, 0)
            return (None, 0)
            
        # 3. 安全处理索引 (防止越界)
        if target_index >= list_len:
            target_index = list_len - 1
        
        if target_index < 0:
            target_index = 0

        # 4. 获取项目
        result = 输入列表[target_index]
        
        # 5. 返回 (选定项, 长度)
        return (result, list_len)

#====================================================

NODE_CLASS_MAPPINGS = {
    "ZML_ImageTransition": ZML_ImageTransition,
    "ZML_ImageEncryption": ZML_ImageEncryption,
    "ZML_BooleanSwitch": ZML_BooleanSwitch,
    "ZML_MaskStroke": ZML_MaskStroke,
    "ZML_PreviewImage": ZML_PreviewImage,
    "ZML_ImageMemory": ZML_ImageMemory,
    "ZML_PromptTokenBalancer": ZML_PromptTokenBalancer,
    "ZML_ImageBatchToInt": ZML_ImageBatchToInt,
    "ZML_ImageCrop": ZML_ImageCrop, 
    "ZML_List_To_Batch": ZML_List_To_Batch,
    "ZML_Get_Item_From_List": ZML_Get_Item_From_List,
    "ZML_ImageBase64Converter": ZML_ImageBase64Converter
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_ImageTransition": "ZML_图像过渡动画",
    "ZML_ImageEncryption": "ZML_图像加密",
    "ZML_BooleanSwitch": "ZML_布尔开关",
    "ZML_MaskStroke": "ZML_遮罩描边",
    "ZML_PreviewImage": "ZML_预览图像",
    "ZML_ImageMemory": "ZML_桥接预览图像",
    "ZML_PromptTokenBalancer": "ZML_提示词token统一",
    "ZML_ImageBatchToInt": "ZML_批次到整数",
    "ZML_ImageCrop": "ZML_图像裁剪",
    "ZML_List_To_Batch": "ZML_列表转批次",
    "ZML_Get_Item_From_List": "ZML_获取列表项",
    "ZML_ImageBase64Converter": "ZML_图像Base64互转"
}
