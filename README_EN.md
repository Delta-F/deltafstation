<div align="center">

# DeltaFStation

[中文](README.md) | [English](README_EN.md)

![Version](https://img.shields.io/badge/version-0.6.4-7C3AED.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-D97706.svg)
![Python](https://img.shields.io/badge/python-3.8%20%7C%203.9%20%7C%203.10%20%7C%203.11%20%7C%203.12-2563EB.svg)
![License](https://img.shields.io/badge/license-MIT-10B981.svg)

An open-source quantitative trading cloud platform built on deltafq, integrating data services, strategy management, and trading access with support for simulation and live trading.

<img src="assets/trader.png" style="width:32%; height:200px; object-fit:contain;" />
<img src="assets/backtest.png" style="width:32%; height:200px; object-fit:contain;" />
<img src="assets/monitor.png" style="width:32%; height:200px; object-fit:contain;" />

</div>

## Installation

```bash
pip install -r requirements.txt
```

## Quick Start

```bash
python run.py
```

Open your browser and visit: http://localhost:5000

## Core Features

```
DeltaFStation/
├── Strategy Backtest    # Strategy creation, historical backtesting, performance analysis
├── Manual Trading       # Account management, manual buy/sell, position tracking
├── Strategy Running     # Automated trading, real-time monitoring, signal execution
└── AI Assistant         # Intelligent Q&A, usage guidance, context-aware help
```

## Project Structure

```
deltafstation/
├── backend/          # Backend code
│   ├── api/          # API endpoints
│   └── core/         # Core modules
├── frontend/         # Frontend code
│   ├── templates/    # HTML templates
│   │   └── _ai_assistant.html  # AI Assistant component
│   └── static/       # Static resources
│       ├── css/      # Stylesheets
│       │   └── ai-assistant.css  # AI Assistant styles
│       └── js/        # JavaScript files
│           └── ai-assistant.js   # AI Assistant logic
├── data/             # Data directory
│   ├── raw/          # Raw data
│   ├── results/      # Backtest results
│   └── strategies/   # Strategy files
└── run.py           # Startup script
```

## Architecture

<img src="assets/arch1.png" style="width:47%; height:220px; object-fit:contain; display:inline-block; vertical-align:top;" />
<img src="assets/arch2.png" style="width:47%; height:220px; object-fit:contain; display:inline-block; vertical-align:top;" />

## Community & Contribution

- Welcome to submit [issues](https://github.com/delta-f/deltafstation/issues) or [pull requests](https://github.com/delta-f/deltafstation/pulls) for feedback and improvements.

## License

MIT License, see [LICENSE](LICENSE) for details.
