"""
回测引擎 - 基于 deltafq 量化框架实现
"""
import os
import importlib.util
import inspect
import pandas as pd
from typing import Dict, Any, Optional, Type
from deltafq.backtest import BacktestEngine as DeltaFqBacktestEngine
from deltafq.strategy.base import BaseStrategy

# 路径常量
_BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
_STRATEGIES_FOLDER = os.path.join(_BASE_DIR, "data", "strategies")
_DATA_RAW_FOLDER = os.path.join(_BASE_DIR, "data", "raw")


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
    ) -> None:
        """
        运行回测
        
        Args:
            strategy: 策略实例（继承自 BaseStrategy）
            data: 历史数据 DataFrame，需包含 Date 索引和 Close 列
            symbol: 交易标的代码
            strategy_name: 策略名称
        """
        # 生成策略信号并运行回测
        signals = strategy.generate_signals(data).astype(int)
        self.trades_df, self.values_df = self._engine.run_backtest(
            symbol=symbol,
            signals=signals,
            price_series=data["Close"],
            strategy_name=strategy_name or (strategy.name if hasattr(strategy, 'name') else "Strategy"),
        )
        
        # 计算指标
        self.values_metrics, self.metrics = self._engine.calculate_metrics()
    
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

    @staticmethod
    def load_and_prepare_data(
        data_file: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        symbol: Optional[str] = None,
    ) -> tuple[pd.DataFrame, str]:
        """
        加载并预处理数据
        
        Args:
            data_file: 数据文件名（相对于 data/raw 目录）
            start_date: 起始日期（可选）
            end_date: 结束日期（可选）
            symbol: 标的代码（可选，默认从文件名解析）
            
        Returns:
            tuple: (处理后的 DataFrame, symbol)
            
        Raises:
            FileNotFoundError: 如果数据文件不存在
            ValueError: 如果数据格式不正确
        """
        # 构建完整文件路径
        filepath = os.path.join(_DATA_RAW_FOLDER, data_file)
        if not os.path.exists(filepath):
            raise FileNotFoundError(f"Data file not found: {data_file}")
        
        # 加载数据
        df = pd.read_csv(filepath)
        if df.empty:
            raise ValueError(f"Data file is empty: {data_file}")
        
        # 处理日期列
        if "Date" in df.columns:
            df["Date"] = pd.to_datetime(df["Date"])
            df = df.set_index("Date")
        elif not isinstance(df.index, pd.DatetimeIndex):
            raise ValueError("Data must have 'Date' column or DatetimeIndex")
        
        # 过滤日期范围
        if start_date and end_date:
            start = pd.to_datetime(start_date)
            end = pd.to_datetime(end_date)
            df = df[(df.index >= start) & (df.index <= end)]
            if df.empty:
                raise ValueError(f"No data in date range: {start_date} to {end_date}")
        
        # 提取 symbol
        if not symbol:
            symbol = data_file.replace(".csv", "").split("_")[0]
        symbol = "ASSET" if not symbol or symbol.upper() == "ASSET" else symbol.upper()
        
        # 验证必要列
        if "Close" not in df.columns:
            raise ValueError("Data must contain 'Close' column")
        
        return df, symbol

    def run_backtest_from_file(
        self,
        strategy_id: str,
        data_file: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        symbol: Optional[str] = None,
    ) -> str:
        """
        从文件运行回测（高级接口）
        
        Args:
            strategy_id: 策略ID
            data_file: 数据文件名
            start_date: 起始日期（可选）
            end_date: 结束日期（可选）
            symbol: 标的代码（可选）
            
        Returns:
            str: 使用的 symbol
        """
        # 加载并预处理数据
        df, symbol = self.load_and_prepare_data(data_file, start_date, end_date, symbol)
        
        # 加载策略类
        strategy_class = self.load_strategy_class(strategy_id)
        
        # 运行回测
        self.run_backtest(
            strategy=strategy_class(),
            data=df,
            symbol=symbol,
            strategy_name=strategy_id
        )
        
        return symbol

    @staticmethod
    def load_strategy_class(strategy_class_name: str) -> Type[BaseStrategy]:
        """
        从 data/strategies 目录加载策略类
        
        Args:
            strategy_class_name: 策略类名
            
        Returns:
            策略类（继承自 BaseStrategy）
            
        Raises:
            RuntimeError: 如果策略类未找到
        """
        if not os.path.exists(_STRATEGIES_FOLDER):
            raise RuntimeError("Strategies folder not found")

        for filename in os.listdir(_STRATEGIES_FOLDER):
            if not filename.endswith(".py"):
                continue

            filepath = os.path.join(_STRATEGIES_FOLDER, filename)
            module_name = f"deltafstation_backtest_strategy_{os.path.splitext(filename)[0]}"
            spec = importlib.util.spec_from_file_location(module_name, filepath)
            if spec is None or spec.loader is None:
                continue

            module = importlib.util.module_from_spec(spec)
            try:
                spec.loader.exec_module(module)
            except Exception:
                continue

            for name, obj in inspect.getmembers(module, inspect.isclass):
                if (name == strategy_class_name and 
                    obj is not BaseStrategy and 
                    issubclass(obj, BaseStrategy)):
                    return obj

        raise RuntimeError(f"Strategy class {strategy_class_name} not found in data/strategies")


# 导出主要类
__all__ = ["BacktestEngine"]
