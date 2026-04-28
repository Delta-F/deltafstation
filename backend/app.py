"""
DeltaFStation - 量化交易系统主应用。

主要职责：
- 创建并配置 Flask 应用（模板/静态目录、CORS、项目配置）
- 注册各类 API 蓝图
- 提供基础页面路由与 SSE 日志流接口
"""

# Standard library imports
import os
import sys
import threading
import time

# Third-party imports
from flask import Flask, Response, jsonify, render_template
from flask_cors import CORS

# Local imports
from config.config import config as project_config

# 全局日志队列，用于 SSE 推送
class LogQueue:
    """线程安全的内存日志队列。"""

    def __init__(self, maxsize=100):
        self.queue = []
        self.maxsize = maxsize
        self.lock = threading.Lock()

    def put(self, msg):
        """追加一条日志（空白会被过滤）。"""
        with self.lock:
            # 过滤掉一些无意义的换行或空白
            clean_msg = msg.strip()
            if not clean_msg:
                return
            # 不再重复添加时间戳，因为原始日志中通常已经包含了时间
            self.queue.append(clean_msg)
            if len(self.queue) > self.maxsize:
                self.queue.pop(0)

    def get_all(self):
        """取出并清空队列中的全部日志。"""
        with self.lock:
            logs = list(self.queue)
            self.queue.clear()
            return logs

global_log_queue = LogQueue()

# 重定向 stdout 以捕获 print 语句
class StdoutRedirector:
    """将写入 sys.stdout 的内容同步写入日志队列。"""

    def __init__(self, original_stdout, log_queue):
        self.original_stdout = original_stdout
        self.log_queue = log_queue

    def write(self, msg):
        """写入 stdout 的同时，把日志推入 SSE 队列。"""
        self.log_queue.put(msg)
        self.original_stdout.write(msg)

    def flush(self):
        """刷新底层 stdout。"""
        self.original_stdout.flush()

if not isinstance(sys.stdout, StdoutRedirector):
    sys.stdout = StdoutRedirector(sys.stdout, global_log_queue)

from backend.api.ai_api import ai_bp
from backend.api.backtest_api import backtest_bp
from backend.api.broker_api import broker_bp
from backend.api.data_api import data_bp
from backend.api.gostrategy_api import gostrategy_bp
from backend.api.simulation_api import simulation_bp
from backend.api.strategy_api import strategy_bp
from backend.core.live_data_manager import live_data_manager

def create_app() -> Flask:
    """创建并配置 Flask 应用实例。"""
    app = Flask(__name__, 
                template_folder='../frontend/templates',
                static_folder='../frontend/static')
    
    # 启用CORS支持
    CORS(app)

    # 加载项目配置（包含 LLM_* 等）
    cfg_name = os.environ.get('FLASK_ENV', 'development')
    cfg_cls = project_config.get(cfg_name) or project_config.get('default')
    app.config.from_object(cfg_cls)

    # 启动市场数据服务
    try:
        live_data_manager.start()
    except Exception as e:
        print(f"Error starting LiveDataManager: {e}")
    
    # 注册蓝图（使用复数形式，符合 RESTful 风格）
    app.register_blueprint(data_bp, url_prefix='/api/data')
    app.register_blueprint(strategy_bp, url_prefix='/api/strategies')
    app.register_blueprint(backtest_bp, url_prefix='/api/backtests')
    app.register_blueprint(simulation_bp, url_prefix='/api/simulations')
    app.register_blueprint(broker_bp, url_prefix='/api/broker')
    app.register_blueprint(gostrategy_bp, url_prefix='/api/gostrategy')
    app.register_blueprint(ai_bp, url_prefix='/api/ai')
    
    @app.route('/')
    def index():
        """主页。"""
        return render_template('index.html')

    @app.route('/strategy')
    def strategy():
        """策略回测页。"""
        return render_template('backtest.html')

    @app.route('/trading')
    def trading():
        """手动交易页。"""
        return render_template('trader.html')

    @app.route('/run')
    def run():
        """运行策略页。"""
        return render_template('gostrategy.html')

    # SSE 日志流
    @app.route('/api/logs/stream')
    def stream_logs():
        """日志实时流（SSE）。

        前端通过 EventSource 或 fetch 流式读取该接口，以获得后台日志增量。
        """
        def generate():
            """生成 SSE 数据流。"""
            # 建立连接时先发送一个欢迎消息
            yield "data: [SYSTEM] Log stream connected...\n\n"
            while True:
                logs = global_log_queue.get_all()
                for log in logs:
                    # SSE 格式必须以 data: 开头，并以 \n\n 结束
                    yield f"data: {log}\n\n"
                time.sleep(0.5)
        return Response(generate(), mimetype='text/event-stream')
    
    @app.errorhandler(404)
    def not_found(error):
        """未知路由。"""
        return jsonify({'error': 'Not found'}), 404
    
    @app.errorhandler(500)
    def internal_error(error):
        """服务端错误兜底。"""
        return jsonify({'error': 'Internal server error'}), 500
    
    return app

if __name__ == '__main__':
    app = create_app()
    app.run(debug=True, host='0.0.0.0', port=5000)
