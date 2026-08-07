"""
歌曲人声/伴奏分离 - 供 Electron 调用
用法: python separate_audio.py <输入音频> <输出目录> <模式> [--mp3]
模式: 2stem (人声+伴奏) | 4stem (人声/鼓/贝斯/其他)
进度通过 stdout 输出 JSON 行: {"stage":"...","percent":N,"message":"..."}
最终结果同样以 JSON 行输出: {"success":true,"outputDir":"...","files":[...]} 或 {"success":false,"error":"..."}

兼容 demucs 4.x：无 two_stems 参数，统一分离 4 轨后张量求和得到伴奏；
mp3 由 save_audio 原生编码（bitrate 参数），不依赖 ffmpeg。
"""
import sys
import os
import json

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

        # demucs 4.x 无 two_stems 参数：统一分离 4 轨（vocals/drums/bass/other）
        progress_state = {"seen_start": False}

        def on_progress(info):
            # info 含 state(start/end)、segment_offset、audio_length 等
            state = info.get("state")
            if state == "start":
                progress_state["seen_start"] = True
                report("separate", 45, "开始分离（首次运行较慢，请耐心等待）…")
            elif state == "end":
                report("separate", 90, "分离完成，正在保存…")
            elif progress_state["seen_start"]:
                total = info.get("audio_length") or 0
                offset = info.get("segment_offset") or 0
                if total > 0:
                    pct = 45 + min(45, max(0, int(offset / total * 45)))
                    report("separate", pct, f"分离中 {pct}%…")

        separator = Separator(model="htdemucs", progress=False, callback=on_progress)
        report("model", 40, "模型加载完成")
        origin, separated = separator.separate_audio_file(input_path)

        # demucs 4.x 分离结果固定为 4 轨
        stems = {k: v for k, v in separated.items()}
        vocals = stems.get("vocals")
        if vocals is None:
            raise RuntimeError(f"分离结果缺少 vocals 轨，实际键: {list(stems.keys())}")

        if mode == "2stem":
            # 伴奏 = 鼓 + 贝斯 + 其他（张量求和）
            import torch

            no_vocals = sum(
                (stems[k] for k in ("drums", "bass", "other") if k in stems),
                start=torch.zeros_like(vocals),
            )
            out_stems = {"vocals": vocals, "no_vocals": no_vocals}
        else:
            out_stems = {k: stems[k] for k in ("vocals", "drums", "bass", "other") if k in stems}

        files = []
        ext = "mp3" if want_mp3 else "wav"
        for stem_name, tensor in out_stems.items():
            out_path = os.path.join(stem_dir, f"{stem_name}.{ext}")
            if want_mp3:
                save_audio(tensor, out_path, samplerate=separator.samplerate, bitrate=192)
            else:
                save_audio(tensor, out_path, samplerate=separator.samplerate)
            label = STEM_LABELS.get(stem_name, stem_name)
            files.append({"name": f"{stem_name}.{ext}", "path": out_path, "label": label})

        print(json.dumps({"success": True, "outputDir": stem_dir, "files": files}, ensure_ascii=False), flush=True)
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
