<div align="center">

# DeltaFStation

[中文](README.md) | [English](README_EN.md)

![Version](https://img.shields.io/badge/version-0.7.4-7C3AED.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-D97706.svg)
![Python](https://img.shields.io/badge/python-3.8%20%7C%203.9%20%7C%203.10%20%7C%203.11%20%7C%203.12-2563EB.svg)
![License](https://img.shields.io/badge/license-MIT-10B981.svg)

基于 deltafq 的开源量化交易云平台，集成数据服务、策略管理与交易接入，支持模拟与实盘。

<img src="assets/trader.png" style="width:32%; height:200px; object-fit:contain;" />
<img src="assets/backtest.png" style="width:32%; height:200px; object-fit:contain;" />
<img src="assets/monitor.png" style="width:32%; height:200px; object-fit:contain;" />

</div>

## 专属教程

慕课网 - 程序员AI量化理财体系课：https://class.imooc.com/sale/aiqwm

## 安装与启动

```bash
pip install -r requirements.txt
python run.py
```

## 核心功能

- 📉 回测中心 - 策略创建、历史数据回测、绩效分析与可视化报告
- 🧾 手动交易 - 管理账户（选择/新建）、本地模拟基于 deltafq 按 tick 撮合、买卖执行与持仓盈亏跟踪
- ⚡ 策略运行 - 自动交易、实时监控、信号执行与日志追踪
- 🤖 AI 小助手 - 智能问答、使用指导、上下文感知帮助

## 项目结构

```
deltafstation/
├── assets/           # 文档与展示图片
├── backend/          # 后端代码
│   ├── api/          # API 接口
│   └── core/         # 核心模块
├── config/           # 配置文件
├── data/             # 数据目录
│   ├── raw/          # 原始数据
│   ├── results/      # 回测结果
│   ├── simulations/  # 仿真记录
│   └── strategies/   # 策略文件
├── data_cache/       # 缓存数据
├── frontend/         # 前端代码
│   ├── templates/    # HTML 模板
│   └── static/       # 静态资源（css/js）
├── requirements.txt  # 依赖列表
└── run.py            # 启动脚本
```

## 技术架构

DeltaFStation 基于 Flask 构建 Web 端，后端集成 deltafq 量化框架，实现从策略研发到交易接入的云端工作流：
https://github.com/Delta-F/deltafq

<table>
  <tr>
    <td><img src="assets/arch1.png" style="width:100%; height:220px; object-fit:contain;" /></td>
    <td><img src="assets/arch2.png" style="width:100%; height:220px; object-fit:contain;" /></td>
  </tr>
</table>

## 社区与贡献

- 欢迎通过 [Issue](https://github.com/delta-f/deltafstation/issues) 或 [PR](https://github.com/delta-f/deltafstation/pulls) 反馈问题、提交改进。
- 微信公众号：关注 `DeltaFQ开源量化`，获取版本更新与量化资料。

<p align="center">
  <img src="assets/wechat_qr.png" width="150" alt="微信公众号" />
</p>

## 许可证

MIT License，详见 [LICENSE](LICENSE)。
