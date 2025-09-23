// DeltaFStation 仿真交易页面JavaScript

// 全局变量
let currentSimulation = null;
let priceChart = null;
let updateInterval = null;

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    loadSimulationHistory();
    loadStrategies();
    initializeChart();
    
    // 设置自动刷新
    updateInterval = setInterval(() => {
        if (currentSimulation) {
            updateSimulationStatus();
        }
    }, 5000); // 每5秒刷新一次
});

// 加载策略列表
async function loadStrategies() {
    try {
        const response = await fetch('/api/strategy/list');
        const data = await response.json();
        
        const strategySelect = document.getElementById('simulationStrategy');
        strategySelect.innerHTML = '<option value="">请选择策略</option>';
        
        data.strategies.forEach(strategy => {
            strategySelect.innerHTML += `<option value="${strategy.id}">${strategy.name}</option>`;
        });
        
    } catch (error) {
        console.error('Error loading strategies:', error);
    }
}

// 加载仿真历史
async function loadSimulationHistory() {
    try {
        const response = await fetch('/api/simulation/list');
        const data = await response.json();
        
        const simulationHistoryList = document.getElementById('simulationHistoryList');
        
        if (data.simulations.length === 0) {
            simulationHistoryList.innerHTML = '<div class="empty-state"><i class="fas fa-history"></i><p>暂无仿真记录</p></div>';
        } else {
            simulationHistoryList.innerHTML = data.simulations.map(simulation => `
                <div class="simulation-item" onclick="selectSimulation('${simulation.id}')">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <h6 class="mb-1">${simulation.strategy_id}</h6>
                            <small class="text-muted">${formatDateTime(simulation.created_at)}</small>
                        </div>
                        <div class="text-end">
                            <span class="badge bg-${simulation.status === 'running' ? 'success' : 'secondary'}">
                                ${simulation.status === 'running' ? '运行中' : '已停止'}
                            </span>
                            <div class="fw-bold text-primary">
                                ¥${simulation.current_capital.toLocaleString()}
                            </div>
                        </div>
                    </div>
                </div>
            `).join('');
        }
        
    } catch (error) {
        console.error('Error loading simulation history:', error);
        document.getElementById('simulationHistoryList').innerHTML = '<div class="text-center text-muted">加载失败</div>';
    }
}

// 选择仿真
async function selectSimulation(simulationId) {
    try {
        const response = await fetch(`/api/simulation/status/${simulationId}`);
        const data = await response.json();
        
        if (response.ok) {
            currentSimulation = data.simulation;
            updateSimulationDisplay();
        } else {
            showAlert(data.error || '加载仿真状态失败', 'danger');
        }
        
    } catch (error) {
        console.error('Error loading simulation:', error);
        showAlert('加载仿真状态失败', 'danger');
    }
}

// 更新仿真显示
function updateSimulationDisplay() {
    if (!currentSimulation) return;
    
    // 更新状态显示
    const statusCard = document.querySelector('.status-card');
    if (currentSimulation.status === 'running') {
        statusCard.innerHTML = '<i class="fas fa-circle text-success"></i><span>运行中</span>';
    } else {
        statusCard.innerHTML = '<i class="fas fa-circle text-danger"></i><span>已停止</span>';
    }
    
    // 更新账户信息
    document.getElementById('currentCapital').textContent = '¥' + currentSimulation.current_capital.toLocaleString();
    
    const totalReturn = ((currentSimulation.current_capital - currentSimulation.initial_capital) / currentSimulation.initial_capital * 100).toFixed(2);
    document.getElementById('totalReturn').textContent = totalReturn + '%';
    document.getElementById('totalReturn').className = 'text-' + (totalReturn >= 0 ? 'success' : 'danger');
    
    document.getElementById('totalTrades').textContent = currentSimulation.trades.length;
    
    // 更新持仓信息
    updatePositionsDisplay();
    
    // 更新交易记录
    updateTradesDisplay();
    
    // 更新按钮状态
    const startBtn = document.getElementById('startSimulationBtn');
    const stopBtn = document.getElementById('stopSimulationBtn');
    
    if (currentSimulation.status === 'running') {
        startBtn.disabled = true;
        stopBtn.disabled = false;
    } else {
        startBtn.disabled = false;
        stopBtn.disabled = true;
    }
}

// 更新持仓显示
function updatePositionsDisplay() {
    const positionsInfo = document.getElementById('positionsInfo');
    
    if (!currentSimulation.positions || Object.keys(currentSimulation.positions).length === 0) {
        positionsInfo.innerHTML = '<div class="text-center text-muted">暂无持仓</div>';
    } else {
        positionsInfo.innerHTML = Object.entries(currentSimulation.positions).map(([symbol, position]) => `
            <div class="position-item">
                <div>
                    <div class="position-symbol">${symbol}</div>
                    <div class="position-quantity">${position.quantity} 股</div>
                </div>
                <div class="text-end">
                    <div class="position-value">¥${(position.avg_price * position.quantity).toLocaleString()}</div>
                    <small class="text-muted">均价: ¥${position.avg_price.toFixed(2)}</small>
                </div>
            </div>
        `).join('');
    }
}

