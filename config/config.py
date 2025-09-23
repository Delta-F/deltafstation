"""
DeltaFStation 配置文件
"""
import os

class Config:
    """基础配置"""
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'deltafstation_secret_key_2024'
    DATA_FOLDER = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data')
    
    # 数据库配置（如果将来需要）
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL') or 'sqlite:///deltafstation.db'
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    # 文件上传配置
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16MB
    UPLOAD_FOLDER = os.path.join(DATA_FOLDER, 'raw')
    
    # 回测配置
    DEFAULT_INITIAL_CAPITAL = 100000
    DEFAULT_COMMISSION = 0.001
    DEFAULT_SLIPPAGE = 0.0005
    
    # 仿真交易配置
    SIMULATION_UPDATE_INTERVAL = 60  # 秒
    MAX_SIMULATION_DURATION = 24 * 60 * 60  # 24小时
    
    # 日志配置
    LOG_LEVEL = 'INFO'
    LOG_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'logs', 'deltafstation.log')

class DevelopmentConfig(Config):
    """开发环境配置"""
    DEBUG = True
    TESTING = False

class ProductionConfig(Config):
    """生产环境配置"""
    DEBUG = False
    TESTING = False

class TestingConfig(Config):
    """测试环境配置"""
    DEBUG = True
    TESTING = True
    WTF_CSRF_ENABLED = False

# 配置字典
config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'testing': TestingConfig,
    'default': DevelopmentConfig
}
