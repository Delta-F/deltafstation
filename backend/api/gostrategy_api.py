"""GoStrategy API - 策略运行"""
from flask import Blueprint, request, jsonify
import os
import json
import pandas as pd
from datetime import datetime, timedelta

from backend.core.live_engine_runner import LiveEngineRunner
from backend.core.simulation_state_service import config_path, stop_same_account

gostrategy_bp = Blueprint('gostrategy', __name__)


@gostrategy_bp.route('/<simulation_id>/run', methods=['POST'])
def run(simulation_id):
    """启动策略。body: strategy_id, symbol, signal_interval?, lookback_bars?"""
    try:
        if not os.path.exists(config_path(simulation_id)):
            return jsonify({'error': 'Simulation not found'}), 404
        data = request.get_json() or {}
        strategy_id = (data.get('strategy_id') or '').strip()
        symbol = (data.get('symbol') or '').strip().upper()
        if not strategy_id or not symbol:
            return jsonify({'error': 'Missing strategy_id or symbol'}), 400
        with open(config_path(simulation_id), 'r', encoding='utf-8') as f:
            cfg = json.load(f)
        stop_same_account(simulation_id)
        try:
            LiveEngineRunner.start(
                account_id=simulation_id,
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
        with open(config_path(simulation_id), 'w', encoding='utf-8') as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        state = LiveEngineRunner.get_state(simulation_id)
        if state:
            cfg.update(state)
        return jsonify({'simulation': cfg})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@gostrategy_bp.route('/<simulation_id>/chart', methods=['GET'])
def chart(simulation_id):
    """K线+信号（策略运行中）"""
    if not os.path.exists(config_path(simulation_id)):
        return jsonify({'error': 'Simulation not found'}), 404
    info = LiveEngineRunner.get_run_info(simulation_id)
    if not info:
        return jsonify({'error': 'Strategy not running'}), 400
    try:
        from deltafq.data import DataFetcher
        from backend.core.backtest_engine import BacktestEngine
        fetcher = DataFetcher(source='yahoo')
        end = datetime.utcnow()
        start = (end - timedelta(days=100)).strftime('%Y-%m-%d')
        interval = info.get('signal_interval', '1d')
        df = fetcher.fetch_data(info['symbol'], start, end.strftime('%Y-%m-%d'), clean=True, interval=interval)
        if df.empty or len(df) < 5:
            return jsonify({'candles': [], 'signals': []})
        df = df.tail(90)
        strat = BacktestEngine.load_strategy_class(info['strategy_id'])(name=info['strategy_id'])
        sigs = strat.generate_signals(df)
        if sigs is None or sigs.empty:
            sigs = pd.Series([0] * len(df), index=df.index)
        candles = [{'date': (idx.strftime('%Y-%m-%d') if hasattr(idx, 'strftime') else str(idx)[:10]),
                   'open': float(row.get('Open', 0) or 0), 'high': float(row.get('High', 0) or 0),
                   'low': float(row.get('Low', 0) or 0), 'close': float(row.get('Close', 0) or 0)}
                  for idx, row in df.iterrows()]
        return jsonify({'candles': candles, 'signals': [int(x) if pd.notna(x) else 0 for x in sigs]})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
