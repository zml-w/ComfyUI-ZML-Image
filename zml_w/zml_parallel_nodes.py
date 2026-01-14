import concurrent.futures
import nodes
import json
import copy
import random
import traceback
import os
import glob
import torch

# ==========================================
# AnyType HACK - 允许连接任何类型
# ==========================================
class AlwaysEqualProxy(str):
    def __eq__(self, _):
        return True
    def __ne__(self, _):
        return False

any_type = AlwaysEqualProxy("*")

# ==========================================
# 变量定义节点 
# ==========================================

class ZML_ParallelVariableBase:
    """变量节点基类"""
    def merge_bundle(self, prev_bundle, key, data):
        new_bundle = copy.deepcopy(prev_bundle) if prev_bundle else {}
        if key in new_bundle:
            print(f"[ZML] 警告: 变量 '{{ {key} }}' 正在被覆盖。")
        new_bundle[key] = data
        return (new_bundle,)

class ZML_ParallelVariableText:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "文本列表": ("STRING", {"multiline": True, "default": "提示词1\n提示词2\n提示词3"}),
                "占位符": ("STRING", {"default": "提示词", "multiline": False}),
            },
            "optional": { "输入变量包": ("VAR_BUNDLE",), }
        }
    RETURN_TYPES = ("VAR_BUNDLE",)
    RETURN_NAMES = ("输出变量包",)
    FUNCTION = "define_var"
    CATEGORY = "image/ZML_图像/子工作流"

    def define_var(self, 文本列表, 占位符, 输入变量包=None):
        base = ZML_ParallelVariableBase()
        lines = [line.strip() for line in 文本列表.split('\n') if line.strip()]
        data = { "type": "list", "values": lines }
        return base.merge_bundle(输入变量包, 占位符, data)

class ZML_ParallelVariableInt:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": { "起始值": ("INT", {"default": 0}), "步长": ("INT", {"default": 1}), "占位符": ("STRING", {"default": "整数"}), },
            "optional": { "输入变量包": ("VAR_BUNDLE",), }
        }
    RETURN_TYPES = ("VAR_BUNDLE",)
    RETURN_NAMES = ("输出变量包",)
    FUNCTION = "define_var"
    CATEGORY = "image/ZML_图像/子工作流"

    def define_var(self, 起始值, 步长, 占位符, 输入变量包=None):
        base = ZML_ParallelVariableBase()
        data = { "type": "math_int", "start": 起始值, "step": 步长 }
        return base.merge_bundle(输入变量包, 占位符, data)

class ZML_ParallelVariableFloat:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": { "起始值": ("FLOAT", {"default": 0.0}), "步长": ("FLOAT", {"default": 0.1}), "占位符": ("STRING", {"default": "浮点"}), },
            "optional": { "输入变量包": ("VAR_BUNDLE",), }
        }
    RETURN_TYPES = ("VAR_BUNDLE",)
    RETURN_NAMES = ("输出变量包",)
    FUNCTION = "define_var"
    CATEGORY = "image/ZML_图像/子工作流"

    def define_var(self, 起始值, 步长, 占位符, 输入变量包=None):
        base = ZML_ParallelVariableBase()
        data = { "type": "math_float", "start": 起始值, "step": 步长 }
        return base.merge_bundle(输入变量包, 占位符, data)

class ZML_ParallelVariableSeed:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": { "种子": ("INT", {"default": 0}), "模式": (["固定", "递增", "随机"],), "占位符": ("STRING", {"default": "随机种"}), },
            "optional": { "输入变量包": ("VAR_BUNDLE",), }
        }
    RETURN_TYPES = ("VAR_BUNDLE",)
    RETURN_NAMES = ("输出变量包",)
    FUNCTION = "define_var"
    CATEGORY = "image/ZML_图像/子工作流"

    def define_var(self, 种子, 模式, 占位符, 输入变量包=None):
        base = ZML_ParallelVariableBase()
        data = { "type": "seed", "start": 种子, "mode": 模式 }
        return base.merge_bundle(输入变量包, 占位符, data)

class ZML_ParallelVariableImageFolder:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": { "文件夹路径": ("STRING", {"default": "C:\\Images"}), "占位符": ("STRING", {"default": "图像"}), },
            "optional": { "输入变量包": ("VAR_BUNDLE",), }
        }
    RETURN_TYPES = ("VAR_BUNDLE",)
    RETURN_NAMES = ("输出变量包",)
    FUNCTION = "define_var"
    CATEGORY = "image/ZML_图像/子工作流"

    def define_var(self, 文件夹路径, 占位符, 输入变量包=None):
        base = ZML_ParallelVariableBase()
        if not os.path.exists(文件夹路径):
            print(f"[ZML] 错误: 文件夹不存在 {文件夹路径}")
            files = []
        else:
            exts = ['*.jpg', '*.jpeg', '*.png', '*.bmp', '*.webp']
            files = []
            for ext in exts:
                files.extend(glob.glob(os.path.join(文件夹路径, ext)))
                files.extend(glob.glob(os.path.join(文件夹路径, ext.upper())))
            files = sorted(list(set(files)))
        data = { "type": "list", "values": files }
        return base.merge_bundle(输入变量包, 占位符, data)

