import re
import os
import time
import random
import json
import math
import server
from aiohttp import web 

# 获取当前文件所在目录
NODE_DIR = os.path.dirname(os.path.abspath(__file__))
# 定义预设文本的目录和文件
PRESET_TEXT_DIR = os.path.join(NODE_DIR, "txt", "Preset text")
PRESET_TEXT_FILE = os.path.join(PRESET_TEXT_DIR, "text_v3.json")

# 确保预设文本目录存在
os.makedirs(PRESET_TEXT_DIR, exist_ok=True)

# Helper function to read preset text file
def _read_presets():
    if os.path.exists(PRESET_TEXT_FILE):
        try:
            with open(PRESET_TEXT_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return data.get("presets", [])
        except (json.JSONDecodeError, FileNotFoundError):
            # If file is empty or corrupted, return empty list
            return []
    return []

# Helper function to write preset text file
def _write_presets(presets):
    # Ensure the directory exists before writing
    os.makedirs(PRESET_TEXT_DIR, exist_ok=True)
    with open(PRESET_TEXT_FILE, 'w', encoding='utf-8') as f:
        json.dump({"presets": presets}, f, indent=4, ensure_ascii=False)

@server.PromptServer.instance.routes.post("/zml_select_text_v3/presets")
async def zml_select_text_v3_presets(request):
    """API endpoint to handle preset text operations for SelectTextV3 node."""
    input_data = await request.json()
    action = input_data.get("action")
    
    response_data = {"success": False, "message": "Unknown action"}

    presets = _read_presets()

    if action == "get_all":
        response_data = {"success": True, "presets": presets}
    elif action == "add":
        item_type = input_data.get("type") # 'text' or 'folder'
        name = input_data.get("name")
        parent_id = input_data.get("parent_id")
        
        if not name or not item_type:
            response_data = {"success": False, "message": "Missing name or type for add operation."}
        else:
            # Generate a unique ID
            new_id = f"{item_type}_{int(time.time())}_{random.randint(0, 9999)}"
            
            # Check for duplicate name within the same parent_id (case-insensitive)
            if any(p['name'].lower() == name.lower() and p.get('parent_id') == parent_id for p in presets):
                response_data = {"success": False, "message": f"A {item_type} with name '{name}' already exists in this location."}
            else:
                new_item = {
                    "id": new_id,
                    "type": item_type,
                    "name": name,
                    "parent_id": parent_id
                }
                if item_type == "text":
                    new_item["content"] = input_data.get("content", "")
                elif item_type == "folder":
                    new_item["is_collapsed"] = False # Default for new folders
                
                presets.append(new_item)
                _write_presets(presets)
                response_data = {"success": True, "message": f"{item_type.capitalize()} added successfully.", "id": new_id}
    elif action == "update":
        item_id = input_data.get("id")
        new_name = input_data.get("new_name")
        new_content = input_data.get("new_content")
        new_parent_id = input_data.get("new_parent_id") # For moving items
        
        found_item = None
        for p in presets:
            if p["id"] == item_id:
                found_item = p
                break
        
        if found_item:
            # Check for duplicate name if name is changed and new name already exists (case-insensitive)
            if new_name and new_name.lower() != found_item['name'].lower():
                if any(p['name'].lower() == new_name.lower() and p['id'] != item_id and p.get('parent_id') == found_item.get('parent_id') for p in presets):
                    response_data = {"success": False, "message": f"A {found_item['type']} with new name '{new_name}' already exists in this location."}
                    return web.json_response(response_data)
            
            if new_name is not None:
                found_item["name"] = new_name
            if found_item["type"] == "text" and new_content is not None:
                found_item["content"] = new_content
            # Always update parent_id regardless of its value (including None for root directory)
            found_item["parent_id"] = new_parent_id
            
            _write_presets(presets)
            response_data = {"success": True, "message": f"{found_item['type'].capitalize()} updated successfully."}
        else:
            response_data = {"success": False, "message": f"Item with ID '{item_id}' not found."}
    elif action == "delete":
        item_id_to_delete = input_data.get("id")
        
        if item_id_to_delete:
            item_to_delete = next((p for p in presets if p["id"] == item_id_to_delete), None)
            
            if item_to_delete:
                # If it's a folder, check for children
                if item_to_delete["type"] == "folder":
                    if any(p.get("parent_id") == item_id_to_delete for p in presets):
                        response_data = {"success": False, "message": "Cannot delete folder: it contains items."}
                        return web.json_response(response_data)
                
                presets = [p for p in presets if p["id"] != item_id_to_delete]
                _write_presets(presets)
                response_data = {"success": True, "message": f"{item_to_delete['type'].capitalize()} deleted successfully."}
            else:
                response_data = {"success": False, "message": f"Item with ID '{item_id_to_delete}' not found."}
        else:
            response_data = {"success": False, "message": "Missing ID for delete operation."}
    elif action == "reorder":
        # This action is for reordering items within the same parent or at the top level
        # The frontend will send the full, reordered list of presets
        updated_presets_list = input_data.get("presets")
        if updated_presets_list is not None and isinstance(updated_presets_list, list):
            # Basic validation: ensure all original IDs are present
            original_ids = {p['id'] for p in presets}
            updated_ids = {p['id'] for p in updated_presets_list}
            
            if original_ids == updated_ids:
                _write_presets(updated_presets_list)
                response_data = {"success": True, "message": "Presets reordered successfully."}
            else:
                response_data = {"success": False, "message": "Reorder failed: Mismatch in preset IDs."}
        else:
            response_data = {"success": False, "message": "Missing or invalid 'presets' list for reorder operation."}
    
    return web.json_response(response_data)


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
    
    # 临时替换权重表达式，匹配任何字符包括换行符 (改进的正则表达式，避免嵌套处理问题)
    text = re.sub(r'\((?:(?!\().)*?\)', replace_fn, text) 

    # 1. 将中文逗号替换为英文逗号
    text = text.replace('，', ',')
    
    # 2. 【顺序调整】先合并连续的逗号，以确保后续BREAK处理的准确性
    # 匹配一个或多个逗号或中文逗号，替换成单个英文逗号
    text = re.sub(r'[,，]+', ',', text)
    
    # 3. 【顺序调整】处理连续BREAK
    # 在逗号被合并后，此正则表达式现在可以正确处理 "BREAK,BREAK"
    # \s* 允许匹配换行符
    text = re.sub(r'(\bBREAK\b\s*,\s*)+(\bBREAK\b)', r'\2', text, flags=re.IGNORECASE)
    
    # 4. 移除开头的BREAK（如 "BREAK, tag" -> "tag"）
    # \s* 允许匹配换行符
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
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "文本": ("STRING", {
                    "multiline": True,
                    "default": "",
                    "placeholder": "输入要转换的文本"
                }),
                "权重转换": (["禁用", "NAI转SD（精确）", "NAI转SD（一位小数）", "清空权重"], {"default": "NAI转SD（精确）"}),
                "文本格式化": (["禁用", "下划线转空格", "空格转下划线", "空格隔离标签", "逗号追加换行", "清空换行", "括号转义"], {"default": "下划线转空格"}),
                "格式化标点符号": ("BOOLEAN", {"default": True, "label_on": "启用", "label_off": "禁用"}),
                "合并相同提示词": ("BOOLEAN", {"default": False, "label_on": "启用", "label_off": "禁用"}),
                "合并白名单": ("STRING", {"default": " BREAK ", "multiline": False, "placeholder": "不合并的提示词，逗号分隔", "tooltip": "这里的提示词不会被合并，请使用逗号分隔"}),
            }
        }
    
    CATEGORY = "image/ZML_图像/文本"
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("文本",)
    FUNCTION = "format_text"
    
    def clear_weights(self, text):
        """移除所有权重语法，只保留标签文本"""
        # 移除SD权重格式 (content:weight)
        # (?:(?!\().)*? 匹配任何字符，非贪婪，直到但不包括下一个开括号或闭括号
        text = re.sub(r'\(\s*((?:(?!\(|\)).)*?)\s*:\s*[\d\.]+\s*\)', r'\1', text)
        # 移除自定义权重格式 weight::content::
        text = re.sub(r'\d+(?:\.\d+)?::(.*?)::', r'\1', text)
        
        # 【修正】迭代移除所有包围性质的括号 (), {}, []
        # 只要还能找到最内层的括号，就继续循环剥离
        # 改进正则表达式，避免匹配到新行
        # 使用非贪婪匹配 .*?，并确保括号内的匹配不跨越其他括号
        while re.search(r'\{(?:(?!\{|\}).)*?\}|\[(?:(?!\[|\]).)*?\]|\((?:(?!\(|\)).)*?\)', text):
             # 移除一层 {}
             text = re.sub(r'\{(?:(?!\{|\}).)*?\}', lambda m: m.group(0)[1:-1], text)
             # 移除一层 []
             text = re.sub(r'\[(?:(?!\[|\]).)*?\]', lambda m: m.group(0)[1:-1], text)
             # 新增：移除一层 ()
             text = re.sub(r'\((?:(?!\(|\)).)*?\)', lambda m: m.group(0)[1:-1], text)
             
        return text

    def convert_braces(self, text, mode="精确"):
        """
        将花括号{}和方括号[]转换为权重格式
        {}表示增加权重，[]表示减少权重
        """
        # 首先处理双冒号格式
        text = self.convert_double_colon(text)
        
        # 同时匹配花括号{}和方括号[]
        # 修改正则表达式以避免匹配嵌套括号内部内容，并允许内容包含换行
        matches = list(re.finditer(r'(\{+[^{}]*?\}+|\[+[^\[\]]*?\]+)', text))
        
        # 如果没有匹配项，直接返回原文本
        if not matches:
            return text
            
        # 从最内层开始处理（反向迭代）
        # 注意：此处假设没有嵌套的括号类型混用，例如 { [tag] }
        # 如果有，需要更复杂的解析逻辑
        for match in reversed(matches):
            full_match = match.group(0)
            start_idx, end_idx = match.span()
            
            # 判断是花括号还是方括号
            is_brace = full_match.startswith('{')
            brace_char = '{' if is_brace else '['
            close_char = '}' if is_brace else ']'
            
            # 计算括号层数
            # 这里的层数计算是基于连续的开头和结尾字符，而不是真正的嵌套深度
            left_count = 0
            for char in full_match:
                if char == brace_char:
                    left_count += 1
                else:
                    break
                    
            right_count = 0
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
        # (.*?) 匹配内容，包括换行
        pattern = r'(\d+(?:\.\d+)?)::(.*?)::'
        
        # 查找所有匹配项
        matches = list(re.finditer(pattern, text, re.DOTALL)) # 使用re.DOTALL让.匹配换行
        
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
        
    def extract_base_tag(self, tag):
        """提取标签的基础部分，保留权重信息"""
        # 处理带权重的标签，如(1girl:1.2)
        weight_match = re.match(r'\(([^:]+):([\d.]+)\)', tag)
        if weight_match:
            base_tag = weight_match.group(1).strip()
            weight = weight_match.group(2)
            return base_tag, f"({base_tag}:{weight})"
        return tag.strip(), tag.strip()
        
    def merge_duplicate_prompts(self, text, 合并白名单=None):
        """合并文本中的重复提示词，默认使用第一个出现的提示词的权重。
        支持跨多行去重：保留首次出现的提示词（及其权重），后续行中的相同提示词会被移除，同时尽量保留原有的行结构。
        白名单中的提示词不参与合并，会按原样保留重复。"""
        if not text.strip():
            return text
        
        # 解析白名单（支持逗号/中文逗号/空白分隔），统一用基础标签比较
        whitelist_set = set()
        if 合并白名单:
            for w in [p.strip() for p in re.split(r"[\s,，、；;]+", 合并白名单) if p.strip()]:
                base_w, _ = self.extract_base_tag(w)
                whitelist_set.add(base_w)
        
        # 按行处理文本
        lines = text.splitlines()
        result_lines = []
        
        # 全局已见标签：在整个文本范围内保留首次出现的标签
        global_seen = {}
        
        for line in lines:
            if not line.strip():
                result_lines.append(line)
                continue
            
            # 检查原始行是否以逗号结尾（忽略行尾空白）
            original_line_ends_with_comma = line.rstrip().endswith(',')
            
            # 分割标签
            tags = [tag.strip() for tag in line.split(',') if tag.strip()]
            
            # 行内已见集合，用于避免单行内重复
            line_seen = set()
            kept_tags = []
            for tag in tags:
                base_tag, processed_tag = self.extract_base_tag(tag)
                
                # 白名单：不参与合并、保留原样
                if base_tag in whitelist_set:
                    kept_tags.append(tag.strip())
                    continue
                
                # 如果在全局已见中，跳过（跨行去重）
                if base_tag in global_seen:
                    continue
                
                # 行内去重
                if base_tag in line_seen:
                    continue
                
                # 记录首个出现的标签（保留其权重表达）
                line_seen.add(base_tag)
                global_seen[base_tag] = processed_tag
                kept_tags.append(processed_tag)
            
            # 重新组合该行（不自动在逗号后添加空格）
            result_line = ','.join(kept_tags)
            
            # 若原始行以逗号结尾，且该行仍有内容，则保留逗号
            if original_line_ends_with_comma and result_line:
                result_line += ','
                
            result_lines.append(result_line)
        
        # 重新组合所有行
        result_text = '\n'.join(result_lines)
        
        return result_text
    
    def format_text(self, 文本, 权重转换, 文本格式化, 格式化标点符号, 合并相同提示词, 合并白名单):
        """处理文本转换"""
        
        # 1. 处理权重转换
        if 权重转换 == "NAI转SD（精确）":
            文本 = self.convert_braces(文本, mode="精确") # convert_braces会先调用convert_double_colon
        elif 权重转换 == "NAI转SD（一位小数）":
            文本 = self.convert_braces(文本, mode="保留一位小数")
        elif 权重转换 == "清空权重":
            文本 = self.clear_weights(文本)
        # 如果为 "禁用", 则不执行任何操作
        
        # 2. 处理文本格式化
        if 文本格式化 == "下划线转空格":
            文本 = 文本.replace('_', ' ')
        elif 文本格式化 == "空格转下划线":
            # 确保只替换实际空格，不影响其他空白符
            文本 = 文本.replace(' ', '_')
        elif 文本格式化 == "空格隔离标签":
            # 替换逗号和其后的任意空白（包括换行）为 ", "
            # 注意：此操作会删除逗号后的换行符，这是此模式的预期行为
            文本 = re.sub(r',\s*', ', ', 文本).strip()
        elif 文本格式化 == "逗号追加换行":
            # 在每个逗号后面添加换行符
            文本 = re.sub(r',\s*', ',\n', 文本).strip()
        elif 文本格式化 == "清空换行":
            # 将所有换行符替换为空格
            文本 = 文本.replace('\n', ' ').replace('\r', ' ').strip()
        elif 文本格式化 == "括号转义":
            # 括号转义功能：为非权重、非最外层的括号添加转义符
            # 先找出所有需要保留的括号（权重表达式和最外层括号）
            # 然后对剩余的括号进行转义
            def escape_brackets(text):
                # 匹配权重表达式 (content:weight)
                weight_pattern = r'\(([^:]+):([\d.]+)\)'
                # 匹配最外层括号（假设没有嵌套）
                outer_bracket_pattern = r'^\([^()]*\)$'
                
                # 保存所有匹配到的权重表达式位置
                weight_matches = list(re.finditer(weight_pattern, text))
                
                # 创建一个标记数组，标记哪些位置需要保留（不转义）
                preserve_positions = set()
                
                # 标记权重表达式中的括号
                for match in weight_matches:
                    start, end = match.span()
                    for i in range(start, end):
                        preserve_positions.add(i)
                
                # 检查整个文本是否被括号包裹且不是权重表达式
                if re.match(outer_bracket_pattern, text) and not re.match(weight_pattern, text):
                    # 标记最外层括号位置
                    preserve_positions.add(0)  # 开括号
                    preserve_positions.add(len(text) - 1)  # 闭括号
                
                # 逐字符处理并转义未标记的括号
                result = []
                for i, char in enumerate(text):
                    if (char == '(' or char == ')') and i not in preserve_positions:
                        result.append('\\' + char)
                    else:
                        result.append(char)
                
                return ''.join(result)
            
            # 对文本进行括号转义处理
            文本 = escape_brackets(文本)
        # 如果为 "禁用", 则不执行任何操作

        # 3. 处理合并相同提示词
        if 合并相同提示词:
            文本 = self.merge_duplicate_prompts(文本, 合并白名单)

        # 4. 处理标点符号格式化
        if 格式化标点符号:
            文本 = self.format_punctuation(文本)
        
        return (文本,)

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
    
    CATEGORY = "image/ZML_图像/文本"
    RETURN_TYPES = ("STRING", "STRING", "STRING")
    RETURN_NAMES = ("文本", "Help", "*过滤*")
    FUNCTION = "filter_text"
    
    def filter_text(self, 文本, 过滤标签):
        """过滤掉指定的标签，按行保留结构"""
        if not 文本.strip():
            return ("", self.help_text, "")
        
        filter_list = [tag.strip() for tag in 过滤标签.split(',') if tag.strip()]
        
        # 按行处理输入文本
        input_lines = 文本.splitlines()
        
        processed_lines = []
        removed_lines = []

        for line in input_lines:
            # 检查原始行是否以逗号结尾（忽略行尾空白）
            original_line_ends_with_comma = line.rstrip().endswith(',')
            
            # 对于每一行，进行标签分割和过滤
            original_tags_on_line = [tag.strip() for tag in re.split(r'[,，]+', line) if tag.strip()]
            
            filtered_tags_on_line = [tag for tag in original_tags_on_line if tag not in filter_list]
            removed_tags_on_line = [tag for tag in original_tags_on_line if tag in filter_list]
            
            # 重新组合行
            processed_line_content = ','.join(filtered_tags_on_line)
            removed_line_content = ','.join(removed_tags_on_line)
            
            # 应用全局标点格式化
            processed_line_content = format_punctuation_global(processed_line_content)
            removed_line_content = format_punctuation_global(removed_line_content)

            # 在格式化之后，如果原始行以逗号结尾，则添加逗号
            if original_line_ends_with_comma:
                processed_line_content += ','
            if original_line_ends_with_comma:
                removed_line_content += ','
            
            processed_lines.append(processed_line_content)
            removed_lines.append(removed_line_content)
        
        # 使用原始换行符重新组合所有行
        result = '\n'.join(processed_lines)
        removed_result = '\n'.join(removed_lines)

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
    
    CATEGORY = "image/ZML_图像/文本"
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

