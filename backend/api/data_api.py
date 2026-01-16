"""
数据管理API
"""
from flask import Blueprint, request, jsonify, send_file, current_app
import os
import io
import pandas as pd
from datetime import datetime
from backend.core.data_manager import DataManager

data_bp = Blueprint('data', __name__)

def get_data_manager():
    """获取 DataManager 实例"""
    data_folder = current_app.config.get('DATA_FOLDER', 
        os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data'))
    return DataManager(data_folder)

def create_file():
    """创建/上传CSV数据文件（内部函数，由 create_file_from_source 调用）"""
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        if file and file.filename.endswith('.csv'):
            dm = get_data_manager()
            
            # 保存文件
            filename = file.filename
            filepath = os.path.join(dm.raw_folder, filename)
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
            return create_file()
        
        # 否则视为从数据源下载
        data = request.get_json() or {}
        symbol = data.get('symbol', '').upper()
        period = data.get('period', '1y')
        
        if not symbol:
            return jsonify({'error': 'Symbol is required when fetching from data source'}), 400
        
        dm = get_data_manager()
        filename, df, status, source = dm.fetch_data(symbol, period=period, update_existing=False)
        
        return jsonify({
            'id': filename,
            'filename': filename,
            'rows': len(df),
            'symbol': symbol,
            'period': period,
            'source': source
        }), 201
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@data_bp.route('/files', methods=['GET'])
def list_files():
    """获取数据文件列表 - GET /api/data/files"""
    try:
        dm = get_data_manager()
        
        if not os.path.exists(dm.raw_folder):
            return jsonify({'files': []})
        
        files = []
        for filename in os.listdir(dm.raw_folder):
            if filename.endswith('.csv'):
                filepath = os.path.join(dm.raw_folder, filename)
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
        dm = get_data_manager()
        filepath = os.path.join(dm.raw_folder, filename)
        
        if not os.path.exists(filepath):
            return jsonify({'error': 'File not found'}), 404
        
        if request.method == 'GET':
            full = request.args.get('full', 'false').lower() == 'true'
            df = pd.read_csv(filepath)
            
            # 统一列名：首字母大写，防止大小写导致前端匹配失败
            df.columns = [col.capitalize() for col in df.columns]
            
            total_rows = len(df)
            columns = list(df.columns)
            start_date = "N/A"
            end_date = "N/A"
            
            if 'Date' in df.columns:
                df['Date'] = pd.to_datetime(df['Date'])
                start_date = df['Date'].min().strftime('%Y-%m-%d')
                end_date = df['Date'].max().strftime('%Y-%m-%d')
                df['Date'] = df['Date'].dt.strftime('%Y-%m-%d')

            # 根据参数决定是否返回完整数据
            if full:
                preview_df = df
            elif total_rows <= 100:
                preview_df = df
            else:
                preview_df = pd.concat([df.head(50), df.tail(50)])

            return jsonify({
                'id': filename,
                'filename': filename,
                'columns': columns,
                'data': preview_df.to_dict('records'),
                'total_rows': total_rows,
                'start_date': start_date,
                'end_date': end_date,
                'is_truncated': not full and total_rows > 100
            })
        
        elif request.method == 'DELETE':
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
    """
    try:
        dm = get_data_manager()
        
        if request.method == 'GET':
            info = dm.get_file_info(symbol)
            if info:
                return jsonify(info)
            return jsonify({'error': f'No data file found for symbol {symbol}'}), 404
        
        elif request.method == 'POST':
            data = request.get_json() or {}
            start_date = data.get('start_date')
            end_date = data.get('end_date')
            
            filename, df, status, source = dm.fetch_data(
                symbol=symbol,
                start_date=start_date,
                end_date=end_date,
                update_existing=True
            )
            
            return jsonify({
                'id': filename,
                'filename': filename,
                'rows': len(df),
                'symbol': symbol,
                'status': status,
                'source': source
            }), 201

    except Exception as e:
        return jsonify({'error': str(e)}), 500
