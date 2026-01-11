"""
策略管理API
"""
from flask import Blueprint, request, jsonify
import os
from datetime import datetime
import importlib.util
import inspect
from typing import List, Dict, Any

try:
    # 新的策略基类（来自 deltafq）
    from deltafq.strategy.base import BaseStrategy  # type: ignore[import-untyped]
except Exception:  # pragma: no cover - 运行环境若无 deltafq 也不致命
    BaseStrategy = object  # type: ignore[assignment]

strategy_bp = Blueprint('strategy', __name__)

def _get_strategies_folder() -> str:
    """返回策略脚本所在目录"""
    return os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
        "data",
        "strategies",
    )


def _discover_strategy_classes() -> List[Dict[str, Any]]:
    """
    扫描 data/strategies 目录下的 .py 文件，查找继承 BaseStrategy 的策略类。

    返回的每一项包含:
    - id: 类名（前端和回测使用的 strategy_id）
    - name: 同 id
    - description: 类的 docstring
    - type: 固定为 'python'
    - status: 固定为 'active'
    - created_at: 文件创建时间
    """
    strategies_folder = _get_strategies_folder()
    if not os.path.exists(strategies_folder):
        return []

    strategies: List[Dict[str, Any]] = []

    for filename in os.listdir(strategies_folder):
        if not filename.endswith(".py"):
            continue

        filepath = os.path.join(strategies_folder, filename)

        # 动态加载模块
        module_name = f"deltafstation_strategy_{os.path.splitext(filename)[0]}"
        spec = importlib.util.spec_from_file_location(module_name, filepath)
        if spec is None or spec.loader is None:  # 安全检查
            continue

        module = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(module)  # type: ignore[arg-type]
        except Exception:
            # 某个策略脚本出错时，忽略该脚本，避免影响整个系统
            continue

        # 查找继承 BaseStrategy 的类
        for name, obj in inspect.getmembers(module, inspect.isclass):
            if not issubclass(obj, BaseStrategy) or obj is BaseStrategy:
                continue

            stat = os.stat(filepath)
            created_at = datetime.fromtimestamp(stat.st_mtime).isoformat()

            strategies.append(
                {
                    "id": name,
                    "name": name,
                    "description": inspect.getdoc(obj) or "",
                    "type": "python",
                    "status": "active",
                    "created_at": created_at,
                    "updated_at": created_at,
                }
            )

    # 按名称排序，便于前端展示
    strategies.sort(key=lambda x: x["name"])
    return strategies


@strategy_bp.route('', methods=['POST'])
def create_strategy():
    """
    创建新策略 - POST /api/strategies
    原：POST /api/strategy/create

    目前所有策略均通过手写 .py 文件维护，本接口仅返回错误提示，
    避免前端误以为可以在线创建 .json 策略。
    """
    return (
        jsonify(
            {
                "error": "当前版本不支持通过 API 创建策略，请在 data/strategies 下编写 .py 策略脚本。"
            }
        ),
        400,
    )

@strategy_bp.route('', methods=['GET'])
def list_strategies():
    """
    获取策略列表 - GET /api/strategies
    原：GET /api/strategy/list
    """
    try:
        strategies = _discover_strategy_classes()
        return jsonify({"strategies": strategies})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@strategy_bp.route('/<strategy_id>', methods=['GET'])
def get_strategy(strategy_id: str):
    """
    获取单个策略详情 - GET /api/strategies/<strategy_id>
    """
    try:
        strategies = _discover_strategy_classes()
        for s in strategies:
            if s["id"] == strategy_id:
                return jsonify({"strategy": s})

        return jsonify({"error": "Strategy not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@strategy_bp.route('/<strategy_id>', methods=['PUT'])
def update_strategy(strategy_id: str):
    """
    更新策略 - PUT /api/strategies/<strategy_id>

    目前策略通过 .py 文件维护，不支持在线编辑。
    """
    return (
        jsonify(
            {
                "error": f"当前版本不支持通过 API 更新策略 {strategy_id}，请直接编辑对应的 .py 文件。"
            }
        ),
        400,
    )

@strategy_bp.route('/<strategy_id>', methods=['DELETE'])
def delete_strategy(strategy_id: str):
    """
    删除策略 - DELETE /api/strategies/<strategy_id>

    为避免误删源码文件，暂不开放删除接口。
    """
    return (
        jsonify(
            {
                "error": f"当前版本不支持通过 API 删除策略 {strategy_id}，如需删除请手动移除对应 .py 文件。"
            }
        ),
        400,
    )