# ============================== 文本行节点==============================
class ZML_TextLine:
    """ZML 文本行节点 (支持从文本框或文件读取)"""

    def __init__(self):
        self.help_text = "你好~欢迎使用ZML节点~本节点现在支持两种输入方式：文件或文本框。\n1. **文件模式**: 从下拉菜单中选择一个 'zml_w/txt' 文件夹下的txt文件。节点会忽略文本框内容，从所选文件中读取文本行。\n2. **文本框模式**: 将下拉菜单设置为'禁用'，然后可以直接在下方的文本框中输入内容。\n\n节点支持三种加载模式：\n- **索引**: 按照指定的'索引'值加载对应行。\n- **顺序**: 每次运行时按顺序加载下一行，不同节点的计数独立，重启后清零。\n- **随机**: 每次运行都随机选择一行。\n\n好啦~祝你天天开心~"
        self.node_dir = os.path.dirname(os.path.abspath(__file__))
        
        # 定义txt文件目录和计数器文件目录
        self.txt_dir = os.path.join(self.node_dir, "txt")
        self.counter_dir = os.path.join(self.node_dir, "counter")
        os.makedirs(self.txt_dir, exist_ok=True)
        os.makedirs(self.counter_dir, exist_ok=True)
        self.counter_file = os.path.join(self.counter_dir, "行计数.json")

        self.reset_counters_on_startup()

    def reset_counters_on_startup(self):
        """在ComfyUI启动时, 创建一个空的JSON计数器文件。"""
        try:
            with open(self.counter_file, "w", encoding="utf-8") as f:
                json.dump({}, f)
        except Exception as e:
            print(f"重置行计数JSON文件失败: {str(e)}")

    def get_all_counts(self):
        """读取整个JSON文件并返回所有节点的计数。"""
        try:
            with open(self.counter_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    def get_sequential_count(self, node_id):
        """获取指定node_id的当前计数值。"""
        all_counts = self.get_all_counts()
        return all_counts.get(node_id, 0)

    def increment_sequential_count(self, node_id):
        """为指定的node_id增加计数并保存回文件。"""
        all_counts = self.get_all_counts()
        current_count = all_counts.get(node_id, 0)
        all_counts[node_id] = current_count + 1
        
        try:
            with open(self.counter_file, "w", encoding="utf-8") as f:
                json.dump(all_counts, f, indent=4)
        except Exception as e:
            print(f"更新行计数JSON文件失败: {str(e)}")


    @classmethod
    def INPUT_TYPES(cls):
        # 扫描 'zml_w/txt' 目录下的txt文件
        base_dir = os.path.dirname(os.path.abspath(__file__))
        txt_dir = os.path.join(base_dir, "txt")
        os.makedirs(txt_dir, exist_ok=True)
        
        try:
            # 排除 Preset text 目录，或者只列出顶级txt文件
            files = [f for f in os.listdir(txt_dir) if f.startswith('Preset text') == False and f.endswith(".txt") and os.path.isfile(os.path.join(txt_dir, f))]
        except Exception as e:
            print(f"ZML_TextLine [错误]: 扫描目录时出错 {txt_dir}: {e}")
            files = []
        
        # 创建下拉菜单列表，"禁用"作为第一个选项
        files.sort() # 排序文件列表
        file_list = ["禁用"] + files
        if not files:
            file_list = ["禁用 (未找到txt文件)"]

        return {
            "required": {
                "文件选择": (file_list,),
                "模式": (["索引", "顺序", "随机"],),
                "索引": ("INT", {"default": 0, "min": 0, "step": 1}),
                "随机行数": ("INT", {"default": 1, "min": 1, "step": 1}), # 新增随机行数选项
            },
            "optional": {
                "文本": ("STRING", {
                    "multiline": True,
                    "default": "",
                    "placeholder": "当'文件选择'为'禁用'时，此文本框生效"
                }),
            },
            "hidden": {
                "prompt": "PROMPT",
                "unique_id": "UNIQUE_ID"
            },
        }

    CATEGORY = "image/ZML_图像/文本"
    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("文本", "help")
    FUNCTION = "get_line"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")

    def get_line(self, 文件选择, 模式, 索引, 随机行数, unique_id, prompt, 文本=None): # 添加随机行数参数
        lines = []
        
        # 检查是否选择了文件（而不是"禁用"选项）
        if 文件选择 not in ["禁用", "禁用 (未找到txt文件)"]:
            file_path = os.path.join(self.txt_dir, 文件选择)
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    # 修改：读取文件时只移除右侧换行符，保留行内以及左侧空白
                    lines = [line.rstrip('\n') for line in f.readlines() if line.strip()]
            except FileNotFoundError:
                return (f"错误: 文件 '{文件选择}' 未在目录 '{self.txt_dir}' 中找到。", self.help_text)
            except Exception as e:
                return (f"错误: 读取文件 '{文件选择}' 时发生错误: {e}", self.help_text)
        else:
            # 如果未选择文件，则从文本框读取
            if 文本:
                # 修改：文本框输入时，按行分割，只对每行末尾的换行符或空行进行处理，保留行内的所有内容
                lines = [line for line in 文本.splitlines() if line.strip()]
            else:
                return ("", self.help_text) # 如果文本框为空

        if not lines:
            return ("", self.help_text)

        num_lines = len(lines)
        output_line = ""

        if 模式 == "索引":
            safe_index = 索引 % num_lines
            output_line = lines[safe_index]

        elif 模式 == "顺序":
            current_count = self.get_sequential_count(unique_id)
            safe_index = current_count % num_lines
            output_line = lines[safe_index]
            self.increment_sequential_count(unique_id)

        elif 模式 == "随机":
            # 根据随机行数选择多行
            if 随机行数 > 0:
                # 确保选择的行数不超过总行数
                count_to_select = min(随机行数, num_lines)
                selected_lines = random.sample(lines, count_to_select)
                output_line = ", ".join(selected_lines) # 用逗号连接多行
            else:
                output_line = random.choice(lines) # 默认选择一行

        return (output_line, self.help_text)

# ============================== 随机权重文本行节点==============================
class ZML_RandomTextWeight:
    """ZML 随机文本权重节点 (支持从文本框或文件读取)"""
    
    def __init__(self):
        self.base_dir = os.path.dirname(os.path.abspath(__file__))
        self.txt_dir = os.path.join(self.base_dir, "txt")
        self.help_text = "你好~欢迎使用ZML节点~\n此节点会自动读取'zml_w/txt'文件夹下的txt文件。从下拉菜单中选择一个文件，节点将从中随机选取指定数量的行或标签，并为每行/标签赋予一个在你设定的最小值和最大值之间（包含边界）的随机权重。你还可以设置权重的的小数位数。如果每行都的结尾都带逗号，节点会自动删除来确保权重格式正确。节点自带1000画师的txt文件，你也可以自己加入其它的txt文件。\n不读取txt文件的情况下会加载文本框里的tag，并对tag随机添加权重！\n好啦~祝你玩得开心！"

    @classmethod
    def INPUT_TYPES(cls):
        base_dir = os.path.dirname(os.path.abspath(__file__))
        txt_dir = os.path.join(base_dir, "txt")
        os.makedirs(txt_dir, exist_ok=True)
        
        try:
            # 排除 Preset text 目录，或者只列出顶级txt文件
            files = [f for f in os.listdir(txt_dir) if f.startswith('Preset text') == False and f.endswith(".txt") and os.path.isfile(os.path.join(txt_dir, f))]
        except Exception as e:
            print(f"ZML_RandomTextWeight [错误]: 扫描目录时出错 {txt_dir}: {e}")
            files = []
        
        # 将'禁用'选项放在列表最前面，作为模式开关
        files.sort() # 排序文件列表
        file_list = ["禁用 (使用文本框)"] + files
        if not files:
            file_list = ["禁用 (使用文本框)", "未找到txt文件"]

        return {
            "required": {
                "文件": (file_list, ),
                "随机模式": (["按行随机", "按标签随机"], {"default": "按行随机"}),
                "小数位数": (["两位", "一位"], {"default": "两位"}),
                "随机个数": ("INT", {"default": 1, "min": 1, "step": 1}),
                "最小权重": ("FLOAT", {"default": 0.3, "min": 0.0, "max": 3.0, "step": 0.01}),
                "最大权重": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 3.0, "step": 0.01}),
            },
            "optional": {
                "文本": ("STRING", {
                    "multiline": True,
                    "default": "",
                    "placeholder": "当'文件'为'禁用 (使用文本框)'时，加载此处的标签或多行文本"
                }),
            }
        }

    CATEGORY = "image/ZML_图像/文本"
    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("文本", "help")
    FUNCTION = "generate_weighted_lines"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")

    def generate_weighted_lines(self, 文件, 随机模式, 小数位数, 随机个数, 最小权重, 最大权重, 文本=None):
        # 确保最小权重不大于最大权重
        min_w = min(最小权重, 最大权重)
        max_w = max(最小权重, 最大权重)
        
        # 根据选项确定小数精度
        precision = 2 if 小数位数 == "两位" else 1

        all_candidates = [] # 存储所有可能的候选项，无论是来自文件还是文本框，根据随机模式进行处理

        # 模式判断：是使用文本框还是文件
        if 文件 == "禁用 (使用文本框)":
            # --- 文本框模式 ---
            if not 文本 or not 文本.strip(): # 仅判断是否为空白字符串
                return ("", self.help_text)

            if 随机模式 == "按行随机":
                # 按换行符分割，过滤掉完全为空白内容的行
                all_candidates = [line for line in 文本.splitlines() if line.strip()]
            elif 随机模式 == "按标签随机":
                # 按逗号分割，过滤掉完全为空白内容的标签
                all_candidates = [tag.strip() for tag in 文本.split(',') if tag.strip()]
            
            if not all_candidates:
                return ("", self.help_text)

        else:
            # --- 文件模式 ---
            if 文件 == "未找到txt文件":
                return ("下拉菜单中未选择有效文件，请检查 '.../zml_w/txt' 目录下是否有txt文件并重启ComfyUI。", self.help_text)

            file_path = os.path.join(self.txt_dir, 文件)
            
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    raw_content = f.read()
                    if 随机模式 == "按行随机":
                        # 读取文件时只移除右侧换行符，并移除行末逗号，保留行内以及左侧空白
                        all_candidates = [line.rstrip('\n').rstrip(',，').strip() for line in raw_content.splitlines() if line.strip()]
                    elif 随机模式 == "按标签随机":
                        # 读取文件时，将所有内容视为一个大字符串，然后按逗号分割
                        all_candidates = [tag.strip() for tag in raw_content.replace('\n', ',').split(',') if tag.strip()]
            except FileNotFoundError:
                return (f"错误: 文件 '{文件}' 未在目录 '{self.txt_dir}' 中找到。", self.help_text)
            except Exception as e:
                return (f"错误: 读取文件 '{文件}' 时发生错误: {e}", self.help_text)

            if not all_candidates:
                return ("", self.help_text)

        # 从所有候选项中随机选择指定数量的行/标签
        count_to_select = min(随机个数, len(all_candidates))
        # 使用 random.sample 进行不重复抽取
        selected_raw_items = random.sample(all_candidates, count_to_select)
        
        weighted_output = []
        for item_content in selected_raw_items:
            # 对每一选中的内容进行格式化和权重添加
            processed_content = item_content
            
            # 只有当内容非空时才添加权重
            if processed_content.strip():
                weight = round(random.uniform(min_w, max_w), precision)
                weighted_output.append(f"({processed_content}:{weight})")
            
        output_text = ", ".join(weighted_output)
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
                    "default": ",\\n\\n",
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
    
    CATEGORY = "image/ZML_图像/文本"
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
        
        # 修改：不再对每个文本进行strip()，过滤掉纯空白的文本（例如只包含换行符的文本），以便保留内部换行
        non_empty_texts = [text for text in texts if text.strip()]
        
        # 处理分隔符中的换行符
        processed_separator = 分隔符.replace("\\n", "\n")
        
        # 使用分隔符连接文本
        combined = processed_separator.join(non_empty_texts)
        
        # 应用标点符号格式化 (在连接后进行)
        if 格式化标点符号:
            combined = format_punctuation_global(combined)
        
        return (combined,)

