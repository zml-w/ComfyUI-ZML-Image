# 导入PyTorch以支持张量操作
import torch

# ============================== AnyType HACK ==============================
# 实现可以匹配任意类型的代理类
class AlwaysEqualProxy(str):
    def __eq__(self, _):
        return True

    def __ne__(self, _):
        return False

# 创建一个 AlwaysEqualProxy 的实例，其值为通配符"*"
any_type = AlwaysEqualProxy("*")
# =====================================================================================

# ============================== 布尔反转节点 ==============================
class ZML_BooleanInverter:
    """
    ZML 布尔反转节点
    将输入的布尔值取反并输出
    True -> False
    False -> True
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "布尔值": ("BOOLEAN", {"default": False}),
            }
        }
    
    CATEGORY = "image/ZML_图像/逻辑"
    RETURN_TYPES = ("BOOLEAN",)
    RETURN_NAMES = ("反转后布尔值",)
    FUNCTION = "invert_boolean"
    
    def invert_boolean(self, 布尔值):
        """将输入的布尔值取反"""
        # 返回取反后的布尔值
        return (not 布尔值,)

# ============================== 相等判断节点 ==============================
class ZML_RelativeComparison:
    """
    ZML 相等判断节点
    设定目标A，BCDE和A比较，和A相等的就+1，最终输出一个整数（从0开始计数）
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "目标A": (any_type, {}),
            },
            "optional": {
                "比较对象B": (any_type, {}),
                "比较对象C": (any_type, {}),
                "比较对象D": (any_type, {}),
                "比较对象E": (any_type, {}),
            }
        }
    
    CATEGORY = "image/ZML_图像/逻辑"
    RETURN_TYPES = ("INT", any_type)
    RETURN_NAMES = ("相等数量", "任意输出")
    FUNCTION = "compare_values"
    
    def compare_values(self, 目标A, 比较对象B=None, 比较对象C=None, 比较对象D=None, 比较对象E=None):
        """比较多个对象与目标A的相等性并计数"""
        count = 0
        
        # 比较各个对象与目标A是否相等
        for obj in [比较对象B, 比较对象C, 比较对象D, 比较对象E]:
            if obj is not None:
                # 处理PyTorch张量的情况
                if isinstance(obj, torch.Tensor) and isinstance(目标A, torch.Tensor):
                    # 检查形状是否相同
                    if obj.shape == 目标A.shape:
                        # 使用equal方法比较两个张量是否完全相等
                        if torch.equal(obj, 目标A):
                            count += 1
                # 处理其他类型
                else:
                    try:
                        if obj == 目标A:
                            count += 1
                    except Exception:
                        # 如果比较失败（例如不同类型之间的比较），则视为不相等
                        pass
        
        # 返回相等数量和目标A作为任意输出
        return (count, 目标A)

# 定义惰性执行选项
lazy_options = {
    "lazy": True
}

