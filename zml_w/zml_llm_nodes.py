import json
import requests
import re
import server
import torch
import base64
import numpy as np
import os
from io import BytesIO
from PIL import Image
from aiohttp import web

# ==========================================
# 工具函数
# ==========================================

def tensor2pil(image):
    """
    将单张 Tensor 图像 (H, W, C) 转为 PIL Image
    """
    return Image.fromarray(np.clip(255. * image.cpu().numpy(), 0, 255).astype(np.uint8))

def pil2base64(image):
    """
    将 PIL Image 转为 base64 字符串 (JPEG 格式)
    """
    try:
        buffered = BytesIO()
        if image.mode != "RGB":
            image = image.convert("RGB")
        image.save(buffered, format="JPEG", quality=95)
        return base64.b64encode(buffered.getvalue()).decode('utf-8')
    except Exception as e:
        print(f"[ZML] 图像转 base64 失败: {e}")
        return None

def create_placeholder_image():
    # 创建 1x1 黑色占位图 [1, 1, 1, 3]
    return torch.zeros((1, 1, 1, 3), dtype=torch.float32)

# ==========================================
# 模型加载器 (参数在工作流中)
# ==========================================
class ZML_LLM_ModelLoader:
    def __init__(self): pass
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # 这里的参数直接显示，供用户填写
                "api_url": ("STRING", {"default": "https://api.deepseek.com", "multiline": False, "tooltip": "LLM API Base URL"}),
                "api_key": ("STRING", {"default": "", "multiline": False, "tooltip": "sk-..."}),
                "model_id": ("STRING", {"default": "deepseek-chat", "multiline": False, "tooltip": "model id"}),
            }
        }
    RETURN_TYPES = ("LLM_MODEL_CONFIG",)
    RETURN_NAMES = ("模型配置",)
    FUNCTION = "load_model"
    CATEGORY = "image/ZML_图像/LLM"
    
    def load_model(self, api_url, api_key, model_id):
        return ({"api_url": api_url, "api_key": api_key, "model_id": model_id, "preset_name": "Custom"},)

# ==========================================
# 节点 1 模型加载器 (读取本地JSON)
# ==========================================
class ZML_LLM_ModelLoaderV2:
    def __init__(self): pass
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # 1. 预设名称：告诉 Python 要读 JSON 里的哪一项
                "preset_name": ("STRING", {"default": "未选择", "multiline": False}),
                # 2. 文件夹路径：告诉 Python 去哪里找 zml_model_key.json
                #    虽然这个路径会保存在工作流里，但这只是你本地的路径，不包含 Key，是安全的。
                "config_folder": ("STRING", {"default": "", "multiline": False}),
            },
            "optional": {
                # 3. 模型ID：作为可选覆盖。
                #    如果这里填了，就用这里的；如果这里为空，就用 JSON 预设里的 model。
                "model_override": ("STRING", {"default": "", "multiline": False, "tooltip": "如果填写，将覆盖预设里的模型ID"}),
            }
        }

    RETURN_TYPES = ("LLM_MODEL_CONFIG",)
    RETURN_NAMES = ("模型配置",)
    FUNCTION = "load_model_from_file"
    CATEGORY = "image/ZML_图像/LLM"
    
    def load_model_from_file(self, preset_name, config_folder, model_override=""):
        # 初始化空配置
        api_url = ""
        api_key = ""
        model_id = "error_loading"

        # 1. 检查文件是否存在
        file_path = os.path.join(config_folder, "zml_model_key.json")
        
        if not os.path.exists(file_path):
            print(f"[ZML] 错误: 找不到配置文件 {file_path}")
            return ({"api_url": "", "api_key": "", "model_id": "Error: Config file not found"},)

        # 2. 读取 JSON
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                presets = data.get("presets", [])
                
                # 3. 查找匹配的预设
                target_preset = next((p for p in presets if p.get("name") == preset_name), None)
                
                if target_preset:
                    api_url = target_preset.get("url", "")
                    api_key = target_preset.get("key", "")
                    # 优先使用 override，如果没有则使用预设里的 model
                    if model_override and model_override.strip():
                        model_id = model_override
                    else:
                        model_id = target_preset.get("model", "")
                else:
                    print(f"[ZML] 错误: 在配置中找不到预设 '{preset_name}'")
                    model_id = f"Error: Preset '{preset_name}' not found"

        except Exception as e:
            print(f"[ZML] 读取配置文件出错: {e}")
            model_id = f"Error: {str(e)}"

        # 返回配置 (Key 和 URL 是刚刚从硬盘读取的，没有保存在工作流中)
        return ({"api_url": api_url, "api_key": api_key, "model_id": model_id, "preset_name": preset_name},)