# ============================== 多文本输入_五V2 节点 ==============================
class ZML_MultiTextInput5V2:
    """ZML 多文本输入_五V2 节点：提供五个单行文本输入和五个独立文本输出，以及合并文本和文本列表输出。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "分隔符": ("STRING", {
                    "multiline": False,
                    "default": ",\n\n",
                    "placeholder": "输入分隔符"
                }),
                "文本1_输入": ("STRING", {
                    "multiline": False, # 单行输入
                    "default": "",
                    "placeholder": "输入文本 1"
                }),
                "文本2_输入": ("STRING", {
                    "multiline": False, # 单行输入
                    "default": "",
                    "placeholder": "输入文本 2"
                }),
                "文本3_输入": ("STRING", {
                    "multiline": False, # 单行输入
                    "default": "",
                    "placeholder": "输入文本 3"
                }),
                "文本4_输入": ("STRING", {
                    "multiline": False, # 单行输入
                    "default": "",
                    "placeholder": "输入文本 4"
                }),
                "文本5_输入": ("STRING", {
                    "multiline": False, # 单行输入
                    "default": "",
                    "placeholder": "输入文本 5"
                }),
            }
        }

    CATEGORY = "image/ZML_图像/文本"
    
    # 7个输出端口
    RETURN_TYPES = ("STRING", "STRING", "STRING", "STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("文本1", "文本2", "文本3", "文本4", "文本5", "合并文本", "文本列表")
    
    # 前6个是 False (单值)，第7个是 True (列表/批次)
    OUTPUT_IS_LIST = (False, False, False, False, False, False, True)
    
    FUNCTION = "passthrough_texts"

    def passthrough_texts(self, 分隔符, 文本1_输入, 文本2_输入, 文本3_输入, 文本4_输入, 文本5_输入):
        """将五个输入文本作为五个独立输出返回，并使用分隔符合并文本输出，同时输出原始列表。"""
        # 安全地将所有文本放入列表
        texts = [
            文本1_输入,
            文本2_输入,
            文本3_输入,
            文本4_输入,
            文本5_输入
        ]
        
        # 过滤掉空文本 (这就是我们需要的列表，不带分隔符)
        non_empty_texts = [t for t in texts if t.strip()]

        # 处理分隔符中的换行符写法
        processed_separator = 分隔符.replace("\\n", "\n")

        # 使用分隔符合并文本
        merged_text = processed_separator.join(non_empty_texts)
            
        # 返回值：前6个是字符串，第7个是列表
        return (文本1_输入, 文本2_输入, 文本3_输入, 文本4_输入, 文本5_输入, merged_text, non_empty_texts)

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
                    "default": ",\\n\\n",
                    "placeholder": "输入分隔符"
                }),
            },
            "optional": {
                "文本1": ("STRING", {"multiline": True, "default": "", "placeholder": "输入文本1"}),
                "文本2": ("STRING", {"multiline": True, "default": "", "placeholder": "输入文本2"}),
                "文本3": ("STRING", {"multiline": True, "default": "", "placeholder": "输入文本3"}),
            }
        }
    
    CATEGORY = "image/ZML_图像/文本"
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
        
        # 修改：不再对每个文本进行strip()，过滤掉纯空白的文本，以便保留内部换行
        non_empty_texts = [text for text in texts if text.strip()]
        
        # 处理分隔符中的换行符
        processed_separator = 分隔符.replace("\\n", "\n")
        
        # 使用分隔符连接文本
        combined = processed_separator.join(non_empty_texts)
        
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
                "分隔符": ("STRING", {"multiline": False, "default": ",\\n\\n"}),
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

    CATEGORY = "image/ZML_图像/文本"
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

        # 过滤出已启用且内容非空的文本，不再对文本进行strip()以保留换行
        enabled_texts = [text for is_enabled, text in inputs if is_enabled and text.strip()]

        # 处理分隔符中的换行符
        processed_separator = 分隔符.replace("\\n", "\n")

        # 使用分隔符连接文本
        combined = processed_separator.join(enabled_texts)

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
                "分隔符": ("STRING", {"multiline": False, "default": ",\\n\\n"}),
                "启用1": ("BOOLEAN", {"default": True, "label_on": "启用 1", "label_off": "禁用 1"}),
                "启用2": ("BOOLEAN", {"default": False, "label_on": "启用 2", "label_off": "禁用 2"}),
                "启用3": ("BOOLEAN", {"default": False, "label_on": "启用 3", "label_off": "禁用 3"}),
                "启用4": ("BOOLEAN", {"default": False, "label_on": "启用 4", "label_off": "禁用 4"}),
                "启用5": ("BOOLEAN", {"default": False, "label_on": "启用 5", "label_off": "禁用 5"}),
            }
        }

    CATEGORY = "image/ZML_图像/文本"
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

        # 过滤出已启用且内容非空的文本，不再对文本进行strip()以保留换行
        enabled_texts = [text for is_enabled, text in inputs if is_enabled and text.strip()]

        # 处理分隔符中的换行符
        processed_separator = 分隔符.replace("\\n", "\n")

        # 使用分隔符连接文本
        combined = processed_separator.join(enabled_texts)

        return (combined,)

# ============================== 选择文本V3节点 (动态UI版)==============================
class ZML_SelectTextV3:
    """ZML 选择文本V3节点：具有动态UI，可以自由添加、删除、启用/禁用文本行。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "separator": ("STRING", {"multiline": False, "default": ",\n\n"}), # 分隔符输入
            },
            "hidden": {
                "selectTextV3_data": ("STRING", {"default": "{}"}), # 隐藏的控件，用于接收JS前端数据
                "unique_id": "UNIQUE_ID",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    CATEGORY = "image/ZML_图像/文本"  # 统一分类
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "execute"
    
    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # 返回float("nan")使ComfyUI认为节点每次都发生了变化，从而每次执行时都重新计算随机结果
        return float("nan")

    def execute(self, separator, selectTextV3_data, unique_id=None, extra_pnginfo=None, 可选输入=None):
        import json
        import random

        try:
            data = json.loads(selectTextV3_data)
        except json.JSONDecodeError:
            data = {"entries": []} # 简化的数据结构

        entries = data.get("entries", [])
        
        final_parts = []
        
        # 检查是否是folder_select模式
        lock_mode = data.get("lock_mode", "none")
        
        if lock_mode == "folder_select":
            # 在folder_select模式下，只使用选中的文本框
            selected_entries = []
            for entry in entries:
                # 检查是否是文件夹类型的条目（注意使用item_type而不是type）
                if entry.get("item_type") == "folder" and entry.get("enabled", True):
                    selected_id = entry.get("selectedTextboxId", None)
                    # 查找对应的子文本框条目（使用parent_id而不是parentId）
                    for sub_entry in entries:
                        if sub_entry.get("parent_id") == entry.get("id") and sub_entry.get("enabled", True):
                            # 如果有选中的ID，则只匹配选中的文本框；否则使用第一个启用的文本框
                            if selected_id is None or sub_entry.get("id") == selected_id:
                                content = sub_entry.get("content", "")
                                if content is not None and content != "":
                                    selected_entries.append(content)
                                    # 如果有选中的ID，找到后就可以跳出循环
                                    if selected_id is not None:
                                        break
            final_parts = selected_entries
        else:
            # 原始逻辑：收集所有启用的文本条目
            enabled_entries = []
            for entry in entries:
                # 只处理非文件夹类型的条目
                if entry.get("type") != "folder" and entry.get("enabled", False):
                    content = entry.get("content", "")
                    if content is not None and content != "":
                        enabled_entries.append(content)
            
            # 检查是否启用了随机选择
            random_enabled = data.get("randomEnabled", False)
            random_count = data.get("randomCount", 1)
            
            if random_enabled and enabled_entries:
                # 确保randomCount是整数
                try:
                    count = max(1, min(int(random_count), len(enabled_entries)))
                    # 随机选择指定数量的条目
                    selected_entries = random.sample(enabled_entries, count)
                    final_parts = selected_entries
                except (ValueError, TypeError):
                    # 如果转换失败，使用所有启用的条目
                    final_parts = enabled_entries
            else:
                # 不启用随机时，使用所有启用的文本条目
                final_parts = enabled_entries
        
        # 如果有可选输入并且不为空，添加到结果中
        if 可选输入 and 可选输入.strip():
            final_parts.append(可选输入.strip())
        
        # 处理分隔符中的换行符
        processed_separator = separator.replace("\\n", "\n")
        
        output_text = processed_separator.join(final_parts)
        
        return (output_text,)

# ============================== 文本分离节点 ==============================
class ZML_SplitText:
    """ZML 文本分离节点：根据指定字符或字符串将文本分割成两部分。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "分隔符_字符": ("STRING", {
                    "multiline": False, # 单行输入
                    "default": ",",
                    "placeholder": "输入用于分割文本的字符或字符串"
                }),
            },
            "optional": {
                "文本_输入": ("STRING", {
                    "forceInput": True, 
                    "default": "",
                }),
            }
        }

    CATEGORY = "image/ZML_图像/文本"
    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("文本_前缀", "文本_后缀")
    FUNCTION = "split_text_by_char"

    def split_text_by_char(self, 分隔符_字符, 文本_输入=""): 
        """根据分隔符_字符将文本_输入分割成两部分。"""
        
        # 如果文本_输入为空或纯空白，直接返回空字符串
        if not 文本_输入.strip():
            return ("", "")

        # 如果分隔符为空，则不进行分割，将整个文本作为前缀输出，后缀为空
        if not 分隔符_字符:
            return (文本_输入, "")

        # 使用 str.partition 方法进行分割，它会在找到第一个分隔符时停止
        # 返回一个元组 (前缀, 分隔符, 后缀)
        before_separator, found_separator, after_separator = 文本_输入.partition(分隔符_字符)

        # 如果分隔符未找到，partition会将整个字符串放在before_separator，后两者为空
        if not found_separator:
            return (文本_输入, "") # 或者 (文本_输入, "") 根据实际需求，这里是返回整个文本作为前缀，后缀为空

        # 不再进行标点符号格式化，直接返回分割后的文本
        return (before_separator, after_separator,)

# ============================== 选择文本V4节点 (单文本框版==============================
class ZML_SelectTextV4:
    """ZML 选择文本V4节点：提供一个多行文本输入框，直接返回输入的文本。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "文本": ("STRING", {"multiline": True, "default": "", "placeholder": "输入文本"}),
            },
        }

    CATEGORY = "image/ZML_图像/文本"
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("文本",)
    FUNCTION = "get_text"

    def get_text(self, 文本):
        """直接返回输入的文本"""
        return (文本,)

