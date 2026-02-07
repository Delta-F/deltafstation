"""
仿真交易引擎：基于 deltafq（EventEngine + yfinance 行情 + paper 交易网关），按 tick 撮合。
持久化由 API 层写入 data/simulations/。
"""
from datetime import datetime
from typing import Optional

from deltafq.live import EventEngine
from deltafq.live.event_engine import EVENT_TICK
from deltafq.live.gateway_registry import create_data_gateway, create_trade_gateway
from deltafq.live.models import OrderRequest


class SimulationEngine:
    """基于 deltafq 的仿真引擎：内存中维护运行中的账户，撮合与行情由 deltafq 完成。"""
    _accounts = {}  # account_id -> { event_engine, data_gw, trade_gw }
    DEFAULT_SYMBOLS = ["000001.SS"]

    @classmethod
    def start(cls, account_id: str, initial_capital: float, commission: float = 0.001) -> None:
        if account_id in cls._accounts:
            return
        event_engine = EventEngine()
        data_gw = create_data_gateway("yfinance", interval=5.0)
        trade_gw = create_trade_gateway("paper", initial_capital=initial_capital, commission=commission)
        if not trade_gw.connect() or not data_gw.connect():
            raise RuntimeError("gateway connect failed")
        data_gw.set_tick_handler(lambda t: event_engine.emit(EVENT_TICK, t))
        event_engine.on(EVENT_TICK, lambda t: trade_gw._engine.on_tick(t))
        data_gw.start()
        data_gw.subscribe(cls.DEFAULT_SYMBOLS)
        cls._accounts[account_id] = {"event_engine": event_engine, "data_gw": data_gw, "trade_gw": trade_gw}

    @classmethod
    def stop(cls, account_id: str) -> None:
        if account_id not in cls._accounts:
            return
        cls._accounts[account_id]["data_gw"].stop()
        del cls._accounts[account_id]

    @classmethod
    def get_state(cls, account_id: str) -> Optional[dict]:
        if account_id not in cls._accounts:
            return None
        eng = cls._accounts[account_id]["trade_gw"]._engine
        pos = {s: {"quantity": p["quantity"], "avg_price": p["avg_price"]}
                for s, p in eng.position_manager.positions.items()}
        trades = []
        for t in eng.trades:
            ts = t.get("timestamp")
            trades.append({
                "symbol": t["symbol"], "action": t["type"], "quantity": abs(t["quantity"]),
                "price": t["price"], "timestamp": ts.isoformat() if hasattr(ts, "isoformat") else str(ts),
                "order_id": t.get("order_id"),
            })
        return {
            "current_capital": eng.cash,
            "positions": pos,
            "trades": trades,
            "frozen_capital": 0,
        }

    @classmethod
    def submit_order(cls, account_id: str, symbol: str, action: str, quantity: int, price: float) -> str:
        if account_id not in cls._accounts:
            raise ValueError("account not running")
        qty = quantity if action == "buy" else -quantity
        req = OrderRequest(symbol=symbol, quantity=qty, price=price, order_type="limit", timestamp=datetime.now())
        return cls._accounts[account_id]["trade_gw"].send_order(req)

    @classmethod
    def is_running(cls, account_id: str) -> bool:
        return account_id in cls._accounts

    @classmethod
    def get_running_ids(cls):
        """返回当前所有运行中的 account_id，用于「仅允许一个账户运行」时停掉其余。"""
        return list(cls._accounts.keys())
