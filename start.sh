#!/bin/bash

# DeltaFStation 量化交易系统启动脚本

echo "=========================================="
echo "DeltaFStation 量化交易系统"
echo "=========================================="

# 检查Python版本
python_version=$(python3 --version 2>&1)
if [[ $? -ne 0 ]]; then
    echo "错误: 未找到Python3，请先安装Python 3.8+"
    exit 1
fi

echo "Python版本: $python_version"

# 检查是否在虚拟环境中
if [[ "$VIRTUAL_ENV" != "" ]]; then
    echo "虚拟环境: $VIRTUAL_ENV"
else
    echo "警告: 建议在虚拟环境中运行"
fi

# 创建必要的目录
echo "创建必要目录..."
mkdir -p data/raw data/processed data/results data/strategies data/simulations logs

# 检查依赖
echo "检查依赖包..."
if ! python3 -c "import flask" 2>/dev/null; then
    echo "安装依赖包..."
    pip3 install -r requirements.txt
    if [[ $? -ne 0 ]]; then
        echo "错误: 依赖安装失败"
        exit 1
    fi
fi

# 设置环境变量
export FLASK_ENV=development
export FLASK_APP=run.py

# 启动应用
echo "启动DeltaFStation系统..."
echo "访问地址: http://localhost:5000"
echo "按 Ctrl+C 停止服务"
echo "=========================================="

python3 run.py
