"""
回测API - 使用 deltafq 量化框架
"""
from flask import Blueprint, request, jsonify
import os
import json
import pandas as pd
from datetime import datetime
from typing import Any
import importlib.util
import inspect
from deltafq.backtest import BacktestEngine as DeltaFqBacktestEngine
from deltafq.strategy.base import BaseStrategy

backtest_bp = Blueprint("backtest", __name__)


def _get_strategies_folder() -> str:
    return os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
        "data",
        "strategies",
    )


def _load_strategy_class(strategy_class_name: str):
    """从 data/strategies 下找到给定类名的策略类，返回类对象。"""
    strategies_folder = _get_strategies_folder()
    if not os.path.exists(strategies_folder):
        raise RuntimeError("Strategies folder not found")

    for filename in os.listdir(strategies_folder):
        if not filename.endswith(".py"):
            continue

        filepath = os.path.join(strategies_folder, filename)
        module_name = f"deltafstation_backtest_strategy_{os.path.splitext(filename)[0]}"
        spec = importlib.util.spec_from_file_location(module_name, filepath)
        if spec is None or spec.loader is None:
            continue

        module = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(module)  # type: ignore[arg-type]
        except Exception:
            continue

        for name, obj in inspect.getmembers(module, inspect.isclass):
            if name != strategy_class_name:
                continue
            if not issubclass(obj, BaseStrategy) or obj is BaseStrategy:
                continue

            return obj

    raise RuntimeError(f"Strategy class {strategy_class_name} not found in data/strategies")


def _convert_to_json_serializable(obj):
    """将 pandas/numpy 对象转换为 JSON 可序列化的格式"""
    import math
    import numpy as np
    
    if isinstance(obj, pd.DataFrame):
        # DataFrame 转字典列表
        result = obj.to_dict("records")
        # 处理每个记录中的特殊类型
        for record in result:
            for key, value in list(record.items()):
                record[key] = _convert_to_json_serializable(value)
        return result
    elif isinstance(obj, pd.Series):
        # Series 转列表
        return [_convert_to_json_serializable(item) for item in obj.tolist()]
    elif isinstance(obj, dict):
        # 递归处理字典
        return {k: _convert_to_json_serializable(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        # 递归处理列表
        return [_convert_to_json_serializable(item) for item in obj]
    elif isinstance(obj, pd.Timestamp):
        return obj.strftime("%Y-%m-%d %H:%M:%S")
    elif isinstance(obj, pd.Timedelta):
        return str(obj)
    elif isinstance(obj, (int, float, np.integer, np.floating)):
        # 处理 NaN、Infinity 和 -Infinity
        # 先转换为 Python 原生类型
        try:
            if isinstance(obj, (np.integer, np.floating)):
                obj = float(obj) if isinstance(obj, np.floating) else int(obj)
        except (OverflowError, ValueError):
            return None
        
        # 检查 NaN
        if pd.isna(obj):
            return None
        
        # 检查 Infinity
        try:
            if math.isinf(obj):
                return None  # 将 Infinity 转换为 None
            if math.isnan(obj):
                return None
        except (TypeError, ValueError):
            pass
        
        # 检查是否为有效的数值
        try:
            # 确保值在合理范围内
            if abs(obj) > 1e308:  # 接近 Infinity 的值
                return None
            return obj
        except (TypeError, ValueError, OverflowError):
            return None
    else:
        return obj


@backtest_bp.route("", methods=["POST"])
def run_backtest():
    """
    创建并运行回测 - POST /api/backtests
    原：POST /api/backtest/run
    """
    try:
        payload: Any = request.get_json()

        # 基本字段验证
        if not payload.get("strategy_id") or not payload.get("data_file"):
            return jsonify({"error": "Missing required fields: strategy_id, data_file"}), 400

        # 加载数据
        data_folder = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
            "data",
            "raw",
        )
        data_file = os.path.join(data_folder, payload["data_file"])

        if not os.path.exists(data_file):
            return jsonify({"error": "Data file not found"}), 404

        df = pd.read_csv(data_file)
        if "Date" in df.columns:
            df["Date"] = pd.to_datetime(df["Date"])
            df = df.set_index("Date")

        # 过滤日期范围（如果提供）
        if payload.get("start_date") and payload.get("end_date"):
            start_date = pd.to_datetime(payload["start_date"])
            end_date = pd.to_datetime(payload["end_date"])
            df = df[(df.index >= start_date) & (df.index <= end_date)]

        # 提取 symbol
        symbol = payload.get("symbol", payload["data_file"].split("_")[0] if "_" in payload["data_file"] else "ASSET")

        # 加载策略类
        strategy_class = _load_strategy_class(payload["strategy_id"])

        # 初始化 deltafq 回测引擎
        initial_capital = payload.get("initial_capital", 100000)
        commission = payload.get("commission", 0.001)
        engine = DeltaFqBacktestEngine(initial_capital=initial_capital, commission=commission)  # type: ignore[call-arg]

        # 设置数据
        engine.data = df

        # 实例化策略并添加到引擎
        strategy_instance = strategy_class()
        engine.add_strategy(strategy_instance)  # type: ignore[arg-type]

        # 运行回测
        trades_df, values_df = engine.run_backtest(
            symbol=symbol,
            signals=None,
            price_series=df["Close"],
            strategy_name=payload["strategy_id"],
        )

        # 计算指标（原样返回，不做处理）
        values_metrics, metrics = engine.calculate_metrics()  # type: ignore[call-arg]

        # 原样返回所有数据，不做格式化处理
        result = {
            "trades_df": _convert_to_json_serializable(trades_df),
            "values_df": _convert_to_json_serializable(values_df),
            "values_metrics": _convert_to_json_serializable(values_metrics),
            "metrics": _convert_to_json_serializable(metrics),
        }

        # 保存回测结果（可选）
        results_folder = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
            "data",
            "results",
        )
        os.makedirs(results_folder, exist_ok=True)

        result_id = f"backtest_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        result_file = os.path.join(results_folder, f"{result_id}.json")

        result_data = {
            "id": result_id,
            "strategy_id": payload["strategy_id"],
            "data_file": payload["data_file"],
            "start_date": payload.get("start_date"),
            "end_date": payload.get("end_date"),
            "initial_capital": initial_capital,
            "commission": commission,
            "created_at": datetime.now().isoformat(),
            "result": result,
        }

        # 保存前清理 Infinity 值
        cleaned_result_data = _convert_to_json_serializable(result_data)
        
        with open(result_file, "w", encoding="utf-8") as f:
            json.dump(cleaned_result_data, f, ensure_ascii=False, indent=2)

        # 确保返回的结果中不包含 Infinity（再次转换以确保安全）
        safe_result = _convert_to_json_serializable(result)
        
        return jsonify({
            "message": "Backtest completed successfully",
            "result_id": result_id,
            **safe_result
        })

    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        print(f"Backtest error: {e}")
        print(f"Traceback: {error_trace}")
        return jsonify({"error": str(e), "traceback": error_trace}), 500

