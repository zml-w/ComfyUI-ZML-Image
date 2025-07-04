# custom_nodes/ComfyUI-ZML-Image/__init__.py

import sys
import os

# 核心步骤1：将插件根目录添加到系统路径，确保导入能成功
plugin_root = os.path.dirname(os.path.abspath(__file__))
if plugin_root not in sys.path:
    sys.path.insert(0, plugin_root)

# 核心步骤2：直接导入所有节点模块
from zml_w import zml_image_nodes
from zml_w import zml_text_nodes
from zml_w import zml_format_nodes
from zml_w import zml_review_nodes
from zml_w import zml_resolution_nodes # <--- 新增的导入

# 核心步骤3：直接合并所有节点的映射字典
NODE_CLASS_MAPPINGS = {
    **zml_image_nodes.NODE_CLASS_MAPPINGS,
    **zml_text_nodes.NODE_CLASS_MAPPINGS,
    **zml_format_nodes.NODE_CLASS_MAPPINGS,
    **zml_review_nodes.NODE_CLASS_MAPPINGS,
    **zml_resolution_nodes.NODE_CLASS_MAPPINGS, # <--- 新增的映射
}

NODE_DISPLAY_NAME_MAPPINGS = {
    **zml_image_nodes.NODE_DISPLAY_NAME_MAPPINGS,
    **zml_text_nodes.NODE_DISPLAY_NAME_MAPPINGS,
    **zml_format_nodes.NODE_DISPLAY_NAME_MAPPINGS,
    **zml_review_nodes.NODE_DISPLAY_NAME_MAPPINGS,
    **zml_resolution_nodes.NODE_DISPLAY_NAME_MAPPINGS, # <--- 新增的映射
}

# 核心步骤4：导出主映射，供ComfyUI使用
__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS']
