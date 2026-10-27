# -*- coding: utf-8 -*-
"""
音乐下载 CLI（对接 MrsEWE44/musicDownload 使用的 musicdl）。

从 stdin 读一条 JSON，向 stdout 写 JSON 行，供 Electron 解析：

  {"cmd":"probe"}
  {"cmd":"search","keyword":"...","sources":["KuwoMusicClient"],"limit":10,"mode":"song"}
  {"cmd":"download","songs":[...],"outputDir":"...","sources":["KuwoMusicClient"],"limit":10}

进度行：{"type":"progress","message":"...","current":1,"total":3}
结果行：{"success":true,...} 或 {"success":false,"error":"..."}
"""

from __future__ import annotations

import io
import json
import os
import re
import shutil
import sys
from contextlib import redirect_stdout

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


SOURCE_CN = {
    "AppleMusicClient": "苹果音乐",
    "DeezerMusicClient": "Deezer",
    "FiveSingMusicClient": "5sing",
    "JamendoMusicClient": "Jamendo",
    "JooxMusicClient": "Joox",
    "KuwoMusicClient": "酷我音乐",
    "KugouMusicClient": "酷狗音乐",
    "MiguMusicClient": "咪咕音乐",
    "NeteaseMusicClient": "网易云音乐",
    "QQMusicClient": "QQ音乐",
    "QianqianMusicClient": "千千音乐",
    "QobuzMusicClient": "Qobuz",
    "SoundCloudMusicClient": "SoundCloud",
    "StreetVoiceMusicClient": "StreetVoice",
    "SodaMusicClient": "汽水音乐",
    "SpotifyMusicClient": "Spotify",
    "TIDALMusicClient": "TIDAL",
}

COVER_FIELDS = (
    "cover",
    "album_cover",
    "pic",
    "picture",
    "img",
    "image",
    "album_img",
    "album_pic",
    "cover_url",
    "pic_url",
)


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def fail(message: str, code: int = 1) -> int:
    emit({"success": False, "error": message})
    return code