@backtest_bp.route('', methods=['GET'])
def list_results():
    """
    获取回测结果列表 - GET /api/backtests
    原：GET /api/backtest/results
    """
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
                    # 正确提取 metrics 数据
                    metrics = result.get('result', {}).get('metrics', {})
                    if not metrics and 'metrics' in result:
                        # 兼容旧格式：如果 metrics 直接在 result 中
                        metrics = result.get('metrics', {})
                    
                    results.append({
                        'id': result.get('id', ''),
                        'strategy_id': result.get('strategy_id', ''),
                        'data_file': result.get('data_file', ''),
                        'start_date': result.get('start_date'),
                        'end_date': result.get('end_date'),
                        'created_at': result.get('created_at', ''),
                        'total_return': metrics.get('total_return', 0) if isinstance(metrics, dict) else 0,
                        'sharpe_ratio': metrics.get('sharpe_ratio', 0) if isinstance(metrics, dict) else 0,
                        'max_drawdown': metrics.get('max_drawdown', 0) if isinstance(metrics, dict) else 0
                    })
        
        # 按创建时间倒序排列（最新的在前）
        results.sort(key=lambda x: x.get('created_at', ''), reverse=True)
        
        return jsonify({'results': results})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@backtest_bp.route('/<result_id>', methods=['GET'])
def get_result(result_id: str):
    """
    获取回测结果详情 - GET /api/backtests/<result_id>
    原：GET /api/backtest/results/<result_id>
    """
    try:
        results_folder = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'results')
        result_file = os.path.join(results_folder, f"{result_id}.json")
        
        if not os.path.exists(result_file):
            return jsonify({'error': 'Result not found'}), 404
        
        # 读取文件并处理可能的 Infinity 值
        try:
            with open(result_file, 'r', encoding='utf-8') as f:
                content = f.read()
                # 替换可能的 Infinity 字符串（处理旧文件）
                content = content.replace(': Infinity', ': null')
                content = content.replace(': -Infinity', ': null')
                content = content.replace(': "inf"', ': null')
                content = content.replace(': "-inf"', ': null')
                result = json.loads(content)
        except json.JSONDecodeError as e:
            # 如果 JSON 解析失败，尝试使用更宽松的方式
            import re
            # 替换所有 Infinity 相关的字符串
            content = re.sub(r':\s*Infinity', ': null', content)
            content = re.sub(r':\s*-Infinity', ': null', content)
            result = json.loads(content)
        
        # 清理 Infinity 值，确保 JSON 可序列化
        cleaned_result = _convert_to_json_serializable(result)
        
        return jsonify({'result': cleaned_result})
    
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
