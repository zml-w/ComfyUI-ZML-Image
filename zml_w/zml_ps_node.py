# zml_ps_node.py
# 版本: 7.0 (优化 ZML_PanoViewer 节点，修复视角拖动控制方向，改进透视控制，添加相机距离调节，增加内外视角切换功能)
import torch
import numpy as np
from PIL import Image
import json
import base64
import io
import math

try:
    import cv2
    from scipy.interpolate import griddata
except ImportError:
    print("错误: ZML节点 V5.0+ 需要 OpenCV 和 SciPy。请执行: pip install opencv-python scipy")
    cv2 = None
    griddata = None # 确保在cv2无法导入时，griddata也为None

# --- ZML_ImageDeform 节点 ---
class ZML_ImageDeform:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像": ("IMAGE",),
                "deformation_data": ("STRING", {"multiline": True, "default": "{}", "widget": "hidden"}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("图像",)
    FUNCTION = "deform_image"
    CATEGORY = "image/ZML_图像/高级图像工具"

    def tensor_to_pil(self, tensor):
        if tensor.dim() == 4:
            tensor = tensor[0] # 从batch中取出第一张图像
        return Image.fromarray(np.clip(255. * tensor.cpu().numpy(), 0, 255).astype(np.uint8))

    def pil_to_tensor(self, pil_image):
        return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)

    def deform_image(self, 图像, deformation_data):
        if not cv2 or not griddata:
            print("错误: OpenCV或SciPy未安装，无法执行形变。")
            return (图像,)

        # 确保输入图像是RGBA格式，因为形变可能引入透明区域
        image_pil = self.tensor_to_pil(图像).convert("RGBA")
        image_cv = cv2.cvtColor(np.array(image_pil), cv2.COLOR_RGBA2BGRA)
        h, w = image_cv.shape[:2]

        try:
            data = json.loads(deformation_data)
            mode = data.get("mode")
            
            if not data or not mode:
                # 如果未编辑或模式无效，直接返回原图张量
                return (图像,)

            deformed_image_cv = None

            if mode == "warp":
                points = np.array(data["points"])
                grid_size = data["gridSize"]
                
                # 原始点：均匀分布在图像上
                src_points = np.meshgrid(np.linspace(0, w-1, grid_size), np.linspace(0, h-1, grid_size))
                src_points = np.stack([src_points[0].ravel(), src_points[1].ravel()], axis=-1)
                
                dst_points = points # 目标点：来自JS前端的变形点
                
                grid_y, grid_x = np.mgrid[0:h, 0:w] # 生成目标图像的每个像素的坐标
                
                # 使用griddata进行插值，计算每个目标像素在原图中的对应位置
                map_y = griddata(dst_points, src_points[:, 1], (grid_x, grid_y), method='cubic').astype(np.float32)
                map_x = griddata(dst_points, src_points[:, 0], (grid_x, grid_y), method='cubic').astype(np.float32)

                # 处理可能出现的NaN值
                nan_mask = np.isnan(map_x)
                if np.any(nan_mask):
                    # 对NaN区域使用线性插值或填充，确保remap能处理有效数据
                    map_x_linear = griddata(dst_points, src_points[:, 0], (grid_x[nan_mask], grid_y[nan_mask]), method='linear')
                    map_y_linear = griddata(dst_points, src_points[:, 1], (grid_x[nan_mask], grid_y[nan_mask]), method='linear')
                    map_x[nan_mask] = np.nan_to_num(map_x_linear) # 填充线性结果
                    map_y[nan_mask] = np.nan_to_num(map_y_linear) # 填充线性结果
                
                deformed_image_cv = cv2.remap(image_cv, np.nan_to_num(map_x), np.nan_to_num(map_y), cv2.INTER_CUBIC, borderMode=cv2.BORDER_TRANSPARENT)

            elif mode == "liquify":
                map_base64 = data["map"]
                if ',' in map_base64:
                    _, encoded = map_base64.split(',', 1)
                else:
                    encoded = map_base64
                
                map_data = base64.b64decode(encoded)
                map_pil = Image.open(io.BytesIO(map_data)).convert("RGBA")
                map_cv = cv2.cvtColor(np.array(map_pil), cv2.COLOR_RGBA2BGR)
                map_cv_resized = cv2.resize(map_cv, (w, h), interpolation=cv2.INTER_LINEAR)
                
                # Displacements are stored in the R and G channels of the map image (often shifted)
                # Assuming R and B channels store x and y displacements, centered at 127.5
                displacement_x = (map_cv_resized[:, :, 2].astype(np.float32) - 127.5) # Red channel (OpenCV BGR, so index 2 is R)
                displacement_y = (map_cv_resized[:, :, 1].astype(np.float32) - 127.5) # Green channel (OpenCV BGR, so index 1 is G)
                
                grid_x, grid_y = np.meshgrid(np.arange(w), np.arange(h))
                map_x = (grid_x + displacement_x).astype(np.float32)
                map_y = (grid_y + displacement_y).astype(np.float32)

                deformed_image_cv = cv2.remap(image_cv, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_TRANSPARENT)

            if deformed_image_cv is not None:
                deformed_pil = Image.fromarray(cv2.cvtColor(deformed_image_cv, cv2.COLOR_BGRA2RGBA))
                return (self.pil_to_tensor(deformed_pil),)
            else:
                return (图像,) # 如果没有形变，返回原始输入图像（张量）

        except Exception as e:
            import traceback
            print(f"ZML图像形变节点出错: {e}")
            traceback.print_exc()
            return (图像,) # 出现异常时返回原始输入图像（张量）

