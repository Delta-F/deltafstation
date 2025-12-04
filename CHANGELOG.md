# DeltaFStation 更新记录 / Changelog

## v0.3.0 （当前，2025-12-04）

**定位**：交易功能完善 + 代码优化。

- 实现手动交易界面（`trader.html`）：账户创建、手动买卖、持仓管理、交易记录跟踪。
- 实现策略运行界面（`gostrategy.html`）：策略启动、实时监控、资产曲线、交易日志。
- 增加模拟数据支持：仿真交易使用演示数据，支持策略自动交易和手动交易。
- 代码优化：抽离公共模块（`common.css`、`common.js`），精简重复代码，完善文档和 Git 规范。

---

## v0.2.0 （2025-12-03）

**定位**：回测功能完整实现，集成 deltafq 量化框架。

- **回测界面实现**
  - 完成 `backtest.html` 策略回测页面：策略选择、数据文件管理、回测参数配置、历史记录查看。
  - 实现 `backtest.js` 前端逻辑：策略加载、数据预览、回测执行、结果可视化（资产曲线、回撤图、收益分布等）。
  - 集成 Chart.js 实现多维度回测结果图表展示。

- **后端回测引擎集成**
  - 实现 `backend/core/backtest_engine.py`：封装 deltafq 的 `BacktestEngine`，提供统一的回测接口。
  - 实现 `backend/api/backtest_api.py`：提供回测执行、结果查询、历史记录管理等 RESTful API。
  - 支持从 `data/strategies/` 目录动态加载 Python 策略类，策略类需继承 deltafq 的 `BaseStrategy`。

- **策略管理**
  - 实现策略文件自动发现机制：扫描 `data/strategies/` 目录下的 `.py` 文件，识别策略类。
  - 提供策略列表查询 API，支持策略元数据（名称、描述等）获取。

- **数据管理增强**
  - 支持 CSV 数据文件上传和 Yahoo Finance 数据下载。
  - 实现数据预览功能，支持前端查看数据文件内容。

---

## v0.1.0 （初始版本）

- 基于 Flask + Bootstrap 5 + Chart.js 搭建的单机量化交易 Web 系统。
- 后端包含：数据管理、策略管理、回测引擎、仿真引擎四大块，全部使用文件（CSV / JSON）作为存储。
- 前端提供：
  - `index`：入口主页；
  - `strategy`：策略创建与回测入口（对应 backtest 页面）；
  - `trading`：手动仿真交易界面（对应 trader 页面）；
  - `run`：策略自动运行与实时监控界面（对应 gostrategy 页面）。
- 回测与策略体系基于 `deltafq` 框架封装，支持自定义 Python 策略类。
