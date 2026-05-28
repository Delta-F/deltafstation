"""仿真账户配置：路径与停机时落盘（StrategyEngine / SimulationEngine 共用）。"""
import os
import json
from datetime import datetime

from backend.core.strategy_engine import StrategyEngine
from backend.core.simulation_engine import SimulationEngine
from backend.core.utils.engine_snapshot import inject_strategy_id

_BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))


def sim_folder():
    return os.path.join(_BASE_DIR, 'data', 'simulations')


def config_path(sid):
    return os.path.join(sim_folder(), f"{sid}.json")


def _load_cfg(account_id: str) -> dict:
    with open(config_path(account_id), 'r', encoding='utf-8') as f:
        return json.load(f)


def _is_broker_cfg(cfg: dict) -> bool:
    return (cfg.get('account_type') or 'local_paper').strip().lower() == 'broker'


def stop_same_account(account_id: str) -> None:
    """停掉该账户上的已有实例（仿真或 StrategyEngine），并持久化 state 到配置。"""
    cfg = None
    if os.path.exists(config_path(account_id)):
        try:
            cfg = _load_cfg(account_id)
        except Exception:
            cfg = None

    if StrategyEngine.is_running(account_id):
        run_info = StrategyEngine.get_run_info(account_id)
        strategy_id = run_info.get("strategy_id") if run_info else None
        state = StrategyEngine.stop(account_id)
        if os.path.exists(config_path(account_id)):
            try:
                cfg = cfg or _load_cfg(account_id)
                is_broker = _is_broker_cfg(cfg)
                if state and not is_broker:
                    inject_strategy_id(state, strategy_id)
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
                inject_strategy_id(state, "manual")
                cfg = cfg or _load_cfg(account_id)
                if not _is_broker_cfg(cfg):
                    cfg.update(state)
                    cfg['engine_state'] = state
                cfg['status'] = 'stopped'
                cfg['stopped_at'] = datetime.now().isoformat()
                with open(config_path(account_id), 'w', encoding='utf-8') as f:
                    json.dump(cfg, f, ensure_ascii=False, indent=2)
            except Exception:
                pass
