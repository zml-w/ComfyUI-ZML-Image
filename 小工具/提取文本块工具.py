# 提取文本块工具.py

import sys
import os
from PIL import Image
import pyperclip
import tkinter as tk
from tkinter import filedialog

# -------------------- 配置 --------------------
# ZML节点用于存储文本块的特定键名
TEXT_BLOCK_KEY = "comfy_text_block"

# 处理文件夹模式下，存放提取出的txt文件的子文件夹名称
OUTPUT_SUBFOLDER = "文本块提取"

# 支持的图片文件扩展名
SUPPORTED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.webp']
# ----------------------------------------------


def handle_drag_and_drop(filepaths):
    """
    处理拖拽至脚本的单个或多个文件。
    将第一个有效图片的文本块复制到剪贴板。
    """
    print("模式: [拖拽处理模式]")
    print(f"检测到 {len(filepaths)} 个文件...\n" + "="*30)

    found_text_and_copied = False
    for i, filepath in enumerate(filepaths, 1):
        print(f"[{i}] 正在处理: {os.path.basename(filepath)}")
        
        if not os.path.isfile(filepath):
            print("   -> ❌ 错误: 这不是一个有效的文件路径。\n")
            continue

        try:
            with Image.open(filepath) as img:
                if img.info and TEXT_BLOCK_KEY in img.info:
                    content = img.info[TEXT_BLOCK_KEY]
                    
                    if not found_text_and_copied:
                        pyperclip.copy(content)
                        print("   -> ✅ 成功！文本内容已复制到剪贴板。")
                        found_text_and_copied = True
                    else:
                        print("   -> ✅ 找到文本 (剪贴板已有内容，未覆盖)。")
                    print("") # 换行
                else:
                    print("   -> ℹ️ 未在此图中找到可提取的文本块。\n")
        except Exception as e:
            print(f"   -> ❌ 处理图片时出错: {e}\n")

    print("="*30)
    if not found_text_and_copied:
        print("在所有拖拽的文件中均未找到可提取的文本块。")
    else:
        print("处理完成。")


def handle_folder_selection():
    """
    处理双击脚本时弹出的文件夹选择。
    提取文件夹内所有图片的文本块并保存为txt文件。
    """
    print("模式: [文件夹处理模式]")
    
    # 弹出文件夹选择对话框
    folder_path = filedialog.askdirectory(
        title="请选择一个图像文件夹 (提示: 拖拽图片至脚本可处理单图)"
    )

    if not folder_path:
        print("您没有选择文件夹，脚本已退出。")
        return

    print(f"已选择文件夹: {folder_path}")
    
    # 扫描文件夹内的图片
    image_files = [f for f in os.listdir(folder_path) 
                   if os.path.splitext(f)[1].lower() in SUPPORTED_EXTENSIONS]

    if not image_files:
        print("此文件夹中未找到支持的图片文件。")
        return
        
    print(f"找到 {len(image_files)} 个图片文件。")
    
    # 请求用户二次确认
    try:
        confirm = input("即将开始提取文本块并保存为txt文件，是否继续? (输入 y 表示同意): ").lower()
    except (EOFError, KeyboardInterrupt):
        print("\n操作已取消。")
        return

    if confirm != 'y':
        print("操作已取消。")
        return

    # 创建输出子文件夹
    output_dir = os.path.join(folder_path, OUTPUT_SUBFOLDER)
    os.makedirs(output_dir, exist_ok=True)
    print(f"提取的文本将保存在: {output_dir}\n" + "="*30)
    
    success_count = 0
    failure_count = 0

    # 遍历并处理每个图片
    for filename in image_files:
        filepath = os.path.join(folder_path, filename)
        try:
            with Image.open(filepath) as img:
                if img.info and TEXT_BLOCK_KEY in img.info:
                    content = img.info[TEXT_BLOCK_KEY]
                    
                    # 构建txt文件名并保存
                    txt_filename = os.path.splitext(filename)[0] + ".txt"
                    txt_filepath = os.path.join(output_dir, txt_filename)
                    
                    with open(txt_filepath, 'w', encoding='utf-8') as f:
                        f.write(content)
                    
                    print(f"✅ 成功: {filename} -> {txt_filename}")
                    success_count += 1
                # 如果图片没有文本块，则静默跳过，不提示
        except Exception as e:
            print(f"❌ 失败: 处理 {filename} 时出错 - {e}")
            failure_count += 1
            
    print("="*30)
    print("处理完毕！")
    print(f"成功提取: {success_count} 个文件")
    if failure_count > 0:
        print(f"处理失败: {failure_count} 个文件")


def main():
    """
    脚本主入口，根据启动方式判断执行哪个模式。
    """
    # 隐藏Tkinter的根窗口
    root = tk.Tk()
    root.withdraw()

    # len(sys.argv) > 1 表示有文件被拖拽到脚本上
    if len(sys.argv) > 1:
        handle_drag_and_drop(sys.argv[1:])
    else:
        # len(sys.argv) == 1 表示是双击运行脚本
        handle_folder_selection()

    # 暂停脚本，方便用户查看结果
    print("\n按 Enter 键退出...")
    input()


if __name__ == "__main__":
    main()