# ============================== 任意切换节点 ==============================
class ZML_AnyTypeSwitch:
    """
    ZML 任意切换节点
    输入任意两个值，根据布尔值选中输出哪一个
    布尔值为False时输出第一个值，布尔值为True时输出第二个值
    输入值都是可选的，未提供时不会报错
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "optional": {
                "输入值1": (any_type, lazy_options),
                "输入值2": (any_type, lazy_options),
            },
            "required": {
                "判断": ("BOOLEAN", {"default": False, "label_on": "选择输入值2", "label_off": "选择输入值1"}),
            }
        }
    
    CATEGORY = "image/ZML_图像/逻辑"
    RETURN_TYPES = (any_type,)
    RETURN_NAMES = ("选择的输出",)
    FUNCTION = "switch_between_values"
    
    def check_lazy_status(self, 判断, **kwargs):
        """告诉系统只需要哪个输入值"""
        # 检查所有输入是否都不存在
        if "输入值1" not in kwargs and "输入值2" not in kwargs:
            return None
            
        # 只返回需要的输入键，但只有当该输入存在时才返回
        if 判断 and "输入值2" in kwargs:
            return ["输入值2"]
        elif "输入值1" in kwargs:
            return ["输入值1"]
        # 如果请求的输入不存在但另一个存在，则返回另一个
        elif "输入值2" in kwargs:
            return ["输入值2"]
        else:
            return None
    
    def switch_between_values(self, 输入值1=None, 输入值2=None, 判断=False):
        """根据布尔值在两个输入值之间进行切换"""
        # 根据布尔值选择输出哪个值
        # True 选择输入值2，False 选择输入值1
        if 判断 and 输入值2 is not None:
            return (输入值2,)
        elif 输入值1 is not None:
            return (输入值1,)
        else:
            # 如果请求的输入值不存在，则默认返回None
            return (None,)

# ============================== 任意切换_五节点 ==============================
class ZML_AnyTypeSwitchFive:
    """
    ZML 任意切换_五节点
    输入任意五个值，根据索引值选中输出哪一个
    索引值为1时输出第一个值，索引值为2时输出第二个值，以此类推
    输入值都是可选的，未提供时不会报错
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "optional": {
                "输入值1": (any_type, lazy_options),
                "输入值2": (any_type, lazy_options),
                "输入值3": (any_type, lazy_options),
                "输入值4": (any_type, lazy_options),
                "输入值5": (any_type, lazy_options),
            },
            "required": {
                "索引": ("INT", {"default": 1, "min": 1, "max": 5, "step": 1, "description": "1-5=选择对应的输入值", "tooltip": "从索引值开始查找，索引值没有输入则递增寻找其它输入"}),
            }
        }
    
    CATEGORY = "image/ZML_图像/逻辑"
    RETURN_TYPES = (any_type,)
    RETURN_NAMES = ("选择的输出",)
    FUNCTION = "switch_between_values"
    
    def check_lazy_status(self, 索引, **kwargs):
        """告诉系统只需要哪个输入值"""
        # 检查所有输入是否都不存在
        all_inputs = [f"输入值{i}" for i in range(1, 6)]
        if all(input not in kwargs for input in all_inputs):
            return None
            
        # 根据索引返回需要的输入键，但只有当该输入存在时才返回
        requested_input = f"输入值{索引}"
        if 1 <= 索引 <= 5 and requested_input in kwargs:
            return [requested_input]
        
        # 如果请求的输入不存在，则返回第一个存在的输入
        for input_key in all_inputs:
            if input_key in kwargs:
                return [input_key]
                
        return None
    
    def switch_between_values(self, 输入值1=None, 输入值2=None, 输入值3=None, 输入值4=None, 输入值5=None, 索引=1):
        """根据索引值在五个输入值之间进行切换"""
        # 根据索引值选择输出哪个值
        if 索引 == 1 and 输入值1 is not None:
            return (输入值1,)
        elif 索引 == 2 and 输入值2 is not None:
            return (输入值2,)
        elif 索引 == 3 and 输入值3 is not None:
            return (输入值3,)
        elif 索引 == 4 and 输入值4 is not None:
            return (输入值4,)
        elif 索引 == 5 and 输入值5 is not None:
            return (输入值5,)
        else:
            # 如果请求的输入值不存在，则按顺序尝试返回其他存在的值
            for val in [输入值1, 输入值2, 输入值3, 输入值4, 输入值5]:
                if val is not None:
                    return (val,)
            # 如果所有值都不存在，则返回None
            return (None,)

