// DeltaFStation 策略分析页面JavaScript

// 全局变量
let currentStrategy = null;
let priceChart = null;

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    loadStrategies();
    loadDataFiles();
    loadBacktestHistory();
    
    // 设置默认日期
    const today = new Date();
    const oneYearAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
    document.getElementById('backtestStartDate').value = oneYearAgo.toISOString().split('T')[0];
    document.getElementById('backtestEndDate').value = today.toISOString().split('T')[0];
});

// 加载策略列表
async function loadStrategies() {
    try {
        const response = await fetch('/api/strategy/list');
        const data = await response.json();
        
        const strategiesList = document.getElementById('strategiesList');
        
        if (data.strategies.length === 0) {
            strategiesList.innerHTML = '<div class="empty-state"><i class="fas fa-cogs"></i><p>暂无策略</p></div>';
        } else {
            strategiesList.innerHTML = data.strategies.map(strategy => `
                <div class="strategy-item" onclick="selectStrategy('${strategy.id}')">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <h6 class="mb-1">${strategy.name}</h6>
                            <small class="text-muted">${strategy.type} | ${formatDateTime(strategy.created_at)}</small>
                        </div>
                        <div class="dropdown">
                            <button class="btn btn-sm btn-outline-secondary dropdown-toggle" type="button" data-bs-toggle="dropdown">
                                <i class="fas fa-ellipsis-v"></i>
                            </button>
                            <ul class="dropdown-menu">
                                <li><a class="dropdown-item" href="#" onclick="editStrategy('${strategy.id}')">
                                    <i class="fas fa-edit me-2"></i>编辑
                                </a></li>
                                <li><a class="dropdown-item" href="#" onclick="deleteStrategy('${strategy.id}')">
                                    <i class="fas fa-trash me-2"></i>删除
                                </a></li>
                            </ul>
                        </div>
                    </div>
                </div>
            `).join('');
        }
        
    } catch (error) {
        console.error('Error loading strategies:', error);
        document.getElementById('strategiesList').innerHTML = '<div class="text-center text-muted">加载失败</div>';
    }
}

// 加载数据文件列表
async function loadDataFiles() {
    try {
        const response = await fetch('/api/data/list');
        const data = await response.json();
        
        const dataFilesList = document.getElementById('dataFilesList');
        const backtestDataFile = document.getElementById('backtestDataFile');
        
        if (data.files.length === 0) {
            dataFilesList.innerHTML = '<div class="empty-state"><i class="fas fa-database"></i><p>暂无数据文件</p></div>';
            backtestDataFile.innerHTML = '<option value="">暂无数据文件</option>';
        } else {
            dataFilesList.innerHTML = data.files.map(file => `
                <div class="data-file-item" onclick="previewData('${file.filename}')">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <h6 class="mb-1">${file.filename}</h6>
                            <small class="text-muted">${formatFileSize(file.size)} | ${formatDateTime(file.modified)}</small>
                        </div>
                        <button class="btn btn-sm btn-outline-primary" onclick="previewData('${file.filename}')">
                            <i class="fas fa-eye"></i>
                        </button>
                    </div>
                </div>
            `).join('');
            
            backtestDataFile.innerHTML = '<option value="">请选择数据文件</option>' + 
                data.files.map(file => `<option value="${file.filename}">${file.filename}</option>`).join('');
        }
        
    } catch (error) {
        console.error('Error loading data files:', error);
        document.getElementById('dataFilesList').innerHTML = '<div class="text-center text-muted">加载失败</div>';
    }
}

// 加载回测历史
async function loadBacktestHistory() {
    try {
        const response = await fetch('/api/backtest/results');
        const data = await response.json();
        
        const backtestHistoryList = document.getElementById('backtestHistoryList');
        
        if (data.results.length === 0) {
            backtestHistoryList.innerHTML = '<div class="empty-state"><i class="fas fa-history"></i><p>暂无回测记录</p></div>';
        } else {
            backtestHistoryList.innerHTML = data.results.map(result => `
                <div class="backtest-item" onclick="viewBacktestResult('${result.id}')">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <h6 class="mb-1">${result.strategy_id}</h6>
                            <small class="text-muted">${result.data_file} | ${formatDateTime(result.created_at)}</small>
                        </div>
                        <div class="text-end">
                            <div class="fw-bold ${result.total_return >= 0 ? 'text-success' : 'text-danger'}">
                                ${(result.total_return * 100).toFixed(2)}%
                            </div>
                            <small class="text-muted">夏普: ${result.sharpe_ratio.toFixed(2)}</small>
                        </div>
                    </div>
                </div>
            `).join('');
        }
        
    } catch (error) {
        console.error('Error loading backtest history:', error);
        document.getElementById('backtestHistoryList').innerHTML = '<div class="text-center text-muted">加载失败</div>';
    }
}