class ZML_AppendTextByKeyword:
    """ZML 追加提示词节点"""
    
    def __init__(self):
        self.help_text = "你好~欢迎使用ZML节点~\n此节点可以检测输入文本中的关键词，并根据选择的模式来处理文本。\n- 检测词：用英文逗号分隔多个关键词\n- 只要输入文本中包含任一检测词，就会执行相应操作\n- 追加模式：将预设文本追加到输入文本后\n- 替换标签模式：只替换与关键词相同的标签\n- 完整替换模式：用预设文本完全替换输入文本\n祝你使用愉快！"
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "输入文本": ("STRING", {
                    "multiline": True,
                    "default": "",
                    "placeholder": "输入要检测的文本"
                }),
                "检测词": ("STRING", {
                    "multiline": False,
                    "default": "",
                    "placeholder": "输入要检测的关键词（用英文逗号分隔）"
                }),
                "预设文本": ("STRING", {
                    "multiline": True,
                    "default": "",
                    "placeholder": "输入要追加或替换的预设文本"
                }),
                "处理模式": (["追加", "替换标签", "完整替换"], {"default": "追加"}),
            }
        }
    
    CATEGORY = "image/ZML_图像/文本"
    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("文本", "Help")
    FUNCTION = "process_text"
    
    def process_text(self, 输入文本, 检测词, 预设文本, 处理模式):
        """根据关键词检测结果处理文本"""
        if not 输入文本.strip():
            return ("", self.help_text)
        
        # 分割检测词并去除空白
        keywords = [kw.strip() for kw in 检测词.split(',') if kw.strip()]
        
        # 如果没有检测词，则直接返回输入文本
        if not keywords:
            return (输入文本, self.help_text)
        
        # 检查输入文本是否包含任一关键词
        contains_keyword = any(keyword in 输入文本 for keyword in keywords)
        
        # 根据处理模式和关键词检测结果处理文本
        if contains_keyword:
            if 处理模式 == "替换标签":
                # 保存原始文本的换行结构
                lines = 输入文本.splitlines()
                processed_lines = []
                
                for line in lines:
                    # 分割每行的标签
                    tags = [tag.strip() for tag in line.split(',') if tag.strip()]
                    # 替换匹配的关键词标签
                    processed_tags = [预设文本 if tag in keywords else tag for tag in tags]
                    # 重新组合该行
                    processed_line = ', '.join(processed_tags)
                    processed_lines.append(processed_line)
                
                # 重新组合所有行
                result_text = '\n'.join(processed_lines)
            elif 处理模式 == "完整替换":
                result_text = 预设文本
            else:  # 追加模式
                # 确保输入文本和预设文本之间有适当的分隔
                if 输入文本.strip().endswith(','):
                    separator = ' '
                else:
                    separator = ', '
                
                result_text = 输入文本 + separator + 预设文本
        else:
            result_text = 输入文本
        
        # 应用全局标点符号格式化
        result_text = format_punctuation_global(result_text)
        
        return (result_text, self.help_text)

