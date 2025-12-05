import json
import requests
import re
import server

# ==========================================
# 节点 1: 模型加载器
# ==========================================
class ZML_LLM_ModelLoader:
    def __init__(self): pass
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "api_url": ("STRING", {"default": "", "multiline": False, "tooltip": "LLM API 的基础地址 (Base URL)，例如 https://api.openai.com/v1"}),
                "api_key": ("STRING", {"default": "", "multiline": False, "tooltip": "API 授权密钥 (sk-...)"}),
                "model_id": ("STRING", {"default": "", "multiline": False, "tooltip": "模型名称 ID，例如 gpt-4o, deepseek-chat"}),
            }
        }
    RETURN_TYPES = ("LLM_MODEL_CONFIG",)
    RETURN_NAMES = ("模型配置",)
    FUNCTION = "load_model"
    CATEGORY = "image/ZML_图像/LLM"
    def load_model(self, api_url, api_key, model_id):
        return ({"api_url": api_url, "api_key": api_key, "model_id": model_id},)

# ==========================================
# 节点 2: 系统提示词
# ==========================================
class ZML_LLM_SystemPrompt:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "system_prompt": ("STRING", {
                    "default": "你是一个猫娘。", 
                    "multiline": True,
                    "tooltip": "设定 AI 的角色、性格、行为准则和背景故事 (System Prompt)"
                }),
            }
        }
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("系统提示词",)
    FUNCTION = "get_prompt"
    CATEGORY = "image/ZML_图像/LLM"
    def get_prompt(self, system_prompt):
        return (system_prompt,)

# ==========================================
# 节点 3: 参数设置 (全中文 + Tooltip)
# ==========================================
class ZML_LLM_Parameters:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "温度": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 2.0, "step": 0.01, "tooltip": "Temperature: 控制随机性。值越高越有创造力/发散，值越低越严谨/保守。"}),
                "最大Token数": ("INT", {"default": 2048, "min": 128, "max": 32768, "step": 1, "tooltip": "Max Tokens: 限制 AI 单次回复生成的最大长度。"}),
                "核采样": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01, "tooltip": "Top P: 另一种控制随机性的参数。建议保持 1.0 或与温度只调节其中一个。"}),
                "频率惩罚": ("FLOAT", {"default": 0.0, "min": -2.0, "max": 2.0, "step": 0.01, "tooltip": "Frequency Penalty: 正值会减少模型逐字重复同样内容的倾向。"}),
                "存在惩罚": ("FLOAT", {"default": 0.0, "min": -2.0, "max": 2.0, "step": 0.01, "tooltip": "Presence Penalty: 正值会鼓励模型谈论新的话题。"}),
            }
        }
    RETURN_TYPES = ("LLM_PARAMS",)
    RETURN_NAMES = ("参数包",)
    FUNCTION = "get_params"
    CATEGORY = "image/ZML_图像/LLM"
    def get_params(self, 温度, 最大Token数, 核采样, 频率惩罚, 存在惩罚):
        return ({
            "temperature": 温度, "max_tokens": 最大Token数, "top_p": 核采样,
            "frequency_penalty": 频率惩罚, "presence_penalty": 存在惩罚
        },)

