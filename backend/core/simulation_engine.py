"""
仿真交易引擎核心类

SimulationEngine 类方法说明：
  start          启动指定账户的仿真引擎，可选从 state 恢复资金/持仓/挂单。
  stop           停止并移除该账户的引擎与行情网关。
  is_running     判断指定 account_id 是否在运行。
  get_running_ids 返回当前所有运行中的 account_id 列表。
  get_state      获取该账户的资金、持仓、成交、订单及冻结资金快照。
  subscribe      为账户订阅指定标的行情（按需拉 tick）。
  submit_order   提交限价单并自动订阅标的，返回订单 id。
  cancel_order   撤销指定订单。

恢复与续号约定（重启账户）：
  1) 恢复现金与持仓（cash / position_manager）。
  2) 恢复历史成交（eng.trades），保证前端“成交”可回显。
  3) 恢复 order_manager.orders（保留历史订单 id 和状态）。
  4) 从历史订单 id 计算最大序号，推进 order_counter，避免重启后从 ORD_000001 重新编号。
"""
from datetime import datetime
import re
from typing import Any, Optional

from deltafq.live import EventEngine
from deltafq.live.event_engine import EVENT_TICK
from deltafq.live.gateway_registry import create_data_gateway, create_trade_gateway
from deltafq.live.models import OrderRequest


def _ts_str(ts: Any) -> str:
    """时间戳转字符串，兼容 datetime 或其它类型。"""
    return ts.isoformat() if hasattr(ts, "isoformat") else str(ts)


def _pending_order_request(o: dict) -> Optional[OrderRequest]:
    """从 state 中的订单字典构造 OrderRequest，无效则返回 None。仅处理 pending 限价单。"""
    if o.get("status") != "pending":
        return None
    symbol = o.get("symbol")
    qty = int(o.get("quantity", 0) or 0)
    price = float(o.get("price", 0) or 0)
    if not symbol or qty <= 0 or price <= 0:
        return None
    action = o.get("action", "buy")
    signed_qty = qty if action == "buy" else -qty
    return OrderRequest(
        symbol=symbol,
        quantity=signed_qty,
        price=price,
        order_type=o.get("type", "limit"),
        timestamp=datetime.now(),
    )


def _parse_dt(value: Any) -> datetime:
    """将字符串/时间对象转为 datetime，失败回退到当前时间。"""
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except Exception:
            return datetime.now()
    return datetime.now()


def _order_seq(order_id: Any) -> int:
    """从 ORD_000123 提取数值序号。"""
    if not isinstance(order_id, str):
        return 0
    m = re.search(r"(\d+)$", order_id)
    return int(m.group(1)) if m else 0


