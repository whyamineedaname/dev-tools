"""
歌曲人声/伴奏分离 - 供 Electron 调用
用法: python separate_audio.py <输入音频> <输出目录> <模式> [--mp3]
模式: 2stem (人声+伴奏) | 4stem (人声/鼓/贝斯/其他)
进度通过 stdout 输出 JSON 行: {"stage":"...","percent":N,"message":"..."}
最终结果同样以 JSON 行输出: {"success":true,"outputDir":"...","files":[...]} 或 {"success":false,"error":"..."}
"""
import sys
import os
import json
import subprocess

STEM_LABELS = {
    "vocals": "人声",
    "no_vocals": "伴奏",
    "drums": "鼓点",
    "bass": "贝斯",
    "other": "其他",
}


def report(stage, percent, message):
    print(json.dumps({"stage": stage, "percent": percent, "message": message}, ensure_ascii=False), flush=True)


def main():
    if len(sys.argv) < 4:
        print(json.dumps({"success": False, "error": "参数不足"}, ensure_ascii=False), flush=True)
        sys.exit(1)
    input_path = sys.argv[1]
    output_dir = sys.argv[2]
    mode = sys.argv[3]
    want_mp3 = "--mp3" in sys.argv[4:]

    if mode not in ("2stem", "4stem"):
        print(json.dumps({"success": False, "error": f"未知模式: {mode}"}, ensure_ascii=False), flush=True)
        sys.exit(1)
    if not os.path.isfile(input_path):
        print(json.dumps({"success": False, "error": f"输入文件不存在: {input_path}"}, ensure_ascii=False), flush=True)
        sys.exit(1)

    try:
        from demucs.api import Separator, save_audio
    except ImportError:
        print(
            json.dumps(
                {"success": False, "error": "未安装 demucs，请先执行: pip install demucs"},
                ensure_ascii=False,
            ),
            flush=True,
        )
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)
    base = os.path.splitext(os.path.basename(input_path))[0]
    stem_dir = os.path.join(output_dir, base)
    os.makedirs(stem_dir, exist_ok=True)

    try:
        report("model", 10, "正在加载分离模型 htdemucs…")
        separator = Separator(model="htdemucs", two_stems="vocals" if mode == "2stem" else None)
        report("model", 40, "模型加载完成")
        report("separate", 45, "开始分离（首次运行较慢，请耐心等待）…")
        origin, separated = separator.separate_audio_file(input_path)
        report("separate", 90, "分离完成，正在保存…")

        files = []
        for stem_name, tensor in separated.items():
            out_path = os.path.join(stem_dir, f"{stem_name}.wav")
            save_audio(tensor, out_path, samplerate=separator.samplerate)
            label = STEM_LABELS.get(stem_name, stem_name)
            files.append({"name": f"{stem_name}.wav", "path": out_path, "label": label})

        if want_mp3:
            report("convert", 95, "转换为 MP3…")
            for item in list(files):
                wav = item["path"]
                mp3 = wav.replace(".wav", ".mp3")
                ret = subprocess.run(
                    ["ffmpeg", "-y", "-i", wav, "-b:a", "192k", mp3],
                    capture_output=True,
                )
                if ret.returncode == 0:
                    os.remove(wav)
                    files.remove(item)
                    files.append(
                        {"name": os.path.basename(mp3), "path": mp3, "label": item["label"]}
                    )

        print(json.dumps({"success": True, "outputDir": stem_dir, "files": files}, ensure_ascii=False), flush=True)
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
