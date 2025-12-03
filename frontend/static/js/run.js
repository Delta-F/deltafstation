// DeltaFStation 运行策略页面 JavaScript
//
// 设计风格与 trading.js 保持一致：
// - 顶部是总览（账户/策略）+ 简洁指标
// - 右侧是日志和监控
// - 统一的工具方法：showAlert / formatDateTime / beforeunload

// =========================
// 全局变量 & 页面初始化
// =========================

let currentStrategyRun = null;   // 当前运行中的策略仿真
let updateInterval = null;       // 状态轮询定时器
let monitorChart = null;         // 实时监控图表
let monitorData = { times: [], values: [] }; // 监控曲线数据

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    loadStrategies();
    initializeMonitorChart();
    
    // 设置自动刷新（仅在有运行中的策略时刷新）
    updateInterval = setInterval(() => {
        if (currentStrategyRun) {
            refreshStrategyStatus();
        }
    }, 5000); // 每5秒刷新一次
});

// =========================
// 策略列表 & 表单处理
// =========================

// 加载策略列表
async function loadStrategies() {
    try {
        const response = await fetch('/api/strategy/list');
        const data = await response.json();
        
        const select = document.getElementById('runStrategySelect');
        select.innerHTML = '<option value="">请选择策略</option>';
        
        if (data.strategies && data.strategies.length > 0) {
            data.strategies.forEach(strategy => {
                select.innerHTML += `<option value="${strategy.id}">${strategy.name} (${strategy.type || '技术分析'})</option>`;
            });
        } else {
            select.innerHTML = '<option value="">暂无可用策略</option>';
        }
    } catch (error) {
        console.error('Error loading strategies:', error);
        addRunLog('加载策略列表失败: ' + error.message, 'error');
    }
}

// =========================
// 实时监控图表
// =========================

// 初始化实时监控图表（资产曲线）
function initializeMonitorChart() {
    const canvas = document.getElementById('monitorChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const ctx = canvas.getContext('2d');
    monitorChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: '总资产',
                data: [],
                borderColor: '#28a745',
                backgroundColor: 'rgba(40, 167, 69, 0.08)',
                borderWidth: 1.5,
                tension: 0.2,
                pointRadius: 0,
                pointHoverRadius: 3,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { maxTicksLimit: 5, font: { size: 10 } }
                },
                y: {
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: { font: { size: 10 } }
                }
            }
        }
    });
}

// 根据模拟/真实数据更新实时监控曲线
function updateMonitorChartFromSimulation(simulation) {
    if (!monitorChart || !simulation) return;

    const initialCapital = simulation.initial_capital || 100000;
    const currentCapital = simulation.current_capital || initialCapital;
    const frozenCapital = simulation.frozen_capital || 0;
    const available = currentCapital - frozenCapital;

    let positionValue = 0;
    if (simulation.positions) {
        Object.entries(simulation.positions).forEach(([symbol, position]) => {
            const quantity = Math.abs(position.quantity || 0);
            const avgPrice = position.avg_price || 0;
            positionValue += quantity * avgPrice;
        });
    }

    const totalAssets = available + positionValue;
    const now = new Date();
    const label = now.toLocaleTimeString().slice(0, 5);

    monitorData.times.push(label);
    monitorData.values.push(totalAssets);

    if (monitorData.times.length > 60) {
        monitorData.times.shift();
        monitorData.values.shift();
    }

    monitorChart.data.labels = monitorData.times;
    monitorChart.data.datasets[0].data = monitorData.values;
    monitorChart.update('none');
}

// =========================
// 日志相关
// =========================

// 添加运行日志（终端风格）
function addRunLog(message, type = 'info') {
    const logsDiv = document.getElementById('runLogs');
    const time = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    logEntry.innerHTML = `<span class="log-time">[${time}]</span>${message}`;
    logsDiv.appendChild(logEntry);
    logsDiv.scrollTop = logsDiv.scrollHeight;
    
    // 限制日志条数
    const entries = logsDiv.querySelectorAll('.log-entry');
    if (entries.length > 200) {
        entries[0].remove();
    }
}

// 清空日志
function clearRunLogs() {
    const logsDiv = document.getElementById('runLogs');
    logsDiv.innerHTML = '<div class="log-entry info"><span class="log-time">[系统]</span>日志已清空</div>';
}

