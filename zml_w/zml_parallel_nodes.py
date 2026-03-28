import concurrent.futures
import nodes
import json
import copy
import random
import traceback
import os
import glob
import torch
import inspect
import sys
import gc
import comfy.model_management

# ==========================================
# AnyType HACK - 允许连接任何类型
# ==========================================
class AlwaysEqualProxy(str):
    def __eq__(self, _): return True
    def __ne__(self, _): return False

any_type = AlwaysEqualProxy("*")

# ==========================================
# 核心容器节点
# ==========================================

class ZML_ParallelJsonContainer:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "JSON工作流": ("STRING", {"multiline": True, "dynamicPrompts": False, "placeholder": "粘贴API JSON，使用{{变量名}}替换"}),
                "执行次数": ("INT", {"default": 1, "min": 1, "max": 3000}),
                "并行线程数": ("INT", {"default": 1, "min": 1, "max": 64}),
                "执行完成后清理缓存": ("BOOLEAN", {"default": True, "tooltip": "所有任务执行完成后执行全面清理，包括卸载模型、Python垃圾回收、CUDA缓存释放，以减少工作流执行造成的内存显存残留。尽量在关闭返回图像时开启这个功能，不然可能会失效。"}),
                "返回图像": (["开启", "关闭"], {"default": "开启"}),
                "控制台日志": (["开启", "关闭"], {"default": "开启"}),
            },
            "optional": { "变量包": ("VAR_BUNDLE",), }
        }

    RETURN_TYPES = ("IMAGE", "STRING", "STRING") 
    RETURN_NAMES = ("图像列表", "任意数据列表", "执行状态")
    
    # 注意：这里保持 True，我们会根据情况返回 [BatchTensor] 或 [Img1, Img2...]
    OUTPUT_IS_LIST = (True, True, False)
    
    FUNCTION = "run_container"
    CATEGORY = "image/ZML_图像/子工作流"

    def run_container(self, JSON工作流, 执行次数, 并行线程数, 执行完成后清理缓存, 返回图像, 控制台日志, 变量包=None):
        try:
            workflow_template = json.loads(JSON工作流)
        except Exception as e:
            return ([], [], f"JSON 格式错误: {e}")

        # --- 变量解析内部函数 ---
        def resolve_variable(key, var_config, index):
            v_type = var_config["type"]
            if v_type == "list":
                values = var_config["values"]
                return values[index % len(values)] if values else ""
            elif v_type == "math_int":
                return int(var_config["start"] + index * var_config["step"])
            elif v_type == "math_float":
                return float(var_config["start"] + index * var_config["step"])
            elif v_type == "seed":
                mode = var_config["mode"]
                if mode == "固定": return var_config["start"]
                elif mode == "递增": return var_config["start"] + index
                else: return random.randint(1, 0xffffffffffffffff)
            return ""

        def smart_replace(obj, current_vars):
            if isinstance(obj, dict):
                return {k: smart_replace(v, current_vars) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [smart_replace(elem, current_vars) for elem in obj]
            elif isinstance(obj, str):
                new_str = obj
                for key, val in current_vars.items():
                    placeholder = f"{{{{{key}}}}}"
                    if placeholder in new_str:
                        if new_str.strip() == placeholder: return val
                        new_str = new_str.replace(placeholder, str(val))
                return new_str
            return obj

        # --- 单个任务执行引擎 ---
        def execute_single_workflow(index):
            try:
                current_vars_map = {}
                if 变量包:
                    for k, v_conf in 变量包.items():
                        current_vars_map[k] = resolve_variable(k, v_conf, index)
                
                current_flow = smart_replace(copy.deepcopy(workflow_template), current_vars_map)
                result_cache = {}

                def get_node_result(node_id):
                    try:
                        if node_id in result_cache: return result_cache[node_id]
                        node_data = current_flow[node_id]
                        class_type = node_data["class_type"].split('|')[0]

                        if class_type not in nodes.NODE_CLASS_MAPPINGS:
                            raise Exception(f"缺失节点: {class_type}")
                        
                        NodeClass = nodes.NODE_CLASS_MAPPINGS[class_type]
                        node_instance = NodeClass()
                        raw_inputs = node_data.get("inputs", {})
                        resolved_inputs = {}
                        for k, v in raw_inputs.items():
                            if isinstance(v, list) and len(v) == 2 and isinstance(v[0], str): 
                                res = get_node_result(v[0])
                                resolved_inputs[k] = res[v[1]] if isinstance(res, tuple) else res
                            else:
                                resolved_inputs[k] = v

                        # 参数过滤与补全逻辑
                        func_name = getattr(node_instance, "FUNCTION")
                        func = getattr(node_instance, func_name)
                        sig = inspect.signature(func)
                        
                        final_kwargs = {}
                        for param_name, param in sig.parameters.items():
                            if param_name in resolved_inputs:
                                final_kwargs[param_name] = resolved_inputs[param_name]
                            elif param_name == "unique_id":
                                final_kwargs[param_name] = node_id
                            elif param_name == "prompt":
                                final_kwargs[param_name] = current_flow
                            elif param_name == "extra_pnginfo":
                                final_kwargs[param_name] = {}
                            
                            if param.kind == inspect.Parameter.VAR_KEYWORD:
                                for k, v in resolved_inputs.items():
                                    if k not in final_kwargs: final_kwargs[k] = v

                        output = func(**final_kwargs)
                        result_cache[node_id] = output
                        return output
                    except Exception as e:
                         raise Exception(f"节点 {node_id} ({class_type}) 执行失败: {str(e)}") from e

                exp_img, exp_any = None, None
                found = False
                for nid, ninfo in current_flow.items():
                    ctype = ninfo["class_type"]
                    if ctype == "ZML_SubflowExportImage":
                        found = True
                        link = ninfo["inputs"].get("图像")
                        if link:
                            res = get_node_result(link[0])
                            exp_img = res[link[1]] if isinstance(res, tuple) else res
                    elif ctype == "ZML_SubflowExportAny":
                        found = True
                        link = ninfo["inputs"].get("任意数据")
                        if link:
                            res = get_node_result(link[0])
                            exp_any = res[link[1]] if isinstance(res, tuple) else res
                
                if not found: return (None, None, "未找到导出节点")
                
                # 任务完成前清空节点缓存，释放内存
                result_cache.clear()
                
                return (exp_img, exp_any, "成功")

            except Exception as e:
                return (None, None, f"任务 {index+1} 执行失败: {str(e)}")

        # 如果关闭返回图像，完全不保存图像数据，只计数
        temp_images = [] if 返回图像 == "开启" else None
        final_anys = []
        status_lines = []
        
        # 使用队列按顺序处理结果
        from queue import Queue
        result_queue = Queue()
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=并行线程数) as executor:
            # 提交所有任务
            futures = {executor.submit(execute_single_workflow, i): i for i in range(执行次数)}
            
            # 按原始顺序收集结果（等待特定索引完成）
            completed_futures = {}
            next_expected = 0
            
            for future in concurrent.futures.as_completed(futures):
                idx = futures[future]
                try:
                    img, val, msg = future.result()
                except Exception as e:
                    img, val, msg = None, None, f"崩溃: {str(e)}"
                
                completed_futures[idx] = (img, val, msg)
                
                # 按顺序处理已完成的任务
                while next_expected in completed_futures:
                    r_img, r_val, r_msg = completed_futures.pop(next_expected)
                    
                    # 立即处理并释放
                    if r_msg == "成功":
                        status_lines.append(f"任务 {next_expected+1}: ✅")
                        if 控制台日志 == "开启":
                            print(f"[ZML] 任务 {next_expected+1}: 执行成功", flush=True)
                            sys.stdout.flush()
                        
                        # 只在需要时保存图像
                        if temp_images is not None and r_img is not None:
                            if len(r_img.shape) == 3:
                                r_img = r_img.unsqueeze(0)
                            temp_images.append(r_img)
                        
                        if r_val is not None:
                            final_anys.append(str(r_val))
                    else:
                        status_lines.append(f"任务 {next_expected+1}: ❌ {r_msg}")
                        if 控制台日志 == "开启":
                            print(f"[ZML] 任务 {next_expected+1}: 执行失败 - {r_msg}", flush=True)
                            sys.stdout.flush()
                    
                    next_expected += 1
        
        # 处理可能遗漏的（理论上不会有）
        while len(status_lines) < 执行次数:
            status_lines.append(f"任务 {len(status_lines)+1}: ❌ 丢失")
        
        # 执行完成后清理缓存
        if 执行完成后清理缓存:
            # 将图像移到CPU释放显存
            if temp_images is not None:
                for i in range(len(temp_images)):
                    if isinstance(temp_images[i], torch.Tensor) and temp_images[i].is_cuda:
                        temp_images[i] = temp_images[i].cpu()
            
            gc.collect()
            comfy.model_management.soft_empty_cache()
            
            if 控制台日志 == "开启":
                print(f"[ZML] 所有任务执行完成，已执行全面内存清理", flush=True)
                sys.stdout.flush()

        # 检查分辨率并决定输出格式 ---
        final_output_images = []
        if temp_images:
            first_shape = temp_images[0].shape  # [B, H, W, C]
            # 检查所有图像的 H(dim 1) 和 W(dim 2) 是否一致
            is_same_res = all(img.shape[1:3] == first_shape[1:3] for img in temp_images)
            
            if is_same_res and len(temp_images) > 1:
                # 分辨率一致：合并为 Batch [N, H, W, C]
                final_output_images = [torch.cat(temp_images, dim=0)]
                if 控制台日志 == "开启":
                    print(f"[ZML] 检测到一致分辨率，已自动合并为 Batch，大小: {final_output_images[0].shape}", flush=True)
            else:
                # 分辨率不一致或只有一张：输出 Image List
                final_output_images = temp_images
                if len(temp_images) > 1 and 控制台日志 == "开启":
                    print(f"[ZML] 检测到不同分辨率，将以图像列表(List)形式输出", flush=True)
        else:
            # 没有返回任何图像，输出单张1*1占位符
            final_output_images = [torch.zeros((1, 1, 1, 3))]
            if 控制台日志 == "开启":
                print(f"[ZML] 未返回图像，输出单张1*1占位符", flush=True)

        return (final_output_images, final_anys, "\n".join(status_lines))

