# custom_nodes/zml_format_nodes.py

import re
import os
import time

# ============================== 文本转格式节点 ==============================
class ZML_TextFormatter:
    """ZML 文本转格式节点"""
    
    def __init__(self):
        # 初始化计数文件路径
        self.node_dir = os.path.dirname(os.path.abspath(__file__))
        self.counter_file = os.path.join(self.node_dir, "转格式计数.txt")
        
        # 确保计数器文件存在
        self.ensure_counter_file()
        
        # 获取当前计数
        self.total_count = self.get_current_count()
        
        # 更新帮助文本
        self.help_text = f"你好，欢迎使用ZML节点！\n到目前为止，你通过此节点总共转换了{self.total_count}次格式！此节点会将NAI的权重格式转化为SD的，还可以将中文逗号替换为英文逗号，或输入多个连续逗号时转换为单个英文逗号，比如输入‘，，{{{{{{kind_smlie}}}}}}，，，,,,，，’时，它会输出为‘(kind smile:1.611),’，输入‘2::1gril::’输出‘(1gril:2)’\n好啦~祝你天天开心！"
    
    def ensure_counter_file(self):
        """确保计数文件存在"""
        try:
            if not os.path.exists(self.counter_file):
                with open(self.counter_file, "w", encoding="utf-8") as f:
                    f.write("0")
        except Exception as e:
            print(f"创建计数文件失败: {str(e)}")
    
    def get_current_count(self):
        """获取当前计数"""
        try:
            if os.path.exists(self.counter_file):
                with open(self.counter_file, "r", encoding="utf-8") as f:
                    count = f.read().strip()
                    return int(count) if count.isdigit() else 0
            return 0
        except Exception:
            return 0
    
    def increment_counter(self):
        """增加计数器并更新帮助文本"""
        try:
            # 增加计数
            self.total_count += 1
            
            # 更新计数文件
            with open(self.counter_file, "w", encoding="utf-8") as f:
                f.write(str(self.total_count))
            
            # 更新帮助文本
            self.help_text = f"你好，欢迎使用ZML节点！\n到目前为止，你通过此节点总共转换了{self.total_count}次格式！此节点会将NAI的权重格式转化为SD的，还可以将中文逗号替换为英文逗号，或输入多个连续逗号时转换为单个英文逗号，比如输入‘，，{{{{{{kind_smlie}}}}}}，，，,,,，，’时，它会输出为‘(kind smile:1.611),’，输入‘2::1gril::’输出‘(1gril:2)’\n好啦~祝你天天开心！"
            
            return self.total_count
        except Exception as e:
            print(f"更新计数器失败: {str(e)}")
            return self.total_count
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "文本": ("STRING", {
                    "multiline": True,
                    "default": "",
                    "placeholder": "输入要转换的文本"
                }),
                "NAI转SD权重": ([True, False], {"default": True}),  # 重命名
                "下划线转空格": ([True, False], {"default": True}),
                "格式化标点符号": ([True, False], {"default": True}),
            }
        }
    
    CATEGORY = "image/ZML_图像"
    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("文本", "Help")
    FUNCTION = "format_text"
    
    def convert_braces(self, text):
        """将花括号{}和双冒号格式::转换为权重格式"""
        # 首先处理双冒号格式（如"2::tag::"）
        text = self.convert_double_colon(text)
        
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
    
    def convert_double_colon(self, text):
        """将双冒号格式::转换为权重格式"""
        # 匹配格式：数字::内容:: 
        # 示例：2::1gril:: → (1gril:2)
        #       1.2::solo:: → (solo:1.2)
        pattern = r'(\d+(?:\.\d+)?)::(.*?)::'
        
        # 查找所有匹配项
        matches = list(re.finditer(pattern, text))
        
        # 如果没有匹配项，直接返回原文本
        if not matches:
            return text
        
        # 从后往前处理（避免替换后位置变化）
        for match in reversed(matches):
            full_match = match.group(0)
            weight_value = match.group(1)
            content = match.group(2)
            
            # 构建权重表达式
            replacement = f"({content}:{weight_value})"
            
            # 替换文本
            start, end = match.span()
            text = text[:start] + replacement + text[end:]
        
        return text
    
    def format_punctuation(self, text):
        """
        格式化标点符号：
        1. 替换中文逗号为英文逗号
        2. 处理带空格的连续逗号
        3. 移除开头的无效逗号
        4. 保护权重表达式中的逗号
        """
        # 存储权重表达式占位符
        placeholders = []
        count = 0
        
        # 保护权重表达式（圆括号内的内容）
        def replace_fn(match):
            nonlocal count
            placeholder = f"__WEIGHT_EXPR_{count}__"
            placeholders.append((placeholder, match.group(0)))
            count += 1
            return placeholder
        
        # 临时替换权重表达式
        text = re.sub(r'\([^)]*\)', replace_fn, text)
        
        # 将中文逗号替换为英文逗号
        text = text.replace('，', ',')
        
        # 处理带空格的连续逗号：合并连续的逗号（包括空格）
        text = re.sub(r'[\s,]+', ',', text)
        
        # 移除开头的逗号（如果前面没有文本）
        text = re.sub(r'^,+,?', '', text)
        
        # 移除多余的连续逗号（保留一个）
        text = re.sub(r',{2,}', ',', text)
        
        # 恢复权重表达式
        for placeholder, expr in placeholders:
            text = text.replace(placeholder, expr)
        
        return text
    
    def format_text(self, 文本, NAI转SD权重, 下划线转空格, 格式化标点符号):  # 参数名更新
        """处理文本转换"""
        # 无论是否有文本输入，都更新计数
        self.increment_counter()
        
        # 如果启用花括号转换
        if NAI转SD权重:
            文本 = self.convert_braces(文本)
        
        # 如果启用下划线转换
        if 下划线转空格:
            文本 = 文本.replace('_', ' ')
        
        # 如果启用格式化标点符号
        if 格式化标点符号:
            文本 = self.format_punctuation(文本)
        
        return (文本, self.help_text)

