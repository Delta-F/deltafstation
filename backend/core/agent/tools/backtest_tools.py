from __future__ import annotations

"""Agent 回测工具（function calling）。

设计目标：
1) 输入灵活：必填参数支持模糊匹配。
2) 输出稳定：返回统一结构（resolved / summary_metrics / trade_preview）。
3) 接入轻量：复用 Core 回测引擎与既有结果落盘风格。

方法说明：
  序列化辅助：
    _convert_to_json_serializable  将 pandas/numpy 对象转换为 JSON 可序列化结构。
  输入规范化辅助：
    _normalize_text                文本标准化（小写 + 去除非字母数字）供模糊匹配使用。
    _to_float                      参数转 float，失败回退默认值。
    _to_int                        参数转 int，失败回退默认值。
    _clean_date                    日期参数清洗，空值转 None。
  发现类辅助：
    _discover_strategy_ids         扫描策略目录，发现可用策略类名。
    _discover_data_files           扫描行情文件并提取 symbol 提示。
  模糊匹配辅助：
    _resolve_strategy_id           解析策略：精确 -> 规范化 -> 模糊包含。
    _resolve_data_file             解析数据文件：精确 -> 按 symbol -> 文件名模糊。
    _match_or_error                解析必填参数，失败返回结构化错误。
  结果组装辅助：
    _build_result_id               生成兼容现有命名规则的结果 ID。
    _pick_date_range               优先用入参日期，缺失时从净值序列推断。
    _build_trade_preview           从成交记录构建最近 N 笔预览。
  对外 handler：
    handle_run_backtest            回测工具主入口（匹配 -> 执行 -> 落盘 -> 返回摘要）。
"""

import importlib.util
import inspect
import json
import math
import os
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from deltafq.strategy.base import BaseStrategy

from backend.core.backtest_engine import BacktestEngine

_BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))))
_STRATEGIES_FOLDER = os.path.join(_BASE_DIR, "data", "strategies")
_DATA_RAW_FOLDER = os.path.join(_BASE_DIR, "data", "raw")
_DATA_RESULTS_FOLDER = os.path.join(_BASE_DIR, "data", "results")


# ---------------------------------------------------------------------------
# 序列化辅助
# ---------------------------------------------------------------------------
def _convert_to_json_serializable(obj: Any) -> Any:
    """将 pandas/numpy 等对象转换为 JSON 可序列化数据。"""
    if isinstance(obj, pd.DataFrame):
        return [_convert_to_json_serializable(record) for record in obj.to_dict("records")]
    if isinstance(obj, pd.Series):
        return [_convert_to_json_serializable(item) for item in obj.tolist()]
    if isinstance(obj, dict):
        return {k: _convert_to_json_serializable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_convert_to_json_serializable(item) for item in obj]
    if isinstance(obj, pd.Timestamp):
        return obj.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(obj, pd.Timedelta):
        return str(obj)
    if isinstance(obj, (int, float, np.integer, np.floating)):
        try:
            if isinstance(obj, np.floating):
                obj = float(obj)
            elif isinstance(obj, np.integer):
                obj = int(obj)
            if pd.isna(obj) or math.isinf(obj) or abs(obj) > 1e308:
                return None
            return obj
        except (TypeError, ValueError, OverflowError):
            return None
    return obj


# ---------------------------------------------------------------------------
# 输入规范化辅助
# ---------------------------------------------------------------------------
def _normalize_text(text: str) -> str:
    """用于模糊匹配的文本标准化（小写 + 仅保留字母数字）。"""
    t = (text or "").strip().lower()
    return "".join(ch for ch in t if ch.isalnum())


def _to_float(value: Any, default: float) -> float:
    """尽力转换为 float，失败返回默认值。"""
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _to_int(value: Any, default: int) -> int:
    """尽力转换为 int，失败返回默认值。"""
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _clean_date(value: Any) -> Optional[str]:
    """日期输入清洗：去空白，空字符串转为 None。"""
    s = str(value or "").strip()
    return s or None


# ---------------------------------------------------------------------------
# 发现类辅助
# ---------------------------------------------------------------------------
def _discover_strategy_ids() -> List[str]:
    """扫描 data/strategies，发现可用策略类名。"""
    if not os.path.exists(_STRATEGIES_FOLDER):
        return []

    ids: List[str] = []
    for filename in os.listdir(_STRATEGIES_FOLDER):
        if not filename.endswith(".py"):
            continue
        filepath = os.path.join(_STRATEGIES_FOLDER, filename)
        module_name = f"deltafstation_strategy_{os.path.splitext(filename)[0]}"
        spec = importlib.util.spec_from_file_location(module_name, filepath)
        if spec is None or spec.loader is None:
            continue
        module = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(module)
        except Exception:
            continue
        for name, obj in inspect.getmembers(module, inspect.isclass):
            if issubclass(obj, BaseStrategy) and obj is not BaseStrategy:
                ids.append(name)
    return sorted(set(ids))