# ==========================================
# 节点 2: 系统提示词
# ==========================================
class ZML_LLM_SystemPrompt:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "system_prompt": ("STRING", {"default": "你是一只猫娘", "multiline": True}),
            }
        }
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("系统提示词",)
    FUNCTION = "get_prompt"
    CATEGORY = "image/ZML_图像/LLM"
    def get_prompt(self, system_prompt):
        return (system_prompt,)

# ==========================================
# 节点 3: 参数设置
# ==========================================
class ZML_LLM_Parameters:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "温度": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 2.0, "step": 0.01}),
                "最大Token数": ("INT", {"default": -1, "min": -1, "max": 32768, "step": 1}),
                "核采样": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                "频率惩罚": ("FLOAT", {"default": 0.0, "min": -2.0, "max": 2.0, "step": 0.01}),
                "存在惩罚": ("FLOAT", {"default": 0.0, "min": -2.0, "max": 2.0, "step": 0.01}),
                "超时时间": ("INT", {"default": 120, "min": 10, "max": 3600, "step": 10}),
            }
        }
    RETURN_TYPES = ("LLM_PARAMS",)
    RETURN_NAMES = ("参数包",)
    FUNCTION = "get_params"
    CATEGORY = "image/ZML_图像/LLM"
    def get_params(self, 温度, 最大Token数, 核采样, 频率惩罚, 存在惩罚, 超时时间):
        return ({
            "temperature": 温度, "max_tokens": 最大Token数, "top_p": 核采样,
            "frequency_penalty": 频率惩罚, "presence_penalty": 存在惩罚,
            "timeout": 超时时间
        },)

# ==========================================
# 节点 4: JSON 结构定义
# ==========================================
class ZML_LLM_JsonSchema:
    @classmethod
    def INPUT_TYPES(cls):
        default_schema = """{
	"回复内容": "在此输入",
	"状态": ["心情", "手部动作", "表情细节"]
}"""
        return {
            "required": {
                "schema_string": ("STRING", {"default": default_schema, "multiline": True}),
            }
        }
    RETURN_TYPES = ("JSON_SCHEMA",)
    RETURN_NAMES = ("JSON结构",)
    FUNCTION = "parse_schema"
    CATEGORY = "image/ZML_图像/LLM"
    def parse_schema(self, schema_string):
        try:
            return (json.loads(schema_string),)
        except json.JSONDecodeError as e:
            return ({"error": "Invalid JSON"},)