// =========================
// 策略启动 / 停止 / 状态刷新
// =========================

// 启动策略运行（自动交易）
async function startRunStrategy() {
    const strategyId = document.getElementById('runStrategySelect').value;
    const symbol = document.getElementById('runSymbol').value.trim().toUpperCase();
    const initialCapital = document.getElementById('runInitialCapital').value;
    const commission = document.getElementById('runCommission').value;
    const slippage = document.getElementById('runSlippage').value;
    
    if (!strategyId) {
        showAlert('请选择策略', 'warning');
        return;
    }
    
    if (!symbol) {
        showAlert('请填写投资标的', 'warning');
        return;
    }
    
    if (!initialCapital) {
        showAlert('请填写初始资金', 'warning');
        return;
    }
    
    addRunLog('正在启动策略运行...', 'info');
    
    try {
        const response = await fetch('/api/simulation/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                strategy_id: strategyId,  // 必须提供策略ID
                initial_capital: parseFloat(initialCapital),
                commission: parseFloat(commission),
                slippage: parseFloat(slippage)
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            currentStrategyRun = {
                id: result.simulation_id,
                strategy_id: strategyId,
                symbol: symbol,
                status: 'running'
            };
            
            addRunLog(`策略启动成功: ${strategyId}`, 'success');
            addRunLog(`投资标的: ${symbol}`, 'info');
            addRunLog(`初始资金: ¥${parseFloat(initialCapital).toLocaleString()}`, 'info');
            addRunLog('策略开始自动运行，将根据市场数据生成交易信号...', 'info');
            
            updateStrategyDisplay();
            refreshStrategyStatus();
        } else {
            addRunLog(`策略启动失败: ${result.error || '未知错误'}`, 'error');
            showAlert(result.error || '启动失败', 'danger');
        }
    } catch (error) {
        console.error('Error starting strategy:', error);
        addRunLog(`策略启动失败: ${error.message}`, 'error');
        showAlert('启动失败', 'danger');
    }
}

