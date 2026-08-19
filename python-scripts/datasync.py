#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
datasync.py —— 通用数据同步引擎（PG / MySQL / ES 互转）

子命令：
  python datasync.py fields <config-json>   查询源/目标表字段信息，输出 JSON
  python datasync.py sync   <config-json>   执行数据同步（批量 upsert），输出 JSON

config-json 结构：
{
  "source": {
    "engine": "mysql" | "pg" | "es",
    "host": "127.0.0.1", "port": 3306,
    "user": "...", "password": "...",
    "database": "db_name",          // es: 索引名
    "table": "table_name"           // es: 忽略（全索引读取）
  },
  "target": { ...同 source... },
  "fields": [                       // 字段映射（按 target 字段名去重）
    {"sourceField": "id", "targetField": "id"},
    {"sourceField": "name", "targetField": "title"}
  ],
  "primaryKey": "id",               // 目标主键字段（同步用 upsert）
  "batchSize": 500                  // 可选，默认 500
}

返回（fields）：
  {"ok": true, "source": {"fields": [{"name","type","nullable","primaryKey"}...], "engine": "mysql"},
   "target": {...}}
返回（sync）：
  {"ok": true, "total": N, "inserted": N, "updated": N, "errors": []}
失败：
  {"ok": false, "error": "..."}
