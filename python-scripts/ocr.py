# -*- coding: utf-8 -*-
"""
OCR 工具统一脚本（基于 RapidOCR + opencv + PyMuPDF）

子命令：
  python ocr.py image <图片路径>
  python ocr.py batch <图片路径> [图片路径 ...]
  python ocr.py pdf  <PDF路径>
  python ocr.py qrcode <图片路径>

所有结果统一输出为 JSON（stdout），供 Electron 主进程捕获后透传前端。
失败时输出 {"success": false, "error": "..."}。
"""

import sys
import os
import json
import logging

# 强制 UTF-8 输出：Windows 下 Python 管道默认用 GBK/cp936，会导致 Electron 侧中文乱码
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

# 抑制 RapidOCR / onnxruntime 的 INFO 日志：
# 这些日志走 stderr，Electron 侧 runPythonScript 会把非空 stderr 视作错误，
# 导致 stdout 里的 JSON 被丢弃。用 logging.disable 全局静音（RapidOCR 在 import
# 时自行 setLevel(INFO)，单设 logger 级别会被其覆盖，disable 不受影响）。
logging.disable(logging.CRITICAL)

# ============ 依赖导入（惰性 + 友好报错） ============

_ocr_engine = None


def get_engine():
    """延迟初始化 RapidOCR 引擎（脚本进程内复用）。"""
    global _ocr_engine
    if _ocr_engine is not None:
        return _ocr_engine
    try:
        from rapidocr import RapidOCR
    except ImportError:
        # 兼容旧版包名（rapidocr_onnxruntime 已停止维护，仅作降级兜底）
        try:
            from rapidocr_onnxruntime import RapidOCR
        except ImportError:
            raise RuntimeError(
                "未安装 rapidocr，请执行：pip install rapidocr onnxruntime"
            )
    _ocr_engine = RapidOCR()
    return _ocr_engine


def _require_cv2():
    try:
        import cv2
        return cv2
    except ImportError:
        raise RuntimeError(
            "未安装 opencv-python（二维码识别需要），请执行：pip install opencv-python"
        )


def _require_fitz():
    try:
        import fitz  # PyMuPDF
        return fitz
    except ImportError:
        raise RuntimeError(
            "未安装 PyMuPDF（PDF OCR 需要），请执行：pip install pymupdf"
        )


def _import_numpy():
    try:
        import numpy as np
        return np
    except ImportError:
        raise RuntimeError("未安装 numpy，请执行：pip install numpy")


# ============ 各子命令实现 ============


def ocr_image(image_source):
    """对单张图片（路径或 numpy 数组）执行 OCR，返回识别文本列表。"""
    engine = get_engine()
    result = engine(image_source)
    if result is None:
        return []
    txts = getattr(result, "txts", None) or []
    return [t for t in txts if t]


def cmd_image(path):
    """识别单张图片：{"success": true, "text": "..."}"""
    if not os.path.isfile(path):
        return {"success": False, "error": f"文件不存在：{path}"}
    lines = ocr_image(path)
    return {"success": True, "text": "\n".join(lines)}


def cmd_batch(paths):
    """批量识别多张图片：{"success": true, "items": [{path, text, error}]}"""
    engine = get_engine()
    items = []
    for p in paths:
        entry = {"path": p, "text": "", "error": ""}
        if not os.path.isfile(p):
            entry["error"] = "文件不存在"
            items.append(entry)
            continue
        try:
            lines = ocr_image(p)
            entry["text"] = "\n".join(lines)
        except Exception as e:  # noqa: BLE001 - 批量任务单个失败不应中断整体
            entry["error"] = str(e)
        items.append(entry)
    return {"success": True, "items": items}


