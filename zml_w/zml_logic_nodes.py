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
                "索引": ("INT", {"default": 1, "min": 1, "max": 5, "step": 1, "description": "1-5=选择对应的输入值"}),
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
        """根据布尔值决定哪个输出端口有效"""
        # 导入ExecutionBlocker用于阻止未使用的输出执行
        from comfy_execution.graph import ExecutionBlocker
        
        # 根据布尔值决定输出
        if 选择输出:
            # 布尔值为True时，输出1阻止执行，输出2有效
            output1 = ExecutionBlocker(None)
            output2 = 输入
        else:
            # 布尔值为False时，输出1有效，输出2阻止执行
            output1 = 输入
            output2 = ExecutionBlocker(None)
        
        return (output1, output2)

# 节点注册
NODE_CLASS_MAPPINGS = {
    "ZML_BooleanInverter": ZML_BooleanInverter,
    "ZML_RelativeComparison": ZML_RelativeComparison,
    "ZML_AnyTypeSwitch": ZML_AnyTypeSwitch,
    "ZML_AnyTypeSwitchFive": ZML_AnyTypeSwitchFive,
    "ZML_SwitchOutput": ZML_SwitchOutput,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ZML_BooleanInverter": "ZML_布尔反转",
    "ZML_RelativeComparison": "ZML_相等判断",
    "ZML_AnyTypeSwitch": "ZML_任意切换",
    "ZML_AnyTypeSwitchFive": "ZML_任意切换_五",
    "ZML_SwitchOutput": "ZML_切换输出",
}