class ZML_ParallelVariableBase:
    def merge_bundle(self, prev_bundle, key, data):
        new_bundle = copy.deepcopy(prev_bundle) if prev_bundle else {}
        new_bundle[key] = data
        return (new_bundle,)

class ZML_ParallelVariableText:
    @classmethod
    def INPUT_TYPES(s): return {"required": {"文本列表": ("STRING", {"multiline": True, "default": "提示词1\n提示词2"}), "占位符": ("STRING", {"default": "提示词"})}, "optional": {"输入变量包": ("VAR_BUNDLE",)}}
    RETURN_TYPES = ("VAR_BUNDLE",); RETURN_NAMES = ("输出变量包",); FUNCTION = "define_var"; CATEGORY = "image/ZML_图像/子工作流"
    def define_var(self, 文本列表, 占位符, 输入变量包=None):
        lines = [line.strip() for line in 文本列表.split('\n') if line.strip()]
        return ZML_ParallelVariableBase().merge_bundle(输入变量包, 占位符, {"type": "list", "values": lines})

class ZML_ParallelVariableInt:
    @classmethod
    def INPUT_TYPES(s): return {"required": {"起始值": ("INT", {"default": 0}), "步长": ("INT", {"default": 1}), "占位符": ("STRING", {"default": "整数"})}, "optional": {"输入变量包": ("VAR_BUNDLE",)}}
    RETURN_TYPES = ("VAR_BUNDLE",); RETURN_NAMES = ("输出变量包",); FUNCTION = "define_var"; CATEGORY = "image/ZML_图像/子工作流"
    def define_var(self, 起始值, 步长, 占位符, 输入变量包=None):
        return ZML_ParallelVariableBase().merge_bundle(输入变量包, 占位符, {"type": "math_int", "start": 起始值, "step": 步长})