// 更新交易记录显示
function updateTradesDisplay() {
    const tradesTableBody = document.getElementById('tradesTableBody');
    
    if (!currentSimulation.trades || currentSimulation.trades.length === 0) {
        tradesTableBody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">暂无交易记录</td></tr>';
    } else {
        tradesTableBody.innerHTML = currentSimulation.trades.slice(-10).reverse().map(trade => `
            <tr>
                <td>${formatDateTime(trade.date)}</td>
                <td>${trade.symbol}</td>
                <td>
                    <span class="badge bg-${trade.action === 'buy' ? 'success' : 'danger'}">
                        ${trade.action === 'buy' ? '买入' : '卖出'}
                    </span>
                </td>
                <td>${trade.quantity}</td>
                <td>¥${trade.price.toFixed(2)}</td>
                <td>¥${(trade.cost || trade.proceeds || 0).toLocaleString()}</td>
                <td>
                    <span class="trade-status success">已完成</span>
                </td>
            </tr>
        `).join('');
    }
}

// 启动仿真
async function startSimulation() {
    const strategyId = document.getElementById('simulationStrategy').value;
    const initialCapital = document.getElementById('simulationCapital').value;
    const commission = document.getElementById('simulationCommission').value;
    const slippage = document.getElementById('simulationSlippage').value;
    
    if (!strategyId || !initialCapital) {
        showAlert('请填写必填字段', 'warning');
        return;
    }
    
    try {
        const response = await fetch('/api/simulation/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                strategy_id: strategyId,
                initial_capital: parseFloat(initialCapital),
                commission: parseFloat(commission),
                slippage: parseFloat(slippage)
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('仿真启动成功', 'success');
            bootstrap.Modal.getInstance(document.getElementById('simulationStartModal')).hide();
            currentSimulation = { id: result.simulation_id, status: 'running' };
            loadSimulationHistory();
            updateSimulationStatus();
        } else {
            showAlert(result.error || '启动失败', 'danger');
        }
        
    } catch (error) {
        console.error('Error starting simulation:', error);
        showAlert('启动失败', 'danger');
    }
}

// 停止仿真
async function stopSimulation() {
    if (!currentSimulation) {
        showAlert('没有运行中的仿真', 'warning');
        return;
    }
    
    try {
        const response = await fetch(`/api/simulation/stop/${currentSimulation.id}`, {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('仿真已停止', 'success');
            currentSimulation.status = 'stopped';
            updateSimulationDisplay();
            loadSimulationHistory();
        } else {
            showAlert(result.error || '停止失败', 'danger');
        }
        
    } catch (error) {
        console.error('Error stopping simulation:', error);
        showAlert('停止失败', 'danger');
    }
}

// 更新仿真状态
async function updateSimulationStatus() {
    if (!currentSimulation) return;
    
    try {
        const response = await fetch(`/api/simulation/status/${currentSimulation.id}`);
        const data = await response.json();
        
        if (response.ok) {
            currentSimulation = data.simulation;
            updateSimulationDisplay();
        }
        
    } catch (error) {
        console.error('Error updating simulation status:', error);
    }
}

// 执行手动交易
async function executeManualTrade() {
    if (!currentSimulation) {
        showAlert('请先启动仿真', 'warning');
        return;
    }
    
    if (currentSimulation.status !== 'running') {
        showAlert('仿真未运行', 'warning');
        return;
    }
    
    const symbol = document.getElementById('tradeSymbol').value;
    const action = document.getElementById('tradeAction').value;
    const quantity = document.getElementById('tradeQuantity').value;
    const price = document.getElementById('tradePrice').value;
    
    if (!symbol || !quantity || !price) {
        showAlert('请填写必填字段', 'warning');
        return;
    }
    
    try {
        const response = await fetch(`/api/simulation/trade/${currentSimulation.id}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                symbol: symbol.toUpperCase(),
                action: action,
                quantity: parseInt(quantity),
                price: parseFloat(price)
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('交易执行成功', 'success');
            document.getElementById('manualTradeForm').reset();
            updateSimulationStatus();
        } else {
            showAlert(result.error || '交易失败', 'danger');
        }
        
    } catch (error) {
        console.error('Error executing trade:', error);
        showAlert('交易失败', 'danger');
    }
}

// 初始化图表
function initializeChart() {
    const ctx = document.getElementById('priceChart').getContext('2d');
    
    priceChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: '价格',
                data: [],
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
                    text: '价格走势图'
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

// 刷新图表
function refreshChart() {
    if (currentSimulation) {
        updateSimulationStatus();
    }
}

// 刷新交易记录
function refreshTrades() {
    if (currentSimulation) {
        updateSimulationStatus();
    }
}

// 刷新仿真历史
function refreshSimulationHistory() {
    loadSimulationHistory();
}

// 显示仿真启动模态框
async function showSimulationStart() {
    await loadStrategies();
    const modal = new bootstrap.Modal(document.getElementById('simulationStartModal'));
    modal.show();
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

// 页面卸载时清理定时器
window.addEventListener('beforeunload', function() {
    if (updateInterval) {
        clearInterval(updateInterval);
    }
});