# ============================== 切换输出节点 ==============================
class ZML_SwitchOutput:
    """
    ZML 切换输出节点
    输入一个任意类型的值，根据布尔值选择从哪个输出端口输出
    布尔值为False时，只有输出1有效，输出2不会执行下游节点
    布尔值为True时，只有输出2有效，输出1不会执行下游节点
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "输入": (any_type, {}),
                "选择输出": ("BOOLEAN", {"default": False, "label_on": "输出2", "label_off": "输出1"}),
            }
        }
    
    CATEGORY = "image/ZML_图像/逻辑"
    RETURN_TYPES = (any_type, any_type)
    RETURN_NAMES = ("输出1", "输出2")
    FUNCTION = "switch_output"
    OUTPUT_NODE = True  # 标记为输出节点，用于控制执行流程
    
    def switch_output(self, 输入, 选择输出=False):
        """根据布尔值决定哪个输出端口有效。对于整数和文本类型，未选中的端口返回空值而不是阻止执行"""
        # 导入ExecutionBlocker用于阻止未使用的输出执行
        from comfy_execution.graph import ExecutionBlocker
        
        # 判断输入类型是否为整数或文本
        is_int_or_text = isinstance(输入, (int, str))
        
        # 根据布尔值决定输出
        if 选择输出:
            # 布尔值为True时，输出2有效
            if is_int_or_text:
                # 对于整数和文本类型，未选中的端口返回空值
                output1 = "" if isinstance(输入, str) else 0  # 文本返回空字符串，整数返回0
            else:
                # 其他类型使用ExecutionBlocker阻止执行
                output1 = ExecutionBlocker(None)
            output2 = 输入
        else:
            # 布尔值为False时，输出1有效
            output1 = 输入
            if is_int_or_text:
                # 对于整数和文本类型，未选中的端口返回空值
                output2 = "" if isinstance(输入, str) else 0  # 文本返回空字符串，整数返回0
            else:
                # 其他类型使用ExecutionBlocker阻止执行
                output2 = ExecutionBlocker(None)
        
        return (output1, output2)

# ============================== 任意开关-五节点 ==============================
class ZML_AnyTypeSwitchFiveBoolean:
    """
    ZML 任意开关-五节点
    输入任意五个值，根据五个布尔开关的状态决定是否将对应的输入传递到对应的输出
    每个布尔开关为True时，对应的输入值将传递到对应的输出端口
    输入值都是可选的，未提供时不会报错
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "optional": {
                "输入1": (any_type, lazy_options),
                "输入2": (any_type, lazy_options),
                "输入3": (any_type, lazy_options),
                "输入4": (any_type, lazy_options),
                "输入5": (any_type, lazy_options),
            },
            "required": {
                "开关1": ("BOOLEAN", {"default": True, "label_on": "开", "label_off": "关"}),
                "开关2": ("BOOLEAN", {"default": False, "label_on": "开", "label_off": "关"}),
                "开关3": ("BOOLEAN", {"default": False, "label_on": "开", "label_off": "关"}),
                "开关4": ("BOOLEAN", {"default": False, "label_on": "开", "label_off": "关"}),
                "开关5": ("BOOLEAN", {"default": False, "label_on": "开", "label_off": "关"}),
            }
        }
    
    CATEGORY = "image/ZML_图像/逻辑"
    RETURN_TYPES = (any_type, any_type, any_type, any_type, any_type)
    RETURN_NAMES = ("输出1", "输出2", "输出3", "输出4", "输出5")
    FUNCTION = "switch_outputs"
    OUTPUT_NODE = True  # 标记为输出节点，用于控制执行流程
    
    def check_lazy_status(self, **kwargs):
        """告诉系统只需要哪些输入值"""
        # 检查哪些开关是开启的
        active_inputs = []
        for i in range(1, 6):
            switch_key = f"开关{i}"
            input_key = f"输入{i}"
            # 如果开关开启且输入存在，则需要该输入
            if switch_key in kwargs and kwargs[switch_key] and input_key in kwargs:
                active_inputs.append(input_key)
        
        return active_inputs if active_inputs else None
    
    def switch_outputs(self, 输入1=None, 输入2=None, 输入3=None, 输入4=None, 输入5=None,
                      开关1=True, 开关2=False, 开关3=False, 开关4=False, 开关5=False):
        """根据五个布尔开关的状态决定是否将对应的输入传递到对应的输出"""
        # 导入ExecutionBlocker用于阻止未使用的输出执行
        from comfy_execution.graph import ExecutionBlocker
        
        # 根据每个开关的状态决定对应的输出
        outputs = []
        inputs = [输入1, 输入2, 输入3, 输入4, 输入5]
        switches = [开关1, 开关2, 开关3, 开关4, 开关5]
        
        for i in range(5):
            if switches[i] and inputs[i] is not None:
                outputs.append(inputs[i])
            else:
                outputs.append(ExecutionBlocker(None))
        
        return tuple(outputs)

