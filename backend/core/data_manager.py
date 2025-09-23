"""
数据管理模块
"""
import pandas as pd
import numpy as np
import os
from datetime import datetime, timedelta
import yfinance as yf

class DataManager:
    """数据管理器"""
    
    def __init__(self, data_folder):
        self.data_folder = data_folder
        self.raw_folder = os.path.join(data_folder, 'raw')
        self.processed_folder = os.path.join(data_folder, 'processed')
        
        # 确保文件夹存在
        os.makedirs(self.raw_folder, exist_ok=True)
        os.makedirs(self.processed_folder, exist_ok=True)
    
    def load_data(self, filename):
        """加载CSV数据文件"""
        filepath = os.path.join(self.raw_folder, filename)
        if not os.path.exists(filepath):
            raise FileNotFoundError(f"Data file not found: {filename}")
        
        df = pd.read_csv(filepath)
        df['Date'] = pd.to_datetime(df['Date'])
        df = df.set_index('Date')
        df = df.sort_index()
        
        return df
    
    def save_data(self, df, filename):
        """保存数据到CSV文件"""
        filepath = os.path.join(self.raw_folder, filename)
        df.to_csv(filepath)
        return filepath
    
    def download_yahoo_data(self, symbol, period='1y'):
        """从Yahoo Finance下载数据"""
        try:
            ticker = yf.Ticker(symbol)
            df = ticker.history(period=period)
            
            if df.empty:
                raise ValueError(f"No data found for symbol {symbol}")
            
            # 重置索引，将Date作为列
            df = df.reset_index()
            df['Date'] = df['Date'].dt.strftime('%Y-%m-%d')
            
            # 保存文件
            filename = f"{symbol}_{period}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
            self.save_data(df, filename)
            
            return filename, df
        
        except Exception as e:
            raise Exception(f"Failed to download data for {symbol}: {str(e)}")
    
    def process_data(self, df):
        """数据预处理"""
        # 移除缺失值
        df = df.dropna()
        
        # 计算技术指标
        df = self._add_technical_indicators(df)
        
        # 计算收益率
        df['Returns'] = df['Close'].pct_change()
        df['Log_Returns'] = np.log(df['Close'] / df['Close'].shift(1))
        
        return df
    
    def _add_technical_indicators(self, df):
        """添加技术指标"""
        # 移动平均线
        df['MA5'] = df['Close'].rolling(window=5).mean()
        df['MA10'] = df['Close'].rolling(window=10).mean()
        df['MA20'] = df['Close'].rolling(window=20).mean()
        df['MA50'] = df['Close'].rolling(window=50).mean()
        
        # RSI
        df['RSI'] = self._calculate_rsi(df['Close'])
        
        # MACD
        macd_data = self._calculate_macd(df['Close'])
        df['MACD'] = macd_data['macd']
        df['MACD_Signal'] = macd_data['signal']
        df['MACD_Histogram'] = macd_data['histogram']
        
        # 布林带
        bb_data = self._calculate_bollinger_bands(df['Close'])
        df['BB_Upper'] = bb_data['upper']
        df['BB_Middle'] = bb_data['middle']
        df['BB_Lower'] = bb_data['lower']
        
        # 成交量指标
        df['Volume_MA'] = df['Volume'].rolling(window=20).mean()
        df['Volume_Ratio'] = df['Volume'] / df['Volume_MA']
        
        return df
    
    def _calculate_rsi(self, prices, period=14):
        """计算RSI指标"""
        delta = prices.diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
        rs = gain / loss
        rsi = 100 - (100 / (1 + rs))
        return rsi
    
    def _calculate_macd(self, prices, fast=12, slow=26, signal=9):
        """计算MACD指标"""
        ema_fast = prices.ewm(span=fast).mean()
        ema_slow = prices.ewm(span=slow).mean()
        macd = ema_fast - ema_slow
        signal_line = macd.ewm(span=signal).mean()
        histogram = macd - signal_line
        
        return {
            'macd': macd,
            'signal': signal_line,
            'histogram': histogram
        }
    
    def _calculate_bollinger_bands(self, prices, period=20, std_dev=2):
        """计算布林带"""
        sma = prices.rolling(window=period).mean()
        std = prices.rolling(window=period).std()
        
        return {
            'upper': sma + (std * std_dev),
            'middle': sma,
            'lower': sma - (std * std_dev)
        }
    
    def get_data_summary(self, df):
        """获取数据摘要信息"""
        summary = {
            'total_rows': len(df),
            'date_range': {
                'start': df.index.min().strftime('%Y-%m-%d'),
                'end': df.index.max().strftime('%Y-%m-%d')
            },
            'price_range': {
                'min': df['Close'].min(),
                'max': df['Close'].max(),
                'mean': df['Close'].mean()
            },
            'volume_stats': {
                'total_volume': df['Volume'].sum(),
                'avg_volume': df['Volume'].mean()
            },
            'missing_data': df.isnull().sum().to_dict()
        }
        
        return summary
