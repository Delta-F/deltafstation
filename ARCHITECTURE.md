# DeltaFStation 系统架构

## 一图看懂

```
前端 (Bootstrap 5 + JS + Chart.js)
  ├── 主页 index
  ├── 策略回测 strategy (支持长跨度数据聚合渲染)
  ├── 手动交易 trading
  ├── 策略运行 run
  ├── 系统日志 Live Console (基于 SSE 实时同步)
  └── AI 小助手 (全局组件)
      ├── 浮标按钮
      ├── 聊天窗口
      └── 智能问答系统

           │  调用 REST API
           ▼
后端 (Flask)
  ├── 数据 API        backend/api/data_api.py
  ├── 策略 API       backend/api/strategy_api.py
  ├── 回测 API       backend/api/backtest_api.py
  ├── 仿真/账户 API   backend/api/simulation_api.py  # 创建、列表、状态、开启、停止、下单
  └── 日志流 (SSE)    backend/app.py (stdout pipe)

           │  业务调用
           ▼
核心引擎 (Core)
  ├── DataManager        backend/core/data_manager.py
  ├── LiveDataManager    backend/core/live_data_manager.py
  ├── BacktestEngine*    backend/core/backtest_engine.py
  └── SimulationEngine   backend/core/simulation_engine.py

           │  读写文件
           ▼
数据层 (Files)
  ├── data/raw/          原始行情 CSV
  ├── data/strategies/   策略 Python 文件*
  ├── data/results/      回测结果 JSON
  └── data/simulations/  仿真记录 JSON
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
  - 基于 `deltafq`（EventEngine + yfinance 行情 + paper 交易网关），按 tick 撮合限价单；仅允许一个账户运行，内存维护运行中实例
  - 由 `simulation_api` 调用，账户配置与列表持久化写入 `data/simulations/`

- **策略管理**
  - 策略实现存放在 `data/strategies/*.py`，继承 `deltafq.BaseStrategy`
  - `strategy_api` 负责发现、列出、加载这些策略

## 项目结构（简版）

```
backend/
  ├── api/        # HTTP API (data, strategy, backtest, simulation)
  ├── core/       # 引擎与数据管理
  └── app.py      # Flask 入口

frontend/
  ├── templates/  # index / strategy / trading / run + 公共组件
  │   └── _ai_assistant.html  # AI 小助手组件
  └── static/     # css / js / 图标等静态资源
      ├── css/
      │   └── ai-assistant.css  # AI 小助手样式
      └── js/
          └── ai-assistant.js   # AI 小助手逻辑（前端模拟对话）

data/             # 本地数据（已在 .gitignore 中忽略）
data_cache/       # 本地缓存（已忽略）
run.py            # 启动脚本
requirements.txt  # 依赖
```

## 设计要点（一句话版）

- **前后端分离但目录同仓**：Flask 只负责 API 和模板渲染，前端用 Bootstrap + 原生 JS。
- **强依赖 deltafq**：回测与策略体系完全复用 `deltafq`，本项目更像一套 Web 外壳。
- **文件即数据库**：数据与结果全部以 CSV / JSON 落在 `data/` 目录，部署简单。
- **易扩展**：新增策略 = 在 `data/strategies/` 写一个继承 `BaseStrategy` 的类，再通过前端选择即可。
- **AI 小助手**：纯前端实现，基于关键词匹配的智能问答系统，支持上下文感知和快捷操作。
