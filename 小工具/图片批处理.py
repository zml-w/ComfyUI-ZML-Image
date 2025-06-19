import os
import shutil
import sys

# 公共配置
image_extensions = {'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff'}
predefined_folder = None  # 存储拖拽传入的路径

# 处理命令行参数（拖拽文件夹时传入）
if len(sys.argv) > 1:
    arg_path = sys.argv[1]
    if os.path.isdir(arg_path):
        predefined_folder = os.path.abspath(arg_path)
        print(f"\n检测到拖拽的文件夹路径：{predefined_folder}")
    else:
        print(f"\n警告：传入路径 '{arg_path}' 不是有效文件夹，将按正常模式运行")

def show_menu():
    """显示功能菜单"""
    print("\n" + "="*30)
    print("图片批处理工具")
    print("1. 重命名文件夹内的图片和同名TXT文件")
    print("2. 为图片创建同名TXT文件")
    print("3. 修改TXT文件内容")
    print("4. 删除所有TXT文件")
    print("5. 备份TXT文件")
    print("6. 筛选非训练集文件")
    print("7. 退出程序")
    print("="*30)

def get_folder_path():
    """获取文件夹路径（优先使用拖拽路径）"""
    global predefined_folder
    if predefined_folder:
        print(f"\n自动使用拖拽路径：{predefined_folder}")
        return predefined_folder
    else:
        while True:
            path = input("\n请输入文件夹路径：").strip()
            if os.path.isdir(path):
                return os.path.abspath(path)
            print("错误：路径无效，请重新输入！")

def validate_folder(folder):
    """验证文件夹有效性"""
    global predefined_folder
    if not os.path.isdir(folder):
        print("错误：路径无效！")
        if predefined_folder:  # 清除无效的预定义路径
            print("预定义路径无效，已清除")
            predefined_folder = None
        return False
    return True

def rename_images_and_txt():
    """功能1：批量重命名图片及同名TXT文件（修改版）"""
    folder = get_folder_path()
    if not validate_folder(folder):
        return

    # 获取前缀并去除前后空格
    prefix = input("请输入文件名前缀（直接回车表示无前缀）：").strip()
    
    # 处理起始编号输入
    start_input = input("起始编号（默认1）：").strip()
    try:
        start = int(start_input) if start_input else 1
    except ValueError:
        print("输入无效，将使用默认值1")
        start = 1

    images = sorted(
        [f for f in os.listdir(folder) 
         if os.path.isfile(os.path.join(folder, f)) 
         and f.split('.')[-1].lower() in image_extensions],
        key=lambda x: os.path.getmtime(os.path.join(folder, x))
    )

    txt_pairs = {}
    for img in images:
        base = os.path.splitext(img)[0]
        txt_file = os.path.join(folder, f"{base}.txt")
        if os.path.exists(txt_file):
            txt_pairs[img] = txt_file

    if txt_pairs:
        print(f"\n发现{len(txt_pairs)}个关联TXT文件")
        confirm = input("同时重命名关联TXT文件？(y/n)：").lower()
        rename_txt = confirm == 'y'
    else:
        rename_txt = False

    counter = start
    success = 0
    for img in images:
        old_base = os.path.splitext(img)[0]
        ext = img.split('.')[-1]
        
        # 新文件名生成逻辑
        if prefix:
            new_base = f"{prefix}_{counter}"
        else:
            new_base = f"{counter}"
        
        img_src = os.path.join(folder, img)
        img_dst = os.path.join(folder, f"{new_base}.{ext}")
        txt_dst = os.path.join(folder, f"{new_base}.txt")

        if os.path.exists(img_dst) or (rename_txt and os.path.exists(txt_dst)):
            print(f"冲突跳过：{new_base}.*")
            continue

        try:
            os.rename(img_src, img_dst)
            print(f"图片重命名：{img} → {new_base}.{ext}")
            success += 1

            if rename_txt and img in txt_pairs:
                os.rename(txt_pairs[img], txt_dst)
                print(f"TXT重命名：{old_base}.txt → {new_base}.txt")

            counter += 1
        except Exception as e:
            print(f"操作失败：{str(e)}")
            # 回滚已修改的文件
            if os.path.exists(img_dst):
                os.rename(img_dst, img_src)
            if rename_txt and os.path.exists(txt_dst):
                os.rename(txt_dst, txt_pairs[img])

    print(f"\n操作完成：成功处理 {success} 个文件")

