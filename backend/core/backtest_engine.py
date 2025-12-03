"""
回测引擎 - 基于 deltafq 量化框架实现
"""
import pandas as pd
from typing import Dict, Any, Optional
from deltafq.backtest import BacktestEngine as DeltaFqBacktestEngine
from deltafq.strategy.base import BaseStrategy


class BacktestEngine:
    """
    回测引擎 - 基于 deltafq 框架的封装
    
    提供统一的回测接口，封装 deltafq 的 BacktestEngine，
    使其与项目其他部分兼容。
    """
    
    def __init__(
        self,
        initial_capital: float = 100000,
        commission: float = 0.001,
        slippage: float = 0.0005,
    ) -> None:
        """
        初始化回测引擎
        
        Args:
            initial_capital: 初始资金
            commission: 交易费率
            slippage: 滑点率
        """
        self.initial_capital = initial_capital
        self.commission = commission
        self.slippage = slippage
        
        # 初始化 deltafq 回测引擎
        self._engine = DeltaFqBacktestEngine(
            initial_capital=self.initial_capital,
            commission=self.commission,
            slippage=self.slippage,
        )
        
        # 存储回测结果
        self.trades_df: pd.DataFrame = pd.DataFrame()
        self.values_df: pd.DataFrame = pd.DataFrame()
        self.metrics: Dict[str, Any] = {}
        self.values_metrics: pd.DataFrame = pd.DataFrame()
    
    def run_backtest(
        self,
        strategy: BaseStrategy,
        data: pd.DataFrame,
        symbol: str = "ASSET",
        strategy_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        运行回测
        
        Args:
            strategy: 策略实例（继承自 BaseStrategy）
            data: 历史数据 DataFrame，需包含 Date 索引和 Close 列
            symbol: 交易标的代码
            strategy_name: 策略名称
            
        Returns:
            回测结果字典，包含：
            - total_return: 总收益率
            - annualized_return: 年化收益率
            - sharpe_ratio: 夏普比率
            - max_drawdown: 最大回撤
            - win_rate: 胜率
            - total_trades: 总交易次数
            - final_capital: 最终资金
            - portfolio_values: 组合价值序列
            - trades: 交易记录列表
            - dates: 日期序列
        """
        # 生成策略信号
        signals = strategy.generate_signals(data)
        signals = signals.astype(int)
        
        # 运行回测
        self.trades_df, self.values_df = self._engine.run_backtest(
            symbol=symbol,
            signals=signals,
            price_series=data["Close"],
            strategy_name=strategy_name or (strategy.name if hasattr(strategy, 'name') else "Strategy"),
        )
        
        # 计算指标
        self.values_metrics, self.metrics = self._engine.calculate_metrics()
        
        # 提取组合价值序列
        portfolio_values = []
        dates = []
        if not self.values_df.empty:
            if "total_value" in self.values_df.columns:
                portfolio_values = self.values_df["total_value"].tolist()
            elif "portfolio_value" in self.values_df.columns:
                portfolio_values = self.values_df["portfolio_value"].tolist()
            elif "value" in self.values_df.columns:
                portfolio_values = self.values_df["value"].tolist()
            elif "equity" in self.values_df.columns:
                portfolio_values = self.values_df["equity"].tolist()
            else:
                numeric_cols = self.values_df.select_dtypes(include=["float64", "int64"]).columns
                if len(numeric_cols) > 0:
                    portfolio_values = self.values_df[numeric_cols[0]].tolist()
            
            # 提取日期
            if "date" in self.values_df.columns:
                dates = pd.to_datetime(self.values_df["date"]).dt.strftime("%Y-%m-%d").tolist()
            elif isinstance(self.values_df.index, pd.DatetimeIndex):
                dates = self.values_df.index.strftime("%Y-%m-%d").tolist()
            else:
                dates = [str(d) for d in self.values_df.index]
        
        # 提取交易记录
        trades = []
        if not self.trades_df.empty:
            trades = self.trades_df.to_dict("records")
        
        # 构建返回结果
        results = {
            "total_return": self.metrics.get("total_return", 0.0),
            "annualized_return": self.metrics.get("annualized_return", 0.0),
            "sharpe_ratio": self.metrics.get("sharpe_ratio", 0.0),
            "max_drawdown": self.metrics.get("max_drawdown", 0.0),
            "win_rate": self.metrics.get("win_rate", 0.0),
            "total_trades": self.metrics.get("total_trade_count", len(trades)),
            "final_capital": self.metrics.get("end_capital", portfolio_values[-1] if portfolio_values else self.initial_capital),
            "portfolio_values": portfolio_values,
            "trades": trades,
            "dates": dates,
        }
        
        return results
    
    def get_trades_df(self) -> pd.DataFrame:
        """获取交易记录 DataFrame"""
        return self.trades_df
    
    def get_values_df(self) -> pd.DataFrame:
        """获取组合价值 DataFrame"""
        return self.values_df
    
    def get_metrics(self) -> Dict[str, Any]:
        """获取回测指标"""
        return self.metrics
    
    def get_values_metrics(self) -> pd.DataFrame:
        """获取每日指标 DataFrame"""
        return self.values_metrics


# 导出主要类
__all__ = ["BacktestEngine"]
