# DeltaFStation

<div align="center">

[中文](README.md) | [English](README_EN.md)

![Version](https://img.shields.io/badge/version-1.0.0-7C3AED.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-D97706.svg)
![Python](https://img.shields.io/badge/python-3.8%20%7C%203.9%20%7C%203.10%20%7C%203.11%20%7C%203.12-2563EB.svg)
![License](https://img.shields.io/badge/license-MIT-10B981.svg)

A web-based quantitative trading system focused on strategy backtesting, simulation trading, and real-time monitoring.

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
└── Strategy Running     # Automated trading, real-time monitoring, signal execution
```

## Usage Examples

### 1. Strategy Backtest

- Upload CSV data files or download from Yahoo Finance
- Create strategies (supports custom Python strategy files)
- Run backtests and view metrics (returns, Sharpe ratio, max drawdown, etc.)
- Visualize backtest results (equity curve, drawdown chart, PnL distribution, etc.)

### 2. Manual Trading

- Create simulation accounts with initial capital and commission rates
- Execute manual buy/sell operations and view positions and P&L in real-time
- Track orders, trades, and positions

### 3. Strategy Running

- Select strategies and start automated trading
- Monitor strategy status, asset changes, and trading signals in real-time
- View real-time equity curves and trading logs

## Tech Stack

- **Backend**: Flask, Pandas, NumPy, yfinance, deltafq
- **Frontend**: Bootstrap 5, JavaScript, Chart.js
- **Data Storage**: CSV, JSON

## Project Structure

```
deltafstation/
├── backend/          # Backend code
│   ├── api/          # API endpoints
│   └── core/         # Core modules
├── frontend/         # Frontend code
│   ├── templates/    # HTML templates
│   └── static/       # Static resources
├── data/             # Data directory
│   ├── raw/          # Raw data
│   ├── results/      # Backtest results
│   └── strategies/   # Strategy files
└── run.py           # Startup script
```

## Community & Contribution

- Welcome to submit [issues](https://github.com/delta-f/deltafstation/issues) or [pull requests](https://github.com/delta-f/deltafstation/pulls) for feedback and improvements.

## License

MIT License, see [LICENSE](LICENSE) for details.

