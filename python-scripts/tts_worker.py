#!/usr/bin/env python3
"""CosyVoice NDJSON worker for 兔丝 TTS. One JSON object per stdin/stdout line."""

from __future__ import annotations

import json
import os
import shutil
import sys
import traceback

MODEL_DIR = os.environ.get("TTS_MODEL_DIR", "").strip()
COSYVOICE_HOME = os.environ.get("COSYVOICE_HOME", "").strip()

MS_REPOS = {
    "cosyvoice3": "FunAudioLLM/Fun-CosyVoice3-0.5B-2512",
    "cosyvoice300m": "iic/CosyVoice-300M",
}
HF_REPOS = {
    "cosyvoice3": "FunAudioLLM/Fun-CosyVoice3-0.5B-2512",
    "cosyvoice300m": "FunAudioLLM/CosyVoice-300M",
}
DIR_NAMES = {
    "cosyvoice3": "Fun-CosyVoice3-0.5B",
    "cosyvoice300m": "CosyVoice-300M",
}

_device = "cpu"
_model_kind = "cosyvoice3"
_engine = None
_loaded = False


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def fail(req_id: str, error: str, extra: dict | None = None) -> None:
    payload = {"id": req_id, "ok": False, "error": error}
    if extra:
        payload.update(extra)
    emit(payload)


def ok(req_id: str, extra: dict | None = None) -> None:
    payload = {"id": req_id, "ok": True}
    if extra:
        payload.update(extra)
    emit(payload)


def setup_sys_path() -> None:
    if not COSYVOICE_HOME:
        return
    if COSYVOICE_HOME not in sys.path:
        sys.path.insert(0, COSYVOICE_HOME)
    matcha = os.path.join(COSYVOICE_HOME, "third_party", "Matcha-TTS")
    if os.path.isdir(matcha) and matcha not in sys.path:
        sys.path.insert(0, matcha)


def try_import_cosyvoice() -> tuple[bool, str]:
    setup_sys_path()
    try:
        import cosyvoice  # noqa: F401
        return True, ""
    except Exception as exc:
        return False, f"无法 import cosyvoice：{exc}。请按 README 安装 CosyVoice，或设置 COSYVOICE_HOME。"


def pick_device_and_model() -> tuple[str, str]:
    force_cpu = os.environ.get("TTS_DEVICE", "").strip().lower() == "cpu"
    if force_cpu:
        return "cpu", "cosyvoice3"
    try:
        import torch

        if sys.platform == "darwin" and hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps", "cosyvoice3"
        if torch.cuda.is_available():
            mem_mib = torch.cuda.get_device_properties(0).total_memory / (1024 * 1024)
            if mem_mib >= 8192:
                return "cuda", "cosyvoice3"
            if mem_mib >= 4096:
                return "cuda", "cosyvoice300m"
    except Exception:
        pass
    return "cpu", "cosyvoice3"


def model_path(kind: str) -> str:
    return os.path.join(MODEL_DIR, DIR_NAMES[kind])


def model_ready(kind: str) -> bool:
    root = model_path(kind)
    if not os.path.isdir(root):
        return False
    for name in ("llm.pt", "flow.pt", "cosyvoice.yaml"):
        if os.path.isfile(os.path.join(root, name)):
            return True
    return False


def device_message(device: str, kind: str, import_ok: bool) -> str:
    if not import_ok:
        return "未检测到 CosyVoice。请按 README 安装后重试。"
    labels = {"cosyvoice3": "CosyVoice 3", "cosyvoice300m": "CosyVoice-300M"}
    label = labels.get(kind, kind)
    if device == "mps":
        return f"将使用 Apple MPS + {label}。合成非实时，首次加载可能较久。"
    if device == "cuda":
        if kind == "cosyvoice300m":
            return f"显存有限，将使用 CUDA + {label}（非 CosyVoice 3）。"
        return f"将使用 CUDA + {label}。"
    if sys.platform.startswith("win"):
        return f"将使用 CPU + {label}，速度会很慢。有独显请安装匹配的 CUDA 版 PyTorch。"
    return f"将使用 CPU + {label}。若 MPS 无声，可设置环境变量 TTS_DEVICE=cpu。"


def op_probe(req_id: str) -> None:
    import_ok, err = try_import_cosyvoice()
    extra = {
        "device": _device,
        "model": _model_kind,
        "modelReady": model_ready(_model_kind),
        "cosyvoiceImportOk": import_ok,
        "message": err if not import_ok else device_message(_device, _model_kind, True),
    }
    ok(req_id, extra)


def _snapshot(repo: str, local_dir: str, source: str) -> None:
    if source == "ms":
        from modelscope.hub.snapshot_download import snapshot_download

        snapshot_download(repo, local_dir=local_dir)
        return
    from huggingface_hub import snapshot_download

    snapshot_download(repo_id=repo, local_dir=local_dir)


