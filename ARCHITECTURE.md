# DeltaFStation 系统架构

## 一图看懂

```
前端 (Bootstrap 5 + JS + Chart.js)
  ├── 主页 index
  ├── 策略回测 strategy (支持长跨度数据聚合渲染)
  ├── 手动交易 trading
  ├── 策略运行 run (gostrategy)
  ├── 系统日志 Live Console (基于 SSE 实时同步)
  └── AI Agent (全局组件 / 侧边栏)
      ├── 开关按钮（切换侧边栏显示）
      ├── 聊天窗口
      └── 对话状态持久化（localStorage / conversationHistory）

           │  调用 REST API
           ▼
后端 (Flask)
  ├── 数据 API        backend/api/data_api.py
  ├── 策略 API        backend/api/strategy_api.py
  ├── 回测 API        backend/api/backtest_api.py
  ├── 仿真/账户 API   backend/api/simulation_api.py   # 创建、列表、状态、开启、停止、下单
  ├── 策略运行 API    backend/api/gostrategy_api.py   # 启动/停止策略、K 线图表（按 signal_interval）
  ├── AI Agent API    backend/api/ai_api.py          # LLM 对话（SSE 流式）
  └── 日志流 (SSE)    backend/app.py (stdout pipe)

           │  业务调用
           ▼
核心引擎 (Core)
  ├── DataManager           backend/core/data_manager.py
  ├── LiveDataManager       backend/core/live_data_manager.py
  ├── BacktestEngine*       backend/core/backtest_engine.py
  ├── SimulationEngine      backend/core/simulation_engine.py      # 手动交易（tick 撮合）
  ├── StrategyEngine*       backend/core/strategy_engine.py     # 策略自动化（deltafq LiveEngine）
  ├── agent/                backend/core/agent/                # AI Agent（LLM + 工具编排）
  │   ├── llm_client.py     backend/core/agent/llm_client.py
  │   ├── tool_registry.py  backend/core/agent/tool_registry.py  # 工具 schema / handler 注册（TOOL_DEFINITIONS）
  │   ├── tool_runner.py    backend/core/agent/tool_runner.py    # 多轮 tool_calls 执行与回注
  │   └── tools/            backend/core/agent/tools/            # 本地工具实现（function handlers）
  │       ├── fun_tools.py       backend/core/agent/tools/fun_tools.py       # 今日一签
  │       └── backtest_tools.py  backend/core/agent/tools/backtest_tools.py  # 回测执行（模糊匹配 + 结构化摘要）
  ├── sim_persistence    backend/core/utils/sim_persistence.py  # 仿真配置路径、同账户停机持久化
  └── engine_snapshot    backend/core/utils/engine_snapshot.py  # 引擎快照构建/恢复、订单续号与策略 ID 注入

           │  读写文件
           ▼
数据层 (Files)
  ├── data/raw/          原始行情 CSV
  ├── data/strategies/   策略 Python 文件*
  ├── data/results/      回测结果 JSON
  └── data/simulations/  仿真账户配置 JSON
```

> 带 * 的模块直接基于 `deltafq` 框架封装。

## 核心模块简介

- **DataManager**
  - 处理 CSV 上传 / 下载 / 预览等数据管理
  - 封装在 `backend/core/data_manager.py`，对外通过 `data_api` 暴露

- **LiveDataManager**
  - 封装 `deltafq.live.YFinanceDataGateway`，负责实时行情获取与订阅
  - 维护内存行情缓存，支持 REST API 异步查询

- **BacktestEngine（回测引擎）**
  - 封装 `deltafq.BacktestEngine`，负责历史回测与绩效指标
  - 由 `backtest_api` 调用，结果写入 `data/results/`

- **SimulationEngine（仿真引擎）**
  - 基于 `deltafq`（EventEngine + yfinance 行情 + paper 交易网关），按 tick 撮合限价单
  - 用于**手动交易**（trading 页），账户配置持久化写入 `data/simulations/`
  - 由 `simulation_api` 调用

- **StrategyEngine（策略运行器）**
  - 封装 `deltafq.live.LiveEngine`，负责策略自动化运行
  - 用于**策略运行**（run/gostrategy 页）：选择策略、标的、周期（1d/1h/5m/1m）后启动
  - 支持 `signal_interval`，K 线图表按所选周期拉取
  - **绩效指标**：通过 `get_run_metrics` 实时调用 `deltafq` 提供指标计算能力（前端同步实现基于 FIFO 的全量指标统计）
  - 由 `gostrategy_api` 调用，状态从 `StrategyEngine.get_state` / `get_run_info` 获取

- **sim_persistence / engine_snapshot**
  - **停机持久化**：`sim_persistence.stop_same_account` 负责在启动新实例前，先安全停止同账户的旧实例并将 state 快照落盘
  - **快照续号**：`engine_snapshot` 统一快照格式，包含资金、持仓、成交、所有订单，并恢复 `order_counter` 确保 ID 连续
  - **策略标记**：支持 `strategy_id` 注入，手动交易自动标记为 `manual`，方便区分交易来源

- **策略管理**
  - 策略实现存放在 `data/strategies/*.py`，继承 `deltafq.BaseStrategy`
  - `strategy_api` 负责发现、列出、加载这些策略

- **AI Agent（Agent 模块）**
  - `LLMClient`：OpenAI 兼容 API 封装，位于 `backend/core/agent/llm_client.py`
    - 支持 DeepSeek、OpenAI、通义等任意 provider，参数由 `config` 配置
  - 工具编排（function calling）：
    - `tool_registry.py`：工具 schema / handler 映射注册（通过 `TOOL_DEFINITIONS` 统一维护）
    - `tool_runner.py`：多轮解析 `tool_calls`、执行本地工具、回注结果的循环
    - `tools/`：具体工具实现（当前提供趣味签文、回测执行工具）
      - `backtest_tools.py`：支持 `strategy_id` / `data_file` 模糊匹配；成功返回 `resolved.date_range`、`summary_metrics`、`trade_preview`
