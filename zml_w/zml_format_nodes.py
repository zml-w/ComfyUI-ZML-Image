# custom_nodes/zml_format_nodes.py

import re

# ============================== 文本转格式节点 ==============================
class ZML_TextFormatter:
    """ZML 文本转格式节点"""
    
    def __init__(self):
        self.help_text = "你好，欢迎使用ZML节点！\n此节点会将NAI的权重格式转化为SD的，还可以将中文逗号替换为英文逗号，或输入多个连续逗号时转换为单个英文逗号，比如输入‘{{{{{kind_smlie}}}}}，，，,,,，，’时，它会输出为‘(kind smile:1.611),’。好啦~祝你天天开心！"
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "文本": ("STRING", {
                    "multiline": True,
                    "default": "",
                    "placeholder": "输入要转换的文本"
                }),
                "花括号转权重": ([True, False], {"default": True}),
                "下划线转空格": ([True, False], {"default": True}),
                "格式化标点符号": ([True, False], {"default": True}),  # 新增选项
            }
        }
    
    CATEGORY = "image/ZML_图像"
    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("文本", "Help")
    FUNCTION = "format_text"
    
    def convert_braces(self, text):
        """将花括号{}转换为权重格式"""
        # 寻找所有花括号对（支持嵌套）
        matches = list(re.finditer(r'\{+[^{}]*?\}+', text))
        
        # 如果没有匹配项，直接返回原文本
        if not matches:
            return text
            
        # 从最内层开始处理（反向迭代）
        for match in reversed(matches):
            full_match = match.group(0)
            start_idx, end_idx = match.span()
            
            # 计算花括号层数（取左右括号的最小值）
            left_braces = 0
            right_braces = 0
            
            # 计算左侧连续花括号数量
            for char in full_match:
                if char == '{':
                    left_braces += 1
                else:
                    break
                    
            # 计算右侧连续花括号数量
            for char in reversed(full_match):
                if char == '}':
                    right_braces += 1
                else:
                    break
            
            # 取有效层数（左右括号的最小值）
            brace_level = min(left_braces, right_braces)
            
            # 提取实际内容（去除花括号）
            content = full_match[left_braces:-right_braces]
            
            # 计算权重值 (1.1的n次方)
            weight = round(1.1 ** brace_level, 3)
            
            # 构建替换文本
            replacement = f"({content}:{weight})"
            
            # 替换原文本中的匹配部分
            text = text[:start_idx] + replacement + text[end_idx:]
            
        return text
    
    def format_punctuation(self, text):
        """格式化标点符号：替换中文逗号为英文逗号，合并连续逗号"""
        # 将中文逗号替换为英文逗号
        text = text.replace('，', ',')
        
        # 合并连续的逗号（多个逗号变成一个逗号）
        text = re.sub(r',+', ',', text)
        
        return text
    
    def format_text(self, 文本, 花括号转权重, 下划线转空格, 格式化标点符号):
        """处理文本转换"""
        # 始终返回帮助文本
        help_output = self.help_text
        
        # 如果启用花括号转换
        if 花括号转权重:
            文本 = self.convert_braces(文本)
        
        # 如果启用下划线转换
        if 下划线转空格:
            文本 = 文本.replace('_', ' ')
        
        # 如果启用格式化标点符号
        if 格式化标点符号:
            文本 = self.format_punctuation(文本)
        
        return (文本, help_output)

# ============================== 筛选文本节点 ==============================
class ZML_TextFilter:
    """ZML 筛选文本节点"""
    
    def __init__(self):
        self.help_text = "你好，欢迎使用ZML节点~\n此节点会筛选掉你不想要的一些tag，比如你可以将R18的tag输入到下面的文本框里，它会从上方文本框里删掉下方文本框里的tag，比如上方输入的为‘1girl,solo,nsfw,’下方文本框输入的为‘nsfw,’，那输出的文本就是‘1girl,solo’了！\n好啦~祝你生活愉快，天天开心~"
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "文本": ("STRING", {
                    "multiline": True,
                    "default": "",
                    "placeholder": "输入要过滤的文本"
                }),
                "过滤标签": ("STRING", {
                    "multiline": True,
                    "default": "",
                    "placeholder": "输入要过滤的标签（用英文逗号分隔）"
                }),
            }
        }
    
    CATEGORY = "image/ZML_图像"
    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("文本", "Help")
    FUNCTION = "filter_text"
    
    def filter_text(self, 文本, 过滤标签):
        """过滤掉指定的标签"""
        # 始终返回帮助文本
        help_output = self.help_text
        
        # 如果输入文本为空，则返回空字符串
        if not 文本.strip():
            return ("", help_output)
        
        # 将过滤标签字符串按逗号分割，并去除每个标签两边的空格
        filter_list = [tag.strip() for tag in 过滤标签.split(',') if tag.strip()]
        
        # 将输入文本按逗号分割（支持中英文逗号）
        tags = []
        for part in re.split(r'[,，]', 文本):
            tag = part.strip()
            if tag:  # 跳过空标签
                tags.append(tag)
        
        # 过滤掉在filter_list中的标签（注意：大小写敏感）
        filtered_tags = [tag for tag in tags if tag not in filter_list]
        
        # 重新组合成字符串
        result = ', '.join(filtered_tags)
        
        return (result, help_output)

# ============================== 节点注册 ==============================
NODE_CLASS_MAPPINGS = {
    "ZML_TextFormatter": ZML_TextFormatter,
    "ZML_TextFilter": ZML_TextFilter,  # 新增节点
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_TextFormatter": "ZML_文本转格式",
    "ZML_TextFilter": "ZML_筛选文本",  # 新增节点显示名称
}