// 停止策略运行
async function stopRunStrategy() {
    if (!currentStrategyRun) {
        showAlert('没有运行中的策略', 'warning');
        return;
    }
    
    if (!confirm('确定要停止策略运行吗？')) {
        return;
    }
    
    addRunLog('正在停止策略运行...', 'warning');
    
    try {
        const response = await fetch(`/api/simulation/stop/${currentStrategyRun.id}`, {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (response.ok) {
            addRunLog('策略已停止运行', 'success');
            currentStrategyRun.status = 'stopped';
            updateStrategyDisplay();
            showAlert('策略已停止', 'success');
        } else {
            addRunLog(`停止失败: ${result.error || '未知错误'}`, 'error');
            showAlert(result.error || '停止失败', 'danger');
        }
    } catch (error) {
        console.error('Error stopping strategy:', error);
        addRunLog(`停止失败: ${error.message}`, 'error');
        showAlert('停止失败', 'danger');
    }
}

// 刷新策略状态
async function refreshStrategyStatus() {
    if (!currentStrategyRun) return;
    
    try {
        const response = await fetch(`/api/simulation/status/${currentStrategyRun.id}`);
        const data = await response.json();
        
        if (response.ok && data.simulation) {
            const simulation = data.simulation;
            currentStrategyRun = {
                ...currentStrategyRun,
                ...simulation
            };
            updateStrategyDisplay();
        }
    } catch (error) {
        console.error('Error refreshing strategy status:', error);
    }
}

// =========================
// 总览 & 指标更新
// =========================

// 更新策略运行总览和指标卡片
function updateStrategyDisplay() {
    if (!currentStrategyRun) {
        // 重置显示
        document.getElementById('runStatusBadge').textContent = '未运行';
        document.getElementById('runStatusBadge').className = 'status-badge waiting';
        document.getElementById('currentStrategy').textContent = '--';
        document.getElementById('currentSymbol').textContent = '--';
        document.getElementById('runCurrentCapital').textContent = '¥0.00';
        document.getElementById('runTotalReturn').textContent = '0.00%';
        document.getElementById('runTradeCount').textContent = '0';
        
        document.getElementById('runInitialCapitalDisplay').textContent = '¥0';
        document.getElementById('runPositionValue').textContent = '¥0';
        document.getElementById('runTotalPnL').textContent = '¥0';
        document.getElementById('runAvailableCapital').textContent = '¥0';
        
        document.getElementById('startStrategyBtn').disabled = false;
        document.getElementById('stopStrategyBtn').disabled = true;
        return;
    }
    
    const simulation = currentStrategyRun;
    const status = simulation.status || 'stopped';
    
    // 更新状态徽章
    const statusBadge = document.getElementById('runStatusBadge');
    if (status === 'running') {
        statusBadge.textContent = '运行中';
        statusBadge.className = 'status-badge running';
    } else {
        statusBadge.textContent = '已停止';
        statusBadge.className = 'status-badge stopped';
    }
    
    // 更新总览信息
    document.getElementById('currentStrategy').textContent = simulation.strategy_id || '--';
    document.getElementById('currentSymbol').textContent = simulation.symbol || '--';
    
    const initialCapital = simulation.initial_capital || 100000;
    const currentCapital = simulation.current_capital || initialCapital;
    const frozenCapital = simulation.frozen_capital || 0;
    const available = currentCapital - frozenCapital;
    
    // 计算持仓市值
    let positionValue = 0;
    if (simulation.positions) {
        Object.entries(simulation.positions).forEach(([symbol, position]) => {
            const quantity = Math.abs(position.quantity || 0);
            const avgPrice = position.avg_price || 0;
            // 简化：使用成本价作为现价
            positionValue += quantity * avgPrice;
        });
    }
    
    const totalAssets = available + positionValue;
    const totalPnL = totalAssets - initialCapital;
    const totalReturn = initialCapital > 0 ? ((totalPnL / initialCapital) * 100).toFixed(2) : '0.00';
    
    document.getElementById('runCurrentCapital').textContent = '¥' + totalAssets.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    
    const returnElement = document.getElementById('runTotalReturn');
    returnElement.textContent = (totalReturn >= 0 ? '+' : '') + totalReturn + '%';
    returnElement.className = 'overview-value ' + (totalReturn >= 0 ? 'text-warning' : 'text-info');
    
    document.getElementById('runTradeCount').textContent = (simulation.trades || []).length;
    
    // 更新指标卡片
    document.getElementById('runInitialCapitalDisplay').textContent = '¥' + initialCapital.toLocaleString();
    document.getElementById('runPositionValue').textContent = '¥' + positionValue.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    
    const pnlElement = document.getElementById('runTotalPnL');
    pnlElement.textContent = (totalPnL >= 0 ? '+' : '') + '¥' + totalPnL.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    pnlElement.className = 'metric-value ' + (totalPnL >= 0 ? '' : 'negative');
    
    document.getElementById('runAvailableCapital').textContent = '¥' + available.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});

    // 更新实时监控图表
    updateMonitorChartFromSimulation(simulation);
    
    // 更新按钮状态
    if (status === 'running') {
        document.getElementById('startStrategyBtn').disabled = true;
        document.getElementById('stopStrategyBtn').disabled = false;
    } else {
        document.getElementById('startStrategyBtn').disabled = false;
        document.getElementById('stopStrategyBtn').disabled = true;
    }
    
    // 如果有新交易，记录到日志（只记录最近一笔的概要）
    if (simulation.trades && simulation.trades.length > 0) {
        const lastTrade = simulation.trades[simulation.trades.length - 1];
        const tradeAction = lastTrade.action === 'buy' ? '买入' : '卖出';
        addRunLog(`策略执行${tradeAction}: ${lastTrade.symbol} ${lastTrade.quantity}股 @ ¥${(lastTrade.price || 0).toFixed(2)}`, 'success');
    }
}

// =========================
// UI 辅助函数
// =========================

// 显示警告/提示消息（与 trading.js 保持一致）
function showAlert(message, type = 'info') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    const container = document.querySelector('.container-fluid');
    if (container) {
        container.insertBefore(alertDiv, container.firstChild);
    }
    
    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.remove();
        }
    }, 3000);
}

// 页面卸载时清理定时器
window.addEventListener('beforeunload', function() {
    if (updateInterval) {
        clearInterval(updateInterval);
    }
});
