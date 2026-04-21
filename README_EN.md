<div align="center">

# DeltaFStation

[中文](README.md) | [English](README_EN.md)

![Version](https://img.shields.io/badge/version-1.0.2-7C3AED.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-D97706.svg)
![Python](https://img.shields.io/badge/python-3.8%20%7C%203.9%20%7C%203.10%20%7C%203.11%20%7C%203.12-2563EB.svg)
![License](https://img.shields.io/badge/license-MIT-10B981.svg)

DeltaFStation is an open-source quantitative trading workstation built on deltafq, delivering an integrated web experience for market data management, strategy development and backtesting, manual simulated trading, automated strategy running, and AI Agent-assisted analysis.

<img src="assets/trader.png" style="width:32%; height:200px; object-fit:contain;" />
<img src="assets/backtest.png" style="width:32%; height:200px; object-fit:contain;" />
<img src="assets/monitor.png" style="width:32%; height:200px; object-fit:contain;" />

</div>

## 🎓 Official Tutorial

#### [iMOOC - Programmer AI Quantitative Wealth Management System Course](https://class.imooc.com/sale/aiqwm)

> The official companion course for this project: a deep dive into the framework architecture from 0 to 1, covering live-trading workflow design and industrial-grade quantitative development practices.

## 🚀 Installation & Quick Start

```bash
pip install -r requirements.txt
python run.py
```

## ✨ Core Features

- 📊 Data Services - Market data management and updates as a unified data entry point for backtesting, simulation, and strategy running
- 📉 Backtest Hub - Strategy creation, historical backtesting, performance analysis, persisted results, and visual reports
- 🧾 Manual Trading - Manage accounts (select or create), local simulation with tick-level matching, buy/sell execution, and position & PnL tracking
- ⚡ Strategy Running - Automated trading workflow orchestration, real-time monitoring, signal execution, and runtime logs
- 🤖 AI Agent - Supports LLM configuration, chat, tool calls, and skill injection

### 🔌 Interface Integrations

- [Data] yfinance ✅ - US equities, A-shares, HK equities, crypto, and indices
- [Data] eastmoney ✅ - Off-exchange funds (index, QDII, equity, bond, hybrid)
- [Data] miniQMT ⏳ - A-share market data access (see the live-trading chapter in the course)
- [Trade] PaperTrade ✅ - Local simulated trading, tick-level order matching, positions and order management
- [Trade] miniQMT Trade ⏳ - A-share live trading (see the live-trading chapter in the course)

## 🗂️ Project Structure

```
deltafstation/
├── assets/           # Docs and presentation images
├── backend/
│   ├── api/          # REST API
│   │   ├── data_api.py
│   │   ├── strategy_api.py
│   │   ├── backtest_api.py
│   │   ├── ai_api.py          # AI Agent: LLM chat (SSE stream); optional backtest SKILL injection
│   │   ├── simulation_api.py   # Manual trading: accounts, orders
│   │   └── gostrategy_api.py   # Strategy run: start/stop, charts
│   ├── core/         # Core engines
│   │   ├── data_manager.py
│   │   ├── live_data_manager.py
│   │   ├── backtest_engine.py
│   │   ├── simulation_engine.py      # Manual tick matching
│   │   ├── strategy_engine.py     # Strategy automation (LiveEngine)
│   │   ├── agent/                   # AI Agent orchestration layer (OpenAI-compatible: DeepSeek / OpenAI / Tongyi etc.)
│   │   │   ├── llm_client.py
│   │   │   ├── skill_prompt.py      # load skills/*/SKILL.md into system prompt on keyword match
│   │   │   ├── skills/              # Markdown skills (e.g. backtest/SKILL.md)
│   │   │   ├── tool_registry.py   # tool schema / handler registration (via TOOL_DEFINITIONS)
│   │   │   ├── tool_runner.py     # multi-round tool_calls execution loop
│   │   │   └── tools/              # tool implementations (handlers)
│   │   │       ├── fun_tools.py
│   │   │       ├── backtest_tools.py
│   │   │       └── backtest_auto_tools.py
│   │   ├── utils/
│   │   │   ├── engine_snapshot.py
│   │   │   ├── sim_persistence.py
│   │   │   └── strategy_loader.py
│   └── app.py        # Flask entry
├── config/
├── data/
│   ├── raw/          # Raw OHLCV CSV
│   ├── results/      # Backtest results JSON
│   ├── simulations/  # Simulation account config JSON
│   └── strategies/   # Strategy Python files
├── frontend/
│   ├── templates/    # index / backtest / trader / gostrategy
│   └── static/       # Static assets (css/js)
├── requirements.txt
└── run.py
```

## 🏗️ Architecture

DeltaFStation is built with Flask on the web layer and integrates the deltafq quantitative framework to deliver a cloud workflow from research to execution:
https://github.com/Delta-F/deltafq

<table>
  <tr>
    <td><img src="assets/arch1.png" style="width:100%; height:220px; object-fit:contain;" /></td>
    <td><img src="assets/arch2.png" style="width:100%; height:220px; object-fit:contain;" /></td>
  </tr>
</table>

## 🤝 Community & Contribution

- Welcome to submit [issues](https://github.com/delta-f/deltafstation/issues) or [pull requests](https://github.com/delta-f/deltafstation/pulls) for feedback and improvements.
- WeChat Official Account: follow `DeltaFQ开源量化` for updates and quant resources.

<p align="center">
  <img src="assets/wechat_qr.png" width="150" alt="WeChat Official Account" />
</p>

## ⚖️ License

MIT License, see [LICENSE](LICENSE) for details.
