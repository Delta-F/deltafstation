"""
数据管理API
"""
from flask import Blueprint, request, jsonify
import os
import pandas as pd
from datetime import datetime, timedelta
import yfinance as yf

try:
    # 优先使用 deltafq 提供的数据获取功能
    from deltafq.data import DataFetcher
except ImportError:  # pragma: no cover - 运行环境可能没有安装 deltafq
    DataFetcher = None

data_bp = Blueprint('data', __name__)

@data_bp.route('/files', methods=['POST'])
def create_file():
    """
    创建/上传CSV数据文件 - POST /api/data/files
    原：POST /api/data/upload
    """
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        if file and file.filename.endswith('.csv'):
            # 保存文件
            data_folder = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'raw')
            os.makedirs(data_folder, exist_ok=True)
            
            filename = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{file.filename}"
            filepath = os.path.join(data_folder, filename)
            file.save(filepath)
            
            # 验证CSV格式
            df = pd.read_csv(filepath)
            required_columns = ['Date', 'Open', 'High', 'Low', 'Close', 'Volume']
            
            if not all(col in df.columns for col in required_columns):
                os.remove(filepath)
                return jsonify({'error': f'CSV must contain columns: {required_columns}'}), 400
            
            return jsonify({
                'id': filename,
                'filename': filename,
                'rows': len(df),
                'columns': list(df.columns)
            }), 201
        
        return jsonify({'error': 'Invalid file type'}), 400
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@data_bp.route('/fetch', methods=['POST'])
def fetch_data():
    """
    从外部数据源获取数据并创建文件 - POST /api/data/fetch
    原：POST /api/data/download
    """
    try:
        data = request.get_json()
        symbol = data.get('symbol', '').upper()
        period = data.get('period', '1y')
        
        if not symbol:
            return jsonify({'error': 'Symbol is required'}), 400
        
        # 下载数据（兼容：若安装了 deltafq 优先使用，否则退回 yfinance）
        if DataFetcher is not None:
            fetcher = DataFetcher()
            df = fetcher.fetch_data(symbol=symbol, period=period)
        else:
            ticker = yf.Ticker(symbol)
            df = ticker.history(period=period)
        
        if df.empty:
            return jsonify({'error': f'No data found for symbol {symbol}'}), 404
        
        # 标准化列名，确保包含所需字段
        if 'Date' not in df.columns:
            df = df.reset_index().rename(columns={df.index.name or 'index': 'Date'})
        df['Date'] = pd.to_datetime(df['Date']).dt.strftime('%Y-%m-%d')
        
        # 保存到CSV
        data_folder = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'raw')
        os.makedirs(data_folder, exist_ok=True)
        
        filename = f"{symbol}_{period}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        filepath = os.path.join(data_folder, filename)
        df.to_csv(filepath, index=False)
        
        return jsonify({
            'file': {
                'id': filename,
                'filename': filename,
                'rows': len(df),
                'symbol': symbol,
                'period': period
            }
        }), 201
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@data_bp.route('/files', methods=['GET'])
def list_files():
    """
    获取数据文件列表 - GET /api/data/files
    原：GET /api/data/list
    """
    try:
        data_folder = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'raw')
        
        if not os.path.exists(data_folder):
            return jsonify({'files': []})
        
        files = []
        for filename in os.listdir(data_folder):
            if filename.endswith('.csv'):
                filepath = os.path.join(data_folder, filename)
                file_stat = os.stat(filepath)
                files.append({
                    'id': filename,
                    'filename': filename,
                    'size': file_stat.st_size,
                    'modified': datetime.fromtimestamp(file_stat.st_mtime).isoformat()
                })
        
        return jsonify({'files': files})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@data_bp.route('/files/<filename>', methods=['GET'])
def get_file(filename):
    """
    获取数据文件详情/预览 - GET /api/data/files/<filename>
    原：GET /api/data/preview/<filename>
    """
    try:
        data_folder = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'raw')
        filepath = os.path.join(data_folder, filename)
        
        if not os.path.exists(filepath):
            return jsonify({'error': 'File not found'}), 404
        
        # 读取前100行
        df = pd.read_csv(filepath, nrows=100)
        
        return jsonify({
            'id': filename,
            'filename': filename,
            'columns': list(df.columns),
            'data': df.to_dict('records'),
            'shape': df.shape
        })
    
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@data_bp.route('/symbols/<symbol>/fetch', methods=['POST'])
def fetch_symbol_data(symbol):
    """
    根据股票代码和时间区间获取数据 - POST /api/data/symbols/<symbol>/fetch
    原：POST /api/data/fetch_symbol
    
    - 若 data/raw 下已存在以代码开头的 CSV，则优先使用最新文件
    - 否则使用 DataFetcher（若可用）或 yfinance 下载数据并保存为 CSV
    """
    try:
        data = request.get_json() or {}
        symbol = symbol.upper()
        start_date = data.get('start_date')
        end_date = data.get('end_date')

        data_folder = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'raw'
        )
        os.makedirs(data_folder, exist_ok=True)

        # 1. 优先查找本地已有文件（文件名以代码开头）
        candidates = []
        for filename in os.listdir(data_folder):
            if filename.lower().endswith('.csv') and filename.upper().startswith(symbol):
                filepath = os.path.join(data_folder, filename)
                stat = os.stat(filepath)
                candidates.append((stat.st_mtime, filename))

        if candidates:
            # 使用最新的一个文件
            candidates.sort(reverse=True)
            latest_filename = candidates[0][1]
            return jsonify({
                'file': {
                    'id': latest_filename,
                    'filename': latest_filename,
                    'source': 'local'
                }
            })

        # 2. 本地没有则从数据源下载
        if not start_date or not end_date:
            return jsonify({'error': 'start_date and end_date are required when downloading new data'}), 400

        start_dt = datetime.fromisoformat(start_date)
        end_dt = datetime.fromisoformat(end_date)

        if DataFetcher is not None:
            fetcher = DataFetcher()
            df = fetcher.fetch_data(symbol=symbol, start_date=start_dt.date(), end_date=end_dt.date())
        else:
            # 回退到 yfinance
            ticker = yf.Ticker(symbol)
            df = ticker.history(start=start_dt, end=end_dt + timedelta(days=1))

        if df is None or df.empty:
            return jsonify({'error': f'No data found for symbol {symbol} in given date range'}), 404

        # 标准化列名
        if 'Date' not in df.columns:
            df = df.reset_index().rename(columns={df.index.name or 'index': 'Date'})
        df['Date'] = pd.to_datetime(df['Date']).dt.strftime('%Y-%m-%d')

        # 使用简单格式化，避免 f-string 表达式中的转义问题
        filename = f"{symbol}_{start_dt.strftime('%Y%m%d')}_{end_dt.strftime('%Y%m%d')}.csv"
        filepath = os.path.join(data_folder, filename)
        df.to_csv(filepath, index=False)

        return jsonify({
            'file': {
                'id': filename,
                'filename': filename,
                'rows': len(df),
                'symbol': symbol,
                'source': 'deltafq' if DataFetcher is not None else 'yfinance'
            }
        }), 201

    except Exception as e:
        return jsonify({'error': str(e)}), 500