def create_txt_files():
    """功能2：创建同名TXT文件"""
    folder = get_folder_path()
    if not validate_folder(folder):
        return

    images = []
    for root, _, files in os.walk(folder):
        for f in files:
            if f.split('.')[-1].lower() in image_extensions:
                images.append(os.path.join(root, f))

    created = 0
    for img_path in images:
        base = os.path.splitext(img_path)[0]
        txt_path = f"{base}.txt"
        
        if not os.path.exists(txt_path):
            try:
                with open(txt_path, 'w') as f:
                    f.write('')
                print(f"创建：{os.path.basename(txt_path)}")
                created += 1
            except Exception as e:
                print(f"创建失败：{str(e)}")
        else:
            print(f"已存在：{os.path.basename(txt_path)}")

    print(f"\n共创建 {created} 个TXT文件")

def modify_txt_contents():
    """功能3：智能修改TXT文件内容"""
    folder = get_folder_path()
    if not validate_folder(folder):
        return
    
    txt_files = []
    all_empty = True
    for root, _, files in os.walk(folder):
        for f in files:
            if f.lower().endswith('.txt'):
                filepath = os.path.join(root, f)
                try:
                    with open(filepath, 'r', encoding='utf-8') as file:
                        content = file.read().strip()
                        is_empty = len(content) == 0
                        txt_files.append((filepath, f, is_empty))
                        if not is_empty:
                            all_empty = False
                except Exception as e:
                    print(f"扫描失败：{f} - {str(e)}")
                    continue

    if not txt_files:
        print("文件夹内没有TXT文件")
        return

    print(f"\n扫描到 {len(txt_files)} 个TXT文件")
    print(f"所有文件均为空白：{'是' if all_empty else '否'}")

    if all_empty:
        confirm = input("是否添加内容？(y/n)：").lower()
        if confirm != 'y':
            return
        content = input("请输入要添加的内容：").strip()
        mode = 'add'
    else:
        print("\n请选择操作：")
        print("1. 覆盖所有内容")
        print("2. 追加内容")
        print("3. 添加末尾逗号")
        print("4. 取消操作")
        choice = input("请输入选项 (1-4)：").strip()
        
        if choice == '1':
            content = input("请输入替换内容：").strip()
            mode = 'replace'
        elif choice == '2':
            content = input("请输入追加内容：").strip()
            mode = 'append'
        elif choice == '3':
            mode = 'comma'
        else:
            return

    modified = 0
    errors = 0

    for filepath, filename, is_empty in txt_files:
        try:
            if mode == 'replace':
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(content)
                print(f"[覆盖] {filename}")
                modified += 1
            elif mode == 'append':
                with open(filepath, 'a', encoding='utf-8') as f:
                    f.write(content)
                print(f"[追加] {filename}")
                modified += 1
            elif mode == 'add':
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(content)
                print(f"[添加] {filename}")
                modified += 1
            elif mode == 'comma':
                with open(filepath, 'r+', encoding='utf-8') as f:
                    content = f.read()
                    if content and not content.endswith(','):
                        f.seek(0, 2)
                        f.write(',')
                        print(f"[加逗号] {filename}")
                        modified += 1
                    else:
                        print(f"[无需修改] {filename}")
        except Exception as e:
            print(f"操作失败：{filename} - {str(e)}")
            errors += 1

    print(f"\n操作完成：成功 {modified} 个，失败 {errors} 个")

def remove_txt_files():
    """功能4：删除所有TXT文件"""
    folder = get_folder_path()
    if not validate_folder(folder):
        return

    confirm = input("确定删除所有TXT文件？(y/n)：").lower()
    if confirm != 'y':
        print("操作已取消")
        return

    deleted = 0
    errors = 0
    for root, _, files in os.walk(folder):
        for f in files:
            if f.lower().endswith('.txt'):
                try:
                    os.remove(os.path.join(root, f))
                    print(f"已删除：{os.path.relpath(os.path.join(root, f), folder)}")
                    deleted += 1
                except Exception as e:
                    print(f"删除失败：{f} - {str(e)}")
                    errors += 1

    print(f"\n共删除 {deleted} 个文件，失败 {errors} 个")

def backup_txt_files():
    """功能5：备份TXT文件"""
    folder = get_folder_path()
    if not validate_folder(folder):
        return
    
    backup_dir = os.path.join(folder, "01备份txt")
    os.makedirs(backup_dir, exist_ok=True)
    
    backed_up = 0
    errors = 0

    for root, dirs, files in os.walk(folder):
        for f in files:
            if f.lower().endswith('.txt'):
                src = os.path.join(root, f)
                rel_path = os.path.relpath(root, folder)
                dest_root = os.path.join(backup_dir, rel_path)
                
                os.makedirs(dest_root, exist_ok=True)
                dest = os.path.join(dest_root, f)
                
                counter = 1
                while os.path.exists(dest):
                    base, ext = os.path.splitext(f)
                    dest = os.path.join(dest_root, f"{base}_{counter}{ext}")
                    counter += 1
                
                try:
                    shutil.copy2(src, dest)
                    print(f"备份：{f} → {os.path.relpath(dest, backup_dir)}")
                    backed_up += 1
                except Exception as e:
                    print(f"备份失败：{f} - {str(e)}")
                    errors += 1

    print(f"\n备份完成：成功 {backed_up} 个，失败 {errors} 个")

