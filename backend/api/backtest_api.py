"""
回测API
"""
from flask import Blueprint, request, jsonify
import os
import json
import pandas as pd
from datetime import datetime, timedelta
from backend.core.backtest_engine import BacktestEngine

backtest_bp = Blueprint('backtest', __name__)

@backtest_bp.route('/run', methods=['POST'])
def run_backtest():
    """运行回测"""
    try:
        data = request.get_json()
        
        # 验证必需字段
        required_fields = ['strategy_id', 'data_file', 'start_date', 'end_date']
        if not all(field in data for field in required_fields):
            return jsonify({'error': f'Missing required fields: {required_fields}'}), 400
        
        # 加载策略
        strategies_folder = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'strategies')
        strategy_file = os.path.join(strategies_folder, f"{data['strategy_id']}.json")
        
        if not os.path.exists(strategy_file):
            return jsonify({'error': 'Strategy not found'}), 404
        
        with open(strategy_file, 'r', encoding='utf-8') as f:
            strategy = json.load(f)
        
        # 加载数据
        data_folder = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'raw')
        data_file = os.path.join(data_folder, data['data_file'])
        
        if not os.path.exists(data_file):
            return jsonify({'error': 'Data file not found'}), 404
        
        df = pd.read_csv(data_file)
        df['Date'] = pd.to_datetime(df['Date'])
        df = df.set_index('Date')
        
        # 过滤日期范围
        start_date = pd.to_datetime(data['start_date'])
        end_date = pd.to_datetime(data['end_date'])
        df = df[(df.index >= start_date) & (df.index <= end_date)]
        
        if df.empty:
            return jsonify({'error': 'No data in specified date range'}), 400
        
        # 运行回测
        engine = BacktestEngine()
        results = engine.run_backtest(
            strategy=strategy,
            data=df,
            initial_capital=data.get('initial_capital', 100000),
            commission=data.get('commission', 0.001),
            slippage=data.get('slippage', 0.0005)
        )
        
        # 保存回测结果
        results_folder = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'results')
        os.makedirs(results_folder, exist_ok=True)
        
        result_id = f"backtest_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        result_file = os.path.join(results_folder, f"{result_id}.json")
        
        # 准备结果数据
        result_data = {
            'id': result_id,
            'strategy_id': data['strategy_id'],
            'data_file': data['data_file'],
            'start_date': data['start_date'],
            'end_date': data['end_date'],
            'initial_capital': data.get('initial_capital', 100000),
            'commission': data.get('commission', 0.001),
            'slippage': data.get('slippage', 0.0005),
            'created_at': datetime.now().isoformat(),
            'results': results
        }
        
        with open(result_file, 'w', encoding='utf-8') as f:
            json.dump(result_data, f, ensure_ascii=False, indent=2, default=str)
        
        return jsonify({
            'message': 'Backtest completed successfully',
            'result_id': result_id,
            'results': results
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@backtest_bp.route('/results', methods=['GET'])
def list_results():
    """获取回测结果列表"""
    try:
        results_folder = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'results')
        
        if not os.path.exists(results_folder):
            return jsonify({'results': []})
        
        results = []
        for filename in os.listdir(results_folder):
            if filename.endswith('.json'):
                filepath = os.path.join(results_folder, filename)
                with open(filepath, 'r', encoding='utf-8') as f:
                    result = json.load(f)
                    results.append({
                        'id': result['id'],
                        'strategy_id': result['strategy_id'],
                        'data_file': result['data_file'],
                        'start_date': result['start_date'],
                        'end_date': result['end_date'],
                        'created_at': result['created_at'],
                        'total_return': result['results'].get('total_return', 0),
                        'sharpe_ratio': result['results'].get('sharpe_ratio', 0),
                        'max_drawdown': result['results'].get('max_drawdown', 0)
                    })
        
        return jsonify({'results': results})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@backtest_bp.route('/results/<result_id>', methods=['GET'])
def get_result():
    """获取回测结果详情"""
    try:
        results_folder = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'results')
        result_file = os.path.join(results_folder, f"{result_id}.json")
        
        if not os.path.exists(result_file):
            return jsonify({'error': 'Result not found'}), 404
        
        with open(result_file, 'r', encoding='utf-8') as f:
            result = json.load(f)
        
        return jsonify({'result': result})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500
