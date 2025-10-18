# custom_nodes/ComfyUI-ZML-Image/zml_w/zml_prompt_nodes.py

import server
from aiohttp import web
import yaml
import os

# 定义提示词文件的路径
PROMPT_FILE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web", "Prompt word", "zh_CN.yaml")

# API 路由：获取提示词数据
@server.PromptServer.instance.routes.get("/zml/get_prompts")
async def get_prompts_data(request):
    try:
        if not os.path.exists(PROMPT_FILE_PATH):
            return web.json_response({"error": "Prompt file not found"}, status=404)
        
        with open(PROMPT_FILE_PATH, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        return web.json_response(data)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

# 新增 API 路由：保存提示词数据
@server.PromptServer.instance.routes.post("/zml/save_prompts")
async def save_prompts_data(request):
    try:
        data = await request.json()
        with open(PROMPT_FILE_PATH, "w", encoding="utf-8") as f:
            yaml.dump(data, f, allow_unicode=True, sort_keys=False)
        return web.Response(status=200, text="Prompts saved successfully.")
    except Exception as e:
        return web.Response(status=500, text=f"Error saving prompts: {str(e)}")

# 新增 API 路由：搜索txt文件中的提示词
@server.PromptServer.instance.routes.post("/zml/search_txt_files")
async def search_txt_files(request):
    try:
        # 获取搜索查询参数
        data = await request.json()
        query = data.get("query", "").lower().strip()
        
        if not query:
            return web.json_response({"results": []})
        
        # 获取Prompt word文件夹路径
        prompt_word_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web", "Prompt word")
        
        if not os.path.exists(prompt_word_dir):
            return web.json_response({"results": []})
        
        results = []
        
        # 遍历文件夹中的所有txt文件
        for filename in os.listdir(prompt_word_dir):
            if filename.endswith(".txt"):
                file_path = os.path.join(prompt_word_dir, filename)
                try:
                    with open(file_path, "r", encoding="utf-8") as f:
                        # 逐行读取文件内容
                        for line_number, line in enumerate(f, 1):
                            line = line.strip()
                            if line:
                                # 检查行是否包含搜索关键词
                                if query in line.lower():
                                    results.append({
                                        "text": line,
                                        "file_name": filename,
                                        "line_number": line_number
                                    })
                except Exception as e:
                    # 如果读取文件出错，记录错误但继续处理其他文件
                    print(f"Error reading file {filename}: {str(e)}")
        
        # 限制返回结果数量，避免过多数据
        max_results = 100
        results = results[:max_results]
        
        return web.json_response({"results": results})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


class ZML_PromptUINode:
    """
    ZML 标签化提示词加载器节点。
    提供一个可视化界面来选择和组合提示词。
    """
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "positive_prompt": ("STRING", {"multiline": True, "default": ""}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("提示词",)
    FUNCTION = "get_prompt"
    CATEGORY = "image/ZML_图像/工具"
    
    def get_prompt(self, positive_prompt):
        return (positive_prompt,)

    def onResize(self, node):
        node.setSize([node.size[0], 100])

# 节点映射
NODE_CLASS_MAPPINGS = {
    "ZML_PromptUINode": ZML_PromptUINode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_PromptUINode": "ZML_标签化提示词加载器",
}