from typing import Any
import pandas as pd
from deltafq.strategy.base import BaseStrategy
from deltafq.indicators import TechnicalIndicators
from deltafq.strategy import SignalGenerator


class BOLLStrategy(BaseStrategy):
    """基于布林带的交易策略"""

    def __init__(self, period: int = 10, std_dev: float = 1.5, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.period = period
        self.std_dev = std_dev

    def generate_signals(self, data: pd.DataFrame) -> pd.Series:  # type: ignore[name-defined]
        """生成交易信号"""
        # 计算布林带
        indicators = TechnicalIndicators()
        boll_bands = indicators.boll(
            data["Close"],
            period=self.period,
            std_dev=self.std_dev,
            method="sample"
        )

        # 生成信号
        signals = SignalGenerator()
        signal_series = signals.boll_signals(
            price=data["Close"],
            bands=boll_bands,
            method="cross_current"
        )

        return signal_series

