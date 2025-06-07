# custom_nodes/__init__.py

from . import zml_image_nodes
from . import zml_text_nodes

NODE_CLASS_MAPPINGS = {**zml_image_nodes.NODE_CLASS_MAPPINGS, **zml_text_nodes.NODE_CLASS_MAPPINGS}
NODE_DISPLAY_NAME_MAPPINGS = {**zml_image_nodes.NODE_DISPLAY_NAME_MAPPINGS, **zml_text_nodes.NODE_DISPLAY_NAME_MAPPINGS}