# 合并相同提示词功能已集成到ZML_TextFormatter节点中，作为一个新选项

# ============================== 合并文本（动态）节点 ==============================
class ZML_MergeText:
    """ZML 合并文本（动态输入）节点：支持动态字符串输入、分隔符。
    支持最多20个输入，并提供文本列表输出。
    """

    @classmethod
    def INPUT_TYPES(cls):
        # 预定义最多20个文本输入名称，供前端按需动态添加/移除
        optional_inputs = {}
        for i in range(1, 21): # 修改：范围扩大到 20
            optional_inputs[f"文本{i}"] = ("STRING", {"forceInput": True})
        return {
            "required": {
                "分隔符": ("STRING", {"multiline": False, "default": ",\n\n"}),
            },
            "optional": optional_inputs,
        }

    CATEGORY = "image/ZML_图像/文本"
    
    # 修改1: 增加第二个输出类型
    RETURN_TYPES = ("STRING", "STRING")
    # 修改2: 增加第二个输出名称
    RETURN_NAMES = ("合并文本", "文本列表")
    
    # 修改3: 声明第二个输出为列表 (True)，第一个为单值 (False)
    OUTPUT_IS_LIST = (False, True)
    
    FUNCTION = "merge_text"

    def merge_text(self, 分隔符, **kwargs):
        # 收集所有非空文本 (遍历 1 到 20)
        texts = []
        for i in range(1, 21):
            key = f"文本{i}"
            # 从 kwargs 中获取输入，如果没有则为空字符串
            val = kwargs.get(key, "")
            # 处理可能的 None 值
            texts.append(val or "")
            
        # 过滤掉空文本 (这就是输出的文本列表，无分隔符)
        non_empty_texts = [t for t in texts if t.strip()]

        # 处理分隔符中的换行符写法
        processed_separator = 分隔符.replace("\\n", "\n")

        # 原样合并 (合并文本输出)
        combined = processed_separator.join(non_empty_texts)

        # 标点格式化清理 (调用同文件中的全局函数)
        combined = format_punctuation_global(combined)
        
        # 返回: (合并后的单字符串, 原始列表)
        return (combined, non_empty_texts)

