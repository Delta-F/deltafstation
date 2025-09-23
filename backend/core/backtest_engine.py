"""
回测引擎
"""
import pandas as pd
import numpy as np
from datetime import datetime
import json

class BacktestEngine:
    """回测引擎"""
    
    def __init__(self):
        self.initial_capital = 0
        self.current_capital = 0
        self.positions = {}
        self.trades = []
        self.portfolio_values = []
        self.dates = []
        
    def run_backtest(self, strategy, data, initial_capital=100000, commission=0.001, slippage=0.0005):
        """运行回测"""
        self.initial_capital = initial_capital
        self.current_capital = initial_capital
        self.positions = {}
        self.trades = []
        self.portfolio_values = []
        self.dates = []
        
        # 初始化策略
        strategy_instance = self._create_strategy_instance(strategy)
        
        # 遍历数据
        for date, row in data.iterrows():
            self.dates.append(date)
            
            # 获取当前价格
            current_price = row['Close']
            
            # 执行策略逻辑
            signals = strategy_instance.generate_signals(row, self.positions, self.current_capital)
            
            # 处理交易信号
            for symbol, signal in signals.items():
                if signal['action'] == 'buy' and signal['quantity'] > 0:
                    self._execute_buy(symbol, current_price, signal['quantity'], commission, slippage)
                elif signal['action'] == 'sell' and symbol in self.positions:
                    self._execute_sell(symbol, current_price, signal['quantity'], commission, slippage)
            
            # 更新组合价值
            portfolio_value = self._calculate_portfolio_value(current_price)
            self.portfolio_values.append(portfolio_value)
        
        # 计算回测结果
        results = self._calculate_results(data)
        
        return results
    
    def _create_strategy_instance(self, strategy):
        """创建策略实例"""
        strategy_type = strategy.get('type', 'technical')
        
        if strategy_type == 'technical':
            return TechnicalStrategy(strategy)
        elif strategy_type == 'fundamental':
            return FundamentalStrategy(strategy)
        elif strategy_type == 'ml':
            return MLStrategy(strategy)
        else:
            return BaseStrategy(strategy)
    
    def _execute_buy(self, symbol, price, quantity, commission, slippage):
        """执行买入操作"""
        # 考虑滑点
        actual_price = price * (1 + slippage)
        cost = actual_price * quantity
        commission_cost = cost * commission
        total_cost = cost + commission_cost
        
        if total_cost <= self.current_capital:
            self.current_capital -= total_cost
            
            if symbol in self.positions:
                # 更新现有持仓
                old_quantity = self.positions[symbol]['quantity']
                old_avg_price = self.positions[symbol]['avg_price']
                new_quantity = old_quantity + quantity
                new_avg_price = (old_avg_price * old_quantity + actual_price * quantity) / new_quantity
                
                self.positions[symbol] = {
                    'quantity': new_quantity,
                    'avg_price': new_avg_price,
                    'total_cost': new_avg_price * new_quantity
                }
            else:
                # 新建持仓
                self.positions[symbol] = {
                    'quantity': quantity,
                    'avg_price': actual_price,
                    'total_cost': cost
                }
            
            # 记录交易
            self.trades.append({
                'date': self.dates[-1],
                'symbol': symbol,
                'action': 'buy',
                'quantity': quantity,
                'price': actual_price,
                'cost': total_cost,
                'commission': commission_cost
            })
    
    def _execute_sell(self, symbol, price, quantity, commission, slippage):
        """执行卖出操作"""
        if symbol not in self.positions:
            return
        
        # 考虑滑点
        actual_price = price * (1 - slippage)
        
        # 确定卖出数量
        sell_quantity = min(quantity, self.positions[symbol]['quantity'])
        
        if sell_quantity > 0:
            proceeds = actual_price * sell_quantity
            commission_cost = proceeds * commission
            net_proceeds = proceeds - commission_cost
            
            self.current_capital += net_proceeds
            
            # 更新持仓
            self.positions[symbol]['quantity'] -= sell_quantity
            if self.positions[symbol]['quantity'] == 0:
                del self.positions[symbol]
            else:
                self.positions[symbol]['total_cost'] = self.positions[symbol]['avg_price'] * self.positions[symbol]['quantity']
            
            # 记录交易
            self.trades.append({
                'date': self.dates[-1],
                'symbol': symbol,
                'action': 'sell',
                'quantity': sell_quantity,
                'price': actual_price,
                'proceeds': net_proceeds,
                'commission': commission_cost
            })
    
    def _calculate_portfolio_value(self, current_price):
        """计算组合总价值"""
        total_value = self.current_capital
        
        for symbol, position in self.positions.items():
            total_value += position['quantity'] * current_price
        
        return total_value
    
    def _calculate_results(self, data):
        """计算回测结果"""
        if not self.portfolio_values:
            return {}
        
        # 转换为numpy数组
        portfolio_values = np.array(self.portfolio_values)
        
        # 基本统计
        total_return = (portfolio_values[-1] - self.initial_capital) / self.initial_capital
        annualized_return = (1 + total_return) ** (252 / len(portfolio_values)) - 1
        
        # 计算收益率
        returns = np.diff(portfolio_values) / portfolio_values[:-1]
        
        # 夏普比率
        if len(returns) > 1 and returns.std() > 0:
            sharpe_ratio = returns.mean() / returns.std() * np.sqrt(252)
        else:
            sharpe_ratio = 0
        
        # 最大回撤
        peak = np.maximum.accumulate(portfolio_values)
        drawdown = (portfolio_values - peak) / peak
        max_drawdown = np.min(drawdown)
        
        # 胜率
        winning_trades = [trade for trade in self.trades if trade['action'] == 'sell' and 
                         trade['proceeds'] > self.positions.get(trade['symbol'], {}).get('total_cost', 0)]
        win_rate = len(winning_trades) / len([t for t in self.trades if t['action'] == 'sell']) if self.trades else 0
        
        # 总交易次数
        total_trades = len(self.trades)
        
        return {
            'total_return': total_return,
            'annualized_return': annualized_return,
            'sharpe_ratio': sharpe_ratio,
            'max_drawdown': max_drawdown,
            'win_rate': win_rate,
            'total_trades': total_trades,
            'final_capital': portfolio_values[-1],
            'portfolio_values': portfolio_values.tolist(),
            'trades': self.trades,
            'positions': self.positions
        }

