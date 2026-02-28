"""引擎 state 转换 - SimulationEngine 与 StrategyEngine 共用。"""
from typing import Any


def _ts_str(ts: Any) -> str:
    return ts.isoformat() if hasattr(ts, "isoformat") else str(ts)


def build_state_from_engine(eng) -> dict:
    """从 trade engine 构建 state 字典（资金、持仓、成交、订单、冻结）。"""
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