# ==========================================
# 节点 4: JSON 结构定义
# ==========================================
class ZML_LLM_JsonSchema:
    @classmethod
    def INPUT_TYPES(cls):
        # 更新为用户要求的默认结构 (转换为 Schema 格式)
        default_schema = """{
	"回复内容": "在此输入",
	"情绪": "在此输入"
}"""
        return {
            "required": {
                "schema_string": ("STRING", {
                    "default": default_schema, 
                    "multiline": True,
                    "tooltip": "在此定义 JSON Schema。AI 将严格（或尽可能）按照此结构输出 JSON 数据。"
                }),
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
# 节点 5: LLM 对话执行
# ==========================================
class ZML_LLM_Chat:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "user_input": ("STRING", {
                    "multiline": True, "default": "", 
                    "tooltip": "用户的提问内容，或者上一环的 Prompt。"
                }),
                "model_config": ("LLM_MODEL_CONFIG", {"tooltip": "连接【模型加载器】节点。"}),
                "system_prompt": ("STRING", {"tooltip": "连接【系统提示词】节点，或直接输入字符串。"}), 
                "params": ("LLM_PARAMS", {"tooltip": "连接【参数设置】节点。"}),
                "json_strategy": (["DeepSeek/通用模式 (json_object)", "OpenAI严格模式 (json_schema)", "仅提示词 (不强求)"], {
                    "default": "DeepSeek/通用模式 (json_object)",
                    "tooltip": "选择结构化输出的策略。\nDeepSeek/通用: 适用于大多数模型，通过提示词+json_object实现。\nOpenAI严格: 仅 GPT-4o 等支持，通过 response_format 强制约束。"
                }),
            },
            "optional": {
                "json_schema": ("JSON_SCHEMA", {"tooltip": "可选：连接【JSON结构定义】节点。如果不连接，则进行普通文本对话。"}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff, "tooltip": "随机种子。固定种子有助于在相同参数下复现结果。"}), 
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("回复内容",)
    FUNCTION = "chat_completions"
    CATEGORY = "image/ZML_图像/LLM"

    def chat_completions(self, user_input, model_config, system_prompt, params, json_strategy, seed=0, json_schema=None):
        api_url = model_config.get("api_url", "").rstrip('/')
        api_key = model_config.get("api_key", "")
        model_id = model_config.get("model_id", "")

        if "generate" not in api_url and "chat/completions" not in api_url:
             api_url = f"{api_url}/v1/chat/completions"

        headers = { "Content-Type": "application/json", "Authorization": f"Bearer {api_key}" }

        final_system_prompt = system_prompt
        response_format_payload = None

        if json_schema is not None:
            if "error" in json_schema:
                return (f"配置错误: JSON Schema 格式不正确。",)
            
            schema_str = json.dumps(json_schema, ensure_ascii=False, indent=2)

            if json_strategy == "DeepSeek/通用模式 (json_object)":
                response_format_payload = { "type": "json_object" }
                final_system_prompt += f"\n\n【输出格式要求】\n请严格按照以下 JSON 格式输出，不要包含 Markdown 标记或额外文字：\n{schema_str}"

            elif json_strategy == "OpenAI严格模式 (json_schema)":
                response_format_payload = {
                    "type": "json_schema",
                    "json_schema": {
                        "name": "structured_output",
                        "strict": True,
                        "schema": json_schema
                    }
                }
            
            else:
                response_format_payload = None
                final_system_prompt += f"\n\n请输出以下 JSON 格式：\n{schema_str}"

        messages = [
            {"role": "system", "content": final_system_prompt},
            {"role": "user", "content": user_input}
        ]

        payload = {
            "model": model_id,
            "messages": messages,
            "stream": False,
            **params
        }
        
        if seed > 0: payload["seed"] = seed
        if response_format_payload: payload["response_format"] = response_format_payload

        try:
            response = requests.post(api_url, json=payload, headers=headers, timeout=120)
            
            if response.status_code != 200:
                err_text = response.text
                if "unavailable" in err_text or "not supported" in err_text:
                    return (f"API 错误 ({response.status_code}): 模型不支持当前的 JSON 策略。\nDeepSeek 请务必选择 'DeepSeek/通用模式'。\n\n原始错误: {err_text}",)
                return (f"API 错误 ({response.status_code}): {err_text}",)
            
            result = response.json()
            try:
                content = result["choices"][0]["message"]["content"]
                return (content,)
            except (KeyError, IndexError):
                return (json.dumps(result, indent=2, ensure_ascii=False),)

        except Exception as e:
            return (f"请求发生异常: {str(e)}",)

# ==========================================
# 节点 6: JSON 提取器
# ==========================================
class ZML_JsonExtractor:
    """
    从 LLM 输出的 JSON 字符串中提取指定 Key 的值。
    支持最多输出 7 个值。
    更新：针对数组类型，会自动将内部元素用换行符拼接。
    """
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "json_string": ("STRING", {"forceInput": True, "multiline": True, "default": "", "tooltip": "连接 LLM 输出的 JSON 文本字符串。"}),
                "keys": ("STRING", {"default": "回复内容, 情绪", "multiline": False, "placeholder": "key1, key2, key3...", "tooltip": "输入要提取的 Key (键名)，用英文逗号分隔。顺序对应下方的输出接口。"}),
            },
            "optional": {
                "default_value": ("STRING", {"default": "", "placeholder": "默认值", "tooltip": "当 JSON 解析失败或找不到对应 Key 时，输出此默认值，防止报错。"}),
            }
        }

    # 定义 7 个输出口
    RETURN_TYPES = ("STRING", "STRING", "STRING", "STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("值1 (Key1)", "值2 (Key2)", "值3 (Key3)", "值4 (Key4)", "值5 (Key5)", "值6 (Key6)", "值7 (Key7)")
    FUNCTION = "extract_json"
    CATEGORY = "image/ZML_图像/LLM"

    def extract_json(self, json_string, keys, default_value=""):
        clean_json = json_string.strip()
        # 清洗 markdown
        match = re.search(r"```(?:json)?\s*(.*?)\s*```", clean_json, re.DOTALL | re.IGNORECASE)
        if match:
            clean_json = match.group(1)
        
        try:
            data = json.loads(clean_json)
        except json.JSONDecodeError:
            print(f"[ZML JsonExtractor] JSON 解析失败，源文本: {clean_json[:100]}...")
            # 返回 7 个默认值
            return tuple([default_value] * 7)

        key_list = [k.strip() for k in keys.replace("，", ",").split(",") if k.strip()]

        results = []
        # 遍历 7 个输出槽位
        for i in range(7):
            if i < len(key_list):
                key = key_list[i]
                val = data.get(key, default_value)
                
                if isinstance(val, list):
                    # 如果是数组，处理内部的每一个元素
                    formatted_items = []
                    for item in val:
                        if isinstance(item, str):
                            formatted_items.append(item)
                        else:
                            # 如果数组里包含的是对象或数字，转为字符串形式
                            formatted_items.append(json.dumps(item, ensure_ascii=False))
                    # 用回车符拼接
                    val = "\n".join(formatted_items)
                
                elif not isinstance(val, str):
                    # 如果不是数组，也不是字符串（比如单个字典或数字），转 JSON 字符串
                    val = json.dumps(val, ensure_ascii=False)

                results.append(val)
            else:
                results.append(default_value)

        return tuple(results)

# 注册节点
NODE_CLASS_MAPPINGS = {
    "ZML_LLM_ModelLoader": ZML_LLM_ModelLoader,
    "ZML_LLM_SystemPrompt": ZML_LLM_SystemPrompt,
    "ZML_LLM_Parameters": ZML_LLM_Parameters,
    "ZML_LLM_JsonSchema": ZML_LLM_JsonSchema,
    "ZML_LLM_Chat": ZML_LLM_Chat,
    "ZML_JsonExtractor": ZML_JsonExtractor
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_LLM_ModelLoader": "ZML_LLM 模型加载器",
    "ZML_LLM_SystemPrompt": "ZML_LLM 系统提示词",
    "ZML_LLM_Parameters": "ZML_LLM 参数设置",
    "ZML_LLM_JsonSchema": "ZML_LLM JSON结构定义",
    "ZML_LLM_Chat": "ZML_LLM 对话主程序",
    "ZML_JsonExtractor": "ZML_LLM JSON提取器"
}