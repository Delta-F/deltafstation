---
name: Broker Data Sync
overview: 基于 miniQMT 的查询接口，建立“后端标准化快照 + 前端定时拉取覆盖”的同步机制，确保资金、持仓、委托、成交与柜台一致。
todos: []
isProject: false
---

# 同步券商账户数据方案

## 目标

让交易页中的账户信息与 miniQMT 柜台保持一致，覆盖以下四类数据：

- 资金（cash / frozen_cash / total_asset）
- 持仓（symbol / volume / can_use_volume / market_value）
- 委托（order_status、成交量、价格、方向）
- 成交（traded_price、traded_volume、成交时间）

## 现有能力（可直接复用）

- 你参考的客户端文件 [c:\Users\leek_\Desktop\Delta\imooc\deltafq\deltafq\adapters\trade\miniqmt_client.py](c:\Users\leek_\Desktop\Delta\imooc\deltafq\deltafq\adapters\trade\miniqmt_client.py) 已提供查询方法：
  - `query_stock_asset()`
  - `query_stock_positions()`
  - `query_stock_orders(cancelable_only=False)`
  - `query_stock_trades()`
- 工程内 broker 引擎文件 [c:\Users\leek_\Desktop\Delta\imooc\deltafstation\backend\core\broker_engine.py](c:\Users\leek_\Desktop\Delta\imooc\deltafstation\backend\core\broker_engine.py) 负责会话管理与快照组装。
- API 文件 [c:\Users\leek_\Desktop\Delta\imooc\deltafstation\backend\api\broker_api.py](c:\Users\leek_\Desktop\Delta\imooc\deltafstation\backend\api\broker_api.py) 提供 `/api/broker/snapshot`。
- 前端文件 [c:\Users\leek_\Desktop\Delta\imooc\deltafstation\frontend\static\js\trader.js](c:\Users\leek_\Desktop\Delta\imooc\deltafstation\frontend\static\js\trader.js) 已有 `updateStatus()` 定时刷新入口。

## 推荐同步机制

```mermaid
flowchart LR
  UI[TraderPage]
  Poller[updateStatusTimer]
  BrokerAPI[GET_api_broker_snapshot]
  BrokerEngine[BrokerEngine_snapshot]
  MiniQmtClient[MiniQmtXtTraderClient_query_*]
  Qmt[miniQMT_terminal]

  UI --> Poller --> BrokerAPI --> BrokerEngine --> MiniQmtClient --> Qmt
  BrokerAPI --> UI
```

- 前端每 3-5 秒轮询一次 `/api/broker/snapshot`。
- 后端每次请求都从柜台实时查询并返回标准化 JSON。
- 前端使用“覆盖策略”更新 `state.simulation`：
  - `asset/positions/orders/trades` 全量覆盖；
  - 本地仅保留 UI 临时字段，不作为真实交易状态来源。

## 状态映射建议（订单）

把柜台 `order_status` 映射为前端通用状态，便于统一渲染：

- `pending`: 48, 49, 50, 51, 55
- `executed`: 56
- `cancelled`: 52, 53, 54, 57
- 其余保留 `raw_status` 兜底显示

同时返回：

- `filled_quantity`（来自 `traded_volume`）
- `raw_status`（原始数值）

这样前端可以同时展示“中文三态 + 柜台原始状态码”。

## 前端更新策略（关键）

在 `updateStatus()` 的 broker 分支里：

- 用 `asset` 更新总资产、可用资金、冻结资金。
- 用 `positions` 更新持仓表与可卖数量。
- 用 `orders` 覆盖委托表（不要只依赖本地下单后 push 的 pending）。
- 用 `trades` 覆盖成交表（保证已成单及时可见）。

错误处理建议：

- `snapshot` 返回 `broker is not connected` 时，将账户标记为 `stopped` 并停止继续轮询该账户。
- 连接失败时直接展示 connect 错误，不再持续刷 snapshot 错误。

## 验证清单

- 下单后 1-2 个轮询周期内，委托状态从 `pending` 变为 `executed/cancelled/partially...`（按映射显示）。
- 成交表能看到对应 `order_id`、成交价、成交量、时间。
- 资金与持仓在成交后发生正确变化。
- 断开连接后 UI 状态自动降为 `stopped`，无无效轮询刷屏。

## 你现在可直接执行的联调步骤

- 先 `POST /api/broker/connect`
- 持续 `GET /api/broker/snapshot`，观察 `asset/positions/orders/trades` 字段变化
- 页面点击下单后，对比：
  - 柜台客户端真实状态
  - snapshot 返回状态
  - 页面渲染状态

三者一致即同步链路完成。