# ============================== 筛选提示词V2节点 ==============================
class ZML_TextFilterV2:
    """ZML 筛选提示词V2节点：基于十个布尔开关筛选提示词，支持从txt/miaoka/目录下的十个分类文件中加载提示词进行过滤"""
    
    def __init__(self):
        self.node_dir = os.path.dirname(os.path.abspath(__file__))
        self.miaoka_dir = os.path.join(self.node_dir, "txt", "miaoka")
        self.category_files = {
            "二次元角色": "二次元角色.txt",
            "人物": "人物.txt", 
            "场景": "场景.txt",
            "服饰": "服饰.txt",
            "物品": "物品.txt",
            "环境": "环境.txt",
            "画面": "画面.txt",
            "艺术家": "艺术家.txt",
            "表情动作": "表情动作.txt",
            "镜头": "镜头.txt"
        }
        self.category_keywords = {}
        self.category_translations = {}  # 新增：存储英文到中文的翻译映射
        self._load_category_keywords()
    
    def _load_category_keywords(self):
        """加载所有分类的关键词和翻译"""
        for category, filename in self.category_files.items():
            file_path = os.path.join(self.miaoka_dir, filename)
            keywords = set()
            translations = {}  # 英文到中文的映射
            try:
                if os.path.exists(file_path):
                    with open(file_path, 'r', encoding='utf-8') as f:
                        for line in f:
                            line = line.strip()
                            if line and ',' in line:
                                # 分割英文提示词和中文翻译
                                parts = line.split(',', 1)
                                english_part = parts[0].strip()
                                chinese_part = parts[1].strip() if len(parts) > 1 else ""
                                if english_part:
                                    keywords.add(english_part)
                                    if chinese_part:
                                        translations[english_part] = chinese_part
                    self.category_keywords[category] = keywords
                    self.category_translations[category] = translations
                else:
                    print(f"ZML_TextFilterV2 [警告]: 分类文件不存在 {file_path}")
                    self.category_keywords[category] = set()
                    self.category_translations[category] = {}
            except Exception as e:
                print(f"ZML_TextFilterV2 [错误]: 加载分类文件失败 {file_path}: {e}")
                self.category_keywords[category] = set()
                self.category_translations[category] = {}
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "输入文本": ("STRING", {"forceInput": True}),
                "自定义过滤词": ("STRING", {
                    "multiline": True,
                    "default": "",
                    "placeholder": "输入自定义过滤词，用英文逗号分隔"
                }),
                "二次元角色": ("BOOLEAN", {"default": False}),
                "人物": ("BOOLEAN", {"default": False}),
                "场景": ("BOOLEAN", {"default": False}),
                "服饰": ("BOOLEAN", {"default": False}),
                "物品": ("BOOLEAN", {"default": False}),
                "环境": ("BOOLEAN", {"default": False}),
                "画面": ("BOOLEAN", {"default": False}),
                "艺术家": ("BOOLEAN", {"default": False}),
                "表情动作": ("BOOLEAN", {"default": False}),
                "镜头": ("BOOLEAN", {"default": False}),
            }
        }
    
    CATEGORY = "image/ZML_图像/文本"
    RETURN_TYPES = ("STRING", "STRING", "STRING")
    RETURN_NAMES = ("筛选后文本", "过滤提示词", "过滤翻译")
    FUNCTION = "filter_text_v2"
    
    def filter_text_v2(self, 输入文本, 自定义过滤词, 二次元角色, 人物, 场景, 服饰, 物品, 环境, 画面, 艺术家, 表情动作, 镜头):
        """根据开关状态筛选提示词，返回筛选后的文本、被过滤的提示词及其翻译"""
        if not 输入文本.strip():
            return ("", "", "")
        
        # 确定需要过滤的分类
        active_categories = []
        switch_states = {
            "二次元角色": 二次元角色,
            "人物": 人物,
            "场景": 场景, 
            "服饰": 服饰,
            "物品": 物品,
            "环境": 环境,
            "画面": 画面,
            "艺术家": 艺术家,
            "表情动作": 表情动作,
            "镜头": 镜头
        }
        
        for category, is_active in switch_states.items():
            if is_active:
                active_categories.append(category)
        
        # 收集所有需要过滤的关键词和翻译
        keywords_to_filter = set()
        translations_to_filter = {}  # 被过滤词的英文到中文映射
        
        # 添加自定义过滤词
        if 自定义过滤词.strip():
            custom_keywords = [kw.strip() for kw in 自定义过滤词.split(',') if kw.strip()]
            keywords_to_filter.update(custom_keywords)
        
        # 添加分类过滤词
        for category in active_categories:
            keywords_to_filter.update(self.category_keywords.get(category, set()))
            translations_to_filter.update(self.category_translations.get(category, {}))
        
        # 如果没有需要过滤的关键词，直接返回原文本
        if not keywords_to_filter:
            return (输入文本, "", "")
        
        # 按行处理，保持原始结构
        lines = 输入文本.splitlines()
        filtered_lines = []
        filtered_keywords = set()  # 被过滤的关键词
        
        for line in lines:
            if not line.strip():
                filtered_lines.append(line)
                continue
                
            # 分割标签，保持原始格式
            tags = []
            current_tag = ""
            in_tag = False
            
            for char in line:
                if char == ',' and not in_tag:
                    if current_tag.strip():
                        tags.append(current_tag.strip())
                    current_tag = ""
                else:
                    current_tag += char
                    if char == '(':
                        in_tag = True
                    elif char == ')':
                        in_tag = False
            
            if current_tag.strip():
                tags.append(current_tag.strip())
            
            # 过滤标签
            filtered_tags = []
            for tag in tags:
                # 提取标签的核心部分（去掉权重）
                core_tag = tag.split(':')[0].strip('()')
                if core_tag not in keywords_to_filter:
                    filtered_tags.append(tag)
                else:
                    # 记录被过滤的关键词
                    filtered_keywords.add(core_tag)
            
            # 重新组合行
            if filtered_tags:
                filtered_line = ', '.join(filtered_tags)
                filtered_lines.append(filtered_line)
        
        # 重新组合所有行
        result = '\n'.join(filtered_lines)
        
        # 应用全局标点符号格式化
        result = format_punctuation_global(result)
        
        # 生成被过滤词的列表和翻译列表
        filtered_list = sorted(list(filtered_keywords))
        filtered_text = ', '.join(filtered_list) if filtered_list else ""
        
        # 生成翻译列表（英文/中文/分类格式，每行一个）
        translation_list = []
        for keyword in filtered_list:
            translation = translations_to_filter.get(keyword, "")
            # 找出这个词属于哪些分类
            categories_for_word = []
            for category in active_categories:
                if keyword in self.category_keywords.get(category, set()):
                    categories_for_word.append(category)
            category_str = '/'.join(categories_for_word) if categories_for_word else "未知"
            
            if translation:
                translation_list.append(f"{keyword}/{translation}/{category_str}")
            else:
                translation_list.append(f"{keyword}//{category_str}")
        translation_text = '\n'.join(translation_list) if translation_list else ""
        
        return (result, filtered_text, translation_text)