def handle_folder_conflict(folder_path):
    """处理目标文件夹冲突"""
    print(f"\n警告：目标文件夹 '{os.path.basename(folder_path)}' 已存在！")
    print("1. 自动添加序号（如：其他文件(1)）")
    print("2. 使用现有文件夹")
    print("3. 取消操作")
    choice = input("请选择处理方式（1-3）：").strip()
    
    if choice == '1':
        counter = 1
        while True:
            new_name = f"{os.path.basename(folder_path)}({counter})"
            new_path = os.path.join(os.path.dirname(folder_path), new_name)
            if not os.path.exists(new_path):
                return new_path
            counter += 1
    elif choice == '2':
        print(f"将使用现有文件夹：'{os.path.basename(folder_path)}'")
        return folder_path
    else:
        return None

def filter_non_training_files():
    """功能6：最终版文件筛选（先扫描后命名）"""
    folder = get_folder_path()
    if not validate_folder(folder):
        return

    print("\n正在扫描文件...")
    to_move = []
    for root, dirs, files in os.walk(folder):
        for file in files:
            if file.startswith(('.', '~$')):
                continue
            
            ext = os.path.splitext(file)[1][1:].lower()
            if ext in image_extensions or ext == 'txt':
                continue
            
            full_path = os.path.join(root, file)
            rel_dir = os.path.relpath(root, folder)
            to_move.append((full_path, rel_dir, file))

    print(f"\n发现 {len(to_move)} 个需要移动的非图片/TXT文件")

    if not to_move:
        print("没有需要移动的文件")
        return

    default_name = "其他文件"
    target_name = input(f"请输入目标文件夹名称（默认：'{default_name}'）：").strip() or default_name
    target_path = os.path.join(folder, target_name)

    if os.path.exists(target_path):
        resolved_path = handle_folder_conflict(target_path)
        if not resolved_path:
            print("操作已取消")
            return
        target_path = resolved_path

    confirm = input(f"是否移动 {len(to_move)} 个文件到 '{os.path.basename(target_path)}'？(y/n) ").lower()
    if confirm != 'y':
        print("操作已取消")
        return

    moved = 0
    errors = 0
    dirs_to_clean = set()

    for src, rel_dir, filename in to_move:
        try:
            if src.startswith(target_path):
                print(f"跳过目标文件夹内文件：{filename}")
                continue
                
            dest_dir = os.path.join(target_path, rel_dir)
            os.makedirs(dest_dir, exist_ok=True)
            
            dest = os.path.join(dest_dir, filename)
            count = 1
            while os.path.exists(dest):
                base, ext = os.path.splitext(filename)
                dest = os.path.join(dest_dir, f"{base}_{count}{ext}")
                count += 1

            shutil.move(src, dest)
            moved += 1
            dirs_to_clean.add(os.path.dirname(src))
        except Exception as e:
            print(f"移动失败：{filename} - {str(e)}")
            errors += 1

    cleaned = 0
    for dir_path in sorted(dirs_to_clean, key=lambda x: len(x.split(os.sep)), reverse=True):
        try:
            if dir_path == folder or not os.listdir(dir_path):
                os.rmdir(dir_path)
                cleaned += 1
        except:
            pass

    print("\n" + "="*40)
    print(f"操作报告：")
    print(f"成功移动文件：{moved} 个")
    print(f"移动失败文件：{errors} 个")
    print(f"清理空目录：{cleaned} 个")
    print(f"目标位置：{os.path.abspath(target_path)}")
    print("="*40)

if __name__ == "__main__":
    while True:
        show_menu()
        try:
            choice = input("\n请选择操作（1-7）：").strip()
        except KeyboardInterrupt:
            print("\n操作已取消")
            continue
            
        if choice == '1':
            rename_images_and_txt()
        elif choice == '2':
            create_txt_files()
        elif choice == '3':
            modify_txt_contents()
        elif choice == '4':
            remove_txt_files()
        elif choice == '5':
            backup_txt_files()
        elif choice == '6':
            filter_non_training_files()
        elif choice == '7':
            print("\n程序已退出")
            break
        else:
            print("无效输入，请重新选择")
            
        input("\n按回车键继续...")