def cmd_pdf(path):
    """扫描版 PDF 逐页转图并 OCR：
    {"success": true, "pages": [{page, text}], "text": "合并文本"}"""
    if not os.path.isfile(path):
        return {"success": False, "error": f"文件不存在：{path}"}

    fitz = _require_fitz()
    np = _import_numpy()
    engine = get_engine()

    try:
        doc = fitz.open(path)
    except Exception as e:  # noqa: BLE001
        return {"success": False, "error": f"无法打开 PDF：{e}"}

    if doc.page_count == 0:
        return {"success": False, "error": "PDF 没有任何页面"}

    pages = []
    for i in range(doc.page_count):
        page = doc.load_page(i)
        # 200 DPI 渲染，兼顾识别精度与速度
        pix = page.get_pixmap(dpi=200)
        # pixmap -> numpy RGB 数组，直接喂给 RapidOCR，避免写临时文件
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(
            pix.height, pix.width, pix.n
        )
        if pix.n == 4:  # RGBA -> RGB
            img = img[:, :, :3]
        lines = ocr_image(img)
        text = "\n".join(lines)
        pages.append({"page": i + 1, "text": text})

    doc.close()
    return {
        "success": True,
        "pages": pages,
        "text": "\n\n".join(p["text"] for p in pages if p["text"]),
    }


def cmd_qrcode(path):
    """识别图片中的二维码 / 条形码：
    {"success": true, "codes": [{type, data}], "text": "..."}"""
    if not os.path.isfile(path):
        return {"success": False, "error": f"文件不存在：{path}"}

    cv2 = _require_cv2()
    np = _import_numpy()
    try:
        # cv2.imread 在 Windows 上不支持中文/非 ASCII 路径（返回 None），
        # 用 numpy 读字节流 + imdecode 解码绕过，与文件系统编码无关。
        img = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)
    except Exception as e:  # noqa: BLE001
        return {"success": False, "error": f"读取图片失败：{e}"}

    if img is None:
        return {"success": False, "error": "无法解码图片，请确认文件为常见图片格式"}

    codes = []

    # QRCode：4.3+ 支持多码检测
    detector = cv2.QRCodeDetector()
    try:
        ok, decoded, _pts, _straight = detector.detectAndDecodeMulti(img)
        if ok:
            for d in decoded:
                if d:
                    codes.append({"type": "QR", "data": d})
    except Exception:  # noqa: BLE001 - 老版本 cv2 无 detectAndDecodeMulti
        retval, decoded_info, _points, _straight_qrcode = detector.detectAndDecode(img)
        if retval and decoded_info:
            codes.append({"type": "QR", "data": decoded_info})

    # 条形码：opencv-contrib 的 barcode 模块（可选）
    try:
        barcode = cv2.barcode_BarcodeDetector()
        retval, decoded_info, _points, _type = barcode.detectAndDecode(img)
        if retval:
            for d in decoded_info:
                if d:
                    codes.append({"type": "Barcode", "data": d})
    except Exception:  # noqa: BLE001 - barcode 模块缺失时静默跳过
        pass

    if not codes:
        return {"success": True, "codes": [], "text": ""}

    text = "\n".join(f"[{c['type']}] {c['data']}" for c in codes)
    return {"success": True, "codes": codes, "text": text}


# ============ 入口 ============

COMMANDS = {
    "image": cmd_image,
    "batch": cmd_batch,
    "pdf": cmd_pdf,
    "qrcode": cmd_qrcode,
}


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(json.dumps({
            "success": False,
            "error": (
                "用法：python ocr.py <image|batch|pdf|qrcode> <路径...>\n"
                "示例：python ocr.py image a.png\n"
                "      python ocr.py batch a.png b.jpg\n"
                "      python ocr.py pdf scan.pdf\n"
                "      python ocr.py qrcode code.png"
            )
        }, ensure_ascii=False))
        return

    command = sys.argv[1]
    args = sys.argv[2:]
    try:
        if command == "image":
            if not args:
                result = {"success": False, "error": "缺少图片路径参数"}
            else:
                result = cmd_image(args[0])
        elif command == "batch":
            if not args:
                result = {"success": False, "error": "缺少图片路径参数"}
            else:
                result = cmd_batch(args)
        elif command == "pdf":
            if not args:
                result = {"success": False, "error": "缺少 PDF 路径参数"}
            else:
                result = cmd_pdf(args[0])
        elif command == "qrcode":
            if not args:
                result = {"success": False, "error": "缺少图片路径参数"}
            else:
                result = cmd_qrcode(args[0])
        else:  # pragma: no cover - 已在入口校验
            result = {"success": False, "error": f"未知子命令：{command}"}
    except Exception as e:  # noqa: BLE001 - 统一兜底，避免栈溢出输出污染 JSON
        result = {"success": False, "error": str(e)}

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()