"""
DeltaFStation - 量化交易系统主应用
"""
from flask import Flask, render_template, request, jsonify, Response
from flask_cors import CORS
import os
import sys
import time
import threading
from datetime import datetime

# 全局日志队列，用于 SSE 推送
class LogQueue:
    def __init__(self, maxsize=100):
        self.queue = []
        self.maxsize = maxsize
        self.lock = threading.Lock()

    def put(self, msg):
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
        with self.lock:
            logs = list(self.queue)
            self.queue.clear()
            return logs

global_log_queue = LogQueue()

# 重定向 stdout 以捕获 print 语句
class StdoutRedirector:
    def __init__(self, original_stdout, log_queue):
        self.original_stdout = original_stdout
        self.log_queue = log_queue

    def write(self, msg):
        self.log_queue.put(msg)
        self.original_stdout.write(msg)

    def flush(self):
        self.original_stdout.flush()

if not isinstance(sys.stdout, StdoutRedirector):
    sys.stdout = StdoutRedirector(sys.stdout, global_log_queue)

from backend.api.data_api import data_bp
from backend.api.strategy_api import strategy_bp
from backend.api.backtest_api import backtest_bp
from backend.api.simulation_api import simulation_bp
from backend.core.live_data_manager import live_data_manager

def create_app():
    app = Flask(__name__, 
                template_folder='../frontend/templates',
                static_folder='../frontend/static')
    
    # 启用CORS支持
    CORS(app)
    
    # 配置
    app.config['SECRET_KEY'] = 'deltafstation_secret_key_2024'
    app.config['DATA_FOLDER'] = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data')
    
    # 启动市场数据服务
    try:
        live_data_manager.start()
    except Exception as e:
        print(f"Error starting LiveDataManager: {e}")
    
    # 注册蓝图（使用复数形式，符合RESTful规范）
    app.register_blueprint(data_bp, url_prefix='/api/data')
    app.register_blueprint(strategy_bp, url_prefix='/api/strategies')
    app.register_blueprint(backtest_bp, url_prefix='/api/backtests')
    app.register_blueprint(simulation_bp, url_prefix='/api/simulations')
    
    @app.route('/')
    def index():
        return render_template('index.html')
    
    @app.route('/strategy')
    def strategy():
        return render_template('backtest.html')
    
    @app.route('/trading')
    def trading():
        return render_template('trader.html')
    
    @app.route('/run')
    def run():
        return render_template('gostrategy.html')
    
    @app.route('/api/logs/stream')
    def stream_logs():
        """日志实时流接口"""
        def generate():
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
        return jsonify({'error': 'Not found'}), 404
    
    @app.errorhandler(500)
    def internal_error(error):
        return jsonify({'error': 'Internal server error'}), 500
    
    return app

if __name__ == '__main__':
    app = create_app()
    app.run(debug=True, host='0.0.0.0', port=5000)
