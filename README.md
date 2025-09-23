# DeltaFStation - 量化交易系统

一个简洁明了的量化交易平台，帮助个人投资者进行策略分析、回测和仿真交易。

## 功能特性

### 📊 数据管理
- 支持CSV数据文件上传
- 从Yahoo Finance下载实时数据
- 数据预处理和技术指标计算
- 数据预览和验证

### 🔧 策略分析
- 技术分析策略（移动平均、RSI、MACD等）
- 基本面分析策略
- 机器学习策略框架
- 策略参数优化

### 📈 回测系统
- 历史数据回测
- 成本滑点考虑
- 风险指标计算（夏普比率、最大回撤等）
- 回测结果可视化

### 🚀 仿真交易
- 实时仿真交易
- 手动交易执行
- 持仓管理
- 交易记录跟踪

## 技术架构

### 后端技术栈
- **Python 3.8+**
- **Flask** - Web框架
- **Pandas** - 数据处理
- **NumPy** - 数值计算
- **yfinance** - 数据获取
- **scikit-learn** - 机器学习

### 前端技术栈
- **HTML5/CSS3** - 页面结构
- **Bootstrap 5** - UI框架
- **JavaScript** - 交互逻辑
- **Chart.js** - 图表展示

### 数据存储
- **CSV文件** - 数据存储
- **JSON文件** - 配置和结果存储

## 快速开始

### 环境要求
- Python 3.8+
- pip

### 安装步骤

1. **克隆项目**
```bash
git clone <repository-url>
cd deltafstation
```

2. **安装依赖**
```bash
pip install -r requirements.txt
```

3. **启动应用**
```bash
python run.py
```

4. **访问系统**
打开浏览器访问: http://localhost:5000

### 使用说明

#### 1. 数据管理
- 上传CSV数据文件（需包含Date, Open, High, Low, Close, Volume列）
- 或从Yahoo Finance下载数据

#### 2. 策略创建
- 选择策略类型（技术分析/基本面分析/机器学习）
- 配置策略参数和交易规则

#### 3. 回测分析
- 选择策略和数据文件
- 设置回测参数（时间范围、初始资金、手续费等）
- 查看回测结果和图表

#### 4. 仿真交易
- 启动仿真交易
- 监控实时状态
- 执行手动交易

## 项目结构

```
deltafstation/
├── backend/                 # 后端代码
│   ├── api/                # API接口
│   │   ├── data_api.py     # 数据管理API
│   │   ├── strategy_api.py # 策略管理API
│   │   ├── backtest_api.py # 回测API
│   │   └── simulation_api.py # 仿真交易API
│   ├── core/               # 核心模块
│   │   ├── data_manager.py # 数据管理器
│   │   ├── backtest_engine.py # 回测引擎
│   │   └── simulation_engine.py # 仿真引擎
│   └── app.py              # 主应用
├── frontend/               # 前端代码
│   ├── templates/          # HTML模板
│   └── static/             # 静态资源
│       ├── css/            # 样式文件
│       └── js/             # JavaScript文件
├── data/                   # 数据目录
│   ├── raw/                # 原始数据
│   ├── processed/          # 处理后的数据
│   └── results/            # 回测结果
├── config/                 # 配置文件
├── logs/                   # 日志文件
├── requirements.txt        # 依赖包
├── run.py                  # 启动脚本
└── README.md              # 项目说明
```

## 配置说明

### 环境变量
- `FLASK_ENV`: 运行环境（development/production）
- `PORT`: 服务端口（默认5000）
- `HOST`: 服务地址（默认0.0.0.0）

### 配置文件
- `config/config.py`: 系统配置
- 支持开发、生产、测试环境配置

## API接口

### 数据管理
- `POST /api/data/upload` - 上传数据文件
- `POST /api/data/download` - 下载数据
- `GET /api/data/list` - 获取数据文件列表
- `GET /api/data/preview/<filename>` - 预览数据

### 策略管理
- `POST /api/strategy/create` - 创建策略
- `GET /api/strategy/list` - 获取策略列表
- `GET /api/strategy/<id>` - 获取策略详情
- `PUT /api/strategy/<id>` - 更新策略
- `DELETE /api/strategy/<id>` - 删除策略

### 回测系统
- `POST /api/backtest/run` - 运行回测
- `GET /api/backtest/results` - 获取回测结果列表
- `GET /api/backtest/results/<id>` - 获取回测结果详情

### 仿真交易
- `POST /api/simulation/start` - 启动仿真
- `POST /api/simulation/stop/<id>` - 停止仿真
- `GET /api/simulation/status/<id>` - 获取仿真状态
- `POST /api/simulation/trade/<id>` - 执行交易

## 开发指南

### 添加新策略
1. 在 `backend/core/backtest_engine.py` 中创建策略类
2. 实现 `generate_signals` 方法
3. 在策略创建API中注册新策略类型

### 添加新指标
1. 在 `backend/core/data_manager.py` 中添加指标计算函数
2. 在 `_add_technical_indicators` 方法中调用

### 自定义前端
1. 修改 `frontend/templates/` 中的HTML模板
2. 更新 `frontend/static/css/style.css` 样式
3. 修改 `frontend/static/js/` 中的JavaScript逻辑

## 注意事项

1. **数据安全**: 请确保数据文件的安全性，避免敏感信息泄露
2. **回测准确性**: 回测结果仅供参考，实际交易存在风险
3. **仿真限制**: 仿真交易不涉及真实资金，但应谨慎对待
4. **性能优化**: 大量数据处理时注意内存使用

## 许可证

本项目采用 MIT 许可证，详见 LICENSE 文件。

## 贡献

欢迎提交 Issue 和 Pull Request 来改进项目。

## 联系方式

如有问题或建议，请通过以下方式联系：
- 提交 Issue
- 发送邮件

---

**免责声明**: 本系统仅供学习和研究使用，不构成投资建议。投资有风险，入市需谨慎。