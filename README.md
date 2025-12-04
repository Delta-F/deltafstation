# DeltaFStation

<div align="center">

[中文](README.md) | [English](README_EN.md)

![Version](https://img.shields.io/badge/version-1.0.0-7C3AED.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-D97706.svg)
![Python](https://img.shields.io/badge/python-3.8%20%7C%203.9%20%7C%203.10%20%7C%203.11%20%7C%203.12-2563EB.svg)
![License](https://img.shields.io/badge/license-MIT-10B981.svg)

基于 Web 的量化交易系统，专注于策略回测、仿真交易与实时监控。

</div>

## 安装

```bash
pip install -r requirements.txt
```

## 快速开始

```bash
python run.py
```

打开浏览器访问: http://localhost:5000

## 核心功能

```
DeltaFStation/
├── 策略回测      # 策略创建、历史数据回测、绩效分析
├── 手动交易      # 账户管理、手动买卖、持仓跟踪
└── 策略运行      # 自动交易、实时监控、信号执行
```

## 使用示例

### 1. 策略回测

- 上传 CSV 数据文件或从 Yahoo Finance 下载
- 创建策略（支持自定义 Python 策略文件）
- 运行回测，查看收益率、夏普比率、最大回撤等指标
- 可视化回测结果（资产曲线、回撤图、收益分布等）

### 2. 手动交易

- 创建仿真账户，设置初始资金和手续费率
- 手动执行买卖操作，实时查看持仓和盈亏
- 跟踪委托、成交和持仓记录

### 3. 策略运行

- 选择策略并启动自动交易
- 实时监控策略状态、资产变化和交易信号
- 查看实时资产曲线和交易日志

## 技术栈

- **后端**: Flask, Pandas, NumPy, yfinance, deltafq
- **前端**: Bootstrap 5, JavaScript, Chart.js
- **数据存储**: CSV, JSON

## 项目结构

```
deltafstation/
├── backend/          # 后端代码
│   ├── api/          # API 接口
│   └── core/         # 核心模块
├── frontend/         # 前端代码
│   ├── templates/    # HTML 模板
│   └── static/       # 静态资源
├── data/             # 数据目录
│   ├── raw/          # 原始数据
│   ├── results/      # 回测结果
│   └── strategies/   # 策略文件
└── run.py           # 启动脚本
```

## 社区与贡献

- 欢迎通过 [Issue](https://github.com/delta-f/deltafstation/issues) 或 [PR](https://github.com/delta-f/deltafstation/pulls) 反馈问题、提交改进。

## 许可证

MIT License，详见 [LICENSE](LICENSE)。