# ==========================================
# 节点 5: LLM 对话执行 (支持多批次图像)
# ==========================================
class ZML_LLM_Chat:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "user_input": ("STRING", {"multiline": True, "default": ""}),
                "model_config": ("LLM_MODEL_CONFIG",),
                "system_prompt": ("STRING",), 
                "params": ("LLM_PARAMS",),
                "json_strategy": (["DeepSeek/通用模式 (json_object)", "OpenAI严格模式 (json_schema)", "仅提示词 (不强求)"], {
                    "default": "DeepSeek/通用模式 (json_object)"
                }),
            },
            "optional": {
                "json_schema": ("JSON_SCHEMA",),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}), 
                "input_image": ("IMAGE", {"tooltip": "支持 Batch 批量图像输入"}),
            }
        }

    RETURN_TYPES = ("STRING", "IMAGE")
    RETURN_NAMES = ("回复内容", "图像")
    FUNCTION = "chat_completions"
    CATEGORY = "image/ZML_图像/LLM"

    def chat_completions(self, user_input, model_config, system_prompt, params, json_strategy, seed=0, json_schema=None, input_image=None):
        api_url = model_config.get("api_url", "").rstrip('/')
        api_key = model_config.get("api_key", "")
        model_id = model_config.get("model_id", "")

        if "generate" not in api_url and "chat/completions" not in api_url:
             api_url = f"{api_url}/v1/chat/completions"

        headers = { "Content-Type": "application/json", "Authorization": f"Bearer {api_key}" }

        # --- 1. 准备文本指令 (合并 System Prompt) ---
        full_text_instruction = ""
        if system_prompt and system_prompt.strip():
            full_text_instruction += f"{system_prompt}\n\n"

        response_format_payload = None
        if json_schema is not None and "error" not in json_schema:
            schema_str = json.dumps(json_schema, ensure_ascii=False, indent=2)
            if json_strategy == "DeepSeek/通用模式 (json_object)":
                response_format_payload = { "type": "json_object" }
                full_text_instruction += f"\n\n【输出格式要求】\n请严格按照以下 JSON 格式输出，不要包含 Markdown 标记：\n{schema_str}"
            elif json_strategy == "OpenAI严格模式 (json_schema)":
                response_format_payload = {
                    "type": "json_schema",
                    "json_schema": {"name": "structured_output", "strict": True, "schema": json_schema}
                }
            else:
                full_text_instruction += f"\n\n请输出以下 JSON 格式：\n{schema_str}"

        full_text_instruction += f"\n\n{user_input}"

        # --- 2. 构建 User 消息 (支持多批次图像) ---
        user_message_content = []
        
        # 添加文本
        user_message_content.append({"type": "text", "text": full_text_instruction})
        
        # 添加图像 (循环处理 Batch 中的每一张)
        if input_image is not None:
            try:
                # ComfyUI Image Shape: [Batch, Height, Width, Channel]
                batch_count = input_image.shape[0]
                
                for i in range(batch_count):
                    # 获取单张图片 Tensor [H, W, C]
                    single_image = input_image[i]
                    pil_image = tensor2pil(single_image)
                    base64_str = pil2base64(pil_image)
                    
                    if base64_str:
                        user_message_content.append({
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{base64_str}"}
                        })
            except Exception as e:
                print(f"[ZML] 批量图片处理出错: {e}")

        # --- 3. 组装 Messages ---
        messages = [{"role": "user", "content": user_message_content}]

        # --- 4. 构建 Payload ---
        payload = {
            "model": model_id,
            "messages": messages,
            "stream": False,
        }
        
        req_timeout = params.get("timeout", 120)
        for key, value in params.items():
            if (key == "max_tokens" and value == -1) or key == "timeout": continue
            payload[key] = value
        
        if seed > 0: payload["seed"] = seed
        if response_format_payload: payload["response_format"] = response_format_payload

        # --- 5. 准备输出图像 (直通) ---
        output_image_tensor = input_image if input_image is not None else create_placeholder_image()

        # --- 6. 发送请求 ---
        try:
            response = requests.post(api_url, json=payload, headers=headers, timeout=req_timeout)
            
            if response.status_code != 200:
                return (f"API 错误 ({response.status_code}): {response.text}", output_image_tensor)
            
            try:
                result = response.json()
            except json.JSONDecodeError:
                return (f"API 返回了无效数据 (非 JSON): {response.text[:800]}...", output_image_tensor)

            if "choices" in result and len(result["choices"]) > 0:
                content = result["choices"][0]["message"]["content"]
                if content.strip() == "INVALID_ARGUMENT":
                    return ("API 拒绝处理：收到 'INVALID_ARGUMENT'。请检查 API Key 权限或图片大小。", output_image_tensor)
                return (content, output_image_tensor)
            else:
                return (f"API 返回结构异常: {json.dumps(result, ensure_ascii=False)}", output_image_tensor)

        except Exception as e:
            return (f"请求发生异常: {str(e)}", output_image_tensor)


