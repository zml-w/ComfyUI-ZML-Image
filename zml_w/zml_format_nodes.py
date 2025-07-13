import re
import os
import time
import random
import json
import math

# ============================== 全局格式化函数 ==============================
def format_punctuation_global(text):
    """
    全局的标点符号格式化函数（独立于类）
    1. 替换中文逗号为英文逗号
    2. 合并连续逗号
    3. 移除开头的无效逗号
    4. 处理连续BREAK
    5. 移除开头的BREAK
    6. 保护权重表达式中的逗号
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
    
    # 1. 将中文逗号替换为英文逗号
    text = text.replace('，', ',')
    
    # 2. 【顺序调整】先合并连续的逗号，以确保后续BREAK处理的准确性
    text = re.sub(r'[,，]+', ',', text)
    
    # 3. 【顺序调整】处理连续BREAK
    # 在逗号被合并后，此正则表达式现在可以正确处理 "BREAK,BREAK"
    text = re.sub(r'(\bBREAK\b\s*,\s*)+(\bBREAK\b)', r'\2', text, flags=re.IGNORECASE)
    
    # 4. 移除开头的BREAK（如 "BREAK, tag" -> "tag"）
    text = re.sub(r'^(\s*,\s*)*\bBREAK\b(\s*,\s*)*', '', text, count=1, flags=re.IGNORECASE)
    
    # 5. 移除开头的逗号（如果前面没有文本）
    text = re.sub(r'^,+', '', text)
    
    # 6. 恢复权重表达式
    for placeholder, expr in placeholders:
        text = text.replace(placeholder, expr)
    
    return text

# ============================== 文本转格式节点 ==============================
class ZML_TextFormatter:
    """ZML 文本转格式节点"""
    
    def __init__(self):
        # 初始化计数文件路径
        self.node_dir = os.path.dirname(os.path.abspath(__file__))

        # 将计数器文件路径移动到 "counter" 子文件夹
        self.counter_dir = os.path.join(self.node_dir, "counter")
        os.makedirs(self.counter_dir, exist_ok=True)
        self.counter_file = os.path.join(self.counter_dir, "转格式计数.txt")
        
        # 确保计数器文件存在
        self.ensure_counter_file()
        
        # 获取当前计数
        self.total_count = self.get_current_count()
        
        # 更新帮助文本
        self.help_text = f"你好，欢迎使用ZML节点~\n到目前为止，你通过此节点总共转换了{self.total_count}次格式！此节点会将NAI的权重格式转化为SD的，还可以将中文逗号替换为英文逗号，或输入多个连续逗号时转换为单个英文逗号，比如输入‘，，{{{{{{kind_smlie}}}}}}，，，,,,，，’时，它会输出为‘(kind smile:1.611),’，输入‘2::1gril::’输出‘(1gril:2)’，输入[[[1girl]]]输出’(1girl:0.729)‘，如果你不想要这种非常精确的转换，还可以选择‘保留一位小数’模式，那输出就是(1girl:0.7)了，多一个嵌套就多/少0.1的乘数。\n还支持格式化断开语法‘BREAK’，会自动合并多个连续的，或者开头的BREAK，比如‘BREAK,1girl，BREAK,BREAK,solo’输出为‘1girl,solo,’，和逗号的格式化一样的效果。\n好啦~祝你天天开心！"
    
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
            self.help_text = f"你好，欢迎使用ZML节点~\n到目前为止，你通过此节点总共转换了{self.total_count}次格式！此节点会将NAI的权重格式转化为SD的，还可以将中文逗号替换为英文逗号，或输入多个连续逗号时转换为单个英文逗号，比如输入‘，，{{{{{{kind_smlie}}}}}}，，，,,,，，’时，它会输出为‘(kind smile:1.611),’，输入‘2::1gril::’输出‘(1gril:2)’，输入[[[1girl]]]输出’(1girl:0.729)‘，如果你不想要这种非常精确的转换，还可以选择‘保留一位小数’模式，那输出就是(1girl:0.7)了，多一个嵌套就多/少0.1的乘数。\n还支持格式化断开语法‘BREAK’，会自动合并多个连续的，或者开头的BREAK，比如‘BREAK,1girl，BREAK,BREAK,solo’输出为‘1girl,solo,’，和逗号的格式化一样的效果。\n好啦~祝你天天开心！"
            
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
                "NAI转SD权重": (["禁用", "精确", "保留一位小数"], {"default": "精确"}),
                "下划线转空格": ([True, False], {"default": True}),
                "格式化标点符号": ([True, False], {"default": True}),
            }
        }
    
    CATEGORY = "image/ZML_图像"
    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("文本", "Help")
    FUNCTION = "format_text"
    
    def convert_braces(self, text, mode="精确"):
        """
        将花括号{}和方括号[]转换为权重格式
        {}表示增加权重，[]表示减少权重
        """
        # 首先处理双冒号格式
        text = self.convert_double_colon(text)
        
        # 同时匹配花括号{}和方括号[]
        matches = list(re.finditer(r'(\{+[^{}]*?\}+|\[+[^\[\]]*?\]+)', text))
        
        # 如果没有匹配项，直接返回原文本
        if not matches:
            return text
            
        # 从最内层开始处理（反向迭代）
        for match in reversed(matches):
            full_match = match.group(0)
            start_idx, end_idx = match.span()
            
            # 判断是花括号还是方括号
            is_brace = full_match.startswith('{')
            brace_char = '{' if is_brace else '['
            close_char = '}' if is_brace else ']'
            
            # 计算括号层数
            left_count = 0
            right_count = 0
            
            # 计算左侧连续括号数量
            for char in full_match:
                if char == brace_char:
                    left_count += 1
                else:
                    break
                    
            # 计算右侧连续括号数量
            for char in reversed(full_match):
                if char == close_char:
                    right_count += 1
                else:
                    break
            
            # 取有效层数（左右括号的最小值）
            brace_level = min(left_count, right_count)
            
            # 提取实际内容（去除括号）
            content = full_match[left_count:-right_count]
            
            # 根据模式计算权重值
            if mode == "精确":
                # 精确模式：指数计算
                base = 1.1 if is_brace else 0.9
                weight = round(base ** brace_level, 3)
            elif mode == "保留一位小数":
                # 保留一位小数模式：线性计算
                weight = 1 + (0.1 * brace_level) if is_brace else 1 - (0.1 * brace_level)
                weight = round(weight, 1)
            else:
                # 禁用模式：不处理
                continue
            
            # 构建替换文本
            replacement = f"({content}:{weight})" if mode != "禁用" else content
            
            # 替换原文本中的匹配部分
            text = text[:start_idx] + replacement + text[end_idx:]
            
        return text
    
    def convert_double_colon(self, text):
        """将双冒号格式::转换为权重格式"""
        # 匹配格式：数字::内容:: 
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
        """调用全局格式化函数"""
        return format_punctuation_global(text)
    
    def format_text(self, 文本, NAI转SD权重, 下划线转空格, 格式化标点符号):
        """处理文本转换"""
        # 无论是否有文本输入，都更新计数
        self.increment_counter()
        
        # 如果启用花括号/方括号转换
        if NAI转SD权重 != "禁用":
            文本 = self.convert_braces(文本, mode=NAI转SD权重)
        
        # 如果启用下划线转换
        if 下划线转空格:
            文本 = 文本.replace('_', ' ')
        
        # 如果启用格式化标点符号
        if 格式化标点符号:
            文本 = self.format_punctuation(文本)
        
        return (文本, self.help_text)

# ============================== 筛选提示词节点 ==============================
class ZML_TextFilter:
    """ZML 筛选提示词节点"""
    
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

# ============================== 删除文本节点 ==============================
class ZML_DeleteText:
    """ZML 删除文本节点"""
    
    def __init__(self):
        self.help_text = "你好，欢迎使用ZML节点~\n此节点会从第一个文本中删除第二个文本中指定的标签或子字符串。例如：第一个文本为'#1girl,2girls,solo,'，第二个文本为'2girls,#,1,o,'，输出结果为'girl,sl,'。删除后会自动清理多余的逗号。\n祝你使用愉快！"
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "文本": ("STRING", {
                    "multiline": True,
                    "default": "",
                    "placeholder": "输入原始文本"
                }),
                "删除标签或字符": ("STRING", { # Renamed input for clarity
                    "multiline": True,
                    "default": "",
                    "placeholder": "输入要删除的标签或子字符串（用英文逗号分隔）"
                }),
            }
        }
    
    CATEGORY = "image/ZML_图像"
    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("文本", "Help")
    FUNCTION = "delete_text"
    
    def delete_text(self, 文本, 删除标签或字符): # Simplified function signature
        """删除文本中的指定标签或子字符串"""
        # 如果输入文本为空，则返回空字符串
        if not 文本.strip():
            return ("", self.help_text)
        
        result = 文本
        
        delete_list = [item.strip() for item in 删除标签或字符.split(',') if item.strip()]
        
        for item_to_delete in delete_list:
            result = result.replace(item_to_delete, '')
        
        result = re.sub(r',+', ',', result) # Merge multiple commas
        result = re.sub(r'^,', '', result)  # Remove leading comma
        result = re.sub(r',$', '', result)  # Remove trailing comma
        
        result = result.replace(',,', ',') # This line is redundant if r',+' is used effectively but doesn't hurt.
        
        return (result, self.help_text)

# ============================== 文本行节点 (Final Multi-Node-Safe Version) ==============================
class ZML_TextLine:
    """ZML 文本行节点 (支持多节点独立计数)"""

    def __init__(self):
        self.help_text = "你好~欢迎使用ZML节点~索引模式是按照索引值加载文本行，随机模式就是随机文本行，顺序模式是一行流加载文本，每次运行都会递增一次行数，顺序模式的索引值是独立计算的，在重启comfyui是清零，当然你也可以修改‘ComfyUI-ZML-Image\zml_w\行计数.json’里的值来自由的决定计数，多个节点的索引是分开计算的，所以就算你使用一百个此节点同时运行，也不会出错。好啦~祝你天天开心~"
        self.node_dir = os.path.dirname(os.path.abspath(__file__))
        
        # 将计数器文件路径移动到 "counter" 子文件夹
        self.counter_dir = os.path.join(self.node_dir, "counter")
        os.makedirs(self.counter_dir, exist_ok=True)
        self.counter_file = os.path.join(self.counter_dir, "行计数.json")

        self.reset_counters_on_startup()

    def reset_counters_on_startup(self):
        """在ComfyUI启动时, 创建一个空的JSON计数器文件."""
        try:
            # Write an empty JSON object "{}", which clears all counters for all nodes
            with open(self.counter_file, "w", encoding="utf-8") as f:
                json.dump({}, f)
        except Exception as e:
            print(f"重置行计数JSON文件失败: {str(e)}")

    def get_all_counts(self):
        """读取整个JSON文件并返回所有节点的计数."""
        try:
            with open(self.counter_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            # If file doesn't exist or is empty/corrupt, return an empty dict
            return {}

    def get_sequential_count(self, node_id):
        """获取指定node_id的当前计数值."""
        all_counts = self.get_all_counts()
        # Return the count for the specific node_id, or 0 if it's not present
        return all_counts.get(node_id, 0)

    def increment_sequential_count(self, node_id):
        """为指定的node_id增加计数并保存回文件."""
        all_counts = self.get_all_counts()
        current_count = all_counts.get(node_id, 0)
        all_counts[node_id] = current_count + 1
        
        try:
            # Write the entire updated dictionary back to the JSON file
            with open(self.counter_file, "w", encoding="utf-8") as f:
                json.dump(all_counts, f, indent=4) # indent for readability
        except Exception as e:
            print(f"更新行计数JSON文件失败: {str(e)}")


    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "文本": ("STRING", {"multiline": True, "default": ""}),
                "模式": (["索引", "顺序", "随机"],),
                "索引": ("INT", {"default": 0, "min": 0, "step": 1}),
            },
            # Add hidden inputs to get the node's unique ID
            "hidden": {
                "prompt": "PROMPT",
                "unique_id": "UNIQUE_ID"
            },
        }

    CATEGORY = "image/ZML_图像"
    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("文本", "help")
    FUNCTION = "get_line"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")

    # Update function signature to accept the new hidden inputs
    def get_line(self, 文本, 模式, 索引, unique_id, prompt):
        lines = [line.strip() for line in 文本.splitlines() if line.strip()]

        if not lines:
            return ("", self.help_text)

        num_lines = len(lines)
        output_line = ""

        if 模式 == "索引":
            safe_index = 索引 % num_lines
            output_line = lines[safe_index]

        elif 模式 == "顺序":
            # Pass the node's unique_id to the counter functions
            current_count = self.get_sequential_count(unique_id)
            safe_index = current_count % num_lines
            output_line = lines[safe_index]
            self.increment_sequential_count(unique_id)

        elif 模式 == "随机":
            output_line = random.choice(lines)

        return (output_line, self.help_text)

# ============================== 随机权重文本行节点 ==============================
class ZML_RandomWeightedTextLine:
    """ZML 随机权重文本行节点"""
    
    def __init__(self):
        # 获取脚本所在的目录 (e.g., .../ComfyUI-ZML-Image/zml_w/)
        self.base_dir = os.path.dirname(os.path.abspath(__file__))
        # 【修正】直接在脚本所在目录中寻找 "txt" 文件夹
        self.txt_dir = os.path.join(self.base_dir, "txt")
        self.help_text = "你好~欢迎使用ZML节点~\n此节点会自动读取'zml_w/txt'文件夹下的txt文件。从下拉菜单中选择一个文件，节点将从中随机选取指定数量的行，并为每行赋予一个在你设定的最小值和最大值之间（包含边界）的随机权重。你还可以设置权重的的小数位数。如果每行都的结尾都带逗号，节点会自动删除来确保权重格式正确。节点自带1000画师的txt文件，你也可以自己加入其它的txt文件。\n祝你玩得开心！"

    @classmethod
    def INPUT_TYPES(cls):
        # 获取脚本所在的目录 (e.g., .../ComfyUI-ZML-Image/zml_w/)
        base_dir = os.path.dirname(os.path.abspath(__file__))
        # 【修正】直接在脚本所在目录中寻找 "txt" 文件夹
        txt_dir = os.path.join(base_dir, "txt")
        
        # 确保目录存在，避免启动时出错
        os.makedirs(txt_dir, exist_ok=True)
        
        try:
            # 获取所有以.txt结尾的文件
            files = [f for f in os.listdir(txt_dir) if f.endswith(".txt")]
        except Exception as e:
            # 保留必要的错误日志
            print(f"ZML_RandomWeightedTextLine [错误]: 扫描目录时出错 {txt_dir}: {e}")
            files = []
        
        # 如果没有文件，显示提示信息
        if not files:
            files = ["未找到txt文件"]

        return {
            "required": {
                "文件": (files, ),
                "小数位数": (["两位", "一位"], {"default": "两位"}),
                "随机个数": ("INT", {"default": 3, "min": 1, "step": 1}),
                "最小权重": ("FLOAT", {"default": 0.2, "min": 0.0, "max": 10.0, "step": 0.1}),
                "最大权重": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 10.0, "step": 0.1}),
            }
        }

    CATEGORY = "image/ZML_图像"
    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("文本", "help")
    FUNCTION = "generate_weighted_lines"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # 每次都重新执行以保证随机性
        return float("nan")

    def generate_weighted_lines(self, 文件, 小数位数, 随机个数, 最小权重, 最大权重):
        # 如果下拉列表是提示信息，则不执行
        if 文件 == "未找到txt文件":
            return ("下拉菜单中未选择有效文件，请检查 '.../zml_w/txt' 目录下是否有txt文件并重启ComfyUI。", self.help_text)

        # 构建所选文件的完整路径
        file_path = os.path.join(self.txt_dir, 文件)
        
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                # 1. 读取所有行
                # 2. 对每行：去除首尾空格 -> 去除行末的中英文逗号 -> 再次去除可能产生的空格
                # 3. 过滤掉处理后为空的行
                lines = [line.strip().rstrip(',，').strip() for line in f.readlines() if line.strip()]
        except FileNotFoundError:
            return (f"错误: 文件 '{文件}' 未在目录 '{self.txt_dir}' 中找到。", self.help_text)
        except Exception as e:
            return (f"错误: 读取文件 '{文件}' 时发生错误: {e}", self.help_text)

        # 如果文件为空或所有行都被过滤，则返回空
        if not lines:
            return ("", self.help_text)

        # 确保最小权重不大于最大权重
        min_w = min(最小权重, 最大权重)
        max_w = max(最小权重, 最大权重)

        # 确定实际要选择的行数（不能超过文件中的总有效行数）
        count = min(随机个数, len(lines))
        
        # 从有效行中随机选择不重复的行
        selected_lines = random.sample(lines, count)
        
        # 根据选项确定小数精度
        precision = 2 if 小数位数 == "两位" else 1

        # 为每一行生成带权重的格式
        weighted_lines = []
        for line in selected_lines:
            # 生成指定范围内的随机权重
            weight = round(random.uniform(min_w, max_w), precision)
            weighted_lines.append(f"({line}:{weight})")
            
        # 用逗号和空格连接所有处理过的行
        output_text = ", ".join(weighted_lines)

        return (output_text, self.help_text)

# ============================== 多文本输入节点（五个输入框）==============================
class ZML_MultiTextInput5:
    """ZML 多文本输入节点（五个输入框）"""
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "格式化标点符号": ([True, False], {"default": True}),
                "分隔符": ("STRING", {
                    "multiline": False,
                    "default": ",",
                    "placeholder": "输入分隔符"
                }),
            },
            "optional": {
                "文本1": ("STRING", {"multiline": True, "default": "", "placeholder": "输入文本1"}),
                "文本2": ("STRING", {"multiline": True, "default": "", "placeholder": "输入文本2"}),
                "文本3": ("STRING", {"multiline": True, "default": "", "placeholder": "输入文本3"}),
                "文本4": ("STRING", {"multiline": True, "default": "", "placeholder": "输入文本4"}),
                "文本5": ("STRING", {"multiline": True, "default": "", "placeholder": "输入文本5"}),
            }
        }
    
    CATEGORY = "image/ZML_图像"
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("文本",)
    FUNCTION = "combine_texts"
    
    def combine_texts(self, 格式化标点符号, 分隔符, 文本1=None, 文本2=None, 文本3=None, 文本4=None, 文本5=None):
        """组合多个文本并应用格式化"""
        # 安全地将所有文本放入列表，并将None转换为空字符串
        texts = [
            文本1 or "",
            文本2 or "",
            文本3 or "",
            文本4 or "",
            文本5 or ""
        ]
        
        # 过滤掉空文本，并去除首尾空格
        non_empty_texts = [text.strip() for text in texts if text.strip()]
        
        # 使用分隔符连接文本
        combined = 分隔符.join(non_empty_texts)
        
        # 应用标点符号格式化
        if 格式化标点符号:
            combined = format_punctuation_global(combined)
        
        return (combined,)

# ============================== 多文本输入节点（三个输入框）==============================
class ZML_MultiTextInput3:
    """ZML 多文本输入节点（三个输入框）"""
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "格式化标点符号": ([True, False], {"default": True}),
                "分隔符": ("STRING", {
                    "multiline": False,
                    "default": ",",
                    "placeholder": "输入分隔符"
                }),
            },
            "optional": {
                "文本1": ("STRING", {"multiline": True, "default": "", "placeholder": "输入文本1"}),
                "文本2": ("STRING", {"multiline": True, "default": "", "placeholder": "输入文本2"}),
                "文本3": ("STRING", {"multiline": True, "default": "", "placeholder": "输入文本3"}),
            }
        }
    
    CATEGORY = "image/ZML_图像"
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("文本",)
    FUNCTION = "combine_texts"
    
    def combine_texts(self, 格式化标点符号, 分隔符, 文本1=None, 文本2=None, 文本3=None):
        """组合多个文本并应用格式化"""
        # 安全地将所有文本放入列表，并将None转换为空字符串
        texts = [
            文本1 or "",
            文本2 or "",
            文本3 or ""
        ]
        
        # 过滤掉空文本，并去除首尾空格
        non_empty_texts = [text.strip() for text in texts if text.strip()]
        
        # 使用分隔符连接文本
        combined = 分隔符.join(non_empty_texts)
        
        # 应用标点符号格式化
        if 格式化标点符号:
            combined = format_punctuation_global(combined)
        
        return (combined,)

# ============================== 选择文本节点 (接口版) ==============================
class ZML_SelectText:
    """ZML 选择文本节点：通过外部接口输入文本，并在节点内选择合并。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # 节点内部的控件
                "分隔符": ("STRING", {"multiline": False, "default": ","}),
                "启用1": ("BOOLEAN", {"default": True, "label_on": "启用 1", "label_off": "禁用 1"}),
                "启用2": ("BOOLEAN", {"default": False, "label_on": "启用 2", "label_off": "禁用 2"}),
                "启用3": ("BOOLEAN", {"default": False, "label_on": "启用 3", "label_off": "禁用 3"}),
                "启用4": ("BOOLEAN", {"default": False, "label_on": "启用 4", "label_off": "禁用 4"}),
                "启用5": ("BOOLEAN", {"default": False, "label_on": "启用 5", "label_off": "禁用 5"}),
            },
            "optional": {
                # 外部文本输入接口
                "文本1": ("STRING", {"forceInput": True}),
                "文本2": ("STRING", {"forceInput": True}),
                "文本3": ("STRING", {"forceInput": True}),
                "文本4": ("STRING", {"forceInput": True}),
                "文本5": ("STRING", {"forceInput": True}),
            }
        }

    CATEGORY = "image/ZML_图像"
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("文本",)
    FUNCTION = "select_and_combine"

    def select_and_combine(self, 分隔符, 启用1, 启用2, 启用3, 启用4, 启用5, 文本1=None, 文本2=None, 文本3=None, 文本4=None, 文本5=None):
        """根据启用状态组合来自接口的文本"""
        # 将启用状态和对应的文本配对。如果接口未连接，其值为None，我们将其视为空字符串。
        inputs = [
            (启用1, 文本1 or ""),
            (启用2, 文本2 or ""),
            (启用3, 文本3 or ""),
            (启用4, 文本4 or ""),
            (启用5, 文本5 or ""),
        ]

        # 过滤出已启用且内容非空的文本
        enabled_texts = [text.strip() for is_enabled, text in inputs if is_enabled and text.strip()]

        # 使用分隔符连接文本
        combined = 分隔符.join(enabled_texts)

        return (combined,)