# --- ZML_CylindricalProjection 节点 (圆柱投影) ---
class ZML_CylindricalProjection:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像": ("IMAGE",),
                "输出宽度": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 8}),
                "输出高度": ("INT", {"default": 512, "min": 64, "max": 4096, "step": 8}),
                "水平视角_度": ("FLOAT", {"default": 90.0, "min": 1.0, "max": 360.0, "step": 1.0, "round": 0.01}),
                "无缝水平循环": ("BOOLEAN", {"default": False}),
                "透明背景": ("BOOLEAN", {"default": True}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("全景图像",)
    FUNCTION = "project_to_cylinder"
    CATEGORY = "image/ZML_图像/图像"

    def tensor_to_pil(self, tensor):
        if tensor.dim() == 4:
            tensor = tensor[0] # 从batch中取出第一张图像
        return Image.fromarray(np.clip(255. * tensor.cpu().numpy(), 0, 255).astype(np.uint8))

    def pil_to_tensor(self, pil_image):
        return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)

    def project_to_cylinder(self, 图像, 输出宽度, 输出高度, 水平视角_度, 无缝水平循环, 透明背景):
        if not cv2:
            print("错误: OpenCV未安装，无法执行圆柱投影。")
            return (图像,)

        input_pil = self.tensor_to_pil(图像)
        
        # 根据透明背景选项确定输入图像的CV格式和remap的边界模式
        if 透明背景:
            input_pil = input_pil.convert("RGBA")
            input_cv = cv2.cvtColor(np.array(input_pil), cv2.COLOR_RGBA2BGRA)
            border_mode = cv2.BORDER_TRANSPARENT # 外部区域填充透明或黑（取决于OpenCV版本和系统设置）
        else:
            input_pil = input_pil.convert("RGB")
            input_cv = cv2.cvtColor(np.array(input_pil), cv2.COLOR_RGB2BGR)
            border_mode = cv2.BORDER_CONSTANT # 外部区域填充黑色
        
        h_in, w_in = input_cv.shape[:2] # 输入图像的实际高宽

        # --- 核心数学修正 ---
        # 1. 计算输出全景图像的中心
        cx_out = 输出宽度 / 2.0
        cy_out = 输出高度 / 2.0

        # 2. 计算将平面图像包裹成圆柱所需的“焦距”或“半径”
        # 这个 'f' 代表了原始透视图像的焦距 (以像素为单位)，决定了透视扭曲程度。
        # 如果原始图像的水平视角是 '水平视角_度'，那么 f = (w_in / 2) / tan(水平视角_度 / 2)
        fov_rad_h = math.radians(水平视角_度)
        if fov_rad_h <= 0: # 避免除零
            fov_rad_h = math.radians(0.1) 
        
        f = (w_in / 2.0) / math.tan(fov_rad_h / 2.0)

        # 3. 创建目标图像的坐标映射矩阵
        map_x = np.zeros((输出高度, 输出宽度), dtype=np.float32)
        map_y = np.zeros((输出高度, 输出宽度), dtype=np.float32)

        # 4. 遍历输出图像的每个像素 (x_out, y_out)
        for y_out in range(输出高度):
            for x_out in range(输出宽度):
                # 将输出像素从笛卡尔坐标转换为全景图的角度 (经度 lon, 纬度 lat)
                
                # 计算经度 (lon)：输出像素与中心线的水平偏移，再归一化到角度
                # 这里 (x_out - cx_out) 是像素偏移量
                # (输出宽度 / fov_rad_h) 是每弧度的像素数，相当于圆柱体的半径
                lon = (x_out - cx_out) / (输出宽度 / fov_rad_h)

                # 计算纬度 (lat)：输出像素与中心线的垂直偏移，再归一化到角度
                # 垂直视场角可以根据原始图像的纵横比来估算
                # 同样，(y_out - cy_out) 是像素偏移量
                # (输出高度 / fov_rad_h / original_aspect) 是每弧度的像素数
                # 简化为：直接使用与水平相同的缩放因子，后续用cos(lon)进行垂直补偿
                lat = (y_out - cy_out) / (输出高度 / fov_rad_h)
                
                # 5. 将经纬度角度反向投影回原始平面图像的像素坐标 (x_in, y_in)
                # 使用标准的从球形到平面投影的逆映射公式 (Rectilinear Projection)
                # X_src = R * tan(lon) + W_src/2
                # Y_src = R * lat / cos(lon) + H_src/2
                # 这里的R就是我们前面计算的透视焦距 'f'
                
                # 检查 lon 是否会引发 math.cos(0) 为 1，或接近 PI/2 导致 tan / cos 变得极大。
                # 但对于合理 FOV 的图像，lon 通常不会达到 PI/2。
                if abs(math.cos(lon)) < 1e-6: # 避免除以接近零的数
                    map_x[y_out, x_out] = -1 # 标记为无效，remap会根据borderMode处理
                    map_y[y_out, x_out] = -1
                    continue

                map_x[y_out, x_out] = w_in / 2.0 + f * math.tan(lon)
                map_y[y_out, x_out] = h_in / 2.0 + f * (lat / math.cos(lon))

        # 如果需要无缝水平循环，设置 remap 的边界模式为 BORDER_WRAP
        if 无缝水平循环:
            border_mode = cv2.BORDER_WRAP
        
        # 执行图像重映射
        deformed_image_cv = cv2.remap(input_cv, map_x, map_y, cv2.INTER_LINEAR, borderMode=border_mode)

        # 将OpenCV图像转换回PIL Image，再转换为ComfyUI Tensor
        if 透明背景:
            deformed_pil = Image.fromarray(cv2.cvtColor(deformed_image_cv, cv2.COLOR_BGRA2RGBA))
            output_tensor = self.pil_to_tensor(deformed_pil)
        else:
            deformed_pil = Image.fromarray(cv2.cvtColor(deformed_image_cv, cv2.COLOR_BGR2RGB))
            output_tensor = self.pil_to_tensor(deformed_pil)
        
        return (output_tensor,)

# --- ZML_PanoViewer 节点 (全景图预览，支持视角滑动输出) ---
class ZML_PanoViewer:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "全景图像": ("IMAGE",),
            }
        }

    RETURN_TYPES = ("IMAGE",)  # 始终返回原图
    RETURN_NAMES = ("输出",)  # 统一输出接口名称
    FUNCTION = "return_image"
    
    CATEGORY = "image/ZML_图像/高级图像工具" 

    def return_image(self, 全景图像):
        # 直接返回全景图像，不做任何处理
        return (全景图像,)

# --- 节点映射 ---
NODE_CLASS_MAPPINGS = {
    "ZML_ImageDeform": ZML_ImageDeform,
    "ZML_CylindricalProjection": ZML_CylindricalProjection,
    "ZML_PanoViewer": ZML_PanoViewer,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_ImageDeform": "ZML_图像形变",
    "ZML_CylindricalProjection": "ZML_圆柱投影",
    "ZML_PanoViewer": "ZML_全景图预览",
}
