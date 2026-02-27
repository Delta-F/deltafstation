"""策略自动化运行器 - 基于 deltafq LiveEngine"""
from typing import Any, Optional
import threading

from deltafq.live import LiveEngine
from backend.core.backtest_engine import BacktestEngine


def _ts_str(ts: Any) -> str:
    return ts.isoformat() if hasattr(ts, "isoformat") else str(ts)


class LiveEngineRunner:
    _runs: dict = {}

    @classmethod
    def _state_from_engine(cls, eng) -> dict:
        pos = {s: {"quantity": p["quantity"], "avg_price": p["avg_price"]}
                for s, p in eng.position_manager.positions.items()}
        trades = [{"symbol": t["symbol"], "action": t["type"], "quantity": abs(t["quantity"]),
                   "price": t["price"], "timestamp": _ts_str(t.get("timestamp")),
                   "order_id": t.get("order_id"), "commission": t.get("commission", 0)} for t in eng.trades]
        orders = []
        frozen = 0.0
        for o in eng.order_manager.get_order_history():
            orders.append({"id": o["id"], "symbol": o["symbol"], "action": "buy" if o["quantity"] > 0 else "sell",
                          "quantity": abs(o["quantity"]), "price": o["price"], "status": o["status"],
                          "type": o["order_type"], "time": _ts_str(o.get("created_at"))})
            if o.get("status") == "pending" and o.get("quantity", 0) > 0 and o.get("price"):
                frozen += o["quantity"] * o["price"]
        return {"current_capital": eng.cash, "positions": pos, "trades": trades, "orders": orders, "frozen_capital": frozen}

    @classmethod
    def start(cls, account_id: str, strategy_id: str, symbol: str, initial_capital: float,
              commission: float = 0.001, signal_interval: str = "1d", lookback_bars: int = 100) -> None:
        if account_id in cls._runs:
            cls.stop(account_id)
        strat = BacktestEngine.load_strategy_class(strategy_id)(name=strategy_id)
        engine = LiveEngine(symbol=symbol, interval=10.0, lookback_bars=lookback_bars, signal_interval=signal_interval)
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
        try:
            run["engine"].stop()
        except Exception:
            pass
        return cls._state_from_engine(run["engine"]._trade_gw._engine)

    @classmethod
    def is_running(cls, account_id: str) -> bool:
        return account_id in cls._runs

    @classmethod
    def get_running_ids(cls):
        return list(cls._runs.keys())

    @classmethod
    def get_state(cls, account_id: str) -> Optional[dict]:
        if account_id not in cls._runs:
            return None
        return cls._state_from_engine(cls._runs[account_id]["engine"]._trade_gw._engine)

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
