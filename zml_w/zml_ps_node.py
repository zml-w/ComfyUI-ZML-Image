# 文件名: zml_ps_node.py (版本 5.0: 全新重构为 "ZML_图像形变" 节点)
import torch
import numpy as np
from PIL import Image
import json
import base64
import io

try:
    import cv2
    from scipy.interpolate import griddata
except ImportError:
    print("错误: ZML节点 V5.0+ 需要 OpenCV 和 SciPy。请执行: pip install opencv-python scipy")
    cv2 = None

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
    CATEGORY = "image/ZML_图像/图像"

    def tensor_to_pil(self, tensor):
        return Image.fromarray(np.clip(255. * tensor.cpu().numpy(), 0, 255).astype(np.uint8))

    def pil_to_tensor(self, pil_image):
        return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)

    def deform_image(self, 图像, deformation_data):
        if not cv2:
            print("错误: OpenCV或SciPy未安装，无法执行形变。")
            return (图像,)

        image_pil = self.tensor_to_pil(图像[0]).convert("RGBA")
        image_cv = cv2.cvtColor(np.array(image_pil), cv2.COLOR_RGBA2BGRA)
        h, w = image_cv.shape[:2]

        try:
            data = json.loads(deformation_data)
            mode = data.get("mode")
            if not data or not mode:
                # 如果未编辑，直接返回原图
                return (图像,)

            deformed_image_cv = None

            if mode == "warp":
                points = np.array(data["points"])
                grid_size = data["gridSize"]
                
                src_points = np.meshgrid(np.linspace(0, w-1, grid_size), np.linspace(0, h-1, grid_size))
                src_points = np.stack([src_points[0].ravel(), src_points[1].ravel()], axis=-1)
                
                dst_points = points
                
                grid_y, grid_x = np.mgrid[0:h, 0:w]
                
                map_y = griddata(dst_points, src_points[:, 1], (grid_x, grid_y), method='cubic').astype(np.float32)
                map_x = griddata(dst_points, src_points[:, 0], (grid_x, grid_y), method='cubic').astype(np.float32)

                nan_mask = np.isnan(map_x)
                if np.any(nan_mask):
                    map_x[nan_mask] = griddata(dst_points, src_points[:, 0], (grid_x[nan_mask], grid_y[nan_mask]), method='linear')
                    map_y[nan_mask] = griddata(dst_points, src_points[:, 1], (grid_x[nan_mask], grid_y[nan_mask]), method='linear')
                
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
                
                displacement = (map_cv_resized[:, :, [2, 1]].astype(np.float32) - 127.5)
                
                grid_x, grid_y = np.meshgrid(np.arange(w), np.arange(h))
                map_x = (grid_x + displacement[:, :, 0]).astype(np.float32)
                map_y = (grid_y + displacement[:, :, 1]).astype(np.float32)

                deformed_image_cv = cv2.remap(image_cv, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_TRANSPARENT)

            if deformed_image_cv is not None:
                deformed_pil = Image.fromarray(cv2.cvtColor(deformed_image_cv, cv2.COLOR_BGRA2RGBA))
                return (self.pil_to_tensor(deformed_pil.convert("RGB")),)
            else:
                return (图像,)

        except Exception as e:
            import traceback
            print(f"ZML图像形变节点出错: {e}")
            traceback.print_exc()
            return (图像,)

NODE_CLASS_MAPPINGS = {"ZML_ImageDeform": ZML_ImageDeform}
NODE_DISPLAY_NAME_MAPPINGS = {"ZML_ImageDeform": "ZML_图像形变"}