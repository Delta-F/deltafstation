<div align="center">

# DeltaFStation

[中文](README.md) | [English](README_EN.md)

![Version](https://img.shields.io/badge/version-0.7.0-7C3AED.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-D97706.svg)
![Python](https://img.shields.io/badge/python-3.8%20%7C%203.9%20%7C%203.10%20%7C%203.11%20%7C%203.12-2563EB.svg)
![License](https://img.shields.io/badge/license-MIT-10B981.svg)

An open-source quantitative trading cloud platform built on deltafq, integrating data services, strategy management, and trading access with support for simulation and live trading.

<img src="assets/trader.png" style="width:32%; height:200px; object-fit:contain;" />
<img src="assets/backtest.png" style="width:32%; height:200px; object-fit:contain;" />
<img src="assets/monitor.png" style="width:32%; height:200px; object-fit:contain;" />

</div>

## Exclusive Tutorials

iMOOC - AI Quantitative System Course : https://class.imooc.com/sale/aiqwm

## Installation & Quick Start

```bash
pip install -r requirements.txt
python run.py
```

Open your browser and visit: http://localhost:5000

## Core Features

- 📉 Backtest Hub - Strategy creation, historical backtesting, performance analysis, and visual reports
- 🧾 Manual Trading - Account management, buy/sell execution, and position & PnL tracking
- ⚡ Strategy Running - Automated trading, real-time monitoring, signal execution, and logs
- 🤖 AI Assistant - Intelligent Q&A, usage guidance, and context-aware help

## Project Structure

```
deltafstation/
├── assets/           # Docs and presentation images
├── backend/          # Backend code
│   ├── api/          # API endpoints
│   └── core/         # Core modules
├── config/           # Configuration
├── data/             # Data directory
│   ├── raw/          # Raw data
│   ├── results/      # Backtest results
│   ├── simulations/  # Simulation records
│   └── strategies/   # Strategy files
├── data_cache/       # Cached data
├── frontend/         # Frontend code
│   ├── templates/    # HTML templates
│   └── static/       # Static assets (css/js)
├── requirements.txt  # Dependencies
└── run.py           # Startup script
```

## Architecture

DeltaFStation is built with Flask on the web layer and integrates the deltafq quantitative framework to deliver a cloud workflow from research to execution:
https://github.com/Delta-F/deltafq

<table>
  <tr>
    <td><img src="assets/arch1.png" style="width:100%; height:220px; object-fit:contain;" /></td>
    <td><img src="assets/arch2.png" style="width:100%; height:220px; object-fit:contain;" /></td>
  </tr>
</table>

## Community & Contribution

- Welcome to submit [issues](https://github.com/delta-f/deltafstation/issues) or [pull requests](https://github.com/delta-f/deltafstation/pulls) for feedback and improvements.
- WeChat Official Account: follow `DeltaFQ开源量化` for updates and quant resources.

<p align="center">
  <img src="assets/wechat_qr.png" width="150" alt="WeChat Official Account" />
</p>

## License

MIT License, see [LICENSE](LICENSE) for details.
