"""
券商交易引擎核心类（miniQMT）。

BrokerEngine 类方法说明：
  connect       连接券商交易网关（miniqmt），若已连接则先断开再重连。
  disconnect    断开当前券商会话并清理内存引用。
  is_connected  判断当前是否存在可用券商会话。
  submit_order  提交限价单（buy/sell），返回柜台委托号字符串。
  cancel_order  撤销指定委托号，返回是否撤单成功。
  snapshot      查询资金、持仓、委托、成交的快照，供前端轮询展示。

快照字段约定：
  - positions: 以柜台持仓为准，包含 symbol/volume/can_use_volume/avg_price/open_price/market_value。
  - orders:    统一映射为前端可识别结构，含 status/raw_status/filled_quantity。
  - trades:    返回当日成交明细，字段与交易页成交表对齐。

状态映射约定（xtconstant.order_status -> 前端 status）：
  - pending:   48/49/50/51/55
  - executed:  56
  - cancelled: 52/53/54/57
"""
from __future__ import annotations

from datetime import datetime, timezone
import threading
from typing import Any, Dict, Optional

from deltafq.live.gateway_registry import create_trade_gateway
from deltafq.live.models import OrderRequest


def _as_int(value: Any, default: int = 0) -> int:
    """将任意输入安全转换为 int，失败回退到 default。"""
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _as_float(value: Any, default: float = 0.0) -> float:
    """将任意输入安全转换为 float，失败回退到 default。"""
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _normalize_order_status(raw_status: Any) -> str:
    """将 xt order_status 映射为前端三态：pending / executed / cancelled。"""
    status = _as_int(raw_status, default=-1)
    if status in {56}:
        return "executed"
    if status in {52, 53, 54, 57}:
        return "cancelled"
    return "pending"


def _normalize_time(value: Any) -> str:
    """将柜台时间字段统一转换为 ISO 字符串；无法识别时返回原始字符串。"""
    if value is None:
        return ""

    # datetime 直接转 ISO
    if isinstance(value, datetime):
        return value.isoformat()

    # 数字时间戳：兼容秒/毫秒
    if isinstance(value, (int, float)):
        ts = float(value)
        if ts > 1e11:  # 毫秒
            ts /= 1000.0
        if ts > 0:
            return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
        return str(value)

    text = str(value).strip()
    if not text:
        return ""

    # 纯数字字符串时间戳
    if text.isdigit():
        ts = float(text)
        if ts > 1e11:  # 毫秒
            ts /= 1000.0
        if ts > 0:
            return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
        return text

    # 已是可读时间字符串，原样返回
    return text


def _infer_action(raw: Any) -> str:
    """从柜台方向字段推断 buy/sell；无法识别时默认 buy。"""
    text = str(raw or "").strip().lower()
    if text in {"buy", "b", "stock_buy", "23"}:
        return "buy"
    if text in {"sell", "s", "stock_sell", "24"}:
        return "sell"
    code = _as_int(raw, default=-1)
    if code == 23:
        return "buy"
    if code == 24:
        return "sell"
    return "buy"


