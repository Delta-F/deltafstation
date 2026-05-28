"""
GoStrategy API - 专注策略运行：

- 路由
  - PUT  /api/gostrategy/<account_id>/strategy  启动或替换账户策略。
  - GET  /api/gostrategy/<account_id>/chart     获取当前策略的 K 线与信号。

- 账户与配置
  - account_id：SIM_xxx（含 local_paper 与 broker）。
  - _resolve_account_config_path(account_id)：解析到 data/simulations/<id>.json。

- set_strategy
  - 校验账户存在，body 含 strategy_id / symbol。
  - stop_same_account(account_id)：停掉同账户上的 StrategyEngine / SimulationEngine。
  - paper：从 engine_state 恢复；broker：miniQMT 双网关，不传 paper state。
"""
from flask import Blueprint, request, jsonify
import os
import json

from backend.core.strategy_engine import StrategyEngine
from backend.core.broker_engine import BrokerEngine
from backend.core.utils.sim_persistence import config_path, stop_same_account
from backend.core.utils.engine_snapshot import inject_strategy_id

gostrategy_bp = Blueprint('gostrategy', __name__)


def _resolve_account_config_path(account_id: str):
    """解析 account_id 对应的配置路径。"""
    path = config_path(account_id)
    if os.path.exists(path):
        return path
    return None


@gostrategy_bp.route('/<account_id>/strategy', methods=['PUT'])
def set_strategy(account_id):
    """设置账户的策略（启动/替换）。body: strategy_id, symbol, signal_interval?, lookback_bars?, order_amount? (paper), order_quantity? (broker)"""
    try:
        cfg_path = _resolve_account_config_path(account_id)
        if not cfg_path:
            return jsonify({'error': 'Account not found'}), 404
        data = request.get_json() or {}
        strategy_id = (data.get('strategy_id') or '').strip()
        symbol = (data.get('symbol') or '').strip().upper()
        if not strategy_id or not symbol:
            return jsonify({'error': 'Missing strategy_id or symbol'}), 400
        stop_same_account(account_id)
        with open(cfg_path, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
        account_type = (cfg.get('account_type') or 'local_paper').strip().lower()
        is_broker = account_type == 'broker'

        order_amount = None
        order_quantity = None
        if is_broker:
            if 'order_quantity' in data and data['order_quantity'] is not None:
                try:
                    v = int(data['order_quantity'])
                    if v > 0:
                        order_quantity = v
                except (TypeError, ValueError):
                    pass
        elif 'order_amount' in data and data['order_amount'] is not None:
            try:
                v = float(data['order_amount'])
                if v > 0:
                    order_amount = v
            except (TypeError, ValueError):
                pass
        signal_interval = (data.get('signal_interval') or '1d').lower()
        lookback_bars = int(data.get('lookback_bars') or 50)
        tick_interval = 5.0 if is_broker else 10.0

        engine_state = None if is_broker else cfg.get('engine_state')

        if is_broker:
            qmt_path = str(cfg.get('qmt_path') or '').strip()
            broker_account = str(cfg.get('broker_account') or '').strip()
            if not qmt_path or not broker_account:
                return jsonify({'error': 'Broker account missing qmt_path or broker_account'}), 400
            if BrokerEngine.is_connected():
                BrokerEngine.disconnect()
        else:
            qmt_path = None
            broker_account = None

        try:
            StrategyEngine.start(
                account_id=account_id,
                strategy_id=strategy_id,
                symbol=symbol,
                initial_capital=float(cfg.get('initial_capital', 100000)),
                commission=float(cfg.get('commission', 0.001)),
                signal_interval=signal_interval,
                lookback_bars=lookback_bars,
                interval=tick_interval,
                order_amount=order_amount,
                order_quantity=order_quantity,
                state=engine_state,
                account_type=account_type,
                qmt_path=qmt_path,
                broker_account=broker_account,
            )
        except Exception as e:
            return jsonify({'error': str(e)}), 500

        cfg['status'] = 'running'
        cfg['strategy_id'] = strategy_id
        cfg['symbol'] = symbol
        cfg['signal_interval'] = signal_interval
        if is_broker:
            if order_quantity is not None:
                cfg['order_quantity'] = order_quantity
        elif order_amount is not None:
            cfg['order_amount'] = order_amount
        with open(cfg_path, 'w', encoding='utf-8') as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)

        state = StrategyEngine.get_state(account_id)
        if state:
            inject_strategy_id(state, strategy_id)
            if not is_broker:
                cfg.update(state)
        run_info = StrategyEngine.get_run_info(account_id) or {}
        cfg['account_type'] = account_type
        cfg['last_signal'] = run_info.get('last_signal')
        cfg['last_signal_label'] = run_info.get('last_signal_label')
        if is_broker:
            if order_quantity is not None:
                cfg['order_quantity'] = order_quantity
        elif order_amount is not None:
            cfg['order_amount'] = order_amount
        return jsonify({'simulation': cfg})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@gostrategy_bp.route('/<account_id>/chart', methods=['GET'])
def chart(account_id):
    """K线+信号（策略运行中）。直接使用 deltafq LiveEngine.get_chart_data。"""
    cfg_path = _resolve_account_config_path(account_id)
    if not cfg_path:
        return jsonify({'error': 'Account not found'}), 404
    info = StrategyEngine.get_run_info(account_id)
    if not info:
        return jsonify({'error': 'Strategy not running'}), 400
    try:
        chart_data = StrategyEngine.get_chart_data(account_id)
        if chart_data is None:
            return jsonify({'candles': [], 'signals': []})
        return jsonify(chart_data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