class BaseStrategy:
    """基础策略类"""
    
    def __init__(self, strategy_config):
        self.config = strategy_config
        self.parameters = strategy_config.get('parameters', {})
    
    def generate_signals(self, data, positions, capital):
        """生成交易信号"""
        return {}

class TechnicalStrategy(BaseStrategy):
    """技术分析策略"""
    
    def generate_signals(self, data, positions, capital):
        """生成技术分析信号"""
        signals = {}
        
        # 简单的移动平均策略示例
        if 'MA5' in data and 'MA20' in data and not pd.isna(data['MA5']) and not pd.isna(data['MA20']):
            if data['MA5'] > data['MA20'] and 'AAPL' not in positions:
                # 买入信号
                quantity = int(capital * 0.1 / data['Close'])  # 使用10%的资金
                if quantity > 0:
                    signals['AAPL'] = {
                        'action': 'buy',
                        'quantity': quantity
                    }
            elif data['MA5'] < data['MA20'] and 'AAPL' in positions:
                # 卖出信号
                signals['AAPL'] = {
                    'action': 'sell',
                    'quantity': positions['AAPL']['quantity']
                }
        
        return signals

class FundamentalStrategy(BaseStrategy):
    """基本面分析策略"""
    
    def generate_signals(self, data, positions, capital):
        """生成基本面分析信号"""
        # 这里可以实现基本面分析逻辑
        return {}

class MLStrategy(BaseStrategy):
    """机器学习策略"""
    
    def generate_signals(self, data, positions, capital):
        """生成机器学习预测信号"""
        # 这里可以实现机器学习预测逻辑
        return {}
