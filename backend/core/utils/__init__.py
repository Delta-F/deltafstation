"""Core 层辅助模块。"""
# simulation_state 不在此 import，避免与 StrategyEngine 循环依赖
from backend.core.utils.engine_state import build_state_from_engine
from backend.core.utils.strategy_loader import load_strategy_class

__all__ = ["build_state_from_engine", "load_strategy_class"]
