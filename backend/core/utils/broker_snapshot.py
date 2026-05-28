"""
券商柜台快照 → 与 paper engine state 对齐的结构（gostrategy / simulation 页共用）。
"""
from __future__ import annotations

from typing import Any, Dict, Optional


def collect_broker_snapshot(trade_gw: Any) -> Dict[str, Any]:
    """从 miniQMT 交易网关拉取原始快照（结构与 BrokerEngine.snapshot 一致）。"""
    from backend.core.broker_engine import (
        _as_float,
        _as_int,
        _infer_action,
        _normalize_order_status,
        _normalize_time,
    )

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
                    getattr(o, "order_time", None) or getattr(o, "insert_time", None) or None
                ),
                "strategy_id": "",
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
                    getattr(t, "traded_time", None) or getattr(t, "trade_time", None) or None
                ),
                "strategy_id": "",
            }
        )

    account_id = getattr(trade_gw, "_account_id", None)
    if account_id is None:
        client_account = getattr(client, "account_id", None)
        account_id = str(client_account) if client_account else None

    return {
        "connected": True,
        "account_id": account_id,
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


def build_state_from_broker_snapshot(snapshot: Dict[str, Any]) -> Dict[str, Any]:
    """将券商快照转为 simulation / gostrategy 使用的 state 结构。"""
    asset = snapshot.get("asset") or {}
    positions: Dict[str, Dict[str, Any]] = {}
    for p in snapshot.get("positions") or []:
        sym = str(p.get("symbol") or "").strip().upper()
        if not sym:
            continue
        qty = int(p.get("can_use_volume") or p.get("volume") or 0)
        if qty <= 0:
            continue
        positions[sym] = {
            "quantity": qty,
            "avg_price": float(p.get("avg_price") or p.get("open_price") or 0),
            "last_price": float(p.get("last_price") or 0),
            "market_value": float(p.get("market_value") or 0),
            "position_profit": float(p.get("position_profit") or 0),
            "profit_rate": float(p.get("profit_rate") or 0),
        }

    trades = []
    for t in snapshot.get("trades") or []:
        trades.append(
            {
                "symbol": t.get("symbol", ""),
                "action": t.get("action", "buy"),
                "quantity": int(t.get("quantity") or 0),
                "price": float(t.get("price") or 0),
                "timestamp": t.get("timestamp", ""),
                "order_id": t.get("order_id", ""),
                **({"strategy_id": t["strategy_id"]} if t.get("strategy_id") else {}),
            }
        )

    orders = []
    for o in snapshot.get("orders") or []:
        orders.append(
            {
                "id": o.get("id", ""),
                "symbol": o.get("symbol", ""),
                "action": o.get("action", "buy"),
                "quantity": int(o.get("quantity") or 0),
                "price": float(o.get("price") or 0),
                "status": o.get("status", "pending"),
                "type": "limit",
                "time": o.get("time", ""),
                **({"strategy_id": o["strategy_id"]} if o.get("strategy_id") else {}),
            }
        )

    frozen = float(asset.get("frozen_cash") or 0)
    return {
        "current_capital": float(asset.get("cash") or 0),
        "positions": positions,
        "trades": trades,
        "orders": orders,
        "frozen_capital": frozen,
    }


def build_state_from_trade_gateway(trade_gw: Any) -> Optional[Dict[str, Any]]:
    """从运行中的 miniQMT 交易网关构建 state；未连接时返回 None。"""
    if trade_gw is None:
        return None
    client = getattr(trade_gw, "client", None)
    if client is None or not getattr(client, "is_connected", lambda: False)():
        return None
    try:
        snapshot = collect_broker_snapshot(trade_gw)
        return build_state_from_broker_snapshot(snapshot)
    except Exception:
        return None