def op_download(req_id: str) -> None:
    import_ok, err = try_import_cosyvoice()
    if not import_ok:
        fail(req_id, err)
        return
    if not MODEL_DIR:
        fail(req_id, "未设置 TTS_MODEL_DIR")
        return
    os.makedirs(MODEL_DIR, exist_ok=True)
    dest = model_path(_model_kind)
    partial = dest + ".partial"
    if os.path.isdir(partial):
        shutil.rmtree(partial, ignore_errors=True)
    os.makedirs(partial, exist_ok=True)
    emit(
        {
            "id": req_id,
            "progress": True,
            "phase": "download",
            "message": "开始下载模型（优先 ModelScope）…",
        }
    )
    last_error = ""
    for source, repos in (("ms", MS_REPOS), ("hf", HF_REPOS)):
        repo = repos[_model_kind]
        try:
            emit(
                {
                    "id": req_id,
                    "progress": True,
                    "phase": "download",
                    "message": f"正在从 {'ModelScope' if source == 'ms' else 'HuggingFace'} 下载 {repo}",
                }
            )
            _snapshot(repo, partial, source)
            if os.path.isdir(dest):
                shutil.rmtree(dest, ignore_errors=True)
            os.rename(partial, dest)
            if not model_ready(_model_kind):
                fail(req_id, "模型已下载但未找到 llm.pt / flow.pt / cosyvoice.yaml，请检查目录")
                return
            ok(req_id, {"modelReady": True})
            return
        except Exception as exc:
            last_error = str(exc)
            continue
    shutil.rmtree(partial, ignore_errors=True)
    fail(req_id, f"下载模型失败：{last_error}")


def op_load(req_id: str) -> None:
    global _engine, _loaded
    import_ok, err = try_import_cosyvoice()
    if not import_ok:
        fail(req_id, err)
        return
    if not model_ready(_model_kind):
        fail(req_id, "模型未下载，请先点击「下载模型」")
        return
    if _loaded and _engine is not None:
        ok(req_id, {"model": _model_kind, "device": _device})
        return
    root = model_path(_model_kind)
    try:
        from cosyvoice.cli.cosyvoice import AutoModel, CosyVoice

        if _model_kind == "cosyvoice3":
            try:
                _engine = AutoModel(model_dir=root)
            except TypeError:
                _engine = AutoModel(root)
            except Exception:
                from cosyvoice.cli.cosyvoice import CosyVoice3  # type: ignore

                _engine = CosyVoice3(root)
        else:
            _engine = CosyVoice(root)
        _loaded = True
        ok(req_id, {"model": _model_kind, "device": _device})
    except Exception as exc:
        fail(req_id, f"加载模型失败：{exc}")


def op_synth(req_id: str, body: dict) -> None:
    text = str(body.get("text") or "")
    prompt_wav = str(body.get("promptWav") or "")
    prompt_text = str(body.get("promptText") or "")
    out_wav = str(body.get("outWav") or "")
    if not (1 <= len(text) <= 2000):
        fail(req_id, "文本长度须为 1～2000 字")
        return
    if not prompt_wav or not os.path.isfile(prompt_wav):
        fail(req_id, "参考音频不存在")
        return
    if not prompt_text.strip():
        fail(req_id, "缺少参考音频转写")
        return
    if not out_wav:
        fail(req_id, "缺少输出路径")
        return
    if _engine is None:
        fail(req_id, "模型未加载")
        return
    partial = out_wav + ".partial.wav"
    try:
        import torch
        import torchaudio

        gen = _engine.inference_zero_shot(text, prompt_text, prompt_wav, stream=False)
        chunks = []
        for item in gen:
            speech = item["tts_speech"] if isinstance(item, dict) else item
            chunks.append(speech)
        if not chunks:
            fail(req_id, "合成结果为空")
            return
        audio = torch.cat(chunks, dim=1) if len(chunks) > 1 else chunks[0]
        sr = getattr(_engine, "sample_rate", 22050)
        os.makedirs(os.path.dirname(out_wav) or ".", exist_ok=True)
        torchaudio.save(partial, audio.cpu(), sr)
        if os.path.exists(out_wav):
            os.remove(out_wav)
        os.rename(partial, out_wav)
        ok(req_id, {"outWav": out_wav})
    except Exception as exc:
        if os.path.isfile(partial):
            try:
                os.remove(partial)
            except OSError:
                pass
        fail(req_id, f"合成失败：{exc}")


def handle(req: dict) -> None:
    req_id = str(req.get("id") or "")
    op = str(req.get("op") or "")
    if not req_id:
        emit({"id": "", "ok": False, "error": "缺少 id"})
        return
    if op == "probe":
        op_probe(req_id)
    elif op == "download":
        op_download(req_id)
    elif op == "load":
        op_load(req_id)
    elif op == "synth":
        op_synth(req_id, req)
    elif op == "shutdown":
        ok(req_id, {})
        sys.exit(0)
    else:
        fail(req_id, f"未知 op：{op}")


def main() -> None:
    global _device, _model_kind
    _device, _model_kind = pick_device_and_model()
    for line in sys.stdin:
        raw = line.strip()
        if not raw:
            continue
        try:
            req = json.loads(raw)
        except json.JSONDecodeError:
            emit({"id": "", "ok": False, "error": "无效 JSON"})
            continue
        try:
            handle(req)
        except Exception:
            rid = ""
            if isinstance(req, dict):
                rid = str(req.get("id") or "")
            fail(rid, traceback.format_exc().splitlines()[-1])


if __name__ == "__main__":
    main()
