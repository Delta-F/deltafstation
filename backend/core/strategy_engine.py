"""
策略引擎 - 基于 deltafq LiveEngine，策略自动化运行（模拟/实盘通用）

StrategyEngine 类方法说明（按优先级）：
  start          在指定账户上启动策略运行。
  stop           停止并移除该账户的策略引擎。
  is_running     判断指定 account_id 是否在运行。
  get_state      获取该账户的资金、持仓、成交、订单快照。
  get_run_info   获取策略运行信息（strategy_id, symbol, last_signal 等）。
  get_chart_data 获取 K 线与信号（LiveEngine 缓存）。
  get_running_ids 返回当前所有运行中的 account_id 列表。
"""
from typing import List, Optional
import threading

from deltafq.live import LiveEngine

from backend.core.utils.strategy_loader import load_strategy_class
from backend.core.utils.engine_state import build_state_from_engine


def _get_engine(run: Optional[dict]):
    """从 run 中提取底层 trade engine。"""
    if not run:
        return None
    gw = getattr(run.get("engine"), "_trade_gw", None)
    return getattr(gw, "_engine", None) if gw else None


class StrategyEngine:
    _runs: dict = {}

    @classmethod
    def start(cls, account_id: str, strategy_id: str, symbol: str, initial_capital: float,
              commission: float = 0.001, signal_interval: str = "1d", lookback_bars: int = 100,
              interval: float = 10.0) -> None:
        if account_id in cls._runs:
            cls.stop(account_id)
        strat = load_strategy_class(strategy_id)(name=strategy_id)
        engine = LiveEngine(symbol=symbol, interval=interval, lookback_bars=lookback_bars, signal_interval=signal_interval)
        engine.set_trade_gateway("paper", initial_capital=initial_capital, commission=commission)
        engine.add_strategy(strat)
        t = threading.Thread(target=lambda: engine.run_live(), daemon=True)
        t.start()
        cls._runs[account_id] = {"engine": engine, "strategy_id": strategy_id, "symbol": symbol,
                                "signal_interval": signal_interval, "thread": t}

    @classmethod
    def stop(cls, account_id: str) -> Optional[dict]:
        run = cls._runs.pop(account_id, None)
        if not run:
            return None
        eng = _get_engine(run)
        try:
            state = build_state_from_engine(eng) if eng else None
        except Exception:
            state = None
        try:
            run["engine"].stop()
        except Exception:
            pass
        return state

    @classmethod
    def is_running(cls, account_id: str) -> bool:
        return account_id in cls._runs

    @classmethod
    def get_state(cls, account_id: str) -> Optional[dict]:
        run = cls._runs.get(account_id)
        eng = _get_engine(run) if run else None
        if not eng:
            return None
        try:
            return build_state_from_engine(eng)
        except Exception:
            return None

    @classmethod
    def get_run_info(cls, account_id: str) -> Optional[dict]:
        run = cls._runs.get(account_id)
        if not run:
            return None
        info = {"strategy_id": run["strategy_id"], "symbol": run["symbol"],
                "signal_interval": run.get("signal_interval", "1d")}
        eng = run["engine"]
        if hasattr(eng, "_last_signal"):
            sig = eng._last_signal
            info["last_signal"] = sig
            info["last_signal_label"] = "买入" if sig == 1 else ("卖出" if sig == -1 else "观望")
        return info

    @classmethod
    def get_chart_data(cls, account_id: str) -> Optional[dict]:
        run = cls._runs.get(account_id)
        if not run:
            return None
        engine = run["engine"]
        if not hasattr(engine, "get_chart_data"):
            return None
        try:
            return engine.get_chart_data()
        except Exception:
            return None

    @classmethod
    def get_running_ids(cls) -> List[str]:
        return list(cls._runs.keys())