# ============================== 选择文本V2节点 (内部输入版) ==============================
class ZML_SelectTextV2:
    """ZML 选择文本V2节点：在节点内部输入文本并选择合并。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # 节点内部的控件
                "文本1": ("STRING", {"multiline": True, "default": ""}),
                "文本2": ("STRING", {"multiline": True, "default": ""}),
                "文本3": ("STRING", {"multiline": True, "default": ""}),
                "文本4": ("STRING", {"multiline": True, "default": ""}),
                "文本5": ("STRING", {"multiline": True, "default": ""}),
                "分隔符": ("STRING", {"multiline": False, "default": ","}),
                "启用1": ("BOOLEAN", {"default": True, "label_on": "启用 1", "label_off": "禁用 1"}),
                "启用2": ("BOOLEAN", {"default": False, "label_on": "启用 2", "label_off": "禁用 2"}),
                "启用3": ("BOOLEAN", {"default": False, "label_on": "启用 3", "label_off": "禁用 3"}),
                "启用4": ("BOOLEAN", {"default": False, "label_on": "启用 4", "label_off": "禁用 4"}),
                "启用5": ("BOOLEAN", {"default": False, "label_on": "启用 5", "label_off": "禁用 5"}),
            }
        }

    CATEGORY = "image/ZML_图像"
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("文本",)
    FUNCTION = "select_and_combine_v2"

    def select_and_combine_v2(self, 文本1, 文本2, 文本3, 文本4, 文本5, 分隔符, 启用1, 启用2, 启用3, 启用4, 启用5):
        """根据启用状态组合来自节点内部的文本"""
        # 将启用状态和对应的文本配对
        inputs = [
            (启用1, 文本1),
            (启用2, 文本2),
            (启用3, 文本3),
            (启用4, 文本4),
            (启用5, 文本5),
        ]

        # 过滤出已启用且内容非空的文本
        enabled_texts = [text.strip() for is_enabled, text in inputs if is_enabled and text.strip()]

        # 使用分隔符连接文本
        combined = 分隔符.join(enabled_texts)

        return (combined,)


# ============================== 节点注册 ==============================
NODE_CLASS_MAPPINGS = {
    "ZML_TextFormatter": ZML_TextFormatter,
    "ZML_TextFilter": ZML_TextFilter,
    "ZML_DeleteText": ZML_DeleteText,
    "ZML_TextLine": ZML_TextLine,
    "ZML_RandomWeightedTextLine": ZML_RandomWeightedTextLine, # 更新后的节点
    "ZML_MultiTextInput5": ZML_MultiTextInput5,
    "ZML_MultiTextInput3": ZML_MultiTextInput3,
    "ZML_SelectText": ZML_SelectText,
    "ZML_SelectTextV2": ZML_SelectTextV2,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_TextFormatter": "ZML_文本转格式",
    "ZML_TextFilter": "ZML_筛选提示词",
    "ZML_DeleteText": "ZML_删除文本",
    "ZML_TextLine": "ZML_文本行",
    "ZML_RandomWeightedTextLine": "ZML_随机权重文本行", # 节点显示名称
    "ZML_MultiTextInput5": "ZML_多文本输入_五",
    "ZML_MultiTextInput3": "ZML_多文本输入_三",
    "ZML_SelectText": "ZML_选择文本",
    "ZML_SelectTextV2": "ZML_选择文本V2",
}
