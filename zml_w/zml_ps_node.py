# zml_ps_node.py
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

# --- ZML_ImageColorAdjust 节点 (图像颜色调整) ---
class ZML_ImageColorAdjust:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像": ("IMAGE",),
            },
            "optional": {
                "color_data": ("STRING", {"multiline": True, "default": "{}", "widget": "hidden"}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("调整后图像",)
    FUNCTION = "adjust_color"
    CATEGORY = "image/ZML_图像/高级图像工具"

    def tensor_to_pil(self, tensor):
        if tensor.dim() == 4:
            tensor = tensor[0] # 从batch中取出第一张图像
        return Image.fromarray(np.clip(255. * tensor.cpu().numpy(), 0, 255).astype(np.uint8))

    def pil_to_tensor(self, pil_image):
        return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)

    def adjust_color(self, 图像, color_data="{}"):
        # 解析颜色调整数据
        try:
            data = json.loads(color_data)
            brightness = data.get('brightness', 0.0)  # 前端用的是-100到100范围
            contrast = data.get('contrast', 0.0)  # 前端用的是-100到100范围
            saturation = data.get('saturation', 0.0)  # 前端用的是-100到100范围
            hue = data.get('hue', 0.0)  # 前端用的是-180到180范围
            sharpen = data.get('sharpen', 0.0)  # 前端用的是0到100范围
            gamma = data.get('gamma', 1.0)
            exposure = data.get('exposure', 0.0)  # 前端用的是-100到100范围
            blur = data.get('blur', 0.0)
            noise = data.get('noise', 0.0)
            vignette = data.get('vignette', 0.0)
        except Exception as e:
            # 如果解析失败，使用默认值并输出错误
            print(f"颜色数据解析错误: {e}")
            brightness = 0.0
            contrast = 0.0
            saturation = 0.0
            hue = 0.0
            sharpen = 0.0
            gamma = 1.0
            exposure = 0.0
            blur = 0.0
            noise = 0.0
            vignette = 0.0
        if not cv2:
            print("错误: OpenCV未安装，无法执行颜色调整。")
            return (图像,)

        # 将张量转换为PIL图像，再转换为OpenCV格式
        image_pil = self.tensor_to_pil(图像)
        # 检查图像是否有透明度通道
        if image_pil.mode == 'RGBA':
            # 分离RGB和Alpha通道
            rgb = image_pil.convert('RGB')
            alpha = np.array(image_pil.split()[-1])
            image_cv = cv2.cvtColor(np.array(rgb), cv2.COLOR_RGB2BGR)
        else:
            image_cv = cv2.cvtColor(np.array(image_pil), cv2.COLOR_RGB2BGR)
            alpha = None

        # 亮度调整 - 保持与前端相同的处理方式
        if brightness != 0:
            image_cv = cv2.add(image_cv, brightness)

        # 对比度调整 - 使用与前端相同的公式
        if contrast != 0:
            factor = (259 * (contrast + 255)) / (255 * (259 - contrast))
            image_cv = cv2.convertScaleAbs(image_cv, alpha=1.0)
            image_cv = cv2.subtract(image_cv, 128)
            image_cv = cv2.convertScaleAbs(image_cv, alpha=factor)
            image_cv = cv2.add(image_cv, 128)

        # 转换到HSV色彩空间进行色相和饱和度调整
        hsv = cv2.cvtColor(image_cv, cv2.COLOR_BGR2HSV).astype(np.float32)

        # 色相调整 - 转换到OpenCV的H通道范围(0-180)
        if hue != 0:
            # 前端色相范围是-180到180，需要转换到OpenCV的HSV范围
            # OpenCV的H通道范围是0-180（对应0-360度）
            hue_adjust = (hue / 2.0) % 180  # 将-180到180转换为-90到90，再取模到0-180
            hsv[:, :, 0] = (hsv[:, :, 0] + hue_adjust) % 180

        # 饱和度调整
        if saturation != 0:
            # 饱和度调整，1.0 + saturation因子
            hsv[:, :, 1] = np.clip(hsv[:, :, 1] * (1.0 + saturation / 100.0), 0, 255)

        # 转换回BGR色彩空间
        image_cv = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)

        # 伽马调整
        if gamma != 1.0:
            # 伽马查找表
            gamma_table = np.array([((i / 255.0) ** (1.0 / gamma)) * 255 for i in np.arange(0, 256)]).astype(np.uint8)
            image_cv = cv2.LUT(image_cv, gamma_table)

        # 锐化调整 - 使用与前端相似的锐化算法，保持卷积核平衡
        if sharpen > 0:
            # 计算锐化强度因子，使用更合理的缩放方式
            sharpen_factor = min(sharpen / 50.0, 3.0)  # 限制最大强度为3，与前端保持一致
            
            # 使用平衡的锐化核
            kernel = np.array([[0, -1, 0],
                              [-1, 5, -1],
                              [0, -1, 0]])
            
            # 先应用标准锐化核
            sharpened = cv2.filter2D(image_cv, -1, kernel)
            
            # 使用混合方式应用锐化效果，避免亮度失衡
            # 锐化结果 = 原图 + (锐化结果 - 原图) * 锐化因子
            image_cv = cv2.addWeighted(image_cv, 1.0, cv2.subtract(sharpened, image_cv), sharpen_factor, 0)
        
        # 曝光调整 - 使用乘法因子而不是加法，避免全白问题
        if exposure != 0:
            # 使用与前端相似的曝光调整方法
            exposure_factor = 1.0 + (exposure / 100.0)
            image_cv = cv2.convertScaleAbs(image_cv, alpha=exposure_factor)
        
        # 模糊调整
        if blur > 0:
            # 前端模糊滑块范围是0-20，我们直接使用这个值来计算模糊程度
            # 根据前端输入范围(0-20)调整模糊强度
            # 从前端范围映射到合理的核大小：3-21的奇数
            # 调整模糊计算方式，确保即使是较小的值也能产生明显效果
            kernel_size = int(blur * 0.5) * 2 + 1  # 确保是奇数
            kernel_size = min(max(3, kernel_size), 21)  # 限制在3-21之间
            # 使用固定的sigma值来增强模糊效果
            sigma = blur * 0.5  # 根据模糊值计算sigma
            # 调试信息：输出实际使用的核大小
            # print(f"使用的模糊核大小: {kernel_size}, sigma: {sigma}")
            image_cv = cv2.GaussianBlur(image_cv, (kernel_size, kernel_size), sigma)
        
        # 噪点调整
        if noise > 0:
            # 添加高斯噪声 - 与前端保持一致，先除以100再乘以255
            mean = 0
            std_dev = (noise / 100.0) * 255.0  # 修复：先除以100再乘以255
            noise_array = np.random.normal(mean, std_dev, image_cv.shape).astype(np.float32)
            image_cv = np.clip(image_cv + noise_array, 0, 255).astype(np.uint8)
        
        # 暗角调整
        if vignette != 0:
            # 创建暗角效果
            rows, cols = image_cv.shape[:2]
            # 计算图像中心
            center_x, center_y = cols // 2, rows // 2
            # 计算到中心的最大距离
            max_dist = np.sqrt(center_x**2 + center_y**2)
            # 创建网格
            x = np.linspace(0, cols-1, cols)
            y = np.linspace(0, rows-1, rows)
            xx, yy = np.meshgrid(x, y)
            # 计算每个像素到中心的距离
            dist = np.sqrt((xx - center_x)**2 + (yy - center_y)**2)
            # 归一化距离
            dist_norm = dist / max_dist
            # 修复：将暗角值除以100进行归一化，与前端保持一致
            vignette_strength = vignette / 100.0
            # 创建暗角蒙版（值越大，暗角越强）
            # 与前端使用相同的计算公式：1.0 - (dist_norm) * vignette_strength
            vignette_mask = 1.0 - (dist_norm) * vignette_strength
            # 确保蒙版值在0-1之间
            vignette_mask = np.clip(vignette_mask, 0, 1)
            # 将蒙版应用到每个通道
            if len(image_cv.shape) == 3:
                # 彩色图像
                for c in range(3):
                    image_cv[:, :, c] = np.clip(image_cv[:, :, c] * vignette_mask, 0, 255).astype(np.uint8)
            else:
                # 灰度图像
                image_cv = np.clip(image_cv * vignette_mask, 0, 255).astype(np.uint8)

        # 将OpenCV图像转换回PIL Image
        if image_pil.mode == 'RGBA' and alpha is not None:
            # 转换回RGB，然后合并Alpha通道
            rgb_pil = Image.fromarray(cv2.cvtColor(image_cv, cv2.COLOR_BGR2RGB))
            rgba_pil = Image.new('RGBA', rgb_pil.size)
            rgba_pil.paste(rgb_pil)
            rgba_pil.putalpha(Image.fromarray(alpha))
            adjusted_image = rgba_pil
        else:
            adjusted_image = Image.fromarray(cv2.cvtColor(image_cv, cv2.COLOR_BGR2RGB))

        # 转换回张量并返回
        return (self.pil_to_tensor(adjusted_image),)

# --- 节点映射 ---
NODE_CLASS_MAPPINGS = {
    "ZML_ImageDeform": ZML_ImageDeform,
    "ZML_CylindricalProjection": ZML_CylindricalProjection,
    "ZML_PanoViewer": ZML_PanoViewer,
    "ZML_ImageColorAdjust": ZML_ImageColorAdjust,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_ImageDeform": "ZML_图像形变",
    "ZML_CylindricalProjection": "ZML_圆柱投影",
    "ZML_PanoViewer": "ZML_全景图预览",
    "ZML_ImageColorAdjust": "ZML_可视化调色",
}
