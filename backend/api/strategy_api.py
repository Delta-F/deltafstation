"""
策略管理API
"""
from flask import Blueprint, request, jsonify
import os
import json
from datetime import datetime

strategy_bp = Blueprint('strategy', __name__)

@strategy_bp.route('/create', methods=['POST'])
def create_strategy():
    """创建新策略"""
    try:
        data = request.get_json()
        
        # 验证必需字段
        required_fields = ['name', 'description', 'type']
        if not all(field in data for field in required_fields):
            return jsonify({'error': f'Missing required fields: {required_fields}'}), 400
        
        strategy = {
            'id': f"strategy_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
            'name': data['name'],
            'description': data['description'],
            'type': data['type'],  # 'technical', 'fundamental', 'ml'
            'parameters': data.get('parameters', {}),
            'rules': data.get('rules', []),
            'created_at': datetime.now().isoformat(),
            'updated_at': datetime.now().isoformat(),
            'status': 'draft'
        }
        
        # 保存策略到文件
        strategies_folder = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'strategies')
        os.makedirs(strategies_folder, exist_ok=True)
        
        strategy_file = os.path.join(strategies_folder, f"{strategy['id']}.json")
        with open(strategy_file, 'w', encoding='utf-8') as f:
            json.dump(strategy, f, ensure_ascii=False, indent=2)
        
        return jsonify({
            'message': 'Strategy created successfully',
            'strategy': strategy
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@strategy_bp.route('/list', methods=['GET'])
def list_strategies():
    """获取策略列表"""
    try:
        strategies_folder = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'strategies')
        
        if not os.path.exists(strategies_folder):
            return jsonify({'strategies': []})
        
        strategies = []
        for filename in os.listdir(strategies_folder):
            if filename.endswith('.json'):
                filepath = os.path.join(strategies_folder, filename)
                with open(filepath, 'r', encoding='utf-8') as f:
                    strategy = json.load(f)
                    strategies.append({
                        'id': strategy['id'],
                        'name': strategy['name'],
                        'description': strategy['description'],
                        'type': strategy['type'],
                        'status': strategy['status'],
                        'created_at': strategy['created_at']
                    })
        
        return jsonify({'strategies': strategies})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@strategy_bp.route('/<strategy_id>', methods=['GET'])
def get_strategy():
    """获取策略详情"""
    try:
        strategies_folder = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'strategies')
        strategy_file = os.path.join(strategies_folder, f"{strategy_id}.json")
        
        if not os.path.exists(strategy_file):
            return jsonify({'error': 'Strategy not found'}), 404
        
        with open(strategy_file, 'r', encoding='utf-8') as f:
            strategy = json.load(f)
        
        return jsonify({'strategy': strategy})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@strategy_bp.route('/<strategy_id>', methods=['PUT'])
def update_strategy():
    """更新策略"""
    try:
        data = request.get_json()
        strategies_folder = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'strategies')
        strategy_file = os.path.join(strategies_folder, f"{strategy_id}.json")
        
        if not os.path.exists(strategy_file):
            return jsonify({'error': 'Strategy not found'}), 404
        
        with open(strategy_file, 'r', encoding='utf-8') as f:
            strategy = json.load(f)
        
        # 更新字段
        for key, value in data.items():
            if key in strategy:
                strategy[key] = value
        
        strategy['updated_at'] = datetime.now().isoformat()
        
        with open(strategy_file, 'w', encoding='utf-8') as f:
            json.dump(strategy, f, ensure_ascii=False, indent=2)
        
        return jsonify({
            'message': 'Strategy updated successfully',
            'strategy': strategy
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@strategy_bp.route('/<strategy_id>', methods=['DELETE'])
def delete_strategy():
    """删除策略"""
    try:
        strategies_folder = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'strategies')
        strategy_file = os.path.join(strategies_folder, f"{strategy_id}.json")
        
        if not os.path.exists(strategy_file):
            return jsonify({'error': 'Strategy not found'}), 404
        
        os.remove(strategy_file)
        
        return jsonify({'message': 'Strategy deleted successfully'})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500
