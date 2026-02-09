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
        # 移除默认订阅，改为按需订阅
        cls._accounts[account_id] = {"event_engine": event_engine, "data_gw": data_gw, "trade_gw": trade_gw}

    @classmethod
    def subscribe(cls, account_id: str, symbol: str) -> None:
        if account_id not in cls._accounts:
            return
        # 简单去重或依赖 gateway 内部处理
        cls._accounts[account_id]["data_gw"].subscribe([symbol])

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
        
        # 1. 持仓
        pos = {s: {"quantity": p["quantity"], "avg_price": p["avg_price"]}
                for s, p in eng.position_manager.positions.items()}
        
        # 2. 成交记录
        trades = []
        for t in eng.trades:
            ts = t.get("timestamp")
            trades.append({
                "symbol": t["symbol"], "action": t["type"], "quantity": abs(t["quantity"]),
                "price": t["price"], "timestamp": ts.isoformat() if hasattr(ts, "isoformat") else str(ts),
                "order_id": t.get("order_id"),
                "commission": t.get("commission", 0),
            })
            
        # 3. 订单记录 (含活动和历史)
        orders = []
        frozen_capital = 0.0
        for o in eng.order_manager.get_order_history():
            ts = o.get("created_at")
            orders.append({
                "id": o["id"], "symbol": o["symbol"], "action": "buy" if o["quantity"] > 0 else "sell",
                "quantity": abs(o["quantity"]), "price": o["price"], "status": o["status"],
                "type": o["order_type"],
                "time": ts.isoformat() if hasattr(ts, "isoformat") else str(ts)
            })
            # 计算冻结资金（仅限价买单）
            if o["status"] == "pending" and o["quantity"] > 0 and o["price"]:
                frozen_capital += o["quantity"] * o["price"]

        return {
            "current_capital": eng.cash,
            "positions": pos,
            "trades": trades,
            "orders": orders,
            "frozen_capital": frozen_capital,
        }

    @classmethod
    def submit_order(cls, account_id: str, symbol: str, action: str, quantity: int, price: float) -> str:
        if account_id not in cls._accounts:
            raise ValueError("account not running")
        
        # 自动订阅该标的行情，确保有 tick 数据驱动撮合
        cls.subscribe(account_id, symbol)
        
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

    @classmethod
    def cancel_order(cls, account_id: str, order_id: str) -> bool:
        if account_id not in cls._accounts:
            raise ValueError("account not running")
        # 直接调用 trade gateway 的 order manager 进行撤单
        return cls._accounts[account_id]["trade_gw"]._engine.order_manager.cancel_order(order_id)
