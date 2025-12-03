"""
DeltaFStation - 量化交易系统主应用
"""
from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
import os
import sys

# 添加项目根目录到Python路径
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.api.data_api import data_bp
from backend.api.strategy_api import strategy_bp
from backend.api.backtest_api import backtest_bp
from backend.api.simulation_api import simulation_bp

def create_app():
    app = Flask(__name__, 
                template_folder='../frontend/templates',
                static_folder='../frontend/static')
    
    # 启用CORS支持
    CORS(app)
    
    # 配置
    app.config['SECRET_KEY'] = 'deltafstation_secret_key_2024'
    app.config['DATA_FOLDER'] = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data')
    
    # 注册蓝图
    app.register_blueprint(data_bp, url_prefix='/api/data')
    app.register_blueprint(strategy_bp, url_prefix='/api/strategy')
    app.register_blueprint(backtest_bp, url_prefix='/api/backtest')
    app.register_blueprint(simulation_bp, url_prefix='/api/simulation')
    
    @app.route('/')
    def index():
        return render_template('index.html')
    
    @app.route('/strategy')
    def strategy():
        return render_template('strategy.html')
    
    @app.route('/trading')
    def trading():
        return render_template('trading.html')
    
    @app.route('/run')
    def run():
        return render_template('run.html')
    
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