# ============================== 节点注册 ==============================
NODE_CLASS_MAPPINGS = {
    "ZML_TextFormatter": ZML_TextFormatter,
    "ZML_TextFilter": ZML_TextFilter,
    "ZML_TextFilterV2": ZML_TextFilterV2,
    "ZML_DeleteText": ZML_DeleteText,
    "ZML_TextLine": ZML_TextLine,
    "ZML_RandomTextWeight": ZML_RandomTextWeight,
    "ZML_MultiTextInput5": ZML_MultiTextInput5,
    "ZML_MultiTextInput5V2": ZML_MultiTextInput5V2,
    "ZML_MultiTextInput3": ZML_MultiTextInput3,
    "ZML_SelectText": ZML_SelectText,
    "ZML_SelectTextV2": ZML_SelectTextV2,
    "ZML_SelectTextV3": ZML_SelectTextV3,
    "ZML_SelectTextV4": ZML_SelectTextV4,
    "ZML_SplitText": ZML_SplitText,
    "ZML_AppendTextByKeyword": ZML_AppendTextByKeyword,
    "ZML_MergeText": ZML_MergeText,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_TextFormatter": "ZML_文本转格式",
    "ZML_TextFilter": "ZML_筛选提示词",
    "ZML_TextFilterV2": "ZML_筛选提示词V2",
    "ZML_DeleteText": "ZML_删除文本",
    "ZML_TextLine": "ZML_文本行",
    "ZML_RandomTextWeight": "ZML_随机文本权重",
    "ZML_MultiTextInput5": "ZML_多文本输入_五",
    "ZML_MultiTextInput5V2": "ZML_多文本输入_五V2",
    "ZML_MultiTextInput3": "ZML_多文本输入_三",
    "ZML_SelectText": "ZML_选择文本",
    "ZML_SelectTextV2": "ZML_选择文本V2",
    "ZML_SelectTextV3": "ZML_选择文本V3",
    "ZML_SelectTextV4": "ZML_选择文本V4",
    "ZML_SplitText": "ZML_文本分离",
    "ZML_AppendTextByKeyword": "ZML_追加提示词",
    "ZML_MergeText": "ZML_合并文本（动态）",
}