"""

import sys
import json
import time
import traceback
from datetime import datetime, date, time
from urllib.parse import quote_plus

# ---------- 输出 ----------
def out(obj: dict) -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(obj, ensure_ascii=False, default=str))


def fail(error: str) -> None:
    out({"ok": False, "error": error})


# ---------- 引擎识别 ----------
ENGINES = ("mysql", "pg", "es")


def _dialect(cfg: dict) -> str:
    engine = (cfg.get("engine") or "").lower()
    if engine not in ENGINES:
        raise ValueError(f"不支持的引擎: {engine!r}（可选: mysql / pg / es）")
    return engine


def _dsn(cfg: dict) -> str:
    """构造 SQLAlchemy DSN（密码特殊字符经 quote_plus 编码）。engine 为 es 时抛错。"""
    engine = _dialect(cfg)
    user = cfg.get("user") or ""
    password = cfg.get("password") or ""
    host = cfg.get("host") or "127.0.0.1"
    port = cfg.get("port") or (3306 if engine == "mysql" else 5432)
    database = cfg.get("database") or ""
    if engine == "mysql":
        return f"mysql+pymysql://{quote_plus(user)}:{quote_plus(password)}@{host}:{port}/{database}?charset=utf8mb4"
    if engine == "pg":
        return f"postgresql+psycopg2://{quote_plus(user)}:{quote_plus(password)}@{host}:{port}/{database}"
    raise ValueError("ES 引擎不使用 SQLAlchemy DSN")


# ---------- 字段元数据 ----------
def _fetch_fields_sql(engine: str, conn, table: str) -> list:
    """返回 [{name, type, nullable, primaryKey}]（SQLAlchemy 2.0：text() + 命名参数）"""
    from sqlalchemy import text

    if engine == "mysql":
        sql = (
            "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY "
            "FROM INFORMATION_SCHEMA.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table ORDER BY ORDINAL_POSITION"
        )
        rows = conn.execute(text(sql), {"table": table}).fetchall()
        return [
            {
                "name": r[0],
                "type": _normalize_mysql_type(r[1]),
                "nullable": r[2] == "YES",
                "primaryKey": r[3] == "PRI",
            }
            for r in rows
        ]
    if engine == "pg":
        sql = (
            "SELECT column_name, data_type, is_nullable, "
            "(SELECT COUNT(*) FROM information_schema.table_constraints tc "
            "  JOIN information_schema.key_column_usage kcu "
            "  ON tc.constraint_name = kcu.constraint_name "
            " WHERE tc.table_name = t.table_name AND tc.constraint_type = 'PRIMARY KEY' "
            "   AND kcu.column_name = t.column_name) "
            "FROM information_schema.columns t "
            "WHERE table_schema = 'public' AND table_name = :table ORDER BY ordinal_position"
        )
        rows = conn.execute(text(sql), {"table": table}).fetchall()
        return [
            {
                "name": r[0],
                "type": _normalize_pg_type(r[1]),
                "nullable": r[2] == "YES",
                "primaryKey": int(r[3] or 0) > 0,
            }
            for r in rows
        ]
    raise ValueError("仅 SQL 引擎支持此路径")


def _normalize_mysql_type(t: str) -> str:
    t = (t or "").lower()
    if t in ("tinyint", "smallint", "mediumint", "int", "bigint", "year"):
        return "int"
    if t in ("decimal", "numeric", "float", "double"):
        return "decimal"
    if t in ("date",):
        return "date"
    if t in ("datetime", "timestamp"):
        return "datetime"
    if t in ("time",):
        return "time"
    if t in ("bit", "boolean"):
        return "bool"
    if t in ("json",):
        return "json"
    if t in ("char", "varchar", "tinytext", "text", "mediumtext", "longtext", "enum", "set"):
        return "string"
    if t in ("binary", "varbinary", "blob", "tinyblob", "mediumblob", "longblob"):
        return "binary"
    return "string"


def _normalize_pg_type(t: str) -> str:
    t = (t or "").lower()
    if t in ("smallint", "integer", "bigint", "int2", "int4", "int8", "serial", "bigserial"):
        return "int"
    if t in ("numeric", "decimal", "real", "double precision", "float4", "float8"):
        return "decimal"
    if t in ("date",):
        return "date"
    if t in ("timestamp", "timestamptz", "timestamp without time zone", "timestamp with time zone"):
        return "datetime"
    if t in ("time", "timetz"):
        return "time"
    if t in ("boolean", "bool"):
        return "bool"
    if t in ("json", "jsonb"):
        return "json"
    if t in ("character varying", "varchar", "character", "char", "text"):
        return "string"
    if t.startswith("character varying"):
        return "string"
    if t in ("bytea",):
        return "binary"
    # TODO: array / uuid 等归为 string
    return "string"


def _fetch_fields_es(cfg: dict) -> list:
    """读取 ES 索引 mapping，返回 [{name, type}]。"""
    es = _es_client(cfg)
    index = cfg.get("database") or cfg.get("index") or ""
    if not index:
        raise ValueError("ES 引擎需要 database（索引名）")
    try:
        mapping = es.indices.get_mapping(index=index)
    except Exception as e:  # noqa: BLE001
        raise ValueError(f"读取 ES 索引映射失败: {e}") from e
    props = {}
    for _idx, meta in (mapping or {}).items():
        # ES 7.x: {index: {mappings: {_doc: {properties}}}}
        # ES 8.x/9.x: {index: {mappings: {properties}}}
        mappings = (meta or {}).get("mappings") or {}
        if isinstance(mappings, dict):
            props = (mappings.get("properties") or {}) or props
            # 兼容 7.x 的类型层包装
            for _t, _m in mappings.items():
                if isinstance(_m, dict) and "properties" in _m:
                    props = _m.get("properties") or {}
    result = []
    for name, meta in (props or {}).items():
        ftype = (meta or {}).get("type", "object")
        result.append(
            {
                "name": name,
                "type": _normalize_es_type(ftype),
                "nullable": True,
                "primaryKey": False,
            }
        )
    return result


def _normalize_es_type(t: str) -> str:
    t = (t or "").lower()
    if t in ("long", "integer", "short", "byte"):
        return "int"
    if t in ("float", "double", "half_float", "scaled_float"):
        return "decimal"
    if t in ("date",):
        return "datetime"
    if t in ("boolean",):
        return "bool"
    if t in ("object", "nested", "flattened"):
        return "json"
    return "string"  # text/keyword 等


def _es_client(cfg: dict):
    try:
        from elasticsearch import Elasticsearch
    except Exception as e:  # noqa: BLE001
        raise ValueError(
            f"Elasticsearch 客户端不可用: {e}\n"
            "请确认已安装兼容的版本：pip install -U elasticsearch"
        ) from e
    scheme = cfg.get("scheme") or "http"
    host = cfg.get("host") or "127.0.0.1"
    port = cfg.get("port") or 9200
    kw = {"hosts": [{"host": host, "port": port, "scheme": scheme}]}
    if cfg.get("user"):
        # 新版客户端(8.x+)用 basic_auth；旧版(7.x)用 http_auth，二者兼容
        kw["basic_auth"] = (cfg["user"], cfg.get("password") or "")
    return Elasticsearch(**kw)


# ---------- 类型兼容性校验 ----------
# 分组: int / decimal / string / date / datetime / time / bool / json / binary
# 可转换目标类型与源类型的关系（源 -> 目标 允许列表）
_COMPAT = {
    "int": {"int", "decimal", "bool"},          # str→int 非法（用户要求）
    "decimal": {"int", "decimal", "bool"},
    "string": {"int", "decimal", "string", "date", "datetime", "time", "bool", "json", "binary"},
    "date": {"date", "datetime"},
    "datetime": {"date", "datetime", "time"},
    "time": {"time"},
    "bool": {"bool", "int", "decimal"},
    "json": {"json", "string"},
    "binary": {"binary"},
}

# 类型转换（Python 值层面）
def _convert(value, source_type: str, target_type: str):
    if value is None:
        return None
    if target_type in ("int",):
        if isinstance(value, bool):
            return int(value)
        return int(value)
    if target_type == "decimal":
        if isinstance(value, bool):
            return float(value)
        if isinstance(value, int):
            return float(value)
        return float(value)
    if target_type == "string":
        if isinstance(value, (datetime, date, time)):
            return value.isoformat()
        if isinstance(value, (dict, list)):
            return json.dumps(value, ensure_ascii=False)
        if isinstance(value, bool):
            return "true" if value else "false"
        return str(value)
    if target_type == "bool":
        if isinstance(value, (int, float)):
            return bool(value)
        return value  # 保持原样，交由目标库处理
    if target_type in ("date", "datetime", "time"):
        if isinstance(value, datetime):
            if target_type == "date":
                return value.date()
            return value
        if isinstance(value, date):
            if target_type == "datetime":
                return datetime.combine(value, time.min)
            return value
        if isinstance(value, time):
            if target_type == "datetime":
                return datetime.combine(date.today(), value)
            return value
        return value  # 字符串时间保持，交由目标库解析
    if target_type == "json":
        return value
    return value  # binary 保持原样


# ---------- 数据读取（分页批量） ----------
def _iter_source(engine: str, conn, table: str, fields: list, batch_size: int):
    """字段列表 = 源字段名列表。每次 yield 一批 dict（key=字段名）。"""
    field_sql = ", ".join(f'"{f}"' if engine == "pg" else f"`{f}`" for f in fields)
    if engine == "pg":
        sql = f"SELECT {field_sql} FROM \"{table}\""
    else:
        sql = f"SELECT {field_sql} FROM `{table}`"
    offset = 0
    from sqlalchemy import text

    while True:
        page_sql = sql
        if engine == "pg":
            page_sql = f"{sql} LIMIT {batch_size} OFFSET {offset}"
        else:
            page_sql = f"{sql} LIMIT {batch_size} OFFSET {offset}"
        rows = conn.execute(text(page_sql)).fetchall()
        if not rows:
            break
        yield [dict(zip(fields, r)) for r in rows]
        if len(rows) < batch_size:
            break
        offset += batch_size


# ---------- 目标写入 ----------
def _upsert_sql_batch(engine: str, table: str, field_names: list, primary_key: str) -> str:
    """生成 upsert SQL，占位符使用命名参数 :c0/:c1...（SQLAlchemy 2.0 executemany 需 dict 参数）"""
    cols = ", ".join(f'"{c}"' if engine == "pg" else f"`{c}`" for c in field_names)
    ph = ", ".join(f":c{i}" for i in range(len(field_names)))
    if engine == "pg":
        return (
            f'INSERT INTO "{table}" ({cols}) VALUES ({ph}) '
            f'ON CONFLICT ("{primary_key}") DO UPDATE SET '
            + ", ".join(
                f'"{c}" = EXCLUDED."{c}"' for c in field_names if c != primary_key
            )
        )
    # mysql: ON DUPLICATE KEY UPDATE
    updates = ", ".join(f"`{c}` = VALUES(`{c}`)" for c in field_names if c != primary_key)
    dup = f" ON DUPLICATE KEY UPDATE {updates}" if updates else ""
    return f"INSERT INTO `{table}` ({cols}) VALUES ({ph}){dup}"


# ---------- 同步执行 ----------
def _do_sync(cfg: dict):
    source = cfg.get("source") or {}
    target = cfg.get("target") or {}
    fields_map = cfg.get("fields") or []
    primary_key = cfg.get("primaryKey") or "id"
    batch_size = int(cfg.get("batchSize") or 500)
    if batch_size < 1:
        batch_size = 500

    if not fields_map:
        raise ValueError("未配置字段映射（fields）")
    if not primary_key:
        raise ValueError("未设置目标主键（primaryKey）")

    src_engine = _dialect(source)
    tgt_engine = _dialect(target)
    src_table = source.get("table") or ""
    tgt_table = target.get("table") or ""

    if src_engine == "pg":
        table_quoted = f'"{src_table}"'
    else:
        table_quoted = f"`{src_table}`"

    # 校验字段映射：目标字段名不能重复
    tgt_names = [m.get("targetField") for m in fields_map]
    if len(tgt_names) != len(set(tgt_names)):
        raise ValueError("字段映射中目标字段名存在重复")

    # 建立源/目标类型映射
    src_field_types = {}
    tgt_field_types = {}
    _probe_conn = None

    total, inserted, updated = 0, 0, 0
    errors = []
    started = time.time()

    from sqlalchemy import create_engine, text

    src_conn = None
    tgt_conn = None
    es = None

    try:
        # 打开源连接
        if src_engine == "es":
            es = _es_client(source)  # 实际上源不可能为 es（ES 读取复杂），上层 UI 会约束
            raise ValueError("暂不支持 ES 作为同步源（请用 SQL 库作为源）")
        src_conn = create_engine(_dsn(source)).connect()
        src_field_types = {f["name"]: f["type"] for f in _fetch_fields_sql(src_engine, src_conn, src_table)}
        if primary_key not in src_field_types:
            raise ValueError(f"源表 {src_table} 不存在主键字段: {primary_key}")

        # 打开目标连接
        if tgt_engine == "es":
            es = _es_client(target)
            tgt_field_types = {f["name"]: f["type"] for f in _fetch_fields_es(target)}
        else:
            tgt_conn = create_engine(_dsn(target)).connect()
            tgt_field_types = {f["name"]: f["type"] for f in _fetch_fields_sql(tgt_engine, tgt_conn, tgt_table)}

        # 校验字段映射类型兼容性
        src_fields = []
        for m in fields_map:
            sf = m.get("sourceField")
            tf = m.get("targetField")
            if not sf or not tf:
                raise ValueError(f"字段映射缺少字段名: {m}")
            if sf not in src_field_types:
                raise ValueError(f"源表不存在字段: {sf}")
            if tf not in tgt_field_types:
                raise ValueError(f"目标表/索引不存在字段: {tf}")
            st, tt = src_field_types[sf], tgt_field_types[tf]
            if tt not in _COMPAT or st not in _COMPAT[tt]:
                raise ValueError(
                    f"字段类型不兼容: {sf}({st}) -> {tf}({tt})"
                )
            src_fields.append(sf)

        # 校验主键在目标中存在
        if primary_key not in tgt_field_types:
            raise ValueError(f"目标表/索引不存在主键字段: {primary_key}")

        # ---- ES 目标写入 ----
        if tgt_engine == "es":
            index = target.get("database") or ""
            if not index:
                raise ValueError("ES 目标缺少 database（索引名）")
            from elasticsearch import helpers

            for batch in _iter_source(src_engine, src_conn, src_table, src_fields, batch_size):
                docs = []
                for row in batch:
                    doc = {}
                    for m in fields_map:
                        sf, tf = m["sourceField"], m["targetField"]
                        doc[tf] = _convert(row[sf], src_field_types[sf], tgt_field_types[tf])
                    pk_val = doc.get(primary_key)
                    if pk_val is None and primary_key in row:
                        pk_val = _convert(row[primary_key], src_field_types[primary_key], tgt_field_types[primary_key])
                    docs.append({"_index": index, "_id": str(pk_val), "_source": doc})
                try:
                    ok, _err = helpers.bulk(es, docs, stats_only=False, raise_on_error=False)
                    inserted += ok
                    total += len(docs)
                    for item in _err:
                        errors.append(str(item.get("index", {}).get("error", item)))
                except Exception as e:  # noqa: BLE001
                    raise ValueError(f"ES bulk 写入失败: {e}") from e
            return {"ok": True, "total": total, "inserted": inserted, "updated": updated,
                    "errors": errors[:50], "seconds": round(time.time() - started, 2)}

        # ---- SQL 目标写入 ----
        sql = _upsert_sql_batch(tgt_engine, tgt_table, tgt_names, primary_key)
        for batch in _iter_source(src_engine, src_conn, src_table, src_fields, batch_size):
            rows = []
            for row in batch:
                values = {}
                for i, m in enumerate(fields_map):
                    sf, tf = m["sourceField"], m["targetField"]
                    values[f"c{i}"] = _convert(row[sf], src_field_types[sf], tgt_field_types[tf])
                rows.append(values)
            try:
                result = tgt_conn.execute(text(sql), rows)
                total += len(rows)
                # rowcount 反映受影响行（PG 的 ON CONFLICT DO UPDATE 每行返回 1；MySQL 返回 1 时为插入否则 2）
                rc = result.rowcount if result.rowcount is not None and result.rowcount >= 0 else len(rows)
                if tgt_engine == "pg":
                    # PG 区分 insert/update 需要 ctid 技巧，这里粗略按全量计入 inserted
                    inserted += rc
                else:
                    # MySQL: 新插入 1，更新 2 —— 按 2 计算更新数需要原始行数
                    inserted += len(rows) * 2 - rc if rc > len(rows) else rc
            except Exception as e:  # noqa: BLE001
                errors.append(f"batch@{total}: {e}")
                if len(errors) > 20:
                    break
        tgt_conn.commit()
        return {"ok": True, "total": total, "inserted": inserted, "updated": updated,
                "errors": errors[:50], "seconds": round(time.time() - started, 2)}
    finally:
        if src_conn is not None:
            try:
                src_conn.close()
            except Exception:  # noqa: BLE001
                pass
        if tgt_conn is not None:
            try:
                tgt_conn.close()
            except Exception:  # noqa: BLE001
                pass


# ---------- 字段查询 ----------
def _do_fields(cfg: dict):
    source = cfg.get("source") or {}
    engine = _dialect(source)
    table = source.get("table") or ""

    if engine == "es":
        fe = _fetch_fields_es(source)
        return {"ok": True, "source": {"engine": "es", "fields": fe}, "target": None}

    try:
        from sqlalchemy import create_engine
    except ImportError:
        raise ValueError("缺少依赖：pip install sqlalchemy pymysql psycopg2-binary")
    if engine == "pg":
        try:
            __import__("psycopg2")
        except ImportError:
            raise ValueError("缺少 PG 驱动：pip install psycopg2-binary")
    if engine == "mysql":
        try:
            __import__("pymysql")
        except ImportError:
            raise ValueError("缺少 MySQL 驱动：pip install pymysql")

    conn = create_engine(_dsn(source)).connect()
    try:
        fields = _fetch_fields_sql(engine, conn, table)
        return {"ok": True, "source": {"engine": engine, "fields": fields}, "target": None}
    finally:
        conn.close()


# ---------- 入口 ----------
def main() -> None:
    if len(sys.argv) < 3:
        fail("用法: datasync.py fields|sync <config-json>")
        return
    cmd = sys.argv[1].lower()
    try:
        cfg = json.loads(sys.argv[2])
    except Exception as e:  # noqa: BLE001
        fail(f"config-json 解析失败: {e}")
        return
    try:
        if cmd == "fields":
            out(_do_fields(cfg))
        elif cmd == "sync":
            out(_do_sync(cfg))
        else:
            fail(f"未知子命令: {cmd}（可选 fields / sync）")
    except Exception as e:  # noqa: BLE001
        # 详细堆栈打印到 stderr（Electron 侧会将其作为 error 文本），stdout 保持干净 JSON
        print(traceback.format_exc(), file=sys.stderr)
        fail(str(e))


if __name__ == "__main__":
    # 兼容 Windows 编码
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass
    main()