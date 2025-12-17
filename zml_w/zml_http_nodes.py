import torch
import numpy as np
import requests
import json
import re
import base64
from PIL import Image
from io import BytesIO

# 辅助函数：Tensor转Base64
def tensor_to_base64(image):
    if image is None:
        return ""
    # ComfyUI image shape: [1, H, W, C] -> [H, W, C]
    i = 255. * image[0].cpu().numpy()
    img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))
    buffered = BytesIO()
    img.save(buffered, format="PNG")
    return base64.b64encode(buffered.getvalue()).decode("utf-8")

# 辅助函数：Bytes转Tensor
def bytes_to_tensor(image_bytes):
    img = Image.open(BytesIO(image_bytes))
    img = img.convert("RGB")
    img = np.array(img).astype(np.float32) / 255.0
    img = torch.from_numpy(img)[None,]
    return img

# ==========================================
# 节点 1: 工作流变量
# ==========================================
class ZML_HTTP_Vars_Workflow:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "A": ("STRING", {"multiline": True, "default": "", "placeholder": "在‘HTTP 通用请求’节点中输入{{A}}"}),
                "B": ("STRING", {"multiline": True, "default": "", "placeholder": "在‘HTTP 通用请求’节点中输入{{B}}"}),
                "C": ("STRING", {"multiline": True, "default": "", "placeholder": "在‘HTTP 通用请求’节点中输入{{C}}"}),
                "D": ("STRING", {"multiline": True, "default": "", "placeholder": "在‘HTTP 通用请求’节点中输入{{D}}"}),
                "E": ("STRING", {"multiline": True, "default": "", "placeholder": "在‘HTTP 通用请求’节点中输入{{E}}"}),
                "F": ("STRING", {"multiline": True, "default": "", "placeholder": "在‘HTTP 通用请求’节点中输入{{F}}"}),
                "G": ("STRING", {"multiline": True, "default": "", "placeholder": "在‘HTTP 通用请求’节点中输入{{G}}"}),
            }
        }
    RETURN_TYPES = ("HTTP_VARS",)
    RETURN_NAMES = ("变量包",)
    FUNCTION = "pack_vars"
    CATEGORY = "image/ZML_图像/HTTP"

    def pack_vars(self, A, B, C, D, E, F, G):
        return ({"A": A, "B": B, "C": C, "D": D, "E": E, "F": F, "G": G},)

# ==========================================
# 节点 2: 浏览器变量
# ==========================================
class ZML_HTTP_Vars_Browser:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # 这个字段会被 JS 隐藏并自动填充
                "json_data": ("STRING", {"default": "{}", "multiline": False}),
            }
        }
    RETURN_TYPES = ("HTTP_VARS",)
    RETURN_NAMES = ("安全变量包",)
    FUNCTION = "load_vars"
    CATEGORY = "image/ZML_图像/HTTP"

    def load_vars(self, json_data):
        try:
            data = json.loads(json_data)
        except:
            data = {}
        return (data,)

# ==========================================
# 节点 3: HTTP 请求主程序
# ==========================================
class ZML_HTTP_Request:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "method": (["GET", "POST", "PUT", "DELETE", "PATCH"], {"default": "POST"}),
                "url": ("STRING", {"default": "https://api.example.com", "multiline": False}),
                "headers": ("STRING", {"default": "请求头", "multiline": True, "placeholder": "Key: Value (每行一个)"}),
                "body": ("STRING", {"default": "请求体（图像变量为{{IMAGE_B64}}）", "multiline": True}),
                "timeout": ("INT", {"default": 30, "min": 1, "max": 300}),
            },
            "optional": {
                "image_input": ("IMAGE",),
                "vars_workflow": ("HTTP_VARS", {"tooltip": "连接【工作流变量】节点 (A-G)"}),
                "vars_browser": ("HTTP_VARS", {"tooltip": "连接【浏览器变量】节点 (自定义Keys)"}),
            }
        }

    RETURN_TYPES = ("STRING", "IMAGE", "INT")
    RETURN_NAMES = ("响应文本", "响应图像", "状态码")
    FUNCTION = "execute_request"
    CATEGORY = "image/ZML_图像/HTTP"

    def execute_request(self, method, url, headers, body, timeout, image_input=None, vars_workflow=None, vars_browser=None):
        # 1. 合并变量
        variables = {}
        if vars_workflow: variables.update(vars_workflow)
        if vars_browser: variables.update(vars_browser)

        # 2. 处理图像输入，存入变量 {{IMAGE_B64}}
        if image_input is not None:
            variables["IMAGE_B64"] = tensor_to_base64(image_input)
        else:
            variables["IMAGE_B64"] = ""

        # 3. 模板替换函数
        def replace_template(text):
            if not isinstance(text, str): return text
            # 查找 {{KEY}} 模式
            def replacer(match):
                key = match.group(1).strip()
                return str(variables.get(key, match.group(0))) # 如果找不到key，保留原样
            return re.sub(r'\{\{(.*?)\}\}', replacer, text)

        # 4. 替换参数
        final_url = replace_template(url)
        final_body = replace_template(body)
        
        # 5. 解析 Headers (支持模板替换)
        headers_dict = {}
        for line in headers.split('\n'):
            line = replace_template(line).strip()
            if ':' in line:
                key, value = line.split(':', 1)
                headers_dict[key.strip()] = value.strip()

        # 6. 执行请求
        try:
            req_params = {
                "method": method,
                "url": final_url,
                "headers": headers_dict,
                "timeout": timeout
            }

            # 智能判断 Body 类型
            if method in ["POST", "PUT", "PATCH"]:
                # 尝试判断是否为 JSON
                try:
                    json_data = json.loads(final_body)
                    req_params["json"] = json_data
                except:
                    # 不是 JSON，当做普通 Data 发送
                    req_params["data"] = final_body.encode('utf-8')

            response = requests.request(**req_params)
            
            # 7. 处理响应
            resp_text = response.text
            status_code = response.status_code
            
            # 尝试解析图像
            resp_image = None
            content_type = response.headers.get("Content-Type", "")
            if "image" in content_type:
                try:
                    resp_image = bytes_to_tensor(response.content)
                except:
                    print("ZML HTTP: 响应虽为图像类型但解析失败")
            
            # 如果没有图像，返回一个空的 1x1 黑色图像以防报错
            if resp_image is None:
                resp_image = torch.zeros((1, 64, 64, 3), dtype=torch.float32)

            return (resp_text, resp_image, status_code)

        except Exception as e:
            return (f"请求错误: {str(e)}", torch.zeros((1, 64, 64, 3)), 500)

NODE_CLASS_MAPPINGS = {
    "ZML_HTTP_Vars_Workflow": ZML_HTTP_Vars_Workflow,
    "ZML_HTTP_Vars_Browser": ZML_HTTP_Vars_Browser,
    "ZML_HTTP_Request": ZML_HTTP_Request
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_HTTP_Vars_Workflow": "HTTP 变量 (工作流存储)",
    "ZML_HTTP_Vars_Browser": "HTTP 变量 (浏览器缓存)",
    "ZML_HTTP_Request": "HTTP 通用请求"
}