# ============================== 切换输出-五节点 ==============================
class ZML_SwitchOutputFive:
    """
    ZML 切换输出-五节点
    输入一个任意类型的值，根据索引值选择从哪个输出端口输出
    索引值为1时，只有输出1有效，其他输出不会执行下游节点
    索引值为2时，只有输出2有效，其他输出不会执行下游节点
    以此类推，索引值范围为1-5
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "输入": (any_type, {}),
                "索引": ("INT", {"default": 1, "min": 1, "max": 5, "step": 1, "description": "1-5=选择对应的输出端口"}),
            }
        }
    
    CATEGORY = "image/ZML_图像/逻辑"
    RETURN_TYPES = (any_type, any_type, any_type, any_type, any_type)
    RETURN_NAMES = ("输出1", "输出2", "输出3", "输出4", "输出5")
    FUNCTION = "switch_output"
    OUTPUT_NODE = True  # 标记为输出节点，用于控制执行流程
    
    def switch_output(self, 输入, 索引=1):
        """根据索引值决定哪个输出端口有效。对于整数和文本类型，未选中的端口返回空值而不是阻止执行"""
        # 导入ExecutionBlocker用于阻止未使用的输出执行
        from comfy_execution.graph import ExecutionBlocker
        
        # 判断输入类型是否为整数或文本
        is_int_or_text = isinstance(输入, (int, str))
        
        # 确保索引在有效范围内
        if not 1 <= 索引 <= 5:
            索引 = 1  # 默认为1
        
        # 初始化所有输出
        outputs = []
        for i in range(5):
            if i == 索引 - 1:
                # 选中的端口输出原始输入值
                outputs.append(输入)
            elif is_int_or_text:
                # 对于整数和文本类型，未选中的端口返回空值
                outputs.append("") if isinstance(输入, str) else outputs.append(0)
            else:
                # 其他类型使用ExecutionBlocker阻止执行
                outputs.append(ExecutionBlocker(None))
        
        return tuple(outputs)

# ============================== 下游节点开关 ==============================
class ZML_DownstreamNodeSwitch:
    """
    ZML 下游节点开关
    根据计数值控制下游节点的执行
    计数值为n时，需要运行n次节点才会执行下游节点
    输出当前执行次数作为计数
    """
    
    # 使用静态变量存储计数器
    _execution_count = 0
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "任意输入": (any_type, {}),
                "计数": ("INT", {"default": 1, "min": 1, "max": 10, "step": 1, "description": "妹妹"}),
            }
        }
    
    CATEGORY = "image/ZML_图像/逻辑"
    RETURN_TYPES = (any_type, "INT")
    RETURN_NAMES = ("任意输出", "当前计数")
    FUNCTION = "control_execution"
    OUTPUT_NODE = True  # 标记为输出节点，用于控制执行流程
    
    def control_execution(self, 任意输入, 计数=0):
        """根据计数值和当前执行次数控制下游节点的执行"""
        # 导入ExecutionBlocker用于阻止未使用的输出执行
        from comfy_execution.graph import ExecutionBlocker
        
        # 确保计数是非负整数
        计数 = max(0, 计数)
        
        # 更新执行计数器
        ZML_DownstreamNodeSwitch._execution_count += 1
        current_count = ZML_DownstreamNodeSwitch._execution_count
        
        # 判断是否执行下游节点
        if 计数 == 0:
            # 计数为0时，始终执行下游节点
            output = 任意输入
        else:
            # 计数为n时，当前执行次数等于计数时执行下游节点
            if current_count == 计数:
                output = 任意输入
                # 执行后重置计数器
                ZML_DownstreamNodeSwitch._execution_count = 0
            else:
                output = ExecutionBlocker(None)
        
        return (output, current_count)

# ============================== 运算判断节点 ==============================
class ZML_ArithmeticComparison:
    """
    ZML 运算判断节点
    只有当判断条件满足（A>B、A<B、A=B）时，才执行下游节点
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "任意输入": (any_type, {}),
                "A": (any_type, {}),
                "B": (any_type, {}),
                "判断条件": (["A大于B", "A小于B", "A等于B"], {"default": "A大于B"}),
            }
        }

    CATEGORY = "image/ZML_图像/逻辑"
    RETURN_TYPES = (any_type, "BOOLEAN")
    RETURN_NAMES = ("任意输出", "判断结果")
    FUNCTION = "evaluate_and_gate"
    OUTPUT_NODE = True  # 标记为输出节点，用于控制执行流程

    def evaluate_and_gate(self, 任意输入, A, B, 判断条件="A大于B"):
        # 导入ExecutionBlocker用于阻止未满足条件时的输出执行
        from comfy_execution.graph import ExecutionBlocker

        def extract_resolution(x):
            """尝试从输入中提取图像分辨率(宽, 高)。支持torch.Tensor或list/tuple中的tensor。
            ComfyUI的IMAGE通常是BHWC，即[批次, 高, 宽, 通道]。"""
            try:
                # 如果是list/tuple，优先取其中的第一个tensor
                if isinstance(x, (list, tuple)) and len(x) > 0:
                    t = next((item for item in x if isinstance(item, torch.Tensor)), None)
                    x = t if t is not None else x
                
                # 直接是tensor的情况
                if isinstance(x, torch.Tensor):
                    dims = x.dim()
                    if dims == 4:  # [B, H, W, C]
                        h = int(x.shape[1])
                        w = int(x.shape[2])
                        return (w, h)
                    elif dims == 3:  # [H, W, C]
                        h = int(x.shape[0])
                        w = int(x.shape[1])
                        return (w, h)
                    elif dims == 2:  # [H, W]
                        h = int(x.shape[0])
                        w = int(x.shape[1])
                        return (w, h)
            except Exception:
                return None
            return None

        result = False
        try:
            resA = extract_resolution(A)
            resB = extract_resolution(B)

            if resA is not None and resB is not None:
                # 基于分辨率判断：等于=宽高都相等；大于/小于=按像素总数(面积)比较
                if 判断条件 == "A等于B":
                    result = (resA[0] == resB[0] and resA[1] == resB[1])
                elif 判断条件 == "A大于B":
                    result = (resA[0] * resA[1] > resB[0] * resB[1])
                elif 判断条件 == "A小于B":
                    result = (resA[0] * resA[1] < resB[0] * resB[1])
            else:
                # 非图像或无法解析分辨率，回退到常规比较逻辑
                if isinstance(A, torch.Tensor) and isinstance(B, torch.Tensor):
                    # 逐元素比较：只有在形状相同时判断
                    if A.shape == B.shape:
                        if 判断条件 == "A等于B":
                            result = torch.equal(A, B)
                        elif 判断条件 == "A大于B":
                            result = bool(torch.all(A > B))
                        elif 判断条件 == "A小于B":
                            result = bool(torch.all(A < B))
                    else:
                        # 形状不同，等于为False；> / < 无法逐元素成立，保持False
                        result = False
                else:
                    # 处理其他可比较类型
                    if 判断条件 == "A等于B":
                        result = (A == B)
                    elif 判断条件 == "A大于B":
                        result = (A > B)
                    elif 判断条件 == "A小于B":
                        result = (A < B)
        except Exception:
            # 比较失败时，认为条件不成立
            result = False

        # 条件成立则透传输入，否则阻断下游执行
        output = 任意输入 if result else ExecutionBlocker(None)
        return (output, result)