class ZML_ParallelVariableFloat:
    @classmethod
    def INPUT_TYPES(s): return {"required": {"起始值": ("FLOAT", {"default": 0.0}), "步长": ("FLOAT", {"default": 0.1}), "占位符": ("STRING", {"default": "浮点"})}, "optional": {"输入变量包": ("VAR_BUNDLE",)}}
    RETURN_TYPES = ("VAR_BUNDLE",); RETURN_NAMES = ("输出变量包",); FUNCTION = "define_var"; CATEGORY = "image/ZML_图像/子工作流"
    def define_var(self, 起始值, 步长, 占位符, 输入变量包=None):
        return ZML_ParallelVariableBase().merge_bundle(输入变量包, 占位符, {"type": "math_float", "start": 起始值, "step": 步长})

class ZML_ParallelVariableSeed:
    @classmethod
    def INPUT_TYPES(s): return {"required": {"种子": ("INT", {"default": 0}), "模式": (["固定", "递增", "随机"],), "占位符": ("STRING", {"default": "随机种"})}, "optional": {"输入变量包": ("VAR_BUNDLE",)}}
    RETURN_TYPES = ("VAR_BUNDLE",); RETURN_NAMES = ("输出变量包",); FUNCTION = "define_var"; CATEGORY = "image/ZML_图像/子工作流"
    def define_var(self, 种子, 模式, 占位符, 输入变量包=None):
        return ZML_ParallelVariableBase().merge_bundle(输入变量包, 占位符, {"type": "seed", "start": 种子, "mode": 模式})