class BrokerEngine:
    """基于 deltafq miniqmt 网关的最小券商会话管理器。"""

    _lock = threading.Lock()
    _trade_gw = None
    _account_id: Optional[str] = None
    _qmt_path: Optional[str] = None

    @classmethod
    def connect(cls, qmt_path: str, account_id: str) -> None:
        """连接券商会话；若已有会话，先断开后按新参数重连。"""
        with cls._lock:
            cls._disconnect_locked()
            trade_gw = create_trade_gateway(
                "miniqmt",
                userdata_mini_path=qmt_path,
                account_id=account_id,
            )
            if not trade_gw.connect():
                raise RuntimeError("broker connect failed")
            cls._trade_gw = trade_gw
            cls._account_id = account_id
            cls._qmt_path = qmt_path

    @classmethod
    def disconnect(cls) -> None:
        """断开券商会话（幂等）。"""
        with cls._lock:
            cls._disconnect_locked()

    @classmethod
    def _disconnect_locked(cls) -> None:
        """在已持有锁的上下文中执行断连并清空缓存引用。"""
        if cls._trade_gw is not None:
            try:
                cls._trade_gw.stop()
            finally:
                cls._trade_gw = None
                cls._account_id = None
                cls._qmt_path = None

    @classmethod
    def is_connected(cls) -> bool:
        """返回当前是否存在可用交易网关连接。"""
        with cls._lock:
            return cls._trade_gw is not None

    @classmethod
    def submit_order(cls, symbol: str, action: str, quantity: int, price: float) -> str:
        """提交限价单并返回柜台委托号（字符串）。"""
        with cls._lock:
            trade_gw = cls._require_connected_locked()
            normalized_action = str(action or "").strip().lower()
            if normalized_action not in {"buy", "sell"}:
                raise ValueError("action must be buy or sell")
            if quantity <= 0:
                raise ValueError("quantity must be > 0")
            if price <= 0:
                raise ValueError("price must be > 0")
            signed_qty = quantity if normalized_action == "buy" else -quantity
            req = OrderRequest(
                symbol=symbol.strip().upper(),
                quantity=signed_qty,
                price=price,
                order_type="limit",
                timestamp=datetime.now(),
            )
            return trade_gw.send_order(req)

    @classmethod
    def cancel_order(cls, order_id: str) -> bool:
        """撤销指定委托；返回 True 表示撤单成功。"""
        with cls._lock:
            trade_gw = cls._require_connected_locked()
            return bool(trade_gw.cancel_order(order_id))

    @classmethod
    def snapshot(cls) -> Dict[str, Any]:
        """返回资金/持仓/委托/成交快照，供交易页轮询渲染。"""
        with cls._lock:
            trade_gw = cls._require_connected_locked()
            client = trade_gw.client
            asset = client.query_stock_asset()
            positions = client.query_stock_positions() or []
            orders = client.query_stock_orders(cancelable_only=False) or []
            trades = client.query_stock_trades() or []

            position_rows = []
            for p in positions:
                position_rows.append(
                    {
                        "symbol": getattr(p, "stock_code", ""),
                        "volume": int(getattr(p, "volume", 0) or 0),
                        "can_use_volume": int(getattr(p, "can_use_volume", 0) or 0),
                        "avg_price": _as_float(getattr(p, "avg_price", 0)),
                        "open_price": _as_float(getattr(p, "open_price", 0)),
                        "last_price": _as_float(getattr(p, "last_price", 0)),
                        "position_profit": _as_float(getattr(p, "position_profit", 0)),
                        "profit_rate": _as_float(getattr(p, "profit_rate", 0)),
                        "market_value": float(getattr(p, "market_value", 0) or 0),
                    }
                )

            order_rows = []
            for o in orders:
                raw_status = getattr(o, "order_status", None)
                action_raw = getattr(o, "order_type", None)
                volume = _as_int(getattr(o, "order_volume", 0))
                traded_volume = _as_int(getattr(o, "traded_volume", 0))
                order_rows.append(
                    {
                        "id": str(getattr(o, "order_id", "") or ""),
                        "symbol": str(getattr(o, "stock_code", "") or "").upper(),
                        "action": _infer_action(action_raw),
                        "price": _as_float(getattr(o, "price", 0)),
                        "quantity": max(volume, 0),
                        "filled_quantity": max(traded_volume, 0),
                        "status": _normalize_order_status(raw_status),
                        "raw_status": _as_int(raw_status, default=-1),
                        "time": _normalize_time(
                            getattr(o, "order_time", None)
                            or getattr(o, "insert_time", None)
                            or None
                        ),
                        "strategy_id": "manual",
                    }
                )

            trade_rows = []
            for t in trades:
                action_raw = getattr(t, "order_type", None)
                trade_rows.append(
                    {
                        "order_id": str(getattr(t, "order_id", "") or ""),
                        "symbol": str(getattr(t, "stock_code", "") or "").upper(),
                        "action": _infer_action(action_raw),
                        "price": _as_float(getattr(t, "traded_price", 0)),
                        "quantity": max(_as_int(getattr(t, "traded_volume", 0)), 0),
                        "timestamp": _normalize_time(
                            getattr(t, "traded_time", None)
                            or getattr(t, "trade_time", None)
                            or None
                        ),
                        "strategy_id": "manual",
                    }
                )

            return {
                "connected": True,
                "account_id": cls._account_id,
                "qmt_path": cls._qmt_path,
                "asset": None
                if asset is None
                else {
                    "cash": float(getattr(asset, "cash", 0) or 0),
                    "frozen_cash": float(getattr(asset, "frozen_cash", 0) or 0),
                    "market_value": float(getattr(asset, "market_value", 0) or 0),
                    "total_asset": float(getattr(asset, "total_asset", 0) or 0),
                },
                "positions": position_rows,
                "orders": order_rows,
                "trades": trade_rows,
            }

    @classmethod
    def _require_connected_locked(cls):
        """在已持有锁时获取网关；未连接则抛出 ValueError。"""
        if cls._trade_gw is None:
            raise ValueError("broker is not connected")
        return cls._trade_gw
