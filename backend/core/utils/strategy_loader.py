"""策略加载 - 从 data/strategies 动态加载策略类，供回测与策略运行共用。"""
import os
import importlib.util
import inspect
from typing import Type

from deltafq.strategy.base import BaseStrategy

_BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
_STRATEGIES_FOLDER = os.path.join(_BASE_DIR, "data", "strategies")


def load_strategy_class(strategy_class_name: str) -> Type[BaseStrategy]:
    """
    从 data/strategies 目录加载策略类。

    Args:
        strategy_class_name: 策略类名

    Returns:
        策略类（继承自 BaseStrategy）

    Raises:
        RuntimeError: 如果策略类未找到
    """
    if not os.path.exists(_STRATEGIES_FOLDER):
        raise RuntimeError("Strategies folder not found")

    for filename in os.listdir(_STRATEGIES_FOLDER):
        if not filename.endswith(".py"):
            continue

        filepath = os.path.join(_STRATEGIES_FOLDER, filename)
        module_name = f"deltafstation_strategy_{os.path.splitext(filename)[0]}"
        spec = importlib.util.spec_from_file_location(module_name, filepath)
        if spec is None or spec.loader is None:
            continue

        module = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(module)
        except Exception:
            continue

        for name, obj in inspect.getmembers(module, inspect.isclass):
            if (name == strategy_class_name and
                    obj is not BaseStrategy and
                    issubclass(obj, BaseStrategy)):
                return obj

    raise RuntimeError(f"Strategy class {strategy_class_name} not found in data/strategies")
