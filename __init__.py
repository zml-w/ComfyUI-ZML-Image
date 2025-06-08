# custom_nodes/__init__.py

from .zml_w import zml_image_nodes
from .zml_w import zml_text_nodes
from .zml_w import zml_format_nodes  # 导入新的节点文件

# 合并所有节点的映射
NODE_CLASS_MAPPINGS = {
    **zml_image_nodes.NODE_CLASS_MAPPINGS,
    **zml_text_nodes.NODE_CLASS_MAPPINGS,
    **zml_format_nodes.NODE_CLASS_MAPPINGS  # 添加新节点的类映射
}

NODE_DISPLAY_NAME_MAPPINGS = {
    **zml_image_nodes.NODE_DISPLAY_NAME_MAPPINGS,
    **zml_text_nodes.NODE_DISPLAY_NAME_MAPPINGS,
    **zml_format_nodes.NODE_DISPLAY_NAME_MAPPINGS  # 添加新节点的显示名称映射
}