---
name: backtest-minimal
description: Trigger this skill when users ask for backtesting, strategy testing, or running strategies. New strategies must be written via ensure_strategy (full source), then run_backtest_auto with symbol; default BOLLStrategy when no strategy_id.
---

# Backtest Skill

## Context

Server injects this block for backtest-related user messages (keyword gating is outside this file).

## Data

Market data uses **yfinance**; pass `symbol` as a yfinance ticker (e.g. `000001.SS`, `AAPL`, `GLD`).

## Dates

For relative ranges (e.g. last 2 years), use the **Server date** line in the system message as `end_date`, compute `start_date`, both `YYYY-MM-DD`.

## Goal

1. Input can be as little as a trading symbol (uses default `BOLLStrategy` if it exists under `data/strategies`).
2. For a **new or custom** strategy (e.g. RSI, KDJ): first call **`ensure_strategy`** with `class_name` and full `source_code`, then call **`run_backtest_auto`** with `symbol` and `strategy_id` equal to that class name.
3. If the user only asks for a quick demo and `BOLLStrategy` is present, you may skip `ensure_strategy` and only call `run_backtest_auto`.

## Tools

### 1. `ensure_strategy` (when you need new code)

- **Required:** `class_name`, `source_code` (complete file).
- **Optional:** `file_basename`, `overwrite`.
- Strategy must subclass `BaseStrategy` from `deltafq.strategy.base` and implement `generate_signals(self, data: pd.DataFrame) -> pd.Series` with values in `{-1, 0, 1}` (or as engine expects).

**Indicator and signal policy**

- **Do not** default to `deltafq.indicators.TechnicalIndicators` or `deltafq.strategy.SignalGenerator`. That package does **not** guarantee every indicator you need; treat it as optional, not the standard path.
- **You** (the model) implement whatever math is required—typically **pandas / numpy** on `data["Open"]`, `High`, `Low`, `Close`, `Volume`—and **derive the signal series** yourself. Same for any custom or niche factor.

**Minimal shape (structure only — you fill in all indicator and signal logic):**

```python
import numpy as np
import pandas as pd
from deltafq.strategy.base import BaseStrategy


class MyStrategy(BaseStrategy):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)

    def generate_signals(self, data: pd.DataFrame) -> pd.Series:
        close = data["Close"]
        # Example: roll your own rules; replace entirely for RSI/KDJ/…
        fast = close.rolling(window=5).mean()
        slow = close.rolling(window=20).mean()
        raw = np.where(fast > slow, 1, np.where(fast < slow, -1, 0))
        return pd.Series(raw, index=data.index, dtype=int)
```

For interface-only reference (uses deltafq helpers internally): [`data/strategies/boll_strategy.py`](data/strategies/boll_strategy.py).

### 2. `run_backtest_auto`

- **Required:** `symbol`
- **Optional:** `strategy_id` (defaults to `BOLLStrategy`), dates, capital, fees, `trade_preview_count`
- If `strategy_id` cannot be loaded from `data/strategies`, the tool returns **`strategy_not_found`** — use `ensure_strategy` first, then retry.

## Tool behavior expectations

`run_backtest_auto` should:

1. Ensure/refresh local CSV data for symbol.
2. Resolve strategy: load `strategy_id` or default `BOLLStrategy`; **do not** auto-generate placeholder files.
3. Return structured result JSON with `status`, `result_id`, `resolved`, `summary_metrics`, `trade_preview`.

## Response style

After tool returns:

- Summarize key metrics in concise Chinese (include `summary_metrics.total_trades` and `summary_metrics.avg_trades_per_day` when present).
- If `ensure_strategy` was used, mention the saved class name and file.
- If `strategy_not_found` was returned, explain that the model must write the strategy with `ensure_strategy` first.