# ============================== 筛选文本节点 ==============================
class ZML_TextFilter:
    """ZML 筛选文本节点"""
    
    def __init__(self):
        self.help_text = "你好，欢迎使用ZML节点~\n此节点会筛选掉你不想要的一些tag，你可以将R18的tag输入到下面的文本框里，它会从上方文本框里删掉下方文本框里的tag，比如上方输入的为‘1girl,solo,nsfw,’下方文本框输入的为‘nsfw,’，那输出的文本就是‘1girl,solo’了！被过滤掉的文本也可以在'*过滤*'接口处输出，如果你不需要输出被过滤的tag的话，不连线也能正常运行。\n好啦~祝你生活愉快，天天开心~"
    
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
    RETURN_TYPES = ("STRING", "STRING", "STRING")
    RETURN_NAMES = ("文本", "Help", "*过滤*")
    FUNCTION = "filter_text"
    
    def filter_text(self, 文本, 过滤标签):
        """过滤掉指定的标签"""
        # 如果输入文本为空，则返回空字符串
        if not 文本.strip():
            return ("", self.help_text, "")
        
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
        
        # 找出被过滤掉的标签
        removed_tags = [tag for tag in tags if tag in filter_list]
        
        # 重新组合成字符串
        result = ', '.join(filtered_tags)
        removed_result = ', '.join(removed_tags)
        
        return (result, self.help_text, removed_result)

# ============================== 节点注册 ==============================
NODE_CLASS_MAPPINGS = {
    "ZML_TextFormatter": ZML_TextFormatter,
    "ZML_TextFilter": ZML_TextFilter,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_TextFormatter": "ZML_文本转格式",
    "ZML_TextFilter": "ZML_筛选文本",
}
