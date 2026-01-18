"""
数据管理模块
"""
import pandas as pd
import os
from datetime import datetime, timedelta
import yfinance as yf

try:
    from deltafq.data import DataFetcher
except ImportError:
    DataFetcher = None

class DataManager:
    """数据管理器"""
    
    def __init__(self, data_folder):
        self.data_folder = data_folder
        self.raw_folder = os.path.join(data_folder, 'raw')
        
        # 确保文件夹存在
        os.makedirs(self.raw_folder, exist_ok=True)
    
    def save_data(self, df, filename, index=False):
        """保存数据到CSV文件"""
        filepath = os.path.join(self.raw_folder, filename)
        df.to_csv(filepath, index=index)
        return filepath
    
    def find_latest_file(self, symbol):
        """查找指定股票代码的最新文件"""
        symbol = symbol.upper()
        candidates = []
        for filename in os.listdir(self.raw_folder):
            if filename.lower().endswith('.csv') and filename.upper().startswith(symbol):
                filepath = os.path.join(self.raw_folder, filename)
                stat = os.stat(filepath)
                candidates.append((stat.st_mtime, filename))
        
        if candidates:
            candidates.sort(reverse=True)
            return candidates[0][1]
        return None
    
    def get_file_info(self, symbol):
        """获取指定股票代码的文件信息"""
        latest_file = self.find_latest_file(symbol)
        if not latest_file:
            return None
        
        df = pd.read_csv(os.path.join(self.raw_folder, latest_file), nrows=1)
        return {
            'id': latest_file,
            'filename': latest_file,
            'source': 'local',
            'columns': list(df.columns)
        }
    
    def _standardize_dataframe(self, df):
        """标准化数据框格式"""
        if 'Date' not in df.columns:
            df = df.reset_index().rename(columns={df.index.name or 'index': 'Date'})
        df['Date'] = pd.to_datetime(df['Date']).dt.strftime('%Y-%m-%d')
        return df
    
    def _get_file_start_date(self, filename):
        """从文件中获取起始日期"""
        try:
            df_dates = pd.read_csv(os.path.join(self.raw_folder, filename), usecols=['Date'])
            if not df_dates.empty:
                return pd.to_datetime(df_dates['Date']).min().date()
        except:
            pass
        return (datetime.now() - timedelta(days=365*20)).date()
    
    def _get_file_date_range(self, filename):
        """从文件中获取日期范围"""
        try:
            df = pd.read_csv(os.path.join(self.raw_folder, filename), usecols=['Date'])
            if not df.empty:
                df['Date'] = pd.to_datetime(df['Date'])
                return df['Date'].min().date(), df['Date'].max().date()
        except:
            pass
        return None, None
    
    def fetch_data(self, symbol, start_date=None, end_date=None, period=None, update_existing=True):
        """
        统一的数据获取方法，支持多种数据源和增量更新
        
        Args:
            symbol: 股票代码
            start_date: 起始日期（datetime.date 或 str）
            end_date: 结束日期（datetime.date 或 str）
            period: 时间周期（如 '1y', 'max'），与 start_date/end_date 二选一
            update_existing: 是否检查并更新已有文件
        
        Returns:
            tuple: (filename, df, status, source) - 文件名、数据框、状态信息、数据源
        """
        symbol = symbol.upper()
        
        # 转换日期格式
        if start_date and isinstance(start_date, str):
            start_date = datetime.fromisoformat(start_date).date()
        if end_date and isinstance(end_date, str):
            end_date = datetime.fromisoformat(end_date).date()
        
        # 1. 检查本地文件（如果需要增量更新）
        latest_file = None
        if update_existing:
            latest_file = self.find_latest_file(symbol)
            
            # 如果指定了日期范围，检查现有文件是否已包含所需日期范围
            if latest_file and start_date and end_date:
                file_start, file_end = self._get_file_date_range(latest_file)
                if file_start and file_end:
                    # 检查文件的日期范围是否包含所需的日期范围
                    if file_start <= start_date and file_end >= end_date:
                        # 日期范围已存在，直接返回文件
                        df = pd.read_csv(os.path.join(self.raw_folder, latest_file))
                        return latest_file, df, "exists", "local"
        
        # 2. 确定时间范围
        if latest_file and update_existing and not (start_date and end_date):
            # 从已有文件获取起始日期，更新到最新（仅在没有指定日期范围时）
            start_date = self._get_file_start_date(latest_file)
            end_date = datetime.now().date()
            status = "updated"
        else:
            # 首次下载或指定了日期范围（需要全量重新下载）
            if period:
                # 使用 period 参数
                start_date = None
                end_date = None
            else:
                if not start_date:
                    start_date = (datetime.now() - timedelta(days=365*20)).date()
                if not end_date:
                    end_date = datetime.now().date()
            status = "downloaded_full"
        
        # 3. 获取数据（优先使用 DataFetcher，否则使用 yfinance）
        try:
            if DataFetcher is not None:
                fetcher = DataFetcher()
                if period:
                    df = fetcher.fetch_data(symbol=symbol, period=period)
                else:
                    df = fetcher.fetch_data(symbol=symbol, start_date=start_date, end_date=end_date)
                source = 'deltafq'
            else:
                ticker = yf.Ticker(symbol)
                if period:
                    df = ticker.history(period=period)
                elif not latest_file and not start_date:
                    df = ticker.history(period="max")
                else:
                    start_dt = datetime.combine(start_date, datetime.min.time())
                    end_dt = datetime.combine(end_date, datetime.max.time())
                    df = ticker.history(start=start_dt, end=end_dt + timedelta(days=1))
                source = 'yfinance'
        except Exception as download_error:
            if latest_file:
                # 下载失败，返回已有文件
                df = pd.read_csv(os.path.join(self.raw_folder, latest_file))
                return latest_file, df, "using_local_on_error", "local"
            raise Exception(f"Failed to download data: {str(download_error)}")
        
        if df is None or df.empty:
            if latest_file:
                df = pd.read_csv(os.path.join(self.raw_folder, latest_file))
                return latest_file, df, "using_local_on_error", "local"
                raise ValueError(f"No data found for symbol {symbol}")
            
        # 4. 标准化数据格式
        df = self._standardize_dataframe(df)
        
        # 5. 保存文件（统一命名为 SYMBOL.csv）
        filename = f"{symbol}.csv"
        self.save_data(df, filename, index=False)
        
        # 6. 清理旧文件（如果有）
        if latest_file and latest_file != filename:
            try:
                os.remove(os.path.join(self.raw_folder, latest_file))
            except:
                pass
        
        return filename, df, status, source
