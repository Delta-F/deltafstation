"""
策略管理API
"""
from flask import Blueprint, request, jsonify, send_from_directory
import os
from datetime import datetime
import importlib.util
import inspect
from typing import List, Dict, Any, Optional
from werkzeug.utils import secure_filename
import shutil

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


def _get_strategy_filepath(strategy_id: str) -> Optional[str]:
    """根据策略ID查找物理文件路径"""
    strategies_folder = _get_strategies_folder()
    if not os.path.exists(strategies_folder):
        return None

    for filename in os.listdir(strategies_folder):
        if not filename.endswith(".py"):
            continue
        filepath = os.path.join(strategies_folder, filename)
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                content = f.read()
                # 精确匹配类名定义
                if f"class {strategy_id}" in content:
                    return filepath
        except Exception:
            continue
    return None


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


@strategy_bp.route("", methods=["GET", "POST"])
def handle_strategies():
    """
    处理策略列表 - GET/POST /api/strategies
    
    GET: 获取策略列表
    POST: 上传新的策略文件
    """
    try:
        if request.method == "GET":
            strategies = _discover_strategy_classes()
            return jsonify({"strategies": strategies})

        elif request.method == "POST":
            # 检查是否有文件上传
            if "file" not in request.files:
                return (
                    jsonify({"error": "请求中未包含文件部分，目前仅支持通过上传 .py 文件创建策略。"}),
                    400,
                )

            file = request.files["file"]
            if file.filename == "":
                return jsonify({"error": "未选择上传文件"}), 400

            if file and file.filename.endswith(".py"):
                filename = secure_filename(file.filename)
                strategies_folder = _get_strategies_folder()
                if not os.path.exists(strategies_folder):
                    os.makedirs(strategies_folder)

                filepath = os.path.join(strategies_folder, filename)
                file.save(filepath)
                return jsonify({"message": f"策略文件 {filename} 上传成功"}), 201
            else:
                return jsonify({"error": "只允许上传 .py 格式的 Python 脚本"}), 400

    except Exception as e:
        return jsonify({"error": f"操作失败: {str(e)}"}), 500


@strategy_bp.route("/<strategy_id>", methods=["GET", "DELETE"])
def handle_strategy(strategy_id: str):
    """
    处理单个策略 - GET/DELETE /api/strategies/<strategy_id>
    
    GET: 获取策略详情、内容或下载文件
    DELETE: 删除策略文件
    """
    try:
        filepath = _get_strategy_filepath(strategy_id)
        if not filepath:
            return jsonify({"error": f"未找到策略 {strategy_id} 对应的脚本文件"}), 404

        if request.method == "GET":
            action = request.args.get("action")

            # 1. 下载文件
            if action == "download":
                folder = os.path.dirname(filepath)
                filename = os.path.basename(filepath)
                return send_from_directory(folder, filename, as_attachment=True)

            # 2. 获取源码内容 (JSON)
            elif action == "content":
                with open(filepath, "r", encoding="utf-8") as f:
                    content = f.read()
                return jsonify(
                    {
                        "strategy_id": strategy_id,
                        "filename": os.path.basename(filepath),
                        "content": content,
                    }
                )

            # 3. 获取元数据详情 (默认)
            else:
                strategies = _discover_strategy_classes()
                for s in strategies:
                    if s["id"] == strategy_id:
                        return jsonify({"strategy": s})
                return jsonify({"error": f"策略 {strategy_id} 的元数据已失效"}), 404

        elif request.method == "DELETE":
            if os.path.exists(filepath):
                os.remove(filepath)
                return jsonify({"message": f"策略 {strategy_id} 已成功删除"})
            return jsonify({"error": "文件不存在"}), 404

    except Exception as e:
        return jsonify({"error": f"操作失败: {str(e)}"}), 500


@strategy_bp.route("/<strategy_id>", methods=["PUT"])
def update_strategy(strategy_id: str):
    """
    更新策略 (暂不支持)
    """
    return (
        jsonify({"error": f"当前版本不支持在线更新策略 {strategy_id}，请重新上传文件。"}),
        400,
    )