class SimulationEngine:
    """基于 deltafq 的仿真引擎：内存中维护运行中的账户，撮合与行情由 deltafq 完成。"""
    _accounts = {}  # account_id -> { event_engine, data_gw, trade_gw }

    @classmethod
    def start(
        cls,
        account_id: str,
        initial_capital: float,
        commission: float = 0.001,
        state: Optional[dict] = None,
    ) -> None:
        """启动指定账户的仿真引擎，可选从 state 恢复资金/持仓/挂单。"""
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

        # 如有快照，恢复资金 / 持仓 / 成交 / 订单
        if state:
            eng = trade_gw._engine
            if state.get("current_capital") is not None:
                eng.cash = float(state["current_capital"])
            for sym, p in state.get("positions", {}).items():
                eng.position_manager.positions[sym] = {
                    "quantity": p.get("quantity", 0),
                    "avg_price": p.get("avg_price", 0.0),
                }
            # 恢复历史成交，保证重启后成交列表可回显
            eng.trades = []
            for t in state.get("trades", []):
                action = t.get("action", "buy")
                qty = int(t.get("quantity", 0) or 0)
                signed_qty = qty if action == "buy" else -qty
                eng.trades.append({
                    "symbol": t.get("symbol"),
                    "type": action,
                    "quantity": signed_qty,
                    "price": float(t.get("price", 0) or 0),
                    "timestamp": t.get("timestamp"),
                    "order_id": t.get("order_id"),
                    "commission": float(t.get("commission", 0) or 0),
                })

            # 直接恢复 order_manager 内部订单字典，保留原始 id，避免重启后从 ORD_000001 重新编号
            om = eng.order_manager
            om.orders = {}
            max_seq = int(getattr(om, "order_counter", 0) or 0)
            for o in state.get("orders", []):
                oid = o.get("id")
                if not oid:
                    continue
                action = o.get("action", "buy")
                qty = int(o.get("quantity", 0) or 0)
                signed_qty = qty if action == "buy" else -qty
                created_at = _parse_dt(o.get("time"))
                om.orders[oid] = {
                    "id": oid,
                    "symbol": o.get("symbol"),
                    "quantity": signed_qty,
                    "order_type": o.get("type", "limit"),
                    "price": float(o.get("price", 0) or 0),
                    "stop_price": None,
                    "status": o.get("status", "pending"),
                    "created_at": created_at,
                    "updated_at": created_at,
                }
                max_seq = max(max_seq, _order_seq(oid))

            # 推进计数器，确保新委托编号在历史最大号之后继续递增
            om.order_counter = max_seq

    @classmethod
    def stop(cls, account_id: str) -> None:
        """停止并移除该账户的引擎与行情网关（幂等，容忍并发调用）。"""
        # 使用 pop 保证并发场景下不会抛 KeyError
        account = cls._accounts.pop(account_id, None)
        if not account:
            return
        try:
            account["data_gw"].stop()
        except Exception:
            # 停止失败不影响账户字典已被移除，避免再次使用半关闭实例
            pass

    @classmethod
    def is_running(cls, account_id: str) -> bool:
        """判断指定 account_id 是否在运行。"""
        return account_id in cls._accounts

    @classmethod
    def get_running_ids(cls):
        """返回当前所有运行中的 account_id 列表。"""
        return list(cls._accounts)

    @classmethod
    def get_state(cls, account_id: str) -> Optional[dict]:
        """获取该账户的资金、持仓、成交、订单及冻结资金快照。"""
        if account_id not in cls._accounts:
            return None
        eng = cls._accounts[account_id]["trade_gw"]._engine
        pos = {s: {"quantity": p["quantity"], "avg_price": p["avg_price"]}
                for s, p in eng.position_manager.positions.items()}
        trades = [
            {
                "symbol": t["symbol"], "action": t["type"], "quantity": abs(t["quantity"]),
                "price": t["price"], "timestamp": _ts_str(t.get("timestamp")),
                "order_id": t.get("order_id"), "commission": t.get("commission", 0),
            }
            for t in eng.trades
        ]
        orders = []
        frozen_capital = 0.0
        for o in eng.order_manager.get_order_history():
            orders.append({
                "id": o["id"], "symbol": o["symbol"], "action": "buy" if o["quantity"] > 0 else "sell",
                "quantity": abs(o["quantity"]), "price": o["price"], "status": o["status"],
                "type": o["order_type"], "time": _ts_str(o.get("created_at")),
            })
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
    def subscribe(cls, account_id: str, symbol: str) -> None:
        """为账户订阅指定标的行情（按需拉 tick）。"""
        if account_id not in cls._accounts:
            return
        cls._accounts[account_id]["data_gw"].subscribe([symbol])

    @classmethod
    def submit_order(cls, account_id: str, symbol: str, action: str, quantity: int, price: float) -> str:
        """提交限价单并自动订阅标的，返回订单 id。"""
        if account_id not in cls._accounts:
            raise ValueError("account not running")
        cls.subscribe(account_id, symbol)
        qty = quantity if action == "buy" else -quantity
        req = OrderRequest(symbol=symbol, quantity=qty, price=price, order_type="limit", timestamp=datetime.now())
        return cls._accounts[account_id]["trade_gw"].send_order(req)

    @classmethod
    def cancel_order(cls, account_id: str, order_id: str) -> bool:
        """撤销指定订单。"""
        if account_id not in cls._accounts:
            raise ValueError("account not running")
        return cls._accounts[account_id]["trade_gw"]._engine.order_manager.cancel_order(order_id)
