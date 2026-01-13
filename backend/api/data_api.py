"""
数据管理API
"""
from flask import Blueprint, request, jsonify, send_file, make_response
import os
import io
import pandas as pd
from datetime import datetime, timedelta
import yfinance as yf

try:
    # 优先使用 deltafq 提供的数据获取功能
    from deltafq.data import DataFetcher
except ImportError:  # pragma: no cover - 运行环境可能没有安装 deltafq
    DataFetcher = None

data_bp = Blueprint('data', __name__)

def create_file():
    """
    创建/上传CSV数据文件（内部函数，由 create_file_from_source 调用）
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
            
            # 不再添加日期前缀，保留原始文件名
            filename = file.filename
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

@data_bp.route('/files', methods=['POST'])
def create_file_from_source():
    """
    从外部数据源获取数据并创建文件 - POST /api/data/files
    支持两种方式：
    1. 文件上传：multipart/form-data with 'file' field
    2. 从数据源下载：application/json with 'symbol' field
    """
    try:
        # 检查是否为文件上传
        if 'file' in request.files:
            return create_file()  # 调用原有的文件上传逻辑
        
        # 否则视为从数据源下载
        data = request.get_json() or {}
        symbol = data.get('symbol', '').upper()
        period = data.get('period', '1y')
        
        if not symbol:
            return jsonify({'error': 'Symbol is required when fetching from data source'}), 400
        
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
            'id': filename,
            'filename': filename,
            'rows': len(df),
            'symbol': symbol,
            'period': period,
            'source': 'deltafq' if DataFetcher is not None else 'yfinance'
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

@data_bp.route('/files/<filename>', methods=['GET', 'DELETE'])
def handle_file(filename):
    """
    处理单个数据文件 - GET/DELETE /api/data/files/<filename>
    
    GET: 获取数据文件详情/预览
    DELETE: 删除数据文件
    """
    try:
        data_folder = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'raw')
        filepath = os.path.join(data_folder, filename)
        
        if not os.path.exists(filepath):
            return jsonify({'error': 'File not found'}), 404
        
        if request.method == 'GET':
            # GET: 获取详情与预览（优化：返回头尾数据及统计信息）
            df = pd.read_csv(filepath)
            
            # 统计信息
            total_rows = len(df)
            columns = list(df.columns)
            start_date = "N/A"
            end_date = "N/A"
            
            if 'Date' in df.columns:
                df['Date'] = pd.to_datetime(df['Date'])
                start_date = df['Date'].min().strftime('%Y-%m-%d')
                end_date = df['Date'].max().strftime('%Y-%m-%d')
                df['Date'] = df['Date'].dt.strftime('%Y-%m-%d')

            # 准备预览数据：前50条 + 后面50条
            if total_rows <= 100:
                preview_df = df
            else:
                head_df = df.head(50)
                tail_df = df.tail(50)
                # 标记中间有截断（由前端处理展示）
                preview_df = pd.concat([head_df, tail_df])

            return jsonify({
                'id': filename,
                'filename': filename,
                'columns': columns,
                'data': preview_df.to_dict('records'),
                'total_rows': total_rows,
                'start_date': start_date,
                'end_date': end_date,
                'is_truncated': total_rows > 100
            })
        
        elif request.method == 'DELETE':
            # DELETE: 删除文件
            os.remove(filepath)
            return jsonify({'message': f'File {filename} deleted successfully'}), 200
    
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@data_bp.route('/template', methods=['GET'])
def download_template():
    """下载CSV数据模板"""
    output = io.BytesIO()
    output.write("Date,Open,High,Low,Close,Volume\n".encode('utf-8'))
    output.write("2026-01-01,150.00,155.00,149.00,153.00,1000000\n".encode('utf-8'))
    output.seek(0)
    return send_file(
        output,
        mimetype='text/csv',
        as_attachment=True,
        download_name='data_template.csv'
    )


@data_bp.route('/symbols/<symbol>/files', methods=['GET', 'POST'])
def handle_symbol_files(symbol):
    """
    处理指定股票代码的数据文件 - GET/POST /api/data/symbols/<symbol>/files
    
    GET: 查找并返回该股票代码的最新数据文件
    POST: 从数据源下载指定时间区间的数据并创建文件
    
    - 若 data/raw 下已存在以代码开头的 CSV，GET 优先返回最新文件
    - POST 使用 DataFetcher（若可用）或 yfinance 下载数据并保存为 CSV
    """
    try:
        symbol = symbol.upper()
        data_folder = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'raw'
        )
        os.makedirs(data_folder, exist_ok=True)

        if request.method == 'GET':
            # GET: 查找本地已有文件（文件名以代码开头）
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
                filepath = os.path.join(data_folder, latest_filename)
                df = pd.read_csv(filepath, nrows=1)  # 读取一行以获取列信息
                return jsonify({
                    'id': latest_filename,
                    'filename': latest_filename,
                    'source': 'local',
                    'columns': list(df.columns)
                })
            else:
                return jsonify({'error': f'No data file found for symbol {symbol}'}), 404

        elif request.method == 'POST':
            # POST: 同步/下载数据 (优化逻辑：获取本地数据 + 更新数据至最新 > 如没有本地数据，则直接下载所有历史数据)
            data = request.get_json() or {}
            
            # 1. 查找本地已有文件
            latest_local = None
            candidates = []
            for filename in os.listdir(data_folder):
                if filename.lower().endswith('.csv') and filename.upper().startswith(symbol):
                    filepath = os.path.join(data_folder, filename)
                    stat = os.stat(filepath)
                    candidates.append((stat.st_mtime, filename))
            
            if candidates:
                candidates.sort(reverse=True)
                latest_local = candidates[0][1]

            # 2. 确定时间范围
            if latest_local:
                # 获取已有数据的起始时间，尝试更新至最新
                try:
                    # 仅读取 Date 列以提高性能并准确获取起始日期
                    df_dates = pd.read_csv(os.path.join(data_folder, latest_local), usecols=['Date'])
                    if not df_dates.empty:
                        # 保持原有起始日期，同步更新至今天
                        start_date_str = pd.to_datetime(df_dates['Date']).min().strftime('%Y-%m-%d')
                    else:
                        start_date_str = (datetime.now() - timedelta(days=365*20)).strftime('%Y-%m-%d')
                except:
                    start_date_str = (datetime.now() - timedelta(days=365*20)).strftime('%Y-%m-%d')
                status_msg = "updated"
            else:
                # 没有本地数据，第一次下载拉取全量历史数据（默认20年）
                start_date_str = (datetime.now() - timedelta(days=365*20)).strftime('%Y-%m-%d')
                status_msg = "downloaded_full"

            end_date_str = datetime.now().strftime('%Y-%m-%d')
            start_dt = datetime.fromisoformat(start_date_str)
            end_dt = datetime.fromisoformat(end_date_str)

            # 3. 下载数据
            try:
                if DataFetcher is not None:
                    fetcher = DataFetcher()
                    # 尝试拉取全量数据，若 DataFetcher 支持 period='max' 则更好
                    df = fetcher.fetch_data(symbol=symbol, start_date=start_dt.date(), end_date=end_dt.date())
                else:
                    ticker = yf.Ticker(symbol)
                    # 如果没有本地文件，尝试拉取 'max' 周期
                    if not latest_local:
                        df = ticker.history(period="max")
                    else:
                        df = ticker.history(start=start_dt, end=end_dt + timedelta(days=1))
                
                if df is None or df.empty:
                    if latest_local:
                        return jsonify({
                            'id': latest_local,
                            'filename': latest_local,
                            'status': 'using_local_on_error',
                            'warning': 'Failed to sync, using existing local data'
                        })
                    return jsonify({'error': f'No data found for symbol {symbol}'}), 404
            except Exception as download_error:
                if latest_local:
                    return jsonify({
                        'id': latest_local,
                        'filename': latest_local,
                        'status': 'using_local_on_error',
                        'warning': f'Download failed: {str(download_error)}'
                    })
                raise download_error

            # 4. 标准化并保存
            if 'Date' not in df.columns:
                df = df.reset_index().rename(columns={df.index.name or 'index': 'Date'})
            df['Date'] = pd.to_datetime(df['Date']).dt.strftime('%Y-%m-%d')

            # 统一文件名为 SYMBOL.csv
            new_filename = f"{symbol}.csv"
            filepath = os.path.join(data_folder, new_filename)
            df.to_csv(filepath, index=False)
            
            # 清理旧命名格式的文件（如果有的话）
            if latest_local and latest_local != new_filename:
                try:
                    os.remove(os.path.join(data_folder, latest_local))
                except:
                    pass

            return jsonify({
                'id': new_filename,
                'filename': new_filename,
                'rows': len(df),
                'symbol': symbol,
                'status': status_msg,
                'source': 'deltafq' if DataFetcher is not None else 'yfinance'
            }), 201

    except Exception as e:
        return jsonify({'error': str(e)}), 500
