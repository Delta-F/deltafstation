# DeltaFStation 系统架构

## 一图看懂

```
前端 (Bootstrap 5 + JS + Chart.js)
  ├── 主页 index
  ├── 策略回测 strategy (支持长跨度数据聚合渲染)
  ├── 手动交易 trading
  ├── 策略运行 run (gostrategy)
  ├── 系统日志 Live Console (基于 SSE 实时同步)
  └── AI 小助手 (全局组件)
      ├── 浮标按钮
      ├── 聊天窗口
      └── 智能问答系统

           │  调用 REST API
           ▼
后端 (Flask)
  ├── 数据 API        backend/api/data_api.py
  ├── 策略 API        backend/api/strategy_api.py
  ├── 回测 API        backend/api/backtest_api.py
  ├── 仿真/账户 API   backend/api/simulation_api.py   # 创建、列表、状态、开启、停止、下单
  ├── 策略运行 API    backend/api/gostrategy_api.py   # 启动/停止策略、K 线图表（按 signal_interval）
  └── 日志流 (SSE)    backend/app.py (stdout pipe)

           │  业务调用
           ▼
核心引擎 (Core)
  ├── DataManager           backend/core/data_manager.py
  ├── LiveDataManager       backend/core/live_data_manager.py
  ├── BacktestEngine*       backend/core/backtest_engine.py
  ├── SimulationEngine      backend/core/simulation_engine.py      # 手动交易（tick 撮合）
  ├── StrategyEngine*     backend/core/strategy_engine.py     # 策略自动化（deltafq LiveEngine）
  └── simulation_state backend/core/utils/simulation_state.py  # 停同账户、持久化

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
  - 由 `gostrategy_api` 调用，状态从 `StrategyEngine.get_state` / `get_run_info` 获取

- **SimulationStateService**
  - 停掉同一账户上已有实例（仿真或 LiveEngine），并持久化 state
  - 供 `gostrategy_api` 在启动策略前调用，避免多引擎冲突

- **策略管理**
  - 策略实现存放在 `data/strategies/*.py`，继承 `deltafq.BaseStrategy`
  - `strategy_api` 负责发现、列出、加载这些策略

## 项目结构（简版）

```
backend/
  ├── api/        # HTTP API (data, strategy, backtest, simulation, gostrategy)
  ├── core/       # 引擎与数据管理
  └── app.py      # Flask 入口

frontend/
  ├── templates/  # index / backtest / trader / gostrategy + 公共组件
  │   └── _ai_assistant.html  # AI 小助手组件
  └── static/
      ├── css/    # style, common, backtest, trader, gostrategy, ai-assistant
      └── js/     # common, backtest, trader, gostrategy, ai-assistant

config/
  └── config.py   # 应用配置

data/             # 本地数据（已在 .gitignore 中忽略）
data_cache/       # 本地缓存（已忽略）
run.py            # 启动脚本
requirements.txt  # 依赖
```

## 设计要点（一句话版）

- **前后端分离但目录同仓**：Flask 只负责 API 和模板渲染，前端用 Bootstrap + 原生 JS。
- **强依赖 deltafq**：回测与策略体系完全复用 `deltafq`，本项目更像一套 Web 外壳。
- **双引擎模式**：`SimulationEngine` 用于手动交易，`StrategyEngine` 用于策略自动运行；同一账户同一时间仅一种模式。
- **文件即数据库**：数据与结果全部以 CSV / JSON 落在 `data/` 目录，部署简单。
- **易扩展**：新增策略 = 在 `data/strategies/` 写一个继承 `BaseStrategy` 的类，再通过前端选择即可。
- **AI 小助手**：纯前端实现，基于关键词匹配的智能问答系统，支持上下文感知和快捷操作。
