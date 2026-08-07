import sys
import os
from markitdown import MarkItDown

# 强制 UTF-8 输出：Windows 下 Python 管道默认用 GBK/cp936，会导致 Electron 侧中文乱码
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

def get_default_output_filename(input_path):
    """根据输入文件路径生成默认的输出文件名"""
    # 获取文件名（去掉路径）
    filename = os.path.basename(input_path)
    # 去掉扩展名
    name_without_ext = os.path.splitext(filename)[0]
    # 返回md文件名
    return f"{name_without_ext}.md"

def main():
    # 检查命令行参数
    if len(sys.argv) < 2:
        print("使用方法: python filetomd.py <输入文件路径> [输出文件名]")
        print("示例: python filetomd.py input.pdf")
        print("示例: python filetomd.py input.xlsx output.md")
        return

    # 获取输入文件路径
    input_path = sys.argv[1]

    # 检查输入文件是否存在
    if not os.path.exists(input_path):
        print(f"错误: 文件 '{input_path}' 不存在")
        return

    # 确定输出文件名
    if len(sys.argv) >= 3:
        output_file = sys.argv[2]
    else:
        output_file = get_default_output_filename(input_path)

    # 创建MarkItDown实例并转换文件
    md = MarkItDown(enable_plugins=True)
    result = md.convert(input_path)

    # 将结果保存到Markdown文件中
    with open(output_file, "w", encoding="utf-8") as f:
        f.write(result.text_content)

    print(f"文件已成功转换为Markdown并保存到 {output_file}")

if __name__ == "__main__":
    main()