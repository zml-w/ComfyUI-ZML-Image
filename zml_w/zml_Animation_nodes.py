import torch
import numpy as np
from PIL import Image, ImageDraw, ImageOps

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

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("过渡批次",)
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

            # 使用 composite 方法进行图像B到图像A的过渡
            # mask 为 255 的地方显示 pil_image_b，为 0 的地方显示 pil_image_a
            current_frame_pil = Image.composite(pil_image_b, pil_image_a, mask)
            transition_frames.append(self._pil_to_tensor(current_frame_pil))

        # 将所有帧合并为一个图像批次
        output_batch = torch.cat(transition_frames, dim=0)
        return (output_batch,)

# 将新节点添加到你的节点映射中
NODE_CLASS_MAPPINGS = {
    "ZML_ImageTransition": ZML_ImageTransition,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_ImageTransition": "ZML_图像过渡动画",
}
