# ComfyUI-ZML-Image/__init__.py

import os
import sys
import importlib.util
import json
from server import PromptServer
from aiohttp import web, ClientSession

# 获取插件的根目录
plugin_root = os.path.dirname(os.path.abspath(__file__))
# 定义节点代码所在的目录
nodes_dir = os.path.join(plugin_root, "zml_w")
# 定义JS文件所在的Web目录
WEB_DIRECTORY = "zml_w/web"

# --------------------------------------------------------------------
# 1. API 端点注册
# --------------------------------------------------------------------
PRESET_FILE_PATH = os.path.join(nodes_dir, "txt", "Preset text", "Preset text.txt")

@PromptServer.instance.routes.post("/zml/add_preset")
async def add_preset_handler(request):
    try:
        data = await request.json()
        name = data.get("name")
        value = data.get("value")
        separator = data.get("separator", "#-#")

        if not name or not value:
            return web.Response(status=400, text="名称和内容不能为空")

        os.makedirs(os.path.dirname(PRESET_FILE_PATH), exist_ok=True)
        
        file_empty = os.path.getsize(PRESET_FILE_PATH) == 0 if os.path.exists(PRESET_FILE_PATH) else True
        
        with open(PRESET_FILE_PATH, "a", encoding="utf-8") as f:
            if not file_empty:
                f.write("\n")
            f.write(f"{name}{separator}{value}")

        return web.Response(status=200, text="预设已成功添加")
    except Exception as e:
        print(f"ZML Add Preset Error: {e}")
        return web.Response(status=500, text=f"服务器错误: {e}")

# ================= 聊天 API 代理 (DeepSeek API) =================
@PromptServer.instance.routes.post("/zml/chat")
async def chat_handler(request):
    try:
        data = await request.json()
        api_key = data.get("apiKey")
        api_url = data.get("apiUrl", "https://api.deepseek.com")
        model_id = data.get("modelId", "deepseek-chat")
        messages = data.get("messages", [])
        temperature = data.get("temperature", 0.7)
        system_prompt = data.get("systemPrompt", "")

        if not api_key:
            print("[ZML Chat] 错误: API Key 为空。")
            return web.Response(status=400, text="API Key不能为空")
        if not messages:
            print("[ZML Chat] 错误: 消息内容为空。")
            return web.Response(status=400, text="消息内容不能为空")

        # DeepSeek API 端点
        full_api_url = f"{api_url}/chat/completions"
        
        # 转换消息格式从 Gemini 格式到 OpenAI/DeepSeek 格式
        # Gemini: {role: "user"/"model", parts: [{text: "..."}]}
        # DeepSeek: {role: "user"/"assistant", content: "..."}
        converted_messages = []
        for msg in messages:
            role = msg.get("role", "")
            parts = msg.get("parts", [])
            text = parts[0].get("text", "") if parts else ""
            
            # 转换角色名称
            if role == "model":
                role = "assistant"
            
            converted_messages.append({
                "role": role,
                "content": text
            })
        
        # 如果有系统提示词，添加到消息列表开头
        if system_prompt and system_prompt.strip():
            converted_messages.insert(0, {
                "role": "system",
                "content": system_prompt
            })
        
        payload = {
            "model": model_id,
            "messages": converted_messages,
            "temperature": temperature,
            "stream": False
        }

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}"
        }

        async with ClientSession() as session:
            async with session.post(full_api_url, json=payload, headers=headers) as resp:
                response_text = await resp.text()
                
                if resp.status == 200:
                    try:
                        response_json = json.loads(response_text)
                        # DeepSeek 响应格式: choices[0].message.content
                        if "choices" in response_json and response_json["choices"]:
                            reply_text = response_json["choices"][0]["message"]["content"]
                            return web.json_response({"reply": reply_text})
                        else:
                            error_info = response_json.get("error", {}).get("message", "Unknown error")
                            print(f"[ZML Chat] API返回内容无效, 原因: {error_info}")
                            return web.Response(status=500, text=f"API返回内容无效: {error_info}")
                    except Exception as parse_e:
                        print(f"[ZML Chat] 解析JSON响应失败: {parse_e}")
                        print(f"[ZML Chat] 原始响应内容: {response_text}")
                        return web.Response(status=500, text=f"解析JSON响应失败: {response_text}")
                else:
                    print(f"❌ [ZML Chat] 请求外部API失败! 详细错误: {response_text}")
                    return web.Response(status=resp.status, text=f"请求外部API失败: {response_text}")

    except Exception as e:
        import traceback
        print(f"❌ [ZML Chat] 处理器发生严重错误: {e}")
        traceback.print_exc()
        return web.Response(status=500, text=f"服务器内部错误: {e}")


# --------------------------------------------------------------------
# 2. 动态加载所有节点
# --------------------------------------------------------------------
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

for filename in os.listdir(nodes_dir):
    if filename.endswith(".py"):
        module_name = filename[:-3]
        if module_name == "__init__":
            continue
        module_path = os.path.join(nodes_dir, filename)
        try:
            spec = importlib.util.spec_from_file_location(f"zml_w.{module_name}", module_path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            if hasattr(module, "NODE_CLASS_MAPPINGS"):
                NODE_CLASS_MAPPINGS.update(module.NODE_CLASS_MAPPINGS)
            if hasattr(module, "NODE_DISPLAY_NAME_MAPPINGS"):
                NODE_DISPLAY_NAME_MAPPINGS.update(module.NODE_DISPLAY_NAME_MAPPINGS)
        except Exception as e:
            print(f"❌ [ZML-Image] Failed to load nodes from {filename}: {e}")

#打印节点总数
print(f"\n{'='*50}\n 💡 [ComfyUI-ZML-Image] 注册节点总数为: {len(NODE_CLASS_MAPPINGS)}！ \n{'='*50}\n")

# --------------------------------------------------------------------
# 3. 导出给 ComfyUI
# --------------------------------------------------------------------
__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS']