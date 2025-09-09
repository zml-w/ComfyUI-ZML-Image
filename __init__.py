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

# ================= 聊天 API 代理 (带详细日志) =================
@PromptServer.instance.routes.post("/zml/chat")
async def chat_handler(request):
    #print("[ZML Chat] 收到聊天请求...")
    try:
        data = await request.json()
        api_key = data.get("apiKey")
        api_url = data.get("apiUrl", "https://generativelanguage.googleapis.com")
        model_id = data.get("modelId", "gemini-2.0-flash")
        messages = data.get("messages", [])
        temperature = data.get("temperature", 0.7)
        system_prompt = data.get("systemPrompt", "")

        if not api_key:
            print("[ZML Chat] 错误: API Key 为空。")
            return web.Response(status=400, text="API Key不能为空")
        if not messages:
            print("[ZML Chat] 错误: 消息内容为空。")
            return web.Response(status=400, text="消息内容不能为空")

        full_api_url = f"{api_url}/v1beta/models/{model_id}:generateContent?key={api_key}"
        #print(f"[ZML Chat] 准备向谷歌API发送请求: {api_url}/v1beta/models/{model_id}")
        
        payload = {
            "contents": messages,
            "generationConfig": { "temperature": temperature }
        }
        
        if system_prompt and system_prompt.strip():
            payload["system_instruction"] = { "parts": [{"text": system_prompt}] }
            #print("[ZML Chat] 请求中包含系统提示词。")

        # 如果您想临时禁用代理，可以将其设置为 None，例如: proxy_url = None
        proxy_url = "http://127.0.0.1:7890" 

        async with ClientSession() as session:
            async with session.post(full_api_url, json=payload, headers={"Content-Type": "application/json"}, proxy=proxy_url) as resp:
                response_text = await resp.text()
                #print(f"[ZML Chat] 收到谷歌API响应, 状态码: {resp.status}")
                
                if resp.status == 200:
                    try:
                        response_json = json.loads(response_text)
                        if "candidates" in response_json and response_json["candidates"]:
                            reply_text = response_json["candidates"][0]["content"]["parts"][0]["text"]
                            #print("[ZML Chat] 成功解析回复, 准备返回给前端。")
                            return web.json_response({"reply": reply_text})
                        else:
                            error_info = response_json.get("promptFeedback", {}).get("blockReason", "Unknown reason")
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