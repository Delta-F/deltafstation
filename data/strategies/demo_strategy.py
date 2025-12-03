from typing import Any
import pandas as pd
from deltafq.strategy.base import BaseStrategy


class DemoStrategy(BaseStrategy):
    """Simple moving-average crossover strategy."""

    def __init__(self, fast_period: int = 5, slow_period: int = 20, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.fast_period = fast_period
        self.slow_period = slow_period

    def generate_signals(self, data: pd.DataFrame) -> pd.Series:  # type: ignore[name-defined]
        closes = data["Close"].astype(float)

        fast_ma = closes.rolling(window=self.fast_period, min_periods=1).mean()
        slow_ma = closes.rolling(window=self.slow_period, min_periods=1).mean()

        signals = pd.Series(0, index=closes.index, dtype=int)
        signals = signals.mask(fast_ma > slow_ma, 1)
        signals = signals.mask(fast_ma < slow_ma, -1)
        return signals


