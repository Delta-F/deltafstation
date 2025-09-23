"""
数据管理API
"""
from flask import Blueprint, request, jsonify
import os
import pandas as pd
from datetime import datetime, timedelta
import yfinance as yf

data_bp = Blueprint('data', __name__)

@data_bp.route('/upload', methods=['POST'])
def upload_data():
    """上传CSV数据文件"""
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
                'message': 'File uploaded successfully',
                'filename': filename,
                'rows': len(df),
                'columns': list(df.columns)
            })
        
        return jsonify({'error': 'Invalid file type'}), 400
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@data_bp.route('/download/<symbol>', methods=['POST'])
def download_data():
    """从Yahoo Finance下载数据"""
    try:
        data = request.get_json()
        symbol = data.get('symbol', '').upper()
        period = data.get('period', '1y')
        
        if not symbol:
            return jsonify({'error': 'Symbol is required'}), 400
        
        # 下载数据
        ticker = yf.Ticker(symbol)
        df = ticker.history(period=period)
        
        if df.empty:
            return jsonify({'error': f'No data found for symbol {symbol}'}), 404
        
        # 重置索引，将Date作为列
        df = df.reset_index()
        df['Date'] = df['Date'].dt.strftime('%Y-%m-%d')
        
        # 保存到CSV
        data_folder = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'raw')
        os.makedirs(data_folder, exist_ok=True)
        
        filename = f"{symbol}_{period}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        filepath = os.path.join(data_folder, filename)
        df.to_csv(filepath, index=False)
        
        return jsonify({
            'message': 'Data downloaded successfully',
            'filename': filename,
            'rows': len(df),
            'symbol': symbol,
            'period': period
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@data_bp.route('/list', methods=['GET'])
def list_data():
    """获取数据文件列表"""
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
                    'filename': filename,
                    'size': file_stat.st_size,
                    'modified': datetime.fromtimestamp(file_stat.st_mtime).isoformat()
                })
        
        return jsonify({'files': files})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@data_bp.route('/preview/<filename>', methods=['GET'])
def preview_data():
    """预览数据文件"""
    try:
        data_folder = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'raw')
        filepath = os.path.join(data_folder, filename)
        
        if not os.path.exists(filepath):
            return jsonify({'error': 'File not found'}), 404
        
        # 读取前100行
        df = pd.read_csv(filepath, nrows=100)
        
        return jsonify({
            'filename': filename,
            'columns': list(df.columns),
            'data': df.to_dict('records'),
            'shape': df.shape
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500
