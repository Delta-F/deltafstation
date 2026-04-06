from __future__ import annotations

import ast
import json
import os
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

from backend.core.agent.tools.backtest_tools import build_backtest_brief_and_persist
from backend.core.backtest_engine import BacktestEngine
from backend.core.data_manager import DataManager
from backend.core.utils.strategy_loader import load_strategy_class

_BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))))
_DATA_FOLDER = os.path.join(_BASE_DIR, "data")
_STRATEGIES_FOLDER = os.path.join(_DATA_FOLDER, "strategies")
_DEFAULT_STRATEGY_ID = "BOLLStrategy"
_MAX_SOURCE_BYTES = 512_000


def _clean_date(value: Any) -> Optional[str]:
    s = str(value or "").strip()
    return s or None


def _to_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _to_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _is_valid_class_name(name: str) -> bool:
    return bool(re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", name or ""))


def _snake_case(name: str) -> str:
    s1 = re.sub("(.)([A-Z][a-z]+)", r"\1_\2", name)
    s2 = re.sub("([a-z0-9])([A-Z])", r"\1_\2", s1)
    return re.sub(r"[^a-z0-9_]+", "_", s2.lower()).strip("_") or "strategy"


def _safe_basename(name: str) -> bool:
    return bool(re.match(r"^[a-zA-Z0-9_.-]+\.py$", name)) and ".." not in name


def _strategies_realpath() -> str:
    return os.path.realpath(_STRATEGIES_FOLDER)


def _file_in_strategies_dir(path: str) -> bool:
    try:
        return os.path.commonpath([_strategies_realpath(), os.path.realpath(path)]) == _strategies_realpath()
    except ValueError:
        return False


def _class_names_in_source(source: str) -> List[str]:
    tree = ast.parse(source)
    return [n.name for n in tree.body if isinstance(n, ast.ClassDef)]


def _files_defining_class(class_name: str) -> List[str]:
    if not os.path.isdir(_STRATEGIES_FOLDER):
        return []
    out: List[str] = []
    for fn in os.listdir(_STRATEGIES_FOLDER):
        if not fn.endswith(".py"):
            continue
        path = os.path.join(_STRATEGIES_FOLDER, fn)
        try:
            with open(path, encoding="utf-8") as f:
                src = f.read()
        except OSError:
            continue
        try:
            names = _class_names_in_source(src)
        except SyntaxError:
            continue
        if class_name in names:
            out.append(fn)
    return out


def handle_ensure_strategy(args: Dict[str, Any]) -> str:
    """
    Write LLM-authored strategy source to data/strategies, then validate via load_strategy_class.

    Required: class_name, source_code.
    Optional: file_basename (safe *.py), overwrite (remove existing files that define the same class).
    """
    class_name = str(args.get("class_name") or "").strip()
    source_code = str(args.get("source_code") or "")
    file_basename = str(args.get("file_basename") or "").strip()
    overwrite = bool(args.get("overwrite"))

    if not class_name:
        return json.dumps({"error": "missing_required_field", "field": "class_name"}, ensure_ascii=False)
    if not _is_valid_class_name(class_name):
        return json.dumps({"error": "invalid_class_name", "class_name": class_name}, ensure_ascii=False)
    if not source_code.strip():
        return json.dumps({"error": "missing_required_field", "field": "source_code"}, ensure_ascii=False)

    if len(source_code.encode("utf-8")) > _MAX_SOURCE_BYTES:
        return json.dumps(
            {"error": "source_too_large", "max_bytes": _MAX_SOURCE_BYTES},
            ensure_ascii=False,
        )

    if class_name not in _class_names_in_source(source_code):
        return json.dumps(
            {
                "error": "class_not_in_source",
                "class_name": class_name,
                "hint": "source_code must define a class with the same name as class_name",
            },
            ensure_ascii=False,
        )

    try:
        compile(source_code, "<ensure_strategy>", "exec")
    except SyntaxError as e:
        return json.dumps(
            {"error": "syntax_error", "details": str(e), "lineno": getattr(e, "lineno", None)},
            ensure_ascii=False,
        )

    existing = _files_defining_class(class_name)
    if existing and not overwrite:
        return json.dumps(
            {
                "error": "strategy_class_exists",
                "class_name": class_name,
                "existing_files": existing,
                "hint": "使用不同 class_name，或设置 overwrite 为 true 覆盖（将删除列出的旧文件）",
            },
            ensure_ascii=False,
        )

    if existing and overwrite:
        for fn in existing:
            path = os.path.join(_STRATEGIES_FOLDER, fn)
            if _file_in_strategies_dir(path):
                try:
                    os.remove(path)
                except OSError as e:
                    return json.dumps(
                        {"error": "remove_failed", "file": fn, "details": str(e)},
                        ensure_ascii=False,
                    )

    os.makedirs(_STRATEGIES_FOLDER, exist_ok=True)

    if file_basename:
        if not _safe_basename(file_basename):
            return json.dumps({"error": "invalid_file_basename", "file_basename": file_basename}, ensure_ascii=False)
        file_name = file_basename
    else:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        file_name = f"agent_llm_{_snake_case(class_name)}_{ts}.py"

    file_path = os.path.join(_STRATEGIES_FOLDER, file_name)
    if not _file_in_strategies_dir(file_path):
        return json.dumps({"error": "invalid_target_path"}, ensure_ascii=False)

    try:
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(source_code)
    except OSError as e:
        return json.dumps({"error": "write_failed", "details": str(e)}, ensure_ascii=False)

    try:
        load_strategy_class(class_name)
    except Exception as e:  # noqa: BLE001
        try:
            os.remove(file_path)
        except OSError:
            pass
        return json.dumps(
            {"error": "load_strategy_failed", "class_name": class_name, "details": str(e)},
            ensure_ascii=False,
        )

    return json.dumps(
        {
            "status": "success",
            "class_name": class_name,
            "strategy_id": class_name,
            "file": file_name,
        },
        ensure_ascii=False,
    )


def handle_run_backtest_auto(args: Dict[str, Any]) -> str:
    """
    自动回测：
    1) symbol 拉取/复用数据；
    2) strategy_id 缺省为 BOLLStrategy（须已在 data/strategies 可加载）；
    3) 新策略须先由 ensure_strategy 写入源码；
    4) 执行回测并返回结构化摘要。
    """
    symbol = str(args.get("symbol") or "").strip().upper()
    if not symbol:
        return json.dumps({"error": "missing_required_field", "field": "symbol"}, ensure_ascii=False)

    requested_strategy_id = str(args.get("strategy_id") or "").strip()
    strategy_id = requested_strategy_id or _DEFAULT_STRATEGY_ID

    start_date = _clean_date(args.get("start_date"))
    end_date = _clean_date(args.get("end_date"))
    initial_capital = _to_float(args.get("initial_capital", 100000), 100000.0)
    commission = _to_float(args.get("commission", 0.001), 0.001)
    slippage = _to_float(args.get("slippage", 0.0005), 0.0005)
    trade_preview_count = _to_int(args.get("trade_preview_count", 10), 10)

    dm = DataManager(_DATA_FOLDER)
    try:
        data_file, _, data_status, data_source = dm.fetch_data(
            symbol=symbol,
            start_date=start_date,
            end_date=end_date,
            update_existing=True,
        )
    except Exception as e:  # noqa: BLE001
        return json.dumps(
            {"error": "data_fetch_failed", "symbol": symbol, "details": str(e)},
            ensure_ascii=False,
        )

    try:
        load_strategy_class(strategy_id)
    except RuntimeError:
        return json.dumps(
            {
                "error": "strategy_not_found",
                "strategy_id": strategy_id,
                "hint": "请先用 ensure_strategy 写入完整策略源码到 data/strategies，或改用已存在的类名（如 BOLLStrategy）",
            },
            ensure_ascii=False,
        )
    except Exception as e:  # noqa: BLE001
        return json.dumps(
            {"error": "strategy_load_failed", "strategy_id": strategy_id, "details": str(e)},
            ensure_ascii=False,
        )

    resolved_strategy_id = strategy_id

    engine = BacktestEngine(
        initial_capital=initial_capital,
        commission=commission,
        slippage=slippage,
    )
    try:
        used_symbol = engine.run_backtest_from_file(
            strategy_id=resolved_strategy_id,
            data_file=data_file,
            start_date=start_date,
            end_date=end_date,
            symbol=symbol,
        )
    except Exception as e:  # noqa: BLE001
        return json.dumps(
            {
                "error": "backtest_failed",
                "symbol": symbol,
                "strategy_id": resolved_strategy_id,
                "data_file": data_file,
                "details": str(e),
            },
            ensure_ascii=False,
        )

    extra = {
        "requested_strategy_id": requested_strategy_id or None,
        "resolved_strategy_id": resolved_strategy_id,
        "used_default_strategy": not requested_strategy_id,
        "data_fetch_status": data_status,
        "data_source": data_source,
    }
    return build_backtest_brief_and_persist(
        engine=engine,
        strategy_id=resolved_strategy_id,
        used_symbol=used_symbol,
        data_file=data_file,
        start_date=start_date,
        end_date=end_date,
        initial_capital=initial_capital,
        commission=commission,
        slippage=slippage,
        trade_preview_count=trade_preview_count,
        extra=extra,
    )


__all__ = ["handle_run_backtest_auto", "handle_ensure_strategy"]