def _discover_data_files() -> List[Dict[str, str]]:
    """扫描 data/raw 下 CSV，并从文件名提取 symbol 提示。"""
    if not os.path.exists(_DATA_RAW_FOLDER):
        return []

    out: List[Dict[str, str]] = []
    for filename in os.listdir(_DATA_RAW_FOLDER):
        if not filename.lower().endswith(".csv"):
            continue
        no_ext = filename[:-4]
        symbol = no_ext.split("_")[0].upper() if no_ext else ""
        out.append({"filename": filename, "symbol": symbol, "no_ext": no_ext})
    return sorted(out, key=lambda x: x["filename"])


# ---------------------------------------------------------------------------
# 模糊匹配辅助
# ---------------------------------------------------------------------------
def _resolve_strategy_id(user_input: str) -> Tuple[Optional[str], List[str]]:
    """解析 strategy_id：精确 -> 规范化 -> 模糊包含。"""
    candidates = _discover_strategy_ids()
    if not candidates:
        return None, []

    raw = (user_input or "").strip()
    n_query = _normalize_text(raw)
    if not raw and not n_query:
        return None, candidates

    exact = [c for c in candidates if c == raw or c.lower() == raw.lower()]
    if len(exact) == 1:
        return exact[0], []
    if len(exact) > 1:
        return None, exact

    norm_eq = [c for c in candidates if _normalize_text(c) == n_query]
    if len(norm_eq) == 1:
        return norm_eq[0], []
    if len(norm_eq) > 1:
        return None, norm_eq

    fuzzy = [c for c in candidates if n_query and n_query in _normalize_text(c)]
    if len(fuzzy) == 1:
        return fuzzy[0], []
    if len(fuzzy) > 1:
        return None, fuzzy

    return None, []


def _resolve_data_file(user_input: str) -> Tuple[Optional[str], List[str]]:
    """解析 data_file：精确 -> 按 symbol 优先 -> 文件名模糊。"""
    files = _discover_data_files()
    if not files:
        return None, []

    raw = (user_input or "").strip()
    n_query = _normalize_text(raw)
    if not raw and not n_query:
        return None, [f["filename"] for f in files]

    # 1) exact filename / no_ext
    exact = [
        f["filename"]
        for f in files
        if f["filename"] == raw
        or f["filename"].lower() == raw.lower()
        or f["no_ext"] == raw
        or f["no_ext"].lower() == raw.lower()
    ]
    if len(exact) == 1:
        return exact[0], []
    if len(exact) > 1:
        return None, exact

    # 2) symbol focus
    by_symbol = [
        f["filename"]
        for f in files
        if n_query and (n_query == _normalize_text(f["symbol"]) or n_query in _normalize_text(f["symbol"]))
    ]
    uniq_symbol = sorted(set(by_symbol))
    if len(uniq_symbol) == 1:
        return uniq_symbol[0], []
    if len(uniq_symbol) > 1:
        return None, uniq_symbol

    # 3) normalized filename fuzzy
    by_name = [
        f["filename"]
        for f in files
        if n_query and n_query in _normalize_text(f["filename"])
    ]
    uniq_name = sorted(set(by_name))
    if len(uniq_name) == 1:
        return uniq_name[0], []
    if len(uniq_name) > 1:
        return None, uniq_name

    return None, []


def _match_or_error(field: str, value: Any) -> Tuple[Optional[str], Optional[Dict[str, Any]]]:
    """解析必填字段；失败时返回结构化错误。"""
    raw = str(value or "").strip()
    if not raw:
        return None, {"error": "missing_required_field", "field": field}

    if field == "strategy_id":
        matched, candidates = _resolve_strategy_id(raw)
    else:
        matched, candidates = _resolve_data_file(raw)

    if matched:
        return matched, None

    if candidates:
        return None, {
            "error": "ambiguous_match",
            "field": field,
            "query": raw,
            "candidates": candidates[:10],
        }

    return None, {"error": "no_match", "field": field, "query": raw, "candidates": []}


# ---------------------------------------------------------------------------
# 结果组装辅助
# ---------------------------------------------------------------------------
def _build_result_id(strategy_id: str, symbol: str, start_date: Optional[str], end_date: Optional[str]) -> str:
    """构造与现有系统风格兼容的回测结果 ID。"""
    s_date = (start_date or "").replace("-", "")
    e_date = (end_date or "").replace("-", "")
    symbol_name = symbol.split(".")[0] if "." in symbol else symbol
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"res_{strategy_id}_{symbol_name}_{s_date}_{e_date}_{ts}"


def _pick_date_range(start_date: Optional[str], end_date: Optional[str], values_df: Any) -> Dict[str, Optional[str]]:
    """优先使用入参日期；缺失时从 values_df 首尾行推断日期区间。"""
    if start_date and end_date:
        return {"start_date": start_date, "end_date": end_date}
    if not isinstance(values_df, list) or not values_df:
        return {"start_date": start_date, "end_date": end_date}

    first = values_df[0] if isinstance(values_df[0], dict) else {}
    last = values_df[-1] if isinstance(values_df[-1], dict) else {}
    guessed_start = first.get("Date") or first.get("date")
    guessed_end = last.get("Date") or last.get("date")
    return {
        "start_date": start_date or guessed_start,
        "end_date": end_date or guessed_end,
    }