class ZML_ParallelVariableImageFolder:
    @classmethod
    def INPUT_TYPES(s): return {"required": {"文件夹路径": ("STRING", {"default": "C:\\"}), "占位符": ("STRING", {"default": "图像文件夹"})}, "optional": {"输入变量包": ("VAR_BUNDLE",)}}
    RETURN_TYPES = ("VAR_BUNDLE",); RETURN_NAMES = ("输出变量包",); FUNCTION = "define_var"; CATEGORY = "image/ZML_图像/子工作流"
    def define_var(self, 文件夹路径, 占位符, 输入变量包=None):
        files = []
        if os.path.exists(文件夹路径):
            for ext in ['*.jpg', '*.png', '*.webp', '*.jpeg']:
                files.extend(glob.glob(os.path.join(文件夹路径, ext)))
                files.extend(glob.glob(os.path.join(文件夹路径, ext.upper())))
        return ZML_ParallelVariableBase().merge_bundle(输入变量包, 占位符, {"type": "list", "values": sorted(list(set(files)))})

class ZML_ParallelVariableImage:
    @classmethod
    def INPUT_TYPES(s): return {"required": {"图像": ("IMAGE",), "占位符": ("STRING", {"default": "图像"})}, "optional": {"输入变量包": ("VAR_BUNDLE",)}}
    RETURN_TYPES = ("VAR_BUNDLE",); RETURN_NAMES = ("输出变量包",); FUNCTION = "define_var"; CATEGORY = "image/ZML_图像/子工作流"
    def define_var(self, 图像, 占位符, 输入变量包=None):
        return ZML_ParallelVariableBase().merge_bundle(输入变量包, 占位符, {"type": "list", "values": [图像]})

class ZML_ParallelVariableAny:
    @classmethod
    def INPUT_TYPES(s): return {"required": {"任意数据": (any_type, {"forceInput": True}), "占位符": ("STRING", {"default": "任意变量"})}, "optional": {"输入变量包": ("VAR_BUNDLE",)}}
    RETURN_TYPES = ("VAR_BUNDLE",); RETURN_NAMES = ("输出变量包",); FUNCTION = "define_var"; CATEGORY = "image/ZML_图像/子工作流"
    def define_var(self, 任意数据, 占位符, 输入变量包=None):
        return ZML_ParallelVariableBase().merge_bundle(输入变量包, 占位符, {"type": "list", "values": [任意数据]})