// 选择策略
async function selectStrategy(strategyId) {
    try {
        const response = await fetch(`/api/strategy/${strategyId}`);
        const data = await response.json();
        
        if (response.ok) {
            currentStrategy = data.strategy;
            showStrategyDetail(data.strategy);
            showBacktestConfig();
        } else {
            showAlert(data.error || '加载策略失败', 'danger');
        }
        
    } catch (error) {
        console.error('Error loading strategy:', error);
        showAlert('加载策略失败', 'danger');
    }
}

// 显示策略详情
function showStrategyDetail(strategy) {
    const strategyDetailCard = document.getElementById('strategyDetailCard');
    const strategyDetailContent = document.getElementById('strategyDetailContent');
    
    strategyDetailContent.innerHTML = `
        <div class="row">
            <div class="col-md-6">
                <h5>${strategy.name}</h5>
                <p class="text-muted">${strategy.description || '暂无描述'}</p>
                <div class="mb-3">
                    <span class="badge bg-primary">${strategy.type}</span>
                    <span class="badge bg-secondary">${strategy.status}</span>
                </div>
            </div>
            <div class="col-md-6">
                <div class="row">
                    <div class="col-6">
                        <div class="metric-card">
                            <h6>创建时间</h6>
                            <p class="mb-0">${formatDateTime(strategy.created_at)}</p>
                        </div>
                    </div>
                    <div class="col-6">
                        <div class="metric-card">
                            <h6>更新时间</h6>
                            <p class="mb-0">${formatDateTime(strategy.updated_at)}</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    strategyDetailCard.style.display = 'block';
}

// 显示回测配置
function showBacktestConfig() {
    const backtestConfigCard = document.getElementById('backtestConfigCard');
    backtestConfigCard.style.display = 'block';
}

// 运行回测
async function runBacktest() {
    if (!currentStrategy) {
        showAlert('请先选择策略', 'warning');
        return;
    }
    
    const dataFile = document.getElementById('backtestDataFile').value;
    const startDate = document.getElementById('backtestStartDate').value;
    const endDate = document.getElementById('backtestEndDate').value;
    const initialCapital = document.getElementById('backtestInitialCapital').value;
    const commission = document.getElementById('backtestCommission').value;
    const slippage = document.getElementById('backtestSlippage').value;
    
    if (!dataFile || !startDate || !endDate) {
        showAlert('请填写必填字段', 'warning');
        return;
    }
    
    try {
        const response = await fetch('/api/backtest/run', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                strategy_id: currentStrategy.id,
                data_file: dataFile,
                start_date: startDate,
                end_date: endDate,
                initial_capital: parseFloat(initialCapital),
                commission: parseFloat(commission),
                slippage: parseFloat(slippage)
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('回测运行成功', 'success');
            showBacktestResult(result.results);
            loadBacktestHistory();
        } else {
            showAlert(result.error || '回测失败', 'danger');
        }
        
    } catch (error) {
        console.error('Error running backtest:', error);
        showAlert('回测失败', 'danger');
    }
}

// 显示回测结果
function showBacktestResult(results) {
    const backtestResultsCard = document.getElementById('backtestResultsCard');
    const backtestResultsContent = document.getElementById('backtestResultsContent');
    
    backtestResultsContent.innerHTML = `
        <div class="row">
            <div class="col-md-3">
                <div class="metric-card">
                    <h4 class="${results.total_return >= 0 ? 'text-success' : 'text-danger'}">
                        ${(results.total_return * 100).toFixed(2)}%
                    </h4>
                    <small class="text-muted">总收益率</small>
                </div>
            </div>
            <div class="col-md-3">
                <div class="metric-card">
                    <h4 class="text-primary">${results.sharpe_ratio.toFixed(2)}</h4>
                    <small class="text-muted">夏普比率</small>
                </div>
            </div>
            <div class="col-md-3">
                <div class="metric-card">
                    <h4 class="text-warning">${(results.max_drawdown * 100).toFixed(2)}%</h4>
                    <small class="text-muted">最大回撤</small>
                </div>
            </div>
            <div class="col-md-3">
                <div class="metric-card">
                    <h4 class="text-info">${results.total_trades}</h4>
                    <small class="text-muted">总交易数</small>
                </div>
            </div>
        </div>
        
        <div class="mt-4">
            <canvas id="backtestChart" width="400" height="200"></canvas>
        </div>
    `;
    
    backtestResultsCard.style.display = 'block';
    
    // 绘制回测图表
    setTimeout(() => {
        drawBacktestChart(results.portfolio_values);
    }, 100);
}

// 绘制回测图表
function drawBacktestChart(portfolioValues) {
    const ctx = document.getElementById('backtestChart').getContext('2d');
    
    if (priceChart) {
        priceChart.destroy();
    }
    
    priceChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: portfolioValues.map((_, index) => `Day ${index + 1}`),
            datasets: [{
                label: '组合价值',
                data: portfolioValues,
                borderColor: '#007bff',
                backgroundColor: 'rgba(0, 123, 255, 0.1)',
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                title: {
                    display: true,
                    text: '回测结果 - 组合价值走势'
                }
            },
            scales: {
                y: {
                    beginAtZero: false
                }
            }
        }
    });
}

// 查看回测结果
async function viewBacktestResult(resultId) {
    try {
        const response = await fetch(`/api/backtest/results/${resultId}`);
        const data = await response.json();
        
        if (response.ok) {
            showBacktestResult(data.result.results);
        } else {
            showAlert(data.error || '加载回测结果失败', 'danger');
        }
        
    } catch (error) {
        console.error('Error loading backtest result:', error);
        showAlert('加载回测结果失败', 'danger');
    }
}

// 预览数据
async function previewData(filename) {
    try {
        const response = await fetch(`/api/data/preview/${filename}`);
        const data = await response.json();
        
        if (response.ok) {
            // 显示数据预览模态框
            const modal = new bootstrap.Modal(document.createElement('div'));
            modal._element.innerHTML = `
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">数据预览 - ${filename}</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="table-responsive">
                                <table class="table table-sm">
                                    <thead>
                                        <tr>
                                            ${data.columns.map(col => `<th>${col}</th>`).join('')}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${data.data.map(row => `
                                            <tr>
                                                ${data.columns.map(col => `<td>${row[col]}</td>`).join('')}
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            modal.show();
        } else {
            showAlert(data.error || '预览数据失败', 'danger');
        }
        
    } catch (error) {
        console.error('Error previewing data:', error);
        showAlert('预览数据失败', 'danger');
    }
}

// 创建策略
async function createStrategy() {
    const name = document.getElementById('strategyName').value;
    const type = document.getElementById('strategyType').value;
    const description = document.getElementById('strategyDescription').value;
    const rules = document.getElementById('strategyRules').value;
    
    if (!name || !type) {
        showAlert('请填写必填字段', 'warning');
        return;
    }
    
    try {
        const response = await fetch('/api/strategy/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name,
                type,
                description,
                parameters: {},
                rules: rules.split('\n').filter(rule => rule.trim())
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('策略创建成功', 'success');
            bootstrap.Modal.getInstance(document.getElementById('strategyCreateModal')).hide();
            document.getElementById('strategyCreateForm').reset();
            loadStrategies();
        } else {
            showAlert(result.error || '创建失败', 'danger');
        }
        
    } catch (error) {
        console.error('Error creating strategy:', error);
        showAlert('创建失败', 'danger');
    }
}

// 编辑策略
function editStrategy(strategyId) {
    // 这里可以实现编辑策略的功能
    showAlert('编辑功能待实现', 'info');
}

// 删除策略
async function deleteStrategy(strategyId) {
    if (!confirm('确定要删除这个策略吗？')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/strategy/${strategyId}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('策略删除成功', 'success');
            loadStrategies();
        } else {
            showAlert(result.error || '删除失败', 'danger');
        }
        
    } catch (error) {
        console.error('Error deleting strategy:', error);
        showAlert('删除失败', 'danger');
    }
}

// 上传数据
async function uploadData() {
    const fileInput = document.getElementById('dataFile');
    const file = fileInput.files[0];
    
    if (!file) {
        showAlert('请选择文件', 'warning');
        return;
    }
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const response = await fetch('/api/data/upload', {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('文件上传成功', 'success');
            bootstrap.Modal.getInstance(document.getElementById('dataUploadModal')).hide();
            fileInput.value = '';
            loadDataFiles();
        } else {
            showAlert(result.error || '上传失败', 'danger');
        }
        
    } catch (error) {
        console.error('Error uploading file:', error);
        showAlert('上传失败', 'danger');
    }
}

// 下载数据
async function downloadData() {
    const symbol = document.getElementById('downloadSymbol').value;
    const period = document.getElementById('downloadPeriod').value;
    
    if (!symbol) {
        showAlert('请输入股票代码', 'warning');
        return;
    }
    
    try {
        const response = await fetch('/api/data/download', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                symbol: symbol.toUpperCase(),
                period: period
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('数据下载成功', 'success');
            bootstrap.Modal.getInstance(document.getElementById('dataDownloadModal')).hide();
            document.getElementById('dataDownloadForm').reset();
            loadDataFiles();
        } else {
            showAlert(result.error || '下载失败', 'danger');
        }
        
    } catch (error) {
        console.error('Error downloading data:', error);
        showAlert('下载失败', 'danger');
    }
}

// 刷新回测历史
function refreshBacktestHistory() {
    loadBacktestHistory();
}

// 显示警告消息
function showAlert(message, type = 'info') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    // 插入到页面顶部
    const container = document.querySelector('.container-fluid');
    container.insertBefore(alertDiv, container.firstChild);
    
    // 3秒后自动消失
    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.remove();
        }
    }, 3000);
}

// 格式化日期时间
function formatDateTime(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

// 格式化文件大小
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