# ============================== 双布尔节点 ==============================
class ZML_DualBoolean:
    """
    ZML 双布尔节点
    提供两个独立的布尔开关，可以分别控制不同的功能
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "A": ("BOOLEAN", {"default": False, "label_on": "True", "label_off": "False"}),
                "B": ("BOOLEAN", {"default": False, "label_on": "True", "label_off": "False"}),
            }
        }
    
    CATEGORY = "image/ZML_图像/逻辑"
    RETURN_TYPES = ("BOOLEAN", "BOOLEAN")
    RETURN_NAMES = ("Boole", "Boole")
    FUNCTION = "output_booleans"
    
    def output_booleans(self, A, B):
        """输出两个布尔值"""
        return (A, B)


# 节点注册
NODE_CLASS_MAPPINGS = {
    "ZML_BooleanInverter": ZML_BooleanInverter,
    "ZML_RelativeComparison": ZML_RelativeComparison,
    "ZML_AnyTypeSwitch": ZML_AnyTypeSwitch,
    "ZML_AnyTypeSwitchFive": ZML_AnyTypeSwitchFive,
    "ZML_SwitchOutput": ZML_SwitchOutput,
    "ZML_AnyTypeSwitchFiveBoolean": ZML_AnyTypeSwitchFiveBoolean,
    "ZML_SwitchOutputFive": ZML_SwitchOutputFive,
    "ZML_DownstreamNodeSwitch": ZML_DownstreamNodeSwitch,
    "ZML_ArithmeticComparison": ZML_ArithmeticComparison,
    "ZML_DualBoolean": ZML_DualBoolean,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_BooleanInverter": "ZML_布尔反转",
    "ZML_RelativeComparison": "ZML_相等判断",
    "ZML_AnyTypeSwitch": "ZML_任意切换",
    "ZML_AnyTypeSwitchFive": "ZML_任意切换_五",
    "ZML_SwitchOutput": "ZML_切换输出",
    "ZML_AnyTypeSwitchFiveBoolean": "ZML_任意开关-五",
    "ZML_SwitchOutputFive": "ZML_切换输出-五",
    "ZML_DownstreamNodeSwitch": "ZML_下游节点开关",
    "ZML_ArithmeticComparison": "ZML_运算判断",
    "ZML_DualBoolean": "ZML_双布尔开关",
}