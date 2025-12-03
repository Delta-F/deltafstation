"""
仿真交易引擎
"""
import pandas as pd
import numpy as np
from datetime import datetime
import json
import os
import threading
import time

class SimulationEngine:
    """仿真交易引擎"""
    
    def __init__(self):
        self.simulations = {}
        self.running = False
    
    def start_simulation(self, simulation_id, strategy=None, initial_capital=100000, commission=0.001, slippage=0.0005):
        """启动仿真交易（strategy为None时表示纯手动交易）"""
        simulation = {
            'id': simulation_id,
            'strategy': strategy,  # 可以为None
            'initial_capital': initial_capital,
            'current_capital': initial_capital,
            'commission': commission,
            'slippage': slippage,
            'positions': {},
            'trades': [],
            'status': 'running',
            'start_time': datetime.now(),
            'last_update': datetime.now()
        }
        
        self.simulations[simulation_id] = simulation
        
        # 启动仿真线程（无论是否有策略都启动，用于维护账户状态）
        thread = threading.Thread(target=self._run_simulation, args=(simulation_id,))
        thread.daemon = True
        thread.start()
    
    def stop_simulation(self, simulation_id):
        """停止仿真交易"""
        if simulation_id in self.simulations:
            self.simulations[simulation_id]['status'] = 'stopped'
            self.simulations[simulation_id]['stop_time'] = datetime.now()
    
    def get_simulation_status(self, simulation_id):
        """获取仿真状态"""
        return self.simulations.get(simulation_id, None)
    
    def execute_trade(self, simulation_id, symbol, action, quantity, price=None):
        """执行交易"""
        if simulation_id not in self.simulations:
            return {'error': 'Simulation not found'}
        
        simulation = self.simulations[simulation_id]
        
        if simulation['status'] != 'running':
            return {'error': 'Simulation is not running'}
        
        # 获取当前价格（这里应该从实时数据源获取）
        if price is None:
            price = self._get_current_price(symbol)
        
        if action == 'buy':
            return self._execute_buy(simulation, symbol, quantity, price)
        elif action == 'sell':
            return self._execute_sell(simulation, symbol, quantity, price)
        else:
            return {'error': 'Invalid action'}
    
    def _run_simulation(self, simulation_id):
        """运行仿真主循环"""
        simulation = self.simulations[simulation_id]
        strategy = simulation.get('strategy')
        
        # 如果没有策略，只维护账户状态，不自动交易
        if not strategy:
            while simulation['status'] == 'running':
                try:
                    # 只更新组合价值和保存状态
                    current_data = self._get_current_market_data()
                    if current_data:
                        simulation['current_capital'] = self._calculate_portfolio_value(simulation, current_data)
                    simulation['last_update'] = datetime.now()
                    self._save_simulation_state(simulation)
                    time.sleep(60)  # 每分钟更新一次
                except Exception as e:
                    print(f"Simulation error: {e}")
                    time.sleep(10)
            return
        
        # 有策略时，执行策略自动交易
        strategy_instance = self._create_strategy_instance(strategy)
        
        while simulation['status'] == 'running':
            try:
                # 获取当前市场数据（这里应该从实时数据源获取）
                current_data = self._get_current_market_data()
                
                if current_data:
                    # 生成交易信号
                    signals = strategy_instance.generate_signals(
                        current_data, 
                        simulation['positions'], 
                        simulation['current_capital']
                    )
                    
                    # 执行交易信号
                    for symbol, signal in signals.items():
                        if signal['action'] == 'buy' and signal['quantity'] > 0:
                            self._execute_buy(simulation, symbol, signal['quantity'], current_data['Close'])
                        elif signal['action'] == 'sell' and symbol in simulation['positions']:
                            self._execute_sell(simulation, symbol, signal['quantity'], current_data['Close'])
                
                # 更新组合价值
                simulation['current_capital'] = self._calculate_portfolio_value(simulation, current_data)
                simulation['last_update'] = datetime.now()
                
                # 保存状态
                self._save_simulation_state(simulation)
                
                # 等待下一次更新
                time.sleep(60)  # 每分钟更新一次
                
            except Exception as e:
                print(f"Simulation error: {e}")
                time.sleep(10)
    
    def _create_strategy_instance(self, strategy):
        """创建策略实例"""
        from backend.core.backtest_engine import TechnicalStrategy, FundamentalStrategy, MLStrategy, BaseStrategy
        
        strategy_type = strategy.get('type', 'technical')
        
        if strategy_type == 'technical':
            return TechnicalStrategy(strategy)
        elif strategy_type == 'fundamental':
            return FundamentalStrategy(strategy)
        elif strategy_type == 'ml':
            return MLStrategy(strategy)
        else:
            return BaseStrategy(strategy)
    
    def _get_current_price(self, symbol):
        """获取当前价格（模拟）"""
        # 这里应该连接到实时数据源
        # 现在返回模拟价格
        import random
        return 100 + random.uniform(-5, 5)
    
    def _get_current_market_data(self):
        """获取当前市场数据（模拟）"""
        # 这里应该连接到实时数据源
        # 现在返回模拟数据
        import random
        
        return {
            'Close': 100 + random.uniform(-5, 5),
            'Volume': random.randint(1000000, 5000000),
            'MA5': 100 + random.uniform(-3, 3),
            'MA20': 100 + random.uniform(-2, 2),
            'RSI': random.uniform(30, 70)
        }
    
    def _execute_buy(self, simulation, symbol, quantity, price):
        """执行买入操作"""
        # 考虑滑点
        actual_price = price * (1 + simulation['slippage'])
        cost = actual_price * quantity
        commission_cost = cost * simulation['commission']
        total_cost = cost + commission_cost
        
        if total_cost <= simulation['current_capital']:
            simulation['current_capital'] -= total_cost
            
            if symbol in simulation['positions']:
                # 更新现有持仓
                old_quantity = simulation['positions'][symbol]['quantity']
                old_avg_price = simulation['positions'][symbol]['avg_price']
                new_quantity = old_quantity + quantity
                new_avg_price = (old_avg_price * old_quantity + actual_price * quantity) / new_quantity
                
                simulation['positions'][symbol] = {
                    'quantity': new_quantity,
                    'avg_price': new_avg_price,
                    'total_cost': new_avg_price * new_quantity
                }
            else:
                # 新建持仓
                simulation['positions'][symbol] = {
                    'quantity': quantity,
                    'avg_price': actual_price,
                    'total_cost': cost
                }
            
            # 记录交易
            trade = {
                'id': f"trade_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}",
                'date': datetime.now().isoformat(),
                'symbol': symbol,
                'action': 'buy',
                'quantity': quantity,
                'price': actual_price,
                'cost': total_cost,
                'commission': commission_cost
            }
            
            simulation['trades'].append(trade)
            
            return {'success': True, 'trade': trade}
        else:
            return {'error': 'Insufficient capital'}
    
    def _execute_sell(self, simulation, symbol, quantity, price):
        """执行卖出操作"""
        if symbol not in simulation['positions']:
            return {'error': 'Position not found'}
        
        # 考虑滑点
        actual_price = price * (1 - simulation['slippage'])
        
        # 确定卖出数量
        sell_quantity = min(quantity, simulation['positions'][symbol]['quantity'])
        
        if sell_quantity > 0:
            proceeds = actual_price * sell_quantity
            commission_cost = proceeds * simulation['commission']
            net_proceeds = proceeds - commission_cost
            
            simulation['current_capital'] += net_proceeds
            
            # 更新持仓
            simulation['positions'][symbol]['quantity'] -= sell_quantity
            if simulation['positions'][symbol]['quantity'] == 0:
                del simulation['positions'][symbol]
            else:
                simulation['positions'][symbol]['total_cost'] = simulation['positions'][symbol]['avg_price'] * simulation['positions'][symbol]['quantity']
            
            # 记录交易
            trade = {
                'id': f"trade_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}",
                'date': datetime.now().isoformat(),
                'symbol': symbol,
                'action': 'sell',
                'quantity': sell_quantity,
                'price': actual_price,
                'proceeds': net_proceeds,
                'commission': commission_cost
            }
            
            simulation['trades'].append(trade)
            
            return {'success': True, 'trade': trade}
        else:
            return {'error': 'Invalid quantity'}
    
    def _calculate_portfolio_value(self, simulation, current_data):
        """计算组合总价值"""
        total_value = simulation['current_capital']
        
        for symbol, position in simulation['positions'].items():
            total_value += position['quantity'] * current_data['Close']
        
        return total_value
    
    def _save_simulation_state(self, simulation):
        """保存仿真状态"""
        try:
            simulation_folder = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'simulations')
            os.makedirs(simulation_folder, exist_ok=True)
            
            config_file = os.path.join(simulation_folder, f"{simulation['id']}.json")
            
            # 准备保存的数据
            save_data = simulation.copy()
            save_data['start_time'] = simulation['start_time'].isoformat()
            save_data['last_update'] = simulation['last_update'].isoformat()
            if 'stop_time' in simulation:
                save_data['stop_time'] = simulation['stop_time'].isoformat()
            
            with open(config_file, 'w', encoding='utf-8') as f:
                json.dump(save_data, f, ensure_ascii=False, indent=2, default=str)
        
        except Exception as e:
            print(f"Failed to save simulation state: {e}")
