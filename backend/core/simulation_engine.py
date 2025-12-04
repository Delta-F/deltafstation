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
import importlib.util
import inspect

class SimulationEngine:
    """仿真交易引擎"""
    
    def __init__(self):
        self.simulations = {}
        self.running = False
    
    def start_simulation(self, simulation_id, strategy=None, initial_capital=100000, commission=0.001, slippage=0.0005, symbol=None, use_demo_data=True):
        """启动仿真交易（strategy为None时表示纯手动交易）
        
        Args:
            simulation_id: 仿真ID
            strategy: 策略配置或策略类名
            initial_capital: 初始资金
            commission: 手续费率
            slippage: 滑点
            symbol: 交易标的
            use_demo_data: 是否使用演示数据（默认True）
        """
        simulation = {
            'id': simulation_id,
            'strategy': strategy,  # 可以为None或策略类名
            'strategy_class_name': strategy if isinstance(strategy, str) else None,  # 策略类名
            'initial_capital': initial_capital,
            'current_capital': initial_capital,
            'commission': commission,
            'slippage': slippage,
            'positions': {},
            'trades': [],
            'status': 'running',
            'start_time': datetime.now(),
            'last_update': datetime.now(),
            'symbol': symbol,
            'demo_trade_index': 0,  # 模拟交易索引
            'demo_trades': None,  # 将在_run_simulation中加载
            'use_demo_data': use_demo_data  # 是否使用演示数据
        }
        
        self.simulations[simulation_id] = simulation
        
        # 启动仿真线程
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
    
    def _get_price_range_for_symbol(self, symbol):
        """根据symbol获取合理的价格范围"""
        # 从演示数据中获取价格范围
        try:
            demo_file = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'simulations', 'demo_simulation_data.json')
            if os.path.exists(demo_file):
                with open(demo_file, 'r', encoding='utf-8') as f:
                    demo_data = json.load(f)
                    trades = demo_data.get('trades', [])
                    symbol_trades = [t for t in trades if t.get('symbol') == symbol]
                    if symbol_trades:
                        prices = [t.get('price', 0) for t in symbol_trades if t.get('price')]
                        if prices:
                            min_price = min(prices)
                            max_price = max(prices)
                            return min_price, max_price, (min_price + max_price) / 2
        except Exception as e:
            print(f"Error getting price range from demo data: {e}")
        
        # 如果没有找到演示数据，根据symbol设置默认价格范围
        if '601398' in symbol or '601398.SH' in symbol:
            # 工商银行
            return 6.8, 8.8, 7.8
        elif '600036' in symbol or '600036.SH' in symbol:
            # 招商银行
            return 42.0, 43.0, 42.5
        else:
            # 默认价格范围（假设是其他股票）
            return 10.0, 12.0, 11.0
    
    def _load_demo_trades(self):
        """从demo_simulation_data.json加载模拟交易数据"""
        try:
            demo_file = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'simulations', 'demo_simulation_data.json')
            if os.path.exists(demo_file):
                with open(demo_file, 'r', encoding='utf-8') as f:
                    demo_data = json.load(f)
                    return demo_data.get('trades', [])
        except Exception as e:
            print(f"Error loading demo trades: {e}")
        
        # 如果文件不存在，返回默认数据（使用工商银行价格）
        return [
            {'action': 'buy', 'quantity': 1000, 'price': 5.78},
            {'action': 'buy', 'quantity': 1000, 'price': 5.79},
            {'action': 'sell', 'quantity': 1000, 'price': 5.80},
            {'action': 'buy', 'quantity': 1000, 'price': 5.79},
            {'action': 'sell', 'quantity': 1000, 'price': 5.81},
            {'action': 'buy', 'quantity': 1000, 'price': 5.82},
            {'action': 'buy', 'quantity': 1000, 'price': 5.83},
            {'action': 'sell', 'quantity': 1000, 'price': 5.84},
            {'action': 'buy', 'quantity': 1000, 'price': 5.85},
            {'action': 'sell', 'quantity': 1000, 'price': 5.86},
            {'action': 'buy', 'quantity': 1000, 'price': 5.87},
            {'action': 'sell', 'quantity': 1000, 'price': 5.88},
        ]
    
    def _generate_demo_trade(self, simulation):
        """生成模拟交易数据"""
        symbol = simulation.get('symbol', '000001.SS')
        
        # 从文件加载或使用缓存的交易数据
        if 'demo_trades' not in simulation or simulation['demo_trades'] is None:
            simulation['demo_trades'] = self._load_demo_trades()
        
        demo_trades = simulation['demo_trades']
        if demo_trades is None or len(demo_trades) == 0:
            return None
        
        trade_index = simulation.get('demo_trade_index', 0)
        
        if trade_index < len(demo_trades):
            trade_data = demo_trades[trade_index]
            simulation['demo_trade_index'] = trade_index + 1
            
            # 从demo数据中提取信息
            action = trade_data.get('action', 'buy')
            quantity = trade_data.get('quantity', 1000)
            price = trade_data.get('price')
            # 如果demo数据中没有价格，使用合理的默认价格
            if price is None:
                _, _, price = self._get_price_range_for_symbol(symbol)
            
            if action == 'buy':
                result = self._execute_buy(simulation, symbol, quantity, price)
            else:
                # 检查是否有持仓可卖
                if symbol in simulation['positions']:
                    sell_qty = min(quantity, simulation['positions'][symbol]['quantity'])
                    if sell_qty > 0:
                        result = self._execute_sell(simulation, symbol, sell_qty, price)
                    else:
                        return None
                else:
                    return None
            
            return result
        
        return None
    
    def _run_simulation(self, simulation_id):
        """运行仿真主循环（使用模拟数据）"""
        simulation = self.simulations[simulation_id]
        strategy = simulation.get('strategy')
        symbol = simulation.get('symbol', '000001.SS')
        
        # 初始化模拟价格（根据symbol获取合理价格范围）
        min_price, max_price, base_price = self._get_price_range_for_symbol(symbol)
        current_price = base_price
        
        # 如果没有策略，只维护账户状态，不自动交易
        if not strategy:
            while simulation['status'] == 'running':
                try:
                    # 更新持仓的当前价格
                    if symbol in simulation['positions']:
                        simulation['positions'][symbol]['current_price'] = current_price
                    
                    simulation['last_update'] = datetime.now()
                    self._save_simulation_state(simulation)
                    time.sleep(60)  # 每分钟更新一次
                except Exception as e:
                    print(f"Simulation error: {e}")
                    time.sleep(10)
            return
        
        # 有策略时，使用模拟数据生成交易
        use_demo_data = simulation.get('use_demo_data', True)
        
        if use_demo_data:
            # 加载demo交易数据
            demo_trades = self._load_demo_trades()
            max_trades = len(demo_trades) if demo_trades else 0
            trade_count = 0
            
            print(f"Starting simulation with {max_trades} demo trades")
            
            while simulation['status'] == 'running' and trade_count < max_trades:
                try:
                    # 每5秒生成一笔模拟交易
                    time.sleep(5)
                    
                    # 生成模拟交易
                    result = self._generate_demo_trade(simulation)
                    if result and result.get('success'):
                        trade_count += 1
                        trade = result.get('trade', {})
                        print(f"[{trade.get('date', datetime.now().isoformat())}] {trade.get('action', 'unknown')} {symbol} {trade.get('quantity', 0)}股 @ {trade.get('price', 0):.2f}")
                        
                        # 立即保存状态，确保交易被记录
                        self._save_simulation_state(simulation)
                    elif result and result.get('error'):
                        # 交易失败（比如资金不足）
                        trade_count += 1
                        print(f"Trade {trade_count} failed: {result.get('error')}")
                    elif result is None:
                        # 如果没有可执行的交易（比如没有持仓可卖），跳过
                        trade_count += 1
                        print(f"Skipping trade {trade_count} (no position to sell)")
                    
                    # 更新当前价格（优先使用最新交易价格）
                    # 优先从最新交易记录中获取该标的的价格
                    if simulation.get('trades') and len(simulation['trades']) > 0:
                        symbol_trades = [t for t in simulation['trades'] if t.get('symbol') == symbol]
                        if symbol_trades:
                            last_trade = symbol_trades[-1]
                            trade_price = last_trade.get('price')
                            if trade_price and min_price <= trade_price <= max_price:
                                current_price = trade_price
                    
                    # 如果当前价格不在合理范围内，使用合理范围内的价格
                    if current_price < min_price or current_price > max_price:
                        current_price = base_price
                    
                    # 添加小幅随机波动（模拟市场波动，但保持在合理范围内）
                    import random
                    price_range = max_price - min_price
                    price_change = random.uniform(-price_range * 0.02, price_range * 0.02)
                    current_price = max(min_price, min(max_price, current_price + price_change))
                    current_price = round(current_price, 2)
                    
                    # 更新持仓的当前价格
                    if symbol in simulation['positions']:
                        simulation['positions'][symbol]['current_price'] = current_price
                    
                    # 更新组合价值
                    position_value = 0
                    for pos_symbol, position in simulation['positions'].items():
                        pos_price = position.get('current_price', position.get('avg_price', 0))
                        position_value += position.get('quantity', 0) * pos_price
                    
                    simulation['last_update'] = datetime.now()
                    
                    # 定期保存状态
                    if trade_count % 2 == 0:
                        self._save_simulation_state(simulation)
                    
                except Exception as e:
                    print(f"Simulation error: {e}")
                    import traceback
                    traceback.print_exc()
                    time.sleep(10)
        else:
            # 不使用demo数据，只维护状态
            print("Starting simulation without demo data")
            max_trades = 0
            trade_count = 0
        
        # 所有模拟交易完成后，继续维护状态
        while simulation['status'] == 'running':
            try:
                # 更新持仓的当前价格（在合理范围内波动）
                import random
                min_price, max_price, _ = self._get_price_range_for_symbol(symbol)
                price_range = max_price - min_price
                price_change = random.uniform(-price_range * 0.05, price_range * 0.05)
                current_price = max(min_price, min(max_price, current_price + price_change))
                current_price = round(current_price, 2)
                
                if symbol in simulation['positions']:
                    simulation['positions'][symbol]['current_price'] = current_price
                
                simulation['last_update'] = datetime.now()
                self._save_simulation_state(simulation)
                time.sleep(60)  # 每分钟更新一次
            except Exception as e:
                print(f"Simulation error: {e}")
                time.sleep(10)
    
    def _load_strategy_class(self, strategy_class_name):
        """从 data/strategies 下加载策略类"""
        try:
            from deltafq.strategy.base import BaseStrategy
        except ImportError:
            BaseStrategy = object
        
        strategies_folder = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'strategies')
        
        for filename in os.listdir(strategies_folder):
            if not filename.endswith('.py'):
                continue
            
            filepath = os.path.join(strategies_folder, filename)
            module_name = f"deltafstation_strategy_{os.path.splitext(filename)[0]}"
            spec = importlib.util.spec_from_file_location(module_name, filepath)
            if spec is None or spec.loader is None:
                continue
            
            module = importlib.util.module_from_spec(spec)
            try:
                spec.loader.exec_module(module)
            except Exception:
                continue
            
            # 查找策略类
            for name, obj in inspect.getmembers(module, inspect.isclass):
                if (issubclass(obj, BaseStrategy) and obj is not BaseStrategy and 
                    name == strategy_class_name):
                    return obj
        
        return None
    
    def _create_strategy_instance(self, strategy):
        """创建策略实例"""
        # 如果 strategy 是字符串（策略类名），则加载策略类
        if isinstance(strategy, str):
            strategy_class = self._load_strategy_class(strategy)
            if strategy_class:
                return strategy_class()
            return None
        
        # 如果是字典配置（旧方式，保留兼容性）
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
            
            # 准备保存的数据（排除不能序列化的对象）
            save_data = {
                'id': simulation['id'],
                'strategy_class_name': simulation.get('strategy_class_name'),
                'strategy_id': simulation.get('strategy_class_name'),  # 兼容前端
                'initial_capital': simulation['initial_capital'],
                'current_capital': simulation['current_capital'],
                'commission': simulation['commission'],
                'slippage': simulation['slippage'],
                'positions': simulation['positions'],
                'trades': simulation['trades'],
                'status': simulation['status'],
                'start_time': simulation['start_time'].isoformat(),
                'last_update': simulation['last_update'].isoformat(),
                'symbol': simulation.get('symbol')
            }
            
            if 'stop_time' in simulation:
                save_data['stop_time'] = simulation['stop_time'].isoformat()
            
            with open(config_file, 'w', encoding='utf-8') as f:
                json.dump(save_data, f, ensure_ascii=False, indent=2, default=str)
        
        except Exception as e:
            print(f"Failed to save simulation state: {e}")
