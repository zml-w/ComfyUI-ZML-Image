# ComfyUI-ZML-Image/__init__.py

import os
import sys
import importlib.util
from server import PromptServer
from aiohttp import web

# 获取插件的根目录
plugin_root = os.path.dirname(os.path.abspath(__file__))
# 定义节点代码所在的目录
nodes_dir = os.path.join(plugin_root, "zml_w")
# 定义JS文件所在的Web目录
WEB_DIRECTORY = "./js" # 相对于 zml_w/web 的路径

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
        
        # 检查文件是否为空，以决定是否添加换行符
        file_empty = os.path.getsize(PRESET_FILE_PATH) == 0 if os.path.exists(PRESET_FILE_PATH) else True
        
        with open(PRESET_FILE_PATH, "a", encoding="utf-8") as f:
            if not file_empty:
                f.write("\n")
            f.write(f"{name}{separator}{value}")

        return web.Response(status=200, text="预设已成功添加")
    except Exception as e:
        print(f"ZML Add Preset Error: {e}")
        return web.Response(status=500, text=f"服务器错误: {e}")

# --------------------------------------------------------------------
# 2. 动态加载所有节点
# --------------------------------------------------------------------
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

# 遍历 zml_w 目录下的所有 .py 文件
for filename in os.listdir(nodes_dir):
    if filename.endswith(".py"):
        module_name = filename[:-3]
        if module_name == "__init__":
            continue
            
        # 构造模块的完整路径
        module_path = os.path.join(nodes_dir, filename)
        
        try:
            # 动态导入模块
            spec = importlib.util.spec_from_file_location(f"zml_w.{module_name}", module_path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            
            # 检查并合并 MAPPINGS
            if hasattr(module, "NODE_CLASS_MAPPINGS"):
                NODE_CLASS_MAPPINGS.update(module.NODE_CLASS_MAPPINGS)
            if hasattr(module, "NODE_DISPLAY_NAME_MAPPINGS"):
                NODE_DISPLAY_NAME_MAPPINGS.update(module.NODE_DISPLAY_NAME_MAPPINGS)
                
            # print(f"✅ [ZML-Image] Loaded nodes from: {filename}") # 打印导入的py文件

        except Exception as e:
            print(f"❌ [ZML-Image] Failed to load nodes from {filename}: {e}")

WEB_DIRECTORY = "zml_w/web"


# --------------------------------------------------------------------
# 3. 导出给 ComfyUI
# --------------------------------------------------------------------
__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']