def to_jsonable(obj):
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, dict):
        return {str(k): to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [to_jsonable(x) for x in obj]
    if hasattr(obj, "model_dump"):
        try:
            return to_jsonable(obj.model_dump())
        except Exception:
            pass
    if hasattr(obj, "dict") and callable(obj.dict):
        try:
            return to_jsonable(obj.dict())
        except Exception:
            pass
    if hasattr(obj, "__dict__"):
        return to_jsonable(vars(obj))
    return str(obj)


def as_dict(obj) -> dict:
    plain = to_jsonable(obj)
    return plain if isinstance(plain, dict) else {"value": plain}


def singers_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return " / ".join(str(s) for s in value if str(s).strip())
    return str(value)


def file_format(song: dict) -> str:
    for field in ("format", "ext", "file_format", "type"):
        val = song.get(field)
        if val:
            return str(val).upper().lstrip(".")
    url = str(song.get("download_url") or "").lower()
    for ext in ("flac", "wav", "m4a", "aac", "mp3"):
        if f".{ext}" in url:
            return ext.upper()
    return ""


def cover_url(song: dict) -> str:
    for field in COVER_FIELDS:
        url = str(song.get(field) or "")
        if url.startswith("http"):
            return url
    return ""


def sanitize_filename(filename: str) -> str:
    return re.sub(r'[\\/*?:"<>|]', "_", str(filename)).strip() or "未命名"


def import_musicdl():
    try:
        from musicdl import musicdl
        return musicdl
    except ImportError as exc:
        raise RuntimeError("未安装 musicdl，请执行：pip install musicdl") from exc


def make_client(musicdl, sources: list[str], limit: int, work_dir: str, cookie: str = ""):
    os.makedirs(work_dir, exist_ok=True)
    cfg = {}
    for src in sources:
        item = {
            "search_size_per_source": limit,
            "work_dir": work_dir,
        }
        if cookie:
            item["default_search_cookies"] = cookie
            item["default_download_cookies"] = cookie
        cfg[src] = item
    return musicdl.MusicClient(music_sources=sources, init_music_clients_cfg=cfg)


def flatten_results(results) -> list[dict]:
    songs: list[dict] = []
    if isinstance(results, dict):
        groups = results.values()
    elif isinstance(results, list):
        groups = [results]
    else:
        groups = [[results]]
    for group in groups:
        if not isinstance(group, list):
            group = [group]
        for item in group:
            song = as_dict(item)
            song["song_name"] = str(song.get("song_name") or "未知歌曲")
            song["singersText"] = singers_text(song.get("singers"))
            song["album"] = str(song.get("album") or "")
            song["source"] = str(song.get("source") or "")
            song["sourceLabel"] = SOURCE_CN.get(song["source"], song["source"] or "未知来源")
            song["file_size"] = str(song.get("file_size") or "")
            song["duration"] = str(song.get("duration") or "")
            song["ext"] = file_format(song)
            song["cover"] = cover_url(song)
            songs.append(song)
    return songs


def cmd_probe() -> int:
    try:
        musicdl = import_musicdl()
        version = getattr(musicdl, "__version__", "")
        emit({
            "success": True,
            "musicdlOk": True,
            "version": str(version or ""),
            "sources": [{"id": k, "name": v} for k, v in SOURCE_CN.items()],
        })
        return 0
    except Exception as exc:
        emit({
            "success": True,
            "musicdlOk": False,
            "error": str(exc),
            "sources": [{"id": k, "name": v} for k, v in SOURCE_CN.items()],
        })
        return 0


def cmd_search(payload: dict) -> int:
    keyword = str(payload.get("keyword") or "").strip()
    if not keyword:
        return fail("请输入搜索关键词或歌单链接")
    sources = [str(s) for s in (payload.get("sources") or []) if s]
    if not sources:
        return fail("请至少选择一个音乐来源")
    limit = int(payload.get("limit") or 10)
    limit = max(1, min(limit, 50))
    mode = str(payload.get("mode") or "song")
    cookie = str(payload.get("cookie") or "").strip()
    work_dir = str(payload.get("workDir") or os.getcwd())

    musicdl = import_musicdl()
    client = make_client(musicdl, sources, limit, work_dir, cookie)
    sink = io.StringIO()
    with redirect_stdout(sink):
        if mode == "playlist":
            results = client.parseplaylist(keyword)
            if not isinstance(results, dict):
                results = {"歌单": results}
        else:
            results = client.search(keyword=keyword)
    songs = flatten_results(results)
    emit({"success": True, "count": len(songs), "songs": songs})
    return 0


def move_downloaded(song: dict, save_path: str, output_dir: str) -> dict | None:
    if not save_path or not os.path.exists(save_path):
        return None
    song_name = str(song.get("song_name") or "未知歌曲")
    singer = singers_text(song.get("singers")) or "未知歌手"
    album = str(song.get("album") or "")
    identifier = str(song.get("identifier") or "")
    ext = os.path.splitext(save_path)[1].lstrip(".")
    if not ext:
        ext = str(song.get("ext") or "mp3").lower().lstrip(".")
    parts = [song_name, singer]
    if album:
        parts.append(album)
    if identifier:
        parts.append(identifier)
    base_name = sanitize_filename("-".join(parts))
    audio_path = os.path.join(output_dir, f"{base_name}.{ext}")
    if os.path.exists(audio_path):
        os.remove(audio_path)
    shutil.move(save_path, audio_path)

    old_lrc = os.path.splitext(save_path)[0] + ".lrc"
    lrc_path = ""
    if os.path.exists(old_lrc):
        lrc_path = os.path.join(output_dir, f"{base_name}.lrc")
        if os.path.exists(lrc_path):
            os.remove(lrc_path)
        shutil.move(old_lrc, lrc_path)

    return {
        "name": os.path.basename(audio_path),
        "path": audio_path,
        "lyricPath": lrc_path,
        "songName": song_name,
        "singers": singer,
    }


def cmd_download(payload: dict) -> int:
    songs = payload.get("songs") or []
    if not isinstance(songs, list) or not songs:
        return fail("请先选择要下载的歌曲")
    output_dir = str(payload.get("outputDir") or "").strip()
    if not output_dir:
        return fail("请选择保存目录")
    sources = [str(s) for s in (payload.get("sources") or []) if s]
    if not sources:
        sources = list({str(s.get("source") or "") for s in songs if s.get("source")})
        sources = [s for s in sources if s]
    if not sources:
        return fail("缺少音乐来源")
    limit = int(payload.get("limit") or 10)
    limit = max(1, min(limit, 50))
    cookie = str(payload.get("cookie") or "").strip()
    work_dir = str(payload.get("workDir") or os.path.join(output_dir, ".tusi-musicdl-tmp"))

    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(work_dir, exist_ok=True)

    musicdl = import_musicdl()
    client = make_client(musicdl, sources, limit, work_dir, cookie)
    files = []
    errors = []
    total = len(songs)
    for index, raw in enumerate(songs, start=1):
        song = as_dict(raw)
        label = f"{song.get('song_name') or '未知歌曲'} - {singers_text(song.get('singers')) or '未知歌手'}"
        emit({"type": "progress", "message": f"正在下载 {label}", "current": index, "total": total})
        try:
            sink = io.StringIO()
            with redirect_stdout(sink):
                downloaded = client.download(song_infos=[song])
            moved = False
            for item in downloaded or []:
                data = as_dict(item)
                save_path = str(data.get("save_path") or "")
                result = move_downloaded(song, save_path, output_dir)
                if result:
                    files.append(result)
                    moved = True
            if not moved:
                errors.append(f"{label}：未获取到文件")
        except Exception as exc:
            errors.append(f"{label}：{exc}")

    try:
        if os.path.isdir(work_dir) and os.path.basename(work_dir).startswith(".tusi-musicdl"):
            shutil.rmtree(work_dir, ignore_errors=True)
    except Exception:
        pass

    emit({
        "success": True,
        "count": len(files),
        "files": files,
        "errors": errors,
        "outputDir": output_dir,
    })
    return 0


def main() -> int:
    raw = sys.stdin.read()
    if not raw.strip():
        return fail("未收到任务参数")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        return fail(f"参数不是合法 JSON：{exc}")
    if not isinstance(payload, dict):
        return fail("参数必须是 JSON 对象")

    cmd = str(payload.get("cmd") or "").strip()
    try:
        if cmd == "probe":
            return cmd_probe()
        if cmd == "search":
            return cmd_search(payload)
        if cmd == "download":
            return cmd_download(payload)
        return fail(f"不支持的命令：{cmd or '空'}")
    except Exception as exc:
        return fail(str(exc))


if __name__ == "__main__":
    sys.exit(main())