def _build_trade_preview(trades: Any, preview_count: int = 10) -> Dict[str, Any]:
    """从成交记录构建轻量预览（最近 N 笔）。"""
    if not isinstance(trades, list) or not trades:
        return {"count": 0, "items": []}

    count = max(1, min(int(preview_count), 50))
    rows = trades[-count:]
    items: List[Dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        qty = row.get("Quantity", row.get("quantity", row.get("qty")))
        side = row.get("type", row.get("Type", row.get("Direction", row.get("direction", row.get("side")))))
        if isinstance(side, str):
            side = side.upper()
        if not side and isinstance(qty, (int, float)):
            side = "BUY" if qty > 0 else "SELL" if qty < 0 else "FLAT"
        items.append(
            {
                "date": row.get("Date", row.get("date", row.get("timestamp"))),
                "side": side,
                "price": row.get("Price", row.get("price")),
                "qty": qty,
                "pnl": row.get("PnL", row.get("pnl", row.get("profit", row.get("profit_loss")))),
            }
        )
    return {"count": len(items), "items": items}


# ---------------------------------------------------------------------------
# 对外 handler
# ---------------------------------------------------------------------------
def handle_run_backtest(args: Dict[str, Any]) -> str:
    """执行回测（必填参数支持模糊匹配），并返回结构化摘要。"""
    strategy_id, err = _match_or_error("strategy_id", args.get("strategy_id"))
    if err:
        return json.dumps(err, ensure_ascii=False)

    data_file, err = _match_or_error("data_file", args.get("data_file"))
    if err:
        return json.dumps(err, ensure_ascii=False)

    start_date = args.get("start_date")
    end_date = args.get("end_date")
    symbol = args.get("symbol")
    start_date = _clean_date(start_date)
    end_date = _clean_date(end_date)
    initial_capital = _to_float(args.get("initial_capital", 100000), 100000.0)
    commission = _to_float(args.get("commission", 0.001), 0.001)
    slippage = _to_float(args.get("slippage", 0.0005), 0.0005)
    trade_preview_count = _to_int(args.get("trade_preview_count", 10), 10)

    engine = BacktestEngine(
        initial_capital=initial_capital,
        commission=commission,
        slippage=slippage,
    )
    used_symbol = engine.run_backtest_from_file(
        strategy_id=strategy_id,
        data_file=data_file,
        start_date=start_date,
        end_date=end_date,
        symbol=symbol,
    )

    result_id = _build_result_id(strategy_id, used_symbol, start_date, end_date)
    result = {
        "trades_df": _convert_to_json_serializable(engine.get_trades_df()),
        "values_df": _convert_to_json_serializable(engine.get_values_df()),
        "values_metrics": _convert_to_json_serializable(engine.get_values_metrics()),
        "metrics": _convert_to_json_serializable(engine.get_metrics()),
    }
    result_data = {
        "id": result_id,
        "strategy_id": strategy_id,
        "symbol": used_symbol,
        "data_file": data_file,
        "start_date": start_date,
        "end_date": end_date,
        "initial_capital": initial_capital,
        "commission": commission,
        "slippage": slippage,
        "created_at": datetime.now().isoformat(),
        "result": result,
    }
    os.makedirs(_DATA_RESULTS_FOLDER, exist_ok=True)
    with open(os.path.join(_DATA_RESULTS_FOLDER, f"{result_id}.json"), "w", encoding="utf-8") as f:
        json.dump(_convert_to_json_serializable(result_data), f, ensure_ascii=False, indent=2)

    metrics = result.get("metrics", {}) if isinstance(result, dict) else {}
    values_df = result.get("values_df", []) if isinstance(result, dict) else []
    trades_df = result.get("trades_df", []) if isinstance(result, dict) else []
    date_range = _pick_date_range(start_date, end_date, values_df)
    brief = {
        "status": "success",
        "message": "Backtest completed successfully",
        "result_id": result_id,
        "resolved": {
            "strategy_id": strategy_id,
            "symbol": used_symbol,
            "data_file": data_file,
            "date_range": date_range,
        },
        "summary_metrics": {
            "total_return_pct": (metrics.get("total_return", 0) * 100) if isinstance(metrics, dict) else None,
            "annualized_return_pct": (metrics.get("annualized_return", 0) * 100) if isinstance(metrics, dict) else None,
            "max_drawdown_pct": (metrics.get("max_drawdown", 0) * 100) if isinstance(metrics, dict) else None,
            "sharpe_ratio": metrics.get("sharpe_ratio") if isinstance(metrics, dict) else None,
            "win_rate_pct": (metrics.get("win_rate", 0) * 100) if isinstance(metrics, dict) else None,
            "profit_loss_ratio": metrics.get("profit_loss_ratio") if isinstance(metrics, dict) else None,
        },
        "trade_preview": _build_trade_preview(trades_df, preview_count=trade_preview_count),
    }
    return json.dumps(_convert_to_json_serializable(brief), ensure_ascii=False)


__all__ = ["handle_run_backtest"]
