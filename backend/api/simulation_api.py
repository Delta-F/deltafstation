"""
仿真/账户 API

路由方法说明：
  list_simulations      GET  /api/simulations            返回仿真账户列表。
  get_simulation_status GET  /api/simulations/<id>        返回指定账户状态（含委托/成交合并）。
  start_simulation      POST /api/simulations            创建新账户（可选自动启动）。
  start_existing        POST /api/simulations/<id>/start 从配置启动已有账户。
  stop_simulation       PUT  /api/simulations/<id>       停止并持久化状态。
  delete_simulation     DELETE /api/simulations/<id>    删除账户配置与运行实例。
  execute_trade         POST /api/simulations/<id>/trades 提交限价单。
  cancel_trade_order    DELETE /api/simulations/<id>/orders/<order_id> 撤销订单。
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

def _generate_sim_id():
    """统一生成 SIM_0001 格式的唯一 ID。"""
    folder = _sim_folder()
    prefix = "SIM_"
    if not os.path.exists(folder):
        return f"{prefix}0001"
    pattern = re.compile(rf"^{prefix}(\d{{4,}})\.json$")
    max_num = 0
    for f in os.listdir(folder):
        match = pattern.match(f)
        if match:
            num = int(match.group(1))
            if num > max_num:
                max_num = num
    return f"{prefix}{max_num + 1:04d}"


def _name_exists(name: str) -> bool:
    """检查账户显示名称是否已存在（同名不允许）。"""
    folder = _sim_folder()
    if not os.path.exists(folder):
        return False
    name = (name or '').strip()
    if not name:
        return False
    for fn in os.listdir(folder):
        if not fn.endswith('.json'):
            continue
        try:
            with open(os.path.join(folder, fn), 'r', encoding='utf-8') as f:
                cfg = json.load(f)
            if (cfg.get('name') or '').strip() == name:
                return True
        except Exception:
            continue
    return False


def _apply_state_to_config(config: dict, state: dict) -> None:
    """将引擎 state 写入 config：以引擎为准覆盖资金/持仓/委托/成交等快照。"""
    config.update(state)


def _merge_order_history(saved_orders: list, state_orders: list) -> list:
    """合并文件历史委托与引擎委托，按 id 去重，状态以引擎最新为准。"""
    saved_map = {o.get('id'): o for o in (saved_orders or []) if o.get('id')}
    state_map = {o.get('id'): o for o in (state_orders or []) if o.get('id')}

    merged = []
    seen = set()

    # 保持文件中的历史顺序；若引擎有同 id，则用引擎最新状态覆盖
    for o in (saved_orders or []):
        oid = o.get('id')
        if not oid or oid in seen:
            continue
        merged.append(state_map.get(oid, o))
        seen.add(oid)

    # 追加文件里没有的新委托
    for o in (state_orders or []):
        oid = o.get('id')
        if not oid or oid in seen:
            continue
        merged.append(o)
        seen.add(oid)

    return merged


def _stop_others_except(account_id: str) -> None:
    """
    只允许当前账户运行：停掉其余账户，并在停机前持久化其 state。

    说明：
      - 前端“账户列表点选切换”不会先显式调用 stop_simulation。
      - 因此这里必须兜底：先抓 state 再 stop，再写回 json，避免切账户时丢持仓/委托/成交。
    """
    for sid in SimulationEngine.get_running_ids():
        if sid == account_id:
            continue
        state = None
        try:
            state = SimulationEngine.get_state(sid)
        except Exception:
            state = None
        SimulationEngine.stop(sid)
        if os.path.exists(_config_path(sid)):
            try:
                with open(_config_path(sid), 'r', encoding='utf-8') as f:
                    cfg = json.load(f)
                if state:
                    _apply_state_to_config(cfg, state)
                    cfg['engine_state'] = state
                cfg['status'] = 'stopped'
                cfg['stopped_at'] = datetime.now().isoformat()
                with open(_config_path(sid), 'w', encoding='utf-8') as f:
                    json.dump(cfg, f, ensure_ascii=False, indent=2)
            except Exception:
                pass


@simulation_bp.route('', methods=['GET'])
def list_simulations():
    """返回仿真账户列表（含状态、资金等摘要）。"""
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
                'id': sid, 'name': s.get('name', sid), 'account_type': s.get('account_type', 'local_paper'),
                'status': st, 'initial_capital': s.get('initial_capital', 0),
                'current_capital': s.get('current_capital', s.get('initial_capital', 0)),
                'created_at': s.get('created_at', 'unknown'),
            })
        except Exception:
            continue
    return jsonify({'simulations': simulations})


@simulation_bp.route('/<simulation_id>', methods=['GET'])
def get_simulation_status(simulation_id):
    """返回指定账户状态（运行中时合并引擎的委托/成交快照，但不写回文件）。"""
    if not os.path.exists(_config_path(simulation_id)):
        return jsonify({'error': 'Simulation not found'}), 404
    with open(_config_path(simulation_id), 'r', encoding='utf-8') as f:
        config = json.load(f)
    if SimulationEngine.is_running(simulation_id):
        state = SimulationEngine.get_state(simulation_id)
        if state:
            saved_orders = config.get('orders', [])
            _apply_state_to_config(config, state)
            config['orders'] = _merge_order_history(saved_orders, state.get('orders') or [])
        config['status'] = 'running'
    elif config.get('status') == 'running':
        # 配置里标记为 running，但引擎没有在跑，修正为 stopped 并写回一次
        config['status'] = 'stopped'
        with open(_config_path(simulation_id), 'w', encoding='utf-8') as fw:
            json.dump(config, fw, ensure_ascii=False, indent=2)
    return jsonify({'simulation': config})


@simulation_bp.route('', methods=['POST'])
def start_simulation():
    """创建新仿真账户（可选自动启动，禁止同名）。"""
    data = request.get_json() or {}
    if data.get('account_type') == 'broker':
        return jsonify({'error': '券商实盘暂未开通此功能'}), 400
    account_id = _generate_sim_id()
    name = (data.get('name') or '').strip() or account_id
    if _name_exists(name):
        return jsonify({'error': '账户名称已存在'}), 400
    if not data.get('initial_capital'):
        return jsonify({'error': 'Missing required field: initial_capital'}), 400
    if os.path.exists(_config_path(account_id)):
        return jsonify({'error': '账户 ID 冲突，请重试'}), 400
    capital = float(data['initial_capital'])
    commission = float(data.get('commission', 0.001))
    slippage = float(data.get('slippage', 0.0005))
    os.makedirs(_sim_folder(), exist_ok=True)
    auto_start = data.get('start', True)
    if auto_start:
        _stop_others_except(account_id)
        try:
            SimulationEngine.start(account_id, capital, commission)
        except Exception as e:
            return jsonify({'error': str(e)}), 500
    cfg = {
        'id': account_id, 'name': name, 'account_type': 'local_paper',
        'initial_capital': capital, 'commission': commission, 'slippage': slippage,
        'status': 'running' if auto_start else 'stopped',
        'created_at': datetime.now().isoformat(),
        'current_capital': capital, 'positions': {}, 'trades': [], 'orders': [],
    }
    with open(_config_path(account_id), 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    return jsonify({'message': 'Simulation created successfully', 'simulation_id': account_id})


@simulation_bp.route('/<simulation_id>/start', methods=['POST'])
def start_existing(simulation_id):
    """从配置启动已有账户（可带 engine_state 恢复）。"""
    if not os.path.exists(_config_path(simulation_id)):
        return jsonify({'error': 'Simulation not found'}), 404
    with open(_config_path(simulation_id), 'r', encoding='utf-8') as f:
        config = json.load(f)
    if SimulationEngine.is_running(simulation_id):
        state = SimulationEngine.get_state(simulation_id)
        if state:
            saved_orders = config.get('orders', [])
            _apply_state_to_config(config, state)
            config['orders'] = _merge_order_history(saved_orders, state.get('orders') or [])
        config['status'] = 'running'
        return jsonify({'simulation': config})
    _stop_others_except(simulation_id)
    capital = float(config.get('initial_capital', 100000))
    commission = float(config.get('commission', 0.001))
    engine_state = config.get('engine_state')
    try:
        SimulationEngine.start(simulation_id, capital, commission, state=engine_state)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    config['status'] = 'running'
    with open(_config_path(simulation_id), 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    state = SimulationEngine.get_state(simulation_id)
    if state:
        saved_orders = config.get('orders', [])
        _apply_state_to_config(config, state)
        config['orders'] = _merge_order_history(saved_orders, state.get('orders') or [])
    return jsonify({'simulation': config})


@simulation_bp.route('/<simulation_id>', methods=['PUT'])
def stop_simulation(simulation_id):
    """
    停止引擎并将当前 state 合并写回配置。

    持久化时机约定：
      - 以“关闭账户（stop）”为主要持久化时机。
      - 下单/撤单接口不主动落盘，避免频繁写文件与历史污染。
      - 若通过切换账户触发停机，由 _stop_others_except 执行同等持久化兜底。
    """
    if not os.path.exists(_config_path(simulation_id)):
        return jsonify({'error': 'Simulation not found'}), 404
    state = None
    if SimulationEngine.is_running(simulation_id):
        state = SimulationEngine.get_state(simulation_id)
        SimulationEngine.stop(simulation_id)
    with open(_config_path(simulation_id), 'r', encoding='utf-8') as f:
        config = json.load(f)
    if state:
        _apply_state_to_config(config, state)
        config['engine_state'] = state
    config['status'] = 'stopped'
    config['stopped_at'] = datetime.now().isoformat()
    with open(_config_path(simulation_id), 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    return jsonify({'simulation': config})


@simulation_bp.route('/<simulation_id>', methods=['DELETE'])
def delete_simulation(simulation_id):
    """删除账户配置文件并停止运行中的实例。"""
    path = _config_path(simulation_id)
    if not os.path.exists(path):
        return jsonify({'error': 'Simulation not found'}), 404
    if SimulationEngine.is_running(simulation_id):
        SimulationEngine.stop(simulation_id)
    try:
        os.remove(path)
        return jsonify({'message': 'Simulation deleted'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@simulation_bp.route('/<simulation_id>/trades', methods=['POST'])
def execute_trade(simulation_id):
    """提交限价单（需 symbol、action、quantity、price）。"""
    data = request.get_json() or {}
    for k in ('symbol', 'action', 'quantity'):
        if k not in data:
            return jsonify({'error': 'Missing required fields: symbol, action, quantity'}), 400
    if not os.path.exists(_config_path(simulation_id)):
        return jsonify({'error': 'Simulation not found'}), 404
    if not SimulationEngine.is_running(simulation_id):
        return jsonify({'error': 'Simulation is not running'}), 400
    price = float(data.get('price', 0))
    if price <= 0:
        return jsonify({'error': 'price required for limit order'}), 400
    try:
        order_id = SimulationEngine.submit_order(
            simulation_id, data['symbol'].strip().upper(), data['action'],
            int(data['quantity']), price)
    except Exception as e:
        return jsonify({'error': str(e)}), 400
    return jsonify({'message': 'Order submitted', 'order_id': order_id})


@simulation_bp.route('/<simulation_id>/orders/<order_id>', methods=['DELETE'])
def cancel_trade_order(simulation_id, order_id):
    """撤销指定订单（仅运行中账户，幂等）。"""
    if not SimulationEngine.is_running(simulation_id):
        return jsonify({'error': 'Simulation is not running'}), 400
    try:
        ok = SimulationEngine.cancel_order(simulation_id, order_id)
        if ok:
            return jsonify({'message': 'Order cancelled'})
        # 幂等处理：订单可能已经成交/已撤，前端可能重复触发撤单，此时不视为错误
        return jsonify({'message': 'Order already completed or not pending'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
