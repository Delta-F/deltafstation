"""
GoStrategy API - 策略运行

路由方法说明：
  set_strategy  PUT  /api/gostrategy/<account_id>/strategy  设置账户的策略（启动/替换）。
  chart         GET  /api/gostrategy/<account_id>/chart     获取该账户当前策略的 K 线与信号。

account_id 为通用交易账户标识，可来自 simulation（SIM_xxx）或 broker（未来 BROKER_xxx）。
本 API 按 account_id 解析操作对象（simulation 或 broker），对上层透明。

分层与职责：

                    account_id (SIM_xxx | BROKER_xxx)
                              │
                              ▼
                    ┌─────────────────────┐
                    │   gostrategy_api    │  ← 策略运行（启动 / chart）
                    │  account_id 通用    │
                    └─────────┬───────────┘
                              │ 解析 account_id
              ┌───────────────┴───────────────┐
              ▼                               ▼
    ┌──────────────────┐           ┌──────────────────┐
    │ simulation_api   │           │   broker_api     │
    │ simulation_id    │           │   broker_id      │
    │ data/simulations │           │   (未来实现)      │
    └──────────────────┘           └──────────────────┘
"""
from flask import Blueprint, request, jsonify
import os
import json

from backend.core.strategy_engine import StrategyEngine
from backend.core.utils.simulation_state import config_path, stop_same_account

gostrategy_bp = Blueprint('gostrategy', __name__)


def _resolve_account_config_path(account_id: str):
    """解析 account_id 对应的配置路径。当前仅支持 simulation，后续 broker_api 实现后扩展。"""
    path = config_path(account_id)
    if os.path.exists(path):
        return path
    # 后续：if account_id.startswith('BROKER_'): return broker_config_path(account_id)
    return None


@gostrategy_bp.route('/<account_id>/strategy', methods=['PUT'])
def set_strategy(account_id):
    """设置账户的策略（启动/替换）。body: strategy_id, symbol, signal_interval?, lookback_bars?"""
    try:
        cfg_path = _resolve_account_config_path(account_id)
        if not cfg_path:
            return jsonify({'error': 'Account not found'}), 404
        data = request.get_json() or {}
        strategy_id = (data.get('strategy_id') or '').strip()
        symbol = (data.get('symbol') or '').strip().upper()
        if not strategy_id or not symbol:
            return jsonify({'error': 'Missing strategy_id or symbol'}), 400
        with open(cfg_path, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
        stop_same_account(account_id)
        try:
            StrategyEngine.start(
                account_id=account_id,
                strategy_id=strategy_id,
                symbol=symbol,
                initial_capital=float(cfg.get('initial_capital', 100000)),
                commission=float(cfg.get('commission', 0.001)),
                signal_interval=(data.get('signal_interval') or '1d').lower(),
                lookback_bars=int(data.get('lookback_bars') or 50),
            )
        except Exception as e:
            return jsonify({'error': str(e)}), 500
        cfg['status'] = 'running'
        cfg['strategy_id'] = strategy_id
        cfg['symbol'] = symbol
        cfg['signal_interval'] = (data.get('signal_interval') or '1d').lower()
        with open(cfg_path, 'w', encoding='utf-8') as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        state = StrategyEngine.get_state(account_id)
        if state:
            cfg.update(state)
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
