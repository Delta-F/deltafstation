---
name: backtest-minimal
description: Trigger this skill when users ask for backtesting, strategy testing, or running strategies. It guides the model to call run_backtest_auto with symbol-first inputs, default BOLL strategy, and auto strategy generation when missing.
---

# Backtest Skill

## Trigger

Use this skill when user intent includes backtest-related requests, including:
- 回测
- 跑策略
- 测试策略
- backtest
- strategy test
- run strategy

## Goal

Provide a minimal backtest workflow:
1. Input can be as little as a trading symbol.
2. Prefer existing strategy if provided.
3. If no strategy is provided, default to `BOLLStrategy`.
4. If the requested strategy cannot be loaded, auto-generate a minimal strategy file and continue.

## Tool to call

Call `run_backtest_auto` with:
- required: `symbol`
- optional: `strategy_id`, `start_date`, `end_date`, `initial_capital`, `commission`, `slippage`, `trade_preview_count`

## Tool behavior expectations

`run_backtest_auto` should:
1. Ensure/refresh local CSV data for symbol.
2. Resolve strategy:
   - use provided `strategy_id`, or
   - fallback to `BOLLStrategy`.
3. If strategy class does not exist:
   - create a minimal strategy `.py` under `data/strategies/`,
   - load it and run backtest.
4. Return structured result JSON with:
   - `status`, `result_id`
   - `resolved` (`strategy_id`, `symbol`, `data_file`, `date_range`)
   - `summary_metrics`
   - `trade_preview`

## Response style

After tool returns:
- summarize key metrics in concise Chinese (include `summary_metrics.total_trades` and `summary_metrics.avg_trades_per_day` when present),
- mention whether strategy was existing/default/generated,
- if generation happened, include generated strategy class name.

