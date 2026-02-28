"""仿真账户配置与状态服务（共享逻辑）。"""
import os
import json
from datetime import datetime

from backend.core.strategy_engine import StrategyEngine
from backend.core.simulation_engine import SimulationEngine

_BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))


def sim_folder():
    return os.path.join(_BASE_DIR, 'data', 'simulations')


def config_path(sid):
    return os.path.join(sim_folder(), f"{sid}.json")


def stop_same_account(account_id: str) -> None:
    """停掉该账户上的已有实例（仿真或 StrategyEngine），并持久化 state 到配置。"""
    if StrategyEngine.is_running(account_id):
        state = StrategyEngine.stop(account_id)
        if state and os.path.exists(config_path(account_id)):
            try:
                with open(config_path(account_id), 'r', encoding='utf-8') as f:
                    cfg = json.load(f)
                cfg.update(state)
                cfg['engine_state'] = state
                cfg['status'] = 'stopped'
                cfg['stopped_at'] = datetime.now().isoformat()
                cfg.pop('strategy_id', None)
                cfg.pop('symbol', None)
                with open(config_path(account_id), 'w', encoding='utf-8') as f:
                    json.dump(cfg, f, ensure_ascii=False, indent=2)
            except Exception:
                pass
    if SimulationEngine.is_running(account_id):
        state = SimulationEngine.get_state(account_id)
        SimulationEngine.stop(account_id)
        if state and os.path.exists(config_path(account_id)):
            try:
                with open(config_path(account_id), 'r', encoding='utf-8') as f:
                    cfg = json.load(f)
                cfg.update(state)
                cfg['engine_state'] = state
                cfg['status'] = 'stopped'
                cfg['stopped_at'] = datetime.now().isoformat()
                with open(config_path(account_id), 'w', encoding='utf-8') as f:
                    json.dump(cfg, f, ensure_ascii=False, indent=2)
            except Exception:
                pass
