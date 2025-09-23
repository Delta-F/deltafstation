#!/usr/bin/env python3
"""
DeltaFStation 量化交易系统启动脚本
"""
import os
import sys
from backend.app import create_app

def main():
    """主函数"""
    # 设置环境变量
    os.environ.setdefault('FLASK_ENV', 'development')
    
    # 创建应用
    app = create_app()
    
    # 获取配置
    port = int(os.environ.get('PORT', 5000))
    host = os.environ.get('HOST', '0.0.0.0')
    debug = os.environ.get('FLASK_ENV') == 'development'
    
    print("=" * 50)
    print("DeltaFStation 量化交易系统")
    print("=" * 50)
    print(f"启动地址: http://{host}:{port}")
    print(f"调试模式: {'开启' if debug else '关闭'}")
    print("=" * 50)
    
    # 启动应用
    app.run(host=host, port=port, debug=debug)

if __name__ == '__main__':
    main()