# ==========================================
# 节点 6: JSON 提取器
# ==========================================
class ZML_JsonExtractor:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "json_string": ("STRING", {"forceInput": True, "multiline": True, "default": ""}),
                "keys": ("STRING", {"default": "回复内容,状态"}),
                "array_mode": (["换行连接 (NewLine)", "文本列表 (List)", "原样列表 (JSON)"], {"default": "换行连接 (NewLine)"}),
            },
            "optional": {
                "default_value": ("STRING", {"default": ""}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING", "STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("值1", "值2", "值3", "值4", "值5", "值6", "值7")
    FUNCTION = "extract_json"
    CATEGORY = "image/ZML_图像/LLM"
    
    # 启用列表输出
    OUTPUT_IS_LIST = (True, True, True, True, True, True, True)

    def extract_json(self, json_string, keys, array_mode, default_value=""):
        clean_json = json_string.strip()
        match = re.search(r"```(?:json)?\s*(.*?)\s*```", clean_json, re.DOTALL | re.IGNORECASE)
        if match: clean_json = match.group(1).strip()
            
        try:
            start_obj = clean_json.find('{')
            start_arr = clean_json.find('[')
            if start_obj != -1 and (start_arr == -1 or start_obj < start_arr):
                end_index = clean_json.rfind('}') + 1
                if end_index > start_obj: clean_json = clean_json[start_obj:end_index]
            elif start_arr != -1:
                end_index = clean_json.rfind(']') + 1
                if end_index > start_arr: clean_json = clean_json[start_arr:end_index]
        except: pass

        try:
            data = json.loads(clean_json)
        except:
            print(f"[ZML] JSON 解析失败: {clean_json[:50]}...")
            return tuple([[default_value]] * 7)

        key_list = [k.strip() for k in keys.replace("，", ",").split(",") if k.strip()]
        results = []
        
        for i in range(7):
            if i < len(key_list):
                val = data.get(key_list[i], default_value)
                final_output = []
                
                if isinstance(val, list):
                    if "文本列表" in array_mode:
                        final_output = [json.dumps(x, ensure_ascii=False) if not isinstance(x, str) else x for x in val]
                    elif "原样列表" in array_mode:
                         final_output = [json.dumps(val, ensure_ascii=False)]
                    else:
                        merged_str = "\n".join([json.dumps(x, ensure_ascii=False) if not isinstance(x, str) else x for x in val])
                        final_output = [merged_str]
                else:
                    if not isinstance(val, str):
                        val = json.dumps(val, ensure_ascii=False)
                    final_output = [val]
                
                results.append(final_output)
            else:
                results.append([default_value])
        
        return tuple(results)

# ==========================================
# 节点 7: 过滤思考
# ==========================================
class ZML_LLM_ThoughtFilter:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {"input_text": ("STRING", {"multiline": False})},
        }
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("过滤后文本",)
    FUNCTION = "filter_thoughts"
    CATEGORY = "image/ZML_图像/LLM"
    
    def filter_thoughts(self, input_text):
        return (re.sub(r'<think>.*?</think>', '', input_text, flags=re.DOTALL | re.IGNORECASE),)


# ==========================================
# API 路由: 配置文件读写
# ==========================================
@server.PromptServer.instance.routes.post("/zml/llm/load_config")
async def load_llm_config(request):
    try:
        data = await request.json()
        folder_path = data.get("path", "")
        
        if not folder_path or not os.path.exists(folder_path):
            return web.json_response({"success": False, "error": "路径不存在或为空"})
            
        file_path = os.path.join(folder_path, "zml_model_key.json")
        
        if not os.path.exists(file_path):
            return web.json_response({"success": True, "presets": [], "message": "文件不存在"})
            
        with open(file_path, 'r', encoding='utf-8') as f:
            content = json.load(f)
            presets = content.get("presets", []) if isinstance(content, dict) else []
            
        return web.json_response({"success": True, "presets": presets})
        
    except Exception as e:
        print(f"[ZML] Load Config Error: {e}")
        return web.json_response({"success": False, "error": str(e)})

@server.PromptServer.instance.routes.post("/zml/llm/save_config")
async def save_llm_config(request):
    try:
        data = await request.json()
        folder_path = data.get("path", "")
        presets = data.get("presets", [])
        
        if not folder_path:
            return web.json_response({"success": False, "error": "路径为空"})
            
        if not os.path.exists(folder_path):
            try:
                os.makedirs(folder_path, exist_ok=True)
            except Exception as e:
                return web.json_response({"success": False, "error": f"无法创建目录: {str(e)}"})

        file_path = os.path.join(folder_path, "zml_model_key.json")
        
        save_data = {
            "version": 1,
            "presets": presets
        }
        
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(save_data, f, ensure_ascii=False, indent=4)
            
        return web.json_response({"success": True})
        
    except Exception as e:
        print(f"[ZML] Save Config Error: {e}")
        return web.json_response({"success": False, "error": str(e)})


# 注册节点
NODE_CLASS_MAPPINGS = {
    "ZML_LLM_ModelLoader": ZML_LLM_ModelLoader,      # V1 基础版
    "ZML_LLM_ModelLoaderV2": ZML_LLM_ModelLoaderV2,  # V2 高级版
    "ZML_LLM_SystemPrompt": ZML_LLM_SystemPrompt,
    "ZML_LLM_Parameters": ZML_LLM_Parameters,
    "ZML_LLM_JsonSchema": ZML_LLM_JsonSchema,
    "ZML_LLM_Chat": ZML_LLM_Chat,
    "ZML_JsonExtractor": ZML_JsonExtractor,
    "ZML_LLM_ThoughtFilter": ZML_LLM_ThoughtFilter
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_LLM_ModelLoader": "ZML_LLM 模型加载器",   
    "ZML_LLM_ModelLoaderV2": "ZML_LLM 模型加载器V2", 
    "ZML_LLM_SystemPrompt": "ZML_LLM 系统提示词",
    "ZML_LLM_Parameters": "ZML_LLM 参数设置",
    "ZML_LLM_JsonSchema": "ZML_LLM JSON结构定义",
    "ZML_LLM_Chat": "ZML_LLM 对话主程序",
    "ZML_JsonExtractor": "ZML_LLM JSON提取器",
    "ZML_LLM_ThoughtFilter": "ZML_LLM 过滤思考"
}