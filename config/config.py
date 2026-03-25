"""
DeltaFStation 配置文件
"""
import os

class Config:
    """基础配置"""
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'deltafstation_secret_key_2026'
    DATA_FOLDER = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data')

    # LLM 配置（OpenAI 兼容 API）
    LLM_API_KEY = "sk-aa5be993bb5d4e84b66246c664bb6d42"
    LLM_BASE_URL = "https://api.deepseek.com/v1"
    LLM_MODEL = "deepseek-chat"

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

# 配置字典
config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'testing': TestingConfig,
    'default': DevelopmentConfig
}