class ZML_SubflowExportImage:
    @classmethod
    def INPUT_TYPES(s): return {"required": {"图像": ("IMAGE",)}}
    RETURN_TYPES = (); OUTPUT_NODE = True; FUNCTION = "export"; CATEGORY = "image/ZML_图像/子工作流"
    def export(self, 图像): return {}

class ZML_SubflowExportAny:
    @classmethod
    def INPUT_TYPES(s): return {"required": {"任意数据": (any_type, {"forceInput": True})}}
    RETURN_TYPES = (); OUTPUT_NODE = True; FUNCTION = "export"; CATEGORY = "image/ZML_图像/子工作流"
    def export(self, 任意数据): return {}

from PIL import Image, ImageOps
import numpy as np

class ZML_SubflowLoadImage:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "图像": ("STRING", {"default": "{{图像}}"}), 
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    FUNCTION = "load_image"
    CATEGORY = "image/ZML_图像/子工作流"

    def load_image(self, 图像):
        # --- 核心逻辑：如果是已经加载好的张量，直接返回 ---
        if isinstance(图像, torch.Tensor):
            # 确保是 [B, H, W, C] 格式
            if len(图像.shape) == 3:
                图像 = 图像.unsqueeze(0)
            # 创建一个空白遮罩
            mask = torch.zeros((图像.shape[0], 图像.shape[1], 图像.shape[2]), dtype=torch.float32)
            return (图像, mask)

        # --- 如果是字符串，按照常规 LoadImage 逻辑加载 ---
        if isinstance(图像, str):
            # 处理 ComfyUI 的路径逻辑（这里简化处理，直接找 input 目录或绝对路径）
            from comfy.utils import common_upscale
            import folder_paths
            
            image_path = folder_paths.get_annotated_filepath(图像)
            if not os.path.exists(image_path):
                # 尝试直接作为绝对路径
                image_path = 图像
                
            img = Image.open(image_path)
            img = ImageOps.exif_transpose(img)
            image = img.convert("RGB")
            image = np.array(image).astype(np.float32) / 255.0
            image = torch.from_numpy(image)[None,]
            
            if 'A' in img.getbands():
                mask = np.array(img.getchannel('A')).astype(np.float32) / 255.0
                mask = 1. - torch.from_numpy(mask)
            else:
                mask = torch.zeros((64,64), dtype=torch.float32)
                
            return (image, mask)
            
        raise Exception(f"不支持的输入类型: {type(图像)}")

NODE_CLASS_MAPPINGS = {
    "ZML_SubflowExportImage": ZML_SubflowExportImage,
    "ZML_SubflowExportAny": ZML_SubflowExportAny,
    "ZML_ParallelJsonContainer": ZML_ParallelJsonContainer,
    "ZML_ParallelVariableText": ZML_ParallelVariableText,
    "ZML_ParallelVariableInt": ZML_ParallelVariableInt,
    "ZML_ParallelVariableFloat": ZML_ParallelVariableFloat,
    "ZML_ParallelVariableSeed": ZML_ParallelVariableSeed,
    "ZML_ParallelVariableImageFolder": ZML_ParallelVariableImageFolder,
    "ZML_ParallelVariableImage": ZML_ParallelVariableImage,
    "ZML_ParallelVariableAny": ZML_ParallelVariableAny,
    "ZML_SubflowLoadImage": ZML_SubflowLoadImage,
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
    "ZML_ParallelVariableImage": "ZML_变量_图像输入",
    "ZML_ParallelVariableAny": "ZML_变量_任意输入",
    "ZML_SubflowLoadImage": "ZML_智能加载图像 (子工作流)",
}