# 交易账户持久化说明

> 文档对应版本：**1.3.0**

描述交易/策略模块中账户状态何时落盘、如何恢复。账户配置统一存放在 **`data/simulations/SIM_*.json`**（含 `local_paper` 与 `broker`，无独立 `data/brokers/` 目录）。

## 落盘时机

- **主路径**：`PUT /api/simulations/<id>`（`stop_simulation`）停止账户时。
- **切账户兜底**：`_stop_others_except()` 在切换运行账户前，先抓取 state 再 stop 并写回 json。
- **默认不落盘**：`POST .../trades` 下单、`DELETE .../orders/<id>` 撤单不会每次写文件。

## 快照字段（paper / local_paper）

持久化时 state 通常包含：

- `current_capital`
- `positions`
- `trades`（含 `strategy_id`）
- `orders`（含 `strategy_id`）
- `frozen_capital`

写入位置：

- json 顶层运行字段
- **`engine_state`**：供 `SimulationEngine` / paper 策略下次 `start(..., state=)` 恢复

`strategy_id` 注入（`inject_strategy_id`）：

- **StrategyEngine（paper）**：当前运行策略 id
- **SimulationEngine（手动）**：`"manual"`

## paper 重启恢复（`engine_snapshot`）

`SimulationEngine.start(..., state=engine_state)` 时：

1. 恢复资金 `eng.cash`
2. 恢复持仓 `position_manager.positions`
3. 恢复成交历史 `eng.trades`
4. 恢复订单 `order_manager.orders`（保留原 id）
5. 从最大 `ORD_xxxxxx` 恢复 **`order_counter`**，避免重启后单号从 1 重复

## broker 账户（`account_type=broker`）

与 paper 差异：

| 项 | 行为 |
|----|------|
| 配置文件 | `data/simulations/SIM_*.json`，字段含 `broker_account`、`qmt_path` |
| 创建账户 | **不**自动启动 `SimulationEngine` |
| 交易页手动实盘 | `BrokerEngine` + `/api/broker/snapshot` 轮询柜台，json 内 `trades` 可能为空或不完整 |
| 策略停止（broker） | **不**将柜台快照整包写入 `engine_state`（`sim_persistence` / `stop_simulation` 对 broker 跳过 paper 式 `cfg.update(state)`） |
| 策略运行中状态 | 运行时经 `broker_snapshot.build_state_from_trade_gateway` 从柜台查询；见 [qmt-strategy-live.md](qmt-strategy-live.md) |

实盘资金、持仓、委托、成交以 **miniQMT 柜台 + 快照 API** 为准，不以本地 json 历史 `trades` 为权威来源。

## 为何恢复 order_counter

若未恢复 `order_counter`，重启后引擎可能再次生成 `ORD_000001`，与历史 id 冲突，导致委托/成交合并展示异常（仅影响 **paper** 链路）。
