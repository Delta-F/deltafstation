"""
仿真/账户 API。本地模拟基于 deltafq（paper + yfinance）；券商实盘仅前端占位。

目录:
  POST   /api/simulations              创建账户（本地模拟）
  GET    /api/simulations              仿真列表
  GET    /api/simulations/<id>         仿真状态
  PUT    /api/simulations/<id>         停止仿真
  POST   /api/simulations/<id>/start   开启账户运行
  POST   /api/simulations/<id>/trades  下单
"""
from flask import Blueprint, request, jsonify
import os
import re
import json
from datetime import datetime

from backend.core.simulation_engine import SimulationEngine

simulation_bp = Blueprint('simulation', __name__)

def _sim_folder():
    return os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'simulations')

def _config_path(sid):
    return os.path.join(_sim_folder(), f"{sid}.json")

def _name_to_id(name):
    """用户输入名称转成唯一 id（仅字母数字下划线横线，文件名安全）。"""
    s = re.sub(r'[^a-zA-Z0-9_\-]', '_', (name or '').strip())
    s = s[:48].strip('_')
    return s or f"sim_{datetime.now().strftime('%Y%m%d%H%M%S')}"


def _stop_others_except(account_id: str) -> None:
    """只允许当前账户运行：停掉其余所有运行中的账户并更新配置为已关闭。"""
    for sid in SimulationEngine.get_running_ids():
        if sid == account_id:
            continue
        SimulationEngine.stop(sid)
        if os.path.exists(_config_path(sid)):
            try:
                with open(_config_path(sid), 'r', encoding='utf-8') as f:
                    cfg = json.load(f)
                cfg['status'] = 'stopped'
                cfg['stopped_at'] = datetime.now().isoformat()
                with open(_config_path(sid), 'w', encoding='utf-8') as f:
                    json.dump(cfg, f, ensure_ascii=False, indent=2)
            except Exception:
                pass


@simulation_bp.route('', methods=['POST'])
def start_simulation():
    data = request.get_json() or {}
    if data.get('account_type') == 'broker':
        return jsonify({'error': '券商实盘暂未开通此功能'}), 400
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': '请填写账户名称'}), 400
    if not data.get('initial_capital'):
        return jsonify({'error': 'Missing required field: initial_capital'}), 400

    account_id = _name_to_id(name)
    if os.path.exists(_config_path(account_id)):
        return jsonify({'error': '账户名称已存在'}), 400

    capital = float(data['initial_capital'])
    commission = float(data.get('commission', 0.001))
    slippage = float(data.get('slippage', 0.0005))

    _stop_others_except(account_id)
    try:
        SimulationEngine.start(account_id, capital, commission)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

    os.makedirs(_sim_folder(), exist_ok=True)
    cfg = {
        'id': account_id, 'name': name, 'account_type': 'local_paper',
        'initial_capital': capital, 'commission': commission, 'slippage': slippage,
        'status': 'running', 'created_at': datetime.now().isoformat(),
        'current_capital': capital, 'positions': {}, 'trades': [],
    }
    with open(_config_path(account_id), 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)

    return jsonify({'message': 'Simulation started successfully', 'simulation_id': account_id})


@simulation_bp.route('/<simulation_id>', methods=['PUT'])
def stop_simulation(simulation_id):
    if not os.path.exists(_config_path(simulation_id)):
        return jsonify({'error': 'Simulation not found'}), 404
    SimulationEngine.stop(simulation_id)
    with open(_config_path(simulation_id), 'r', encoding='utf-8') as f:
        config = json.load(f)
    config['status'] = 'stopped'
    config['stopped_at'] = datetime.now().isoformat()
    with open(_config_path(simulation_id), 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    return jsonify({'simulation': config})


@simulation_bp.route('/<simulation_id>/start', methods=['POST'])
def start_existing(simulation_id):
    """开启已有账户（从配置恢复并启动引擎）。"""
    if not os.path.exists(_config_path(simulation_id)):
        return jsonify({'error': 'Simulation not found'}), 404
    with open(_config_path(simulation_id), 'r', encoding='utf-8') as f:
        config = json.load(f)
    if SimulationEngine.is_running(simulation_id):
        state = SimulationEngine.get_state(simulation_id)
        config.update(state)
        config['status'] = 'running'
        return jsonify({'simulation': config})
    _stop_others_except(simulation_id)
    capital = float(config.get('initial_capital', 100000))
    commission = float(config.get('commission', 0.001))
    try:
        SimulationEngine.start(simulation_id, capital, commission)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    config['status'] = 'running'
    with open(_config_path(simulation_id), 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    state = SimulationEngine.get_state(simulation_id)
    config.update(state)
    return jsonify({'simulation': config})


@simulation_bp.route('/<simulation_id>', methods=['GET'])
def get_simulation_status(simulation_id):
    if not os.path.exists(_config_path(simulation_id)):
        return jsonify({'error': 'Simulation not found'}), 404
    with open(_config_path(simulation_id), 'r', encoding='utf-8') as f:
        config = json.load(f)
    if SimulationEngine.is_running(simulation_id):
        state = SimulationEngine.get_state(simulation_id)
        config.update(state)
        config['status'] = 'running'
    elif config.get('status') == 'running':
        config['status'] = 'stopped'
    return jsonify({'simulation': config})


@simulation_bp.route('', methods=['GET'])
def list_simulations():
    folder = _sim_folder()
    if not os.path.exists(folder):
        return jsonify({'simulations': []})
    simulations = []
    for fn in os.listdir(folder):
        if not fn.endswith('.json'):
            continue
        path = os.path.join(folder, fn)
        if os.path.getsize(path) == 0:
            continue
        try:
            with open(path, 'r', encoding='utf-8') as f:
                s = json.load(f)
            sid = s.get('id', fn.replace('.json', ''))
            st = s.get('status', 'unknown')
            if st == 'running' and not SimulationEngine.is_running(sid):
                st = 'stopped'
            simulations.append({
                'id': sid,
                'name': s.get('name', sid),
                'account_type': s.get('account_type', 'local_paper'),
                'status': st,
                'initial_capital': s.get('initial_capital', 0),
                'current_capital': s.get('current_capital', s.get('initial_capital', 0)),
                'created_at': s.get('created_at', 'unknown'),
            })
        except Exception:
            continue
    return jsonify({'simulations': simulations})


@simulation_bp.route('/<simulation_id>/trades', methods=['POST'])
def execute_trade(simulation_id):
    data = request.get_json() or {}
    for k in ('symbol', 'action', 'quantity'):
        if k not in data:
            return jsonify({'error': f'Missing required fields: symbol, action, quantity'}), 400
    if not os.path.exists(_config_path(simulation_id)):
        return jsonify({'error': 'Simulation not found'}), 404
    if not SimulationEngine.is_running(simulation_id):
        return jsonify({'error': 'Simulation is not running'}), 400
    price = float(data.get('price', 0))
    if price <= 0:
        return jsonify({'error': 'price required for limit order'}), 400
    try:
        order_id = SimulationEngine.submit_order(simulation_id, data['symbol'].strip().upper(), data['action'], int(data['quantity']), price)
    except Exception as e:
        return jsonify({'error': str(e)}), 400
    return jsonify({'message': 'Order submitted', 'order_id': order_id})