# ==========================================
# 导出锚点
# ==========================================

class ZML_SubflowExportImage:
    @classmethod
    def INPUT_TYPES(s): return {"required": {"图像": ("IMAGE",)}}
    RETURN_TYPES = ()
    OUTPUT_NODE = True
    FUNCTION = "export"
    CATEGORY = "image/ZML_图像/子工作流"
    def export(self, 图像): return {}

class ZML_SubflowExportAny:
    @classmethod
    def INPUT_TYPES(s): 
        # 修改点：这里使用 any_type 代替原来的 nodes.MAX_RESOLUTION
        return {"required": {"任意数据": (any_type, {"forceInput": True})}}
    RETURN_TYPES = ()
    OUTPUT_NODE = True
    FUNCTION = "export"
    CATEGORY = "image/ZML_图像/子工作流"
    def export(self, 任意数据): return {}

# ==========================================
# 核心容器节点
# ==========================================

class ZML_ParallelJsonContainer:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "JSON工作流": ("STRING", {"multiline": True, "dynamicPrompts": False, "placeholder": "在此粘贴工作流API，并在需要的位置里使用{{}}包裹变量名，如{{提示词}}。 "}),
                "执行次数": ("INT", {"default": 1, "min": 1, "max": 1000}),
                "并行线程数": ("INT", {"default": 1, "min": 1, "max": 32, "tooltip": "同时执行的线程数，多线程可以显著提高执行速度，子工作流为需要加载模型来生图的话，那只能单线程执行。"}),
                "清理缓存间隔": ("INT", {"default": 0, "min": 0, "max": 200, "tooltip": "执行完指定次数后，清理一次GPU缓存，以释放内存。"}),
                "返回图像": (["开启", "关闭"], {"default": "开启", "tooltip": "开启时，返回生成的图像；关闭时，只返回占位符图像，以减少工作流执行时占用的缓存。"}),
            },
            "optional": {
                "变量包": ("VAR_BUNDLE",),
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING", "STRING") 
    RETURN_NAMES = ("图像列表", "任意数据列表", "执行状态")
    
    OUTPUT_IS_LIST = (True, True, False)
    
    FUNCTION = "run_container"
    CATEGORY = "image/ZML_图像/子工作流"

    def run_container(self, JSON工作流, 执行次数, 并行线程数, 清理缓存间隔, 返回图像, 变量包=None):
        try:
            workflow_template = json.loads(JSON工作流)
        except Exception as e:
            err_msg = f"JSON 格式严重错误: {e}"
            return ([], [], err_msg)

        # --- 变量解析逻辑 ---
        def resolve_variable(key, var_config, index):
            v_type = var_config["type"]
            if v_type == "list":
                values = var_config["values"]
                if not values: return f"错误:变量{key}列表为空"
                return values[index % len(values)]
            elif v_type == "math_int":
                return int(var_config["start"] + index * var_config["step"])
            elif v_type == "math_float":
                return float(var_config["start"] + index * var_config["step"])
            elif v_type == "seed":
                mode = var_config["mode"]
                start = var_config["start"]
                if mode == "固定": return start
                elif mode == "递增": return start + index
                elif mode == "随机": return random.randint(1, 0xffffffffffffffff)
            return ""

        def smart_replace(obj, current_vars):
            if isinstance(obj, dict):
                return {k: smart_replace(v, current_vars) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [smart_replace(elem, current_vars) for elem in obj]
            elif isinstance(obj, str):
                new_str = obj
                replaced = False
                for key, val in current_vars.items():
                    placeholder = f"{{{{{key}}}}}"
                    if placeholder in new_str:
                        new_str = new_str.replace(placeholder, str(val))
                        replaced = True
                if replaced:
                    try:
                        if "." not in new_str and new_str.lstrip('-').isdigit():
                            return int(new_str)
                    except: pass
                    try:
                        return float(new_str)
                    except: pass
                return new_str
            else:
                return obj

        # --- 单任务执行引擎 ---
        def execute_single_workflow(index):
            try:
                # 1. 变量准备
                current_vars_map = {}
                if 变量包:
                    for k, v_conf in 变量包.items():
                        current_vars_map[k] = resolve_variable(k, v_conf, index)
                
                # 2. 变量替换
                current_flow = copy.deepcopy(workflow_template)
                current_flow = smart_replace(current_flow, current_vars_map)

                # 3. 递归执行
                result_cache = {} 
                
                # 清理GPU缓存
                if 清理缓存间隔 > 0 and (index +1) % 清理缓存间隔 == 0:
                    torch.cuda.empty_cache()
                    print(f"[ZML] 已清理GPU缓存，当前任务索引: {index+1}")
                    
                def get_node_result(node_id):
                    if node_id in result_cache: return result_cache[node_id]
                    if node_id not in current_flow: raise Exception(f"节点 ID {node_id} 在 JSON 中未找到")

                    node_data = current_flow[node_id]
                    class_type = node_data["class_type"]
                    inputs_config = node_data.get("inputs", {})

                    if class_type not in nodes.NODE_CLASS_MAPPINGS:
                        raise Exception(f"系统中缺少节点类: {class_type}")
                    
                    NodeClass = nodes.NODE_CLASS_MAPPINGS[class_type]
                    node_instance = NodeClass()
                    
                    resolved_inputs = {}
                    for k, v in inputs_config.items():
                        if isinstance(v, list) and len(v) == 2 and isinstance(v[0], str): 
                            dep_res = get_node_result(v[0])
                            if isinstance(dep_res, tuple):
                                idx = v[1] if v[1] < len(dep_res) else -1
                                resolved_inputs[k] = dep_res[idx]
                            else:
                                resolved_inputs[k] = dep_res
                        else:
                            resolved_inputs[k] = v

                    func = getattr(node_instance, getattr(node_instance, "FUNCTION"))
                    output = func(**resolved_inputs)
                    result_cache[node_id] = output
                    return output

                # 4. 导出结果
                exp_img, exp_any = None, None
                found_export = False

                for nid, ninfo in current_flow.items():
                    if ninfo["class_type"] == "ZML_SubflowExportImage":
                        found_export = True
                        try:
                            link = ninfo["inputs"].get("图像")
                            if isinstance(link, list):
                                res = get_node_result(link[0])
                                exp_img = res[link[1]] if isinstance(res, tuple) else res
                        except Exception as e:
                            raise Exception(f"导出图像失败: {str(e)}")
                    elif ninfo["class_type"] == "ZML_SubflowExportAny":
                        found_export = True
                        try:
                            link = ninfo["inputs"].get("任意数据")
                            if isinstance(link, list):
                                res = get_node_result(link[0])
                                exp_any = res[link[1]] if isinstance(res, tuple) else res
                        except Exception as e:
                             raise Exception(f"导出数据失败: {str(e)}")
                
                if not found_export:
                    return (None, None, "警告: JSON 中未找到 ZML导出节点")

                return (exp_img, exp_any, "成功")

            except Exception as e:
                return (None, None, str(e))

        # --- 并行执行 ---
        final_images = []
        final_anys = []
        final_statuses_list = [""] * 执行次数
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=并行线程数) as executor:
            future_to_idx = {executor.submit(execute_single_workflow, i): i for i in range(执行次数)}
            
            for future in concurrent.futures.as_completed(future_to_idx):
                idx = future_to_idx[future]
                try:
                    img, any_val, status_msg = future.result()
                    
                    if status_msg == "成功":
                        final_statuses_list[idx] = f"任务 {idx+1}: ✅ 成功"
                        if 返回图像 == "开启":
                            if img is not None: final_images.append(img)
                        else:
                            # 生成1*1占位符图像
                            placeholder_img = torch.zeros((1, 1, 1, 3), dtype=torch.float32)
                            final_images.append(placeholder_img)
                        if any_val is not None: final_anys.append(str(any_val))
                    else:
                        final_statuses_list[idx] = f"任务 {idx+1}: ❌ 失败 - {status_msg}"

                except Exception as e:
                    final_statuses_list[idx] = f"任务 {idx+1}: 💥 系统级异常 - {str(e)}"
                    traceback.print_exc()

        status_string = "\n\n".join(final_statuses_list)

        return (final_images, final_anys, status_string)

# 注册映射
NODE_CLASS_MAPPINGS = {
    "ZML_SubflowExportImage": ZML_SubflowExportImage,
    "ZML_SubflowExportAny": ZML_SubflowExportAny,
    "ZML_ParallelJsonContainer": ZML_ParallelJsonContainer,
    "ZML_ParallelVariableText": ZML_ParallelVariableText,
    "ZML_ParallelVariableInt": ZML_ParallelVariableInt,
    "ZML_ParallelVariableFloat": ZML_ParallelVariableFloat,
    "ZML_ParallelVariableSeed": ZML_ParallelVariableSeed,
    "ZML_ParallelVariableImageFolder": ZML_ParallelVariableImageFolder,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_SubflowExportImage": "ZML_导出图像 (子工作流)",
    "ZML_SubflowExportAny": "ZML_导出任意数据 (子工作流)",
    "ZML_ParallelJsonContainer": "ZML_多线程子工作流",
    "ZML_ParallelVariableText": "ZML_变量_文本列表",
    "ZML_ParallelVariableInt": "ZML_变量_整数序列",
    "ZML_ParallelVariableFloat": "ZML_变量_浮点序列",
    "ZML_ParallelVariableSeed": "ZML_变量_随机种子",
    "ZML_ParallelVariableImageFolder": "ZML_变量_图像文件夹",
}