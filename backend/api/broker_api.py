"""
券商交易 API（/api/broker）。

用途：
  - 为 trader 页提供最小实盘联调接口（连接、下单、撤单、快照查询）。
  - 与 simulation_api 分离，不影响本地 paper 仿真流程。

路由说明：
  connect_broker     POST   /api/broker/connect        连接 miniQMT 交易会话
  disconnect_broker  POST   /api/broker/disconnect     断开当前会话
  submit_order       POST   /api/broker/orders         提交限价单
  cancel_order      DELETE  /api/broker/orders/<oid>   撤销指定委托
  get_snapshot       GET    /api/broker/snapshot       查询资金/持仓/委托/成交快照
"""
from flask import Blueprint, jsonify, request

from backend.core.broker_engine import BrokerEngine

broker_bp = Blueprint("broker", __name__)


@broker_bp.route("/connect", methods=["POST"])
def connect_broker():
    """连接券商交易会话（必填：account_id、qmt_path）。"""
    data = request.get_json() or {}
    account_id = str(data.get("account_id") or "").strip()
    qmt_path = str(data.get("qmt_path") or "").strip()
    if not account_id:
        return jsonify({"error": "Missing required field: account_id"}), 400
    if not qmt_path:
        return jsonify({"error": "Missing required field: qmt_path"}), 400
    try:
        BrokerEngine.connect(qmt_path=qmt_path, account_id=account_id)
        return jsonify({"message": "Broker connected"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@broker_bp.route("/disconnect", methods=["POST"])
def disconnect_broker():
    """断开当前券商会话（幂等）。"""
    try:
        BrokerEngine.disconnect()
        return jsonify({"message": "Broker disconnected"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@broker_bp.route("/orders", methods=["POST"])
def submit_order():
    """提交限价单（必填：symbol、action、quantity、price）。"""
    data = request.get_json() or {}
    for key in ("symbol", "action", "quantity", "price"):
        if key not in data:
            return jsonify({"error": "Missing required fields: symbol, action, quantity, price"}), 400
    try:
        order_id = BrokerEngine.submit_order(
            symbol=str(data["symbol"]),
            action=str(data["action"]),
            quantity=int(data["quantity"]),
            price=float(data["price"]),
        )
        return jsonify({"message": "Order submitted", "order_id": order_id})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@broker_bp.route("/orders/<order_id>", methods=["DELETE"])
def cancel_order(order_id):
    """撤销指定委托；若订单已完成则返回幂等成功提示。"""
    try:
        ok = BrokerEngine.cancel_order(order_id)
        if ok:
            return jsonify({"message": "Order cancelled"})
        return jsonify({"message": "Order already completed or not pending"}), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@broker_bp.route("/snapshot", methods=["GET"])
def get_snapshot():
    """获取券商快照：资金、持仓、委托、成交。"""
    try:
        return jsonify(BrokerEngine.snapshot())
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500
