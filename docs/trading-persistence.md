# Trading Persistence Notes

This note describes how account state is persisted and restored in the trading module.

## Persist Timing

- Primary persist point: `PUT /api/simulations/<id>` (`stop_simulation`).
- Account switch fallback: `_stop_others_except()` persists the running account before stopping it.
- `POST /trades` and `DELETE /orders/<id>` do not persist by default.

## State Snapshot Fields

When persisting account state, the snapshot includes:

- `current_capital`
- `positions`
- `trades`
- `orders`
- `frozen_capital`

The snapshot is written to:

- top-level runtime fields in simulation json
- `engine_state` for restart restore

## Restart Restore Flow

In `SimulationEngine.start(..., state=engine_state)`:

1. Restore cash (`eng.cash`)
2. Restore positions (`position_manager.positions`)
3. Restore trade history (`eng.trades`)
4. Restore order history (`order_manager.orders`) with original order ids
5. Rebuild `order_counter` from max `ORD_xxxxxx` to keep ids monotonic

## Why Order Counter Restore Matters

If `order_counter` is not restored, after restart the engine can generate ids from `ORD_000001` again, which can collide with historical ids and cause merge/overwrite issues in order history presentation.
