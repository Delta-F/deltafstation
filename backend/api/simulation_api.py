"""
仿真交易API
"""
from flask import Blueprint, request, jsonify
import os
import json
import pandas as pd
from datetime import datetime
from backend.core.simulation_engine import SimulationEngine

simulation_bp = Blueprint('simulation', __name__)

@simulation_bp.route('/start', methods=['POST'])
def start_simulation():
    """启动仿真交易（支持手动交易和策略自动交易，使用模拟数据）"""
    try:
        data = request.get_json()
        
        # 验证必需字段
        if 'initial_capital' not in data:
            return jsonify({'error': 'Missing required field: initial_capital'}), 400
        
        strategy_id = data.get('strategy_id', '')
        symbol = data.get('symbol', '')
        use_demo_data = data.get('use_demo_data', True)  # 默认使用演示数据
        
        # 创建仿真引擎
        engine = SimulationEngine()
        simulation_id = f"sim_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        # 启动仿真（使用策略类名）
        strategy_param = strategy_id if strategy_id else None
        
        engine.start_simulation(
            simulation_id=simulation_id,
            strategy=strategy_param,  # 策略类名或None
            initial_capital=data['initial_capital'],
            commission=data.get('commission', 0.001),
            slippage=data.get('slippage', 0.0005),
            symbol=symbol if symbol else None,
            use_demo_data=use_demo_data
        )
        
        # 保存仿真配置
        simulation_folder = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'simulations')
        os.makedirs(simulation_folder, exist_ok=True)
        
        simulation_config = {
            'id': simulation_id,
            'strategy_id': strategy_id if strategy_id else None,
            'initial_capital': data['initial_capital'],
            'commission': data.get('commission', 0.001),
            'slippage': data.get('slippage', 0.0005),
            'status': 'running',
            'created_at': datetime.now().isoformat(),
            'current_capital': data['initial_capital'],
            'positions': {},
            'trades': [],
            'symbol': symbol if symbol else None
        }
        
        config_file = os.path.join(simulation_folder, f"{simulation_id}.json")
        with open(config_file, 'w', encoding='utf-8') as f:
            json.dump(simulation_config, f, ensure_ascii=False, indent=2)
        
        return jsonify({
            'message': 'Simulation started successfully',
            'simulation_id': simulation_id
        })
    
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@simulation_bp.route('/stop/<simulation_id>', methods=['POST'])
def stop_simulation(simulation_id):
    """停止仿真交易"""
    try:
        simulation_folder = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'simulations')
        config_file = os.path.join(simulation_folder, f"{simulation_id}.json")
        
        if not os.path.exists(config_file):
            return jsonify({'error': 'Simulation not found'}), 404
        
        with open(config_file, 'r', encoding='utf-8') as f:
            config = json.load(f)
        
        config['status'] = 'stopped'
        config['stopped_at'] = datetime.now().isoformat()
        
        with open(config_file, 'w', encoding='utf-8') as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
        
        return jsonify({'message': 'Simulation stopped successfully'})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@simulation_bp.route('/status/<simulation_id>', methods=['GET'])
def get_simulation_status(simulation_id):
    """获取仿真状态"""
    try:
        simulation_folder = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'simulations')
        config_file = os.path.join(simulation_folder, f"{simulation_id}.json")
        
        if not os.path.exists(config_file):
            return jsonify({'error': 'Simulation not found'}), 404
        
        with open(config_file, 'r', encoding='utf-8') as f:
            config = json.load(f)
        
        return jsonify({'simulation': config})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@simulation_bp.route('/list', methods=['GET'])
def list_simulations():
    """获取仿真列表"""
    try:
        simulation_folder = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'simulations')
        
        if not os.path.exists(simulation_folder):
            return jsonify({'simulations': []})
        
        simulations = []
        for filename in os.listdir(simulation_folder):
            if filename.endswith('.json'):
                filepath = os.path.join(simulation_folder, filename)
                with open(filepath, 'r', encoding='utf-8') as f:
                    simulation = json.load(f)
                    simulations.append({
                        'id': simulation['id'],
                        'strategy_id': simulation['strategy_id'],
                        'status': simulation['status'],
                        'initial_capital': simulation['initial_capital'],
                        'current_capital': simulation.get('current_capital', simulation['initial_capital']),
                        'created_at': simulation['created_at']
                    })
        
        return jsonify({'simulations': simulations})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@simulation_bp.route('/trade/<simulation_id>', methods=['POST'])
def execute_trade():
    """执行交易"""
    try:
        data = request.get_json()
        
        # 验证必需字段
        required_fields = ['symbol', 'action', 'quantity']
        if not all(field in data for field in required_fields):
            return jsonify({'error': f'Missing required fields: {required_fields}'}), 400
        
        simulation_folder = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'simulations')
        config_file = os.path.join(simulation_folder, f"{simulation_id}.json")
        
        if not os.path.exists(config_file):
            return jsonify({'error': 'Simulation not found'}), 404
        
        with open(config_file, 'r', encoding='utf-8') as f:
            config = json.load(f)
        
        if config['status'] != 'running':
            return jsonify({'error': 'Simulation is not running'}), 400
        
        # 这里应该调用实际的交易逻辑
        # 简化版本，直接更新配置
        trade = {
            'id': f"trade_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}",
            'symbol': data['symbol'],
            'action': data['action'],  # 'buy' or 'sell'
            'quantity': data['quantity'],
            'price': data.get('price', 0),
            'timestamp': datetime.now().isoformat()
        }
        
        config['trades'].append(trade)
        
        with open(config_file, 'w', encoding='utf-8') as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
        
        return jsonify({
            'message': 'Trade executed successfully',
            'trade': trade
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500
