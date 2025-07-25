# custom_nodes/ComfyUI-ZML-Image/__init__.py

import sys
import os
import server
from aiohttp import web

# 核心步骤1：将插件根目录添加到系统路径
plugin_root = os.path.dirname(os.path.abspath(__file__))
if plugin_root not in sys.path:
    sys.path.insert(0, plugin_root)

# 定义预设文件的全局路径，方便API路由使用
PRESET_FILE_PATH = os.path.join(plugin_root, "zml_w", "txt", "Preset text", "Preset text.txt")

@server.PromptServer.instance.routes.post("/zml/add_preset")
async def add_preset_handler(request):
    try:
        data = await request.json()
        name = data.get("name")
        value = data.get("value")
        separator = data.get("separator", "#-#") # 从前端获取分隔符, 默认为 #-#

        if not name or not value:
            return web.Response(status=400, text="名称和内容不能为空")

        # 确保目录存在
        os.makedirs(os.path.dirname(PRESET_FILE_PATH), exist_ok=True)
        
        # 以追加模式写入文件
        with open(PRESET_FILE_PATH, "a", encoding="utf-8") as f:
            # 如果文件非空，先写入一个换行符
            if os.path.getsize(PRESET_FILE_PATH) > 0:
                f.write("\n")
            f.write(f"{name}{separator}{value}")

        return web.Response(status=200, text="预设已成功添加")
    except Exception as e:
        print(f"ZML Add Preset Error: {e}")
        return web.Response(status=500, text=f"服务器错误: {e}")

# 核心步骤2：直接导入所有节点模块
from zml_w import zml_image_nodes
from zml_w import zml_text_nodes
from zml_w import zml_format_nodes
from zml_w import zml_review_nodes
from zml_w import zml_resolution_nodes
from zml_w import zml_lora_nodes  # <--- 添加这一行, 导入新的Lora节点

# 核心步骤3：直接合并所有节点的映射字典
NODE_CLASS_MAPPINGS = {
    **zml_image_nodes.NODE_CLASS_MAPPINGS,
    **zml_text_nodes.NODE_CLASS_MAPPINGS,
    **zml_format_nodes.NODE_CLASS_MAPPINGS,
    **zml_review_nodes.NODE_CLASS_MAPPINGS,
    **zml_resolution_nodes.NODE_CLASS_MAPPINGS,
    **zml_lora_nodes.NODE_CLASS_MAPPINGS,  # <--- 添加这一行
}

NODE_DISPLAY_NAME_MAPPINGS = {
    **zml_image_nodes.NODE_DISPLAY_NAME_MAPPINGS,
    **zml_text_nodes.NODE_DISPLAY_NAME_MAPPINGS,
    **zml_format_nodes.NODE_DISPLAY_NAME_MAPPINGS,
    **zml_review_nodes.NODE_DISPLAY_NAME_MAPPINGS,
    **zml_resolution_nodes.NODE_DISPLAY_NAME_MAPPINGS,
    **zml_lora_nodes.NODE_DISPLAY_NAME_MAPPINGS, # <--- 添加这一行
}

WEB_DIRECTORY = "zml_w"

# 核心步骤4：导出主映射，供ComfyUI使用
__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS']
