from __future__ import annotations

import json
import os
import re
from datetime import datetime
from typing import Any, Dict, Optional

from backend.core.agent.tools.backtest_tools import build_backtest_brief_and_persist
from backend.core.backtest_engine import BacktestEngine
from backend.core.data_manager import DataManager
from backend.core.utils.strategy_loader import load_strategy_class

_BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))))
_DATA_FOLDER = os.path.join(_BASE_DIR, "data")
_STRATEGIES_FOLDER = os.path.join(_DATA_FOLDER, "strategies")
_DEFAULT_STRATEGY_ID = "BOLLStrategy"


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


def _sanitize_class_name(raw_name: str) -> str:
    if _is_valid_class_name(raw_name):
        return raw_name

    cleaned = re.sub(r"[^A-Za-z0-9_]+", "", raw_name or "")
    if not cleaned:
        cleaned = "AgentGeneratedStrategy"
    if cleaned[0].isdigit():
        cleaned = f"S{cleaned}"
    if not _is_valid_class_name(cleaned):
        cleaned = "AgentGeneratedStrategy"
    return cleaned


def _snake_case(name: str) -> str:
    s1 = re.sub("(.)([A-Z][a-z]+)", r"\1_\2", name)
    s2 = re.sub("([a-z0-9])([A-Z])", r"\1_\2", s1)
    return re.sub(r"[^a-z0-9_]+", "_", s2.lower()).strip("_")


def _strategy_py_template(class_name: str) -> str:
    return f'''"""Auto-generated strategy template for agent backtesting."""
import pandas as pd
from deltafq.strategy.base import BaseStrategy


class {class_name}(BaseStrategy):
    """Simple generated strategy: flip signal every 2 bars."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

    def generate_signals(self, data: pd.DataFrame) -> pd.Series:  # type: ignore[name-defined]
        n = len(data)
        signals = [1 if (i // 2) % 2 == 0 else -1 for i in range(n)]
        return pd.Series(signals, index=data.index)
'''


def _ensure_strategy_exists_or_generate(strategy_id: str) -> tuple[str, Optional[str], bool]:
    try:
        load_strategy_class(strategy_id)
        return strategy_id, None, False
    except RuntimeError:
        pass

    class_name = _sanitize_class_name(strategy_id)
    if not class_name:
        class_name = "AgentGeneratedStrategy"

    # avoid collision by suffixing timestamp if class exists or name not equal original
    try:
        load_strategy_class(class_name)
        class_name = f"{class_name}_{datetime.now().strftime('%H%M%S')}"
    except RuntimeError:
        pass

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    file_name = f"agent_generated_{_snake_case(class_name)}_{timestamp}.py"
    os.makedirs(_STRATEGIES_FOLDER, exist_ok=True)
    file_path = os.path.join(_STRATEGIES_FOLDER, file_name)

    with open(file_path, "w", encoding="utf-8") as f:
        f.write(_strategy_py_template(class_name))

    # validate loadability
    load_strategy_class(class_name)
    return class_name, file_name, True


def handle_run_backtest_auto(args: Dict[str, Any]) -> str:
    """
    最小自动回测：
    1) symbol 拉取/复用数据；
    2) strategy_id 缺省为 BOLLStrategy；
    3) 若策略不存在则自动写入策略文件并加载；
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
        resolved_strategy_id, generated_file, generated = _ensure_strategy_exists_or_generate(strategy_id)
    except Exception as e:  # noqa: BLE001
        return json.dumps(
            {"error": "strategy_prepare_failed", "strategy_id": strategy_id, "details": str(e)},
            ensure_ascii=False,
        )

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
        "strategy_generated": generated,
        "generated_strategy_file": generated_file,
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


__all__ = ["handle_run_backtest_auto"]

