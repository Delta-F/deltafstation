# QMT 策略实盘联调说明

> DeltaFStation **1.3.0** 起可用

## 环境

- 本机已安装并登录 **miniQMT / QMT 交易端**
- `userdata_mini` 路径与资金账号与账户配置一致
- Python 依赖：`deltafq>=1.0.2`（含 `LiveEngine` + miniqmt 网关）

## 账户准备

1. 在 **交易页 → 管理账户** 创建 `account_type: broker` 账户，填写 `broker_account`、`qmt_path`
2. 或在策略运行页选择已创建的带 `[QMT]` 标记的账户

> broker 账户创建时**不会**启动本地 paper 仿真引擎。

## 启动策略

1. 打开 **策略运行** 页，选择 QMT 账户与策略
2. 标的使用 A 股代码格式，如 `159118.SZ`
3. **单次股数**（`#runOrderQuantity`）：填写则按股数下单（默认 100，100 股整数倍）；留空则由引擎按满可用资金换算
4. 点击 **启动策略** — 将断开交易页已有 QMT 连接，由 `LiveEngine` 占用会话并自动下单

## 会话互斥

| 场景 | 行为 |
|------|------|
| 策略运行中 | 交易页 `POST /api/broker/connect`、手动下单返回 409 |
| 启动 broker 策略前 | 自动 `BrokerEngine.disconnect()` |
| 停止策略后 | 不自动重连；需在交易页手动 connect |

## 状态刷新

- 策略运行中：`GET /api/simulations/<id>` 合并 `StrategyEngine` 柜台快照
- 可选：`GET /api/broker/snapshot` 在策略占用会话时由引擎代理返回同一柜台数据
- 行情：`GET /api/data/live/<symbol>?source=miniqmt`

## 冒烟清单

- [ ] 信号翻转后柜台出现限价买/卖
- [ ] 撤单与 pending 终态日志正常
- [ ] 停止策略后可在交易页重新 connect
- [ ] paper 账户策略运行无回归
