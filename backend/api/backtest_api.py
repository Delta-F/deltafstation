"""
回测API - RESTful 风格，通过 Core 层调用回测引擎
"""
from flask import Blueprint, request, jsonify
import os
import json
import math
import re
import traceback
import pandas as pd
import numpy as np
from datetime import datetime
from typing import Any
from backend.core.backtest_engine import BacktestEngine

backtest_bp = Blueprint("backtest", __name__)

# 路径常量
_BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
_DATA_RESULTS_FOLDER = os.path.join(_BASE_DIR, "data", "results")


def _convert_to_json_serializable(obj):
    """将 pandas/numpy 对象转换为 JSON 可序列化的格式"""
    if isinstance(obj, pd.DataFrame):
        return [_convert_to_json_serializable(record) for record in obj.to_dict("records")]
    elif isinstance(obj, pd.Series):
        return [_convert_to_json_serializable(item) for item in obj.tolist()]
    elif isinstance(obj, dict):
        return {k: _convert_to_json_serializable(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [_convert_to_json_serializable(item) for item in obj]
    elif isinstance(obj, pd.Timestamp):
        return obj.strftime("%Y-%m-%d %H:%M:%S")
    elif isinstance(obj, pd.Timedelta):
        return str(obj)
    elif isinstance(obj, (int, float, np.integer, np.floating)):
        try:
            # 转换为 Python 原生类型
            if isinstance(obj, np.floating):
                obj = float(obj)
            elif isinstance(obj, np.integer):
                obj = int(obj)
            
            # 检查 NaN 和 Infinity
            if pd.isna(obj) or math.isinf(obj) or abs(obj) > 1e308:
                return None
            return obj
        except (TypeError, ValueError, OverflowError):
            return None
    else:
        return obj


@backtest_bp.route("", methods=["POST"])
def run_backtest():
    """创建并运行回测 - POST /api/backtests"""
    try:
        payload: Any = request.get_json()
        if not payload or not payload.get("strategy_id") or not payload.get("data_file"):
            return jsonify({"error": "Missing required fields: strategy_id, data_file"}), 400

        # 创建回测引擎
        engine = BacktestEngine(
            initial_capital=payload.get("initial_capital", 100000),
            commission=payload.get("commission", 0.001),
            slippage=payload.get("slippage", 0.0005)
        )
        
        # 运行回测（Core 层处理数据加载和预处理）
        symbol = engine.run_backtest_from_file(
            strategy_id=payload["strategy_id"],
            data_file=payload["data_file"],
            start_date=payload.get("start_date"),
            end_date=payload.get("end_date"),
            symbol=payload.get("symbol")
        )

        # 获取回测结果
        result = {
            "trades_df": _convert_to_json_serializable(engine.get_trades_df()),
            "values_df": _convert_to_json_serializable(engine.get_values_df()),
            "values_metrics": _convert_to_json_serializable(engine.get_values_metrics()),
            "metrics": _convert_to_json_serializable(engine.get_metrics()),
        }

        # 保存结果
        os.makedirs(_DATA_RESULTS_FOLDER, exist_ok=True)
        s_date = payload.get("start_date", "").replace("-", "")
        e_date = payload.get("end_date", "").replace("-", "")
        symbol_name = symbol.split(".")[0] if "." in symbol else symbol
        result_id = f"res_{payload['strategy_id']}_{symbol_name}_{s_date}_{e_date}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        result_data = {
            "id": result_id,
            "strategy_id": payload["strategy_id"],
            "symbol": symbol,
            "data_file": payload["data_file"],
            "start_date": payload.get("start_date"),
            "end_date": payload.get("end_date"),
            "initial_capital": payload.get("initial_capital", 100000),
            "commission": payload.get("commission", 0.001),
            "created_at": datetime.now().isoformat(),
            "result": result,
        }

        with open(os.path.join(_DATA_RESULTS_FOLDER, f"{result_id}.json"), "w", encoding="utf-8") as f:
            json.dump(_convert_to_json_serializable(result_data), f, ensure_ascii=False, indent=2)

        return jsonify({
            "message": "Backtest completed successfully",
            "result_id": result_id,
            **result
        })

    except Exception as e:
        error_trace = traceback.format_exc()
        print(f"Backtest error: {e}\nTraceback: {error_trace}")
        return jsonify({"error": str(e), "traceback": error_trace}), 500

@backtest_bp.route('', methods=['GET'])
def list_results():
    """获取回测结果列表 - GET /api/backtests"""
    try:
        if not os.path.exists(_DATA_RESULTS_FOLDER):
            return jsonify({'results': []})
        
        results = []
        for filename in os.listdir(_DATA_RESULTS_FOLDER):
            if filename.endswith('.json'):
                with open(os.path.join(_DATA_RESULTS_FOLDER, filename), 'r', encoding='utf-8') as f:
                    result = json.load(f)
                    metrics = result.get('result', {}).get('metrics', {}) or result.get('metrics', {})
                    
                    results.append({
                        'id': result.get('id', ''),
                        'strategy_id': result.get('strategy_id', ''),
                        'symbol': result.get('symbol', ''),
                        'data_file': result.get('data_file', ''),
                        'start_date': result.get('start_date'),
                        'end_date': result.get('end_date'),
                        'created_at': result.get('created_at', ''),
                        'total_return': metrics.get('total_return', 0) if isinstance(metrics, dict) else 0,
                        'sharpe_ratio': metrics.get('sharpe_ratio', 0) if isinstance(metrics, dict) else 0,
                        'max_drawdown': metrics.get('max_drawdown', 0) if isinstance(metrics, dict) else 0
                    })
        
        results.sort(key=lambda x: x.get('created_at', ''), reverse=True)
        return jsonify({'results': results})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@backtest_bp.route('', methods=['DELETE'])
def clear_results():
    """清空所有回测结果 - DELETE /api/backtests"""
    try:
        if not os.path.exists(_DATA_RESULTS_FOLDER):
            return jsonify({'message': 'No results to clear'}), 200
        
        count = 0
        for filename in os.listdir(_DATA_RESULTS_FOLDER):
            if filename.endswith('.json'):
                try:
                    os.remove(os.path.join(_DATA_RESULTS_FOLDER, filename))
                    count += 1
                except OSError:
                    pass
        
        return jsonify({'message': f'Successfully cleared {count} results'}), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@backtest_bp.route('/<result_id>', methods=['GET'])
def get_result(result_id: str):
    """获取回测结果详情 - GET /api/backtests/<result_id>"""
    try:
        result_file = os.path.join(_DATA_RESULTS_FOLDER, f"{result_id}.json")
        if not os.path.exists(result_file):
            return jsonify({'error': 'Result not found'}), 404
        
        with open(result_file, 'r', encoding='utf-8') as f:
            content = f.read()
            # 处理旧文件中的 Infinity 字符串
            content = re.sub(r':\s*-?Infinity', ': null', content)
            result = json.loads(content)
        
        return jsonify({'result': _convert_to_json_serializable(result)})
    
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
