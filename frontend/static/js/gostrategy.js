// DeltaFStation 运行策略页面 JavaScript
// 基于 trading.js 的结构，适配策略运行页面
// DOM 辅助函数 $ 已在 common.js 中定义

// =========================
// 全局变量
// =========================

let currentStrategyRun = null;   // 当前运行中的策略仿真
let updateInterval = null;       // 状态轮询定时器
let equityChart = null;          // 资产曲线图
let equityData = { times: [], values: [] }; // 资产曲线数据
let orders = [];                 // 委托列表
let trades = [];                 // 成交列表
let logs = [];                    // 日志数组

// =========================
// 页面初始化
// =========================

document.addEventListener('DOMContentLoaded', function() {
    loadStrategies();
    initializeEquityChart();
    
    // 设置自动刷新（仅在有运行中的策略时刷新）
    updateInterval = setInterval(() => {
        if (currentStrategyRun) {
            refreshStrategyStatus();
        }
    }, 5000); // 每5秒刷新一次
});

// =========================
// 策略列表加载
// =========================

// 加载策略列表
async function loadStrategies() {
    try {
        const response = await fetch('/api/strategy/list');
        const data = await response.json();
        
        const select = $('runStrategySelect');
        select.innerHTML = '<option value="">请选择策略</option>';
        
        let defaultStrategyId = null;
        
        if (data.strategies && data.strategies.length > 0) {
            data.strategies.forEach(strategy => {
                const option = document.createElement('option');
                option.value = strategy.id;
                option.textContent = `${strategy.name} (${strategy.type || '技术分析'})`;
                select.appendChild(option);
                
                // 优先选择BOLLStrategy，如果没有则选择第一个策略
                if (strategy.id === 'BOLLStrategy') {
                    defaultStrategyId = strategy.id;
                } else if (!defaultStrategyId) {
                    defaultStrategyId = strategy.id;
                }
            });
            
            // 设置默认选中值（优先BOLLStrategy，否则选择第一个）
            if (defaultStrategyId) {
                select.value = defaultStrategyId;
            }
        } else {
            select.innerHTML = '<option value="">暂无可用策略</option>';
        }
    } catch (error) {
        console.error('Error loading strategies:', error);
        addLog('加载策略列表失败: ' + error.message, 'error');
    }
}

// =========================
// 资产曲线图初始化
// =========================

// 初始化资产曲线图
function initializeEquityChart() {
    const canvas = $('equityChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const ctx = canvas.getContext('2d');
    equityChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: '总资产',
                data: [],
                borderColor: '#28a745',
                backgroundColor: 'rgba(40, 167, 69, 0.1)',
                borderWidth: 2,
                tension: 0.3,
                pointRadius: 0,
                pointHoverRadius: 4,
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
                    intersect: false,
                    callbacks: {
                        label: function(context) {
                            return '总资产: ¥' + context.parsed.y.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { 
                        maxTicksLimit: 8, 
                        font: { size: 9 },
                        maxRotation: 45,
                        minRotation: 45
                    }
                },
                y: {
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: { 
                        font: { size: 10 },
                        callback: function(value) {
                            if (value >= 10000) {
                                return '¥' + (value / 10000).toFixed(1) + 'w';
                            } else if (value >= 1000) {
                                return '¥' + (value / 1000).toFixed(0) + 'k';
                            } else {
                                return '¥' + value.toFixed(0);
                            }
                        }
                    }
                }
            }
        }
    });
}

// 更新资产曲线图
function updateEquityChart(totalAssets) {
    if (!equityChart || totalAssets === undefined || totalAssets === null) return;
    
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const label = `${hours}:${minutes}:${seconds}`;

    equityData.times.push(label);
    equityData.values.push(totalAssets);

    // 保持最近100个数据点
    if (equityData.times.length > 100) {
        equityData.times.shift();
        equityData.values.shift();
    }

    equityChart.data.labels = equityData.times;
    equityChart.data.datasets[0].data = equityData.values;
    equityChart.update('none');
}

// =========================
// 账户管理
// =========================

// 显示创建账户模态框
function showCreateAccount() {
    new bootstrap.Modal($('createAccountModal')).show();
}

// 创建交易账户
async function createAccount() {
    const initialCapital = $('accountCapital').value;
    const commission = $('accountCommission').value;
    
    if (!initialCapital) {
        showAlert('请填写初始资金', 'warning');
        return;
    }
    
    try {
        const body = {
            initial_capital: parseFloat(initialCapital),
            commission: parseFloat(commission),
            slippage: 0.0005  // 默认滑点
            // 不传 strategy_id，表示纯账户，不启动策略
        };
        
        const response = await fetch('/api/simulation/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('交易账户创建成功', 'success');
            addLog(`创建交易账户: 初始资金 ¥${parseFloat(initialCapital).toLocaleString()}`, 'success');
            bootstrap.Modal.getInstance($('createAccountModal')).hide();
            
            // 更新账户信息
            currentStrategyRun = {
                id: result.simulation_id,
                status: 'running',
                initial_capital: parseFloat(initialCapital),
                current_capital: parseFloat(initialCapital),
                commission: parseFloat(commission),
                slippage: 0.0005,  // 默认滑点
                positions: {},
                trades: []
            };
            
            // 同步更新策略配置表单中的值
            $('runInitialCapital').value = initialCapital;
            $('runCommission').value = commission;
            
            updateStrategyDisplay();
        } else {
            addLog(`创建账户失败: ${result.error || '未知错误'}`, 'error');
            showAlert(result.error || '创建失败', 'danger');
        }
    } catch (error) {
        console.error('Error creating account:', error);
        addLog(`创建账户失败: ${error.message}`, 'error');
        showAlert('创建失败', 'danger');
    }
}

// 关闭账户
async function stopSimulation() {
    if (!currentStrategyRun) {
        showAlert('没有运行中的账户', 'warning');
        return;
    }
    
    if (!confirm('确定要关闭交易账户吗？关闭后需要重新创建账户才能继续交易。')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/simulation/stop/${currentStrategyRun.id}`, {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('账户已关闭', 'success');
            addLog('关闭交易账户', 'info');
            if (currentStrategyRun) {
                currentStrategyRun.status = 'stopped';
            }
            updateStrategyDisplay();
        } else {
            addLog(`关闭账户失败: ${result.error || '未知错误'}`, 'error');
            showAlert(result.error || '关闭失败', 'danger');
        }
    } catch (error) {
        console.error('Error stopping account:', error);
        addLog(`关闭账户失败: ${error.message}`, 'error');
        showAlert('关闭失败', 'danger');
    }
}

// =========================
// 策略启动 / 停止
// =========================

// 启动策略运行
async function startRunStrategy() {
    // 检查是否已有账户，如果没有则先创建账户
    if (!currentStrategyRun) {
        const initialCapital = $('runInitialCapital').value;
        const commission = $('runCommission').value;
        
        if (!initialCapital) {
            showAlert('请填写初始资金', 'warning');
            return;
        }
        
        // 自动创建账户
        try {
            const body = {
                initial_capital: parseFloat(initialCapital),
                commission: parseFloat(commission),
                slippage: 0.0005  // 默认滑点
            };
            
            const response = await fetch('/api/simulation/start', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                addLog(`创建账户失败: ${result.error || '未知错误'}`, 'error');
                showAlert(result.error || '创建账户失败', 'danger');
                return;
            }
            
            currentStrategyRun = {
                id: result.simulation_id,
                status: 'running',
                initial_capital: parseFloat(initialCapital),
                current_capital: parseFloat(initialCapital),
                commission: parseFloat(commission),
                slippage: 0.0005,  // 默认滑点
                positions: {},
                trades: []
            };
            
            addLog(`自动创建交易账户: 初始资金 ¥${parseFloat(initialCapital).toLocaleString()}`, 'success');
        } catch (error) {
            console.error('Error creating account:', error);
            addLog(`创建账户失败: ${error.message}`, 'error');
            showAlert('创建账户失败', 'danger');
            return;
        }
    }
    
    const strategyId = $('runStrategySelect').value;
    const symbol = $('runSymbol').value.trim().toUpperCase();
    
    if (!strategyId) {
        showAlert('请选择策略', 'warning');
        return;
    }
    
    if (!symbol) {
        showAlert('请填写投资标的', 'warning');
        return;
    }
    
    addLog('正在启动策略运行...', 'info');
    
    try {
        // 创建新账户并启动策略（基于历史数据回放）
        const response = await fetch('/api/simulation/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                strategy_id: strategyId,
                symbol: symbol,
                initial_capital: currentStrategyRun.initial_capital,
                commission: currentStrategyRun.commission,
                slippage: currentStrategyRun.slippage,
                use_demo_data: document.getElementById('useDemoData').checked
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            currentStrategyRun = {
                id: result.simulation_id,
                strategy_id: strategyId,
                symbol: symbol,
                status: 'running',
                initial_capital: currentStrategyRun.initial_capital,
                current_capital: currentStrategyRun.initial_capital,
                commission: currentStrategyRun.commission,
                slippage: currentStrategyRun.slippage,
                positions: {},
                trades: []
            };
            
            addLog(`策略启动成功: ${strategyId}`, 'success');
            addLog(`投资标的: ${symbol}`, 'info');
            const useDemoData = $('useDemoData').checked;
            if (useDemoData) {
                addLog('已启用演示数据，将自动生成模拟交易...', 'info');
            } else {
                addLog('未启用演示数据，策略将等待真实信号...', 'info');
            }
            
            updateStrategyDisplay();
            refreshStrategyStatus();
        } else {
            addLog(`策略启动失败: ${result.error || '未知错误'}`, 'error');
            showAlert(result.error || '启动失败', 'danger');
        }
    } catch (error) {
        console.error('Error starting strategy:', error);
        addLog(`策略启动失败: ${error.message}`, 'error');
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
    
    addLog('正在停止策略运行...', 'warning');
    
    try {
        const response = await fetch(`/api/simulation/stop/${currentStrategyRun.id}`, {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (response.ok) {
            addLog('策略已停止运行', 'success');
            if (currentStrategyRun) {
                currentStrategyRun.status = 'stopped';
            }
            updateStrategyDisplay();
            showAlert('策略已停止', 'success');
        } else {
            addLog(`停止失败: ${result.error || '未知错误'}`, 'error');
            showAlert(result.error || '停止失败', 'danger');
        }
    } catch (error) {
        console.error('Error stopping strategy:', error);
        addLog(`停止失败: ${error.message}`, 'error');
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
            const oldTradeCount = currentStrategyRun.trades ? currentStrategyRun.trades.length : 0;
            
            currentStrategyRun = {
                ...currentStrategyRun,
                ...simulation
            };
            
            // 如果有新交易，记录到日志
            const newTradeCount = simulation.trades ? simulation.trades.length : 0;
            if (newTradeCount > oldTradeCount && simulation.trades) {
                const newTrades = simulation.trades.slice(oldTradeCount);
                newTrades.forEach(trade => {
                    const action = trade.action === 'buy' ? '买入' : '卖出';
                    addLog(`策略执行${action}: ${trade.symbol} ${trade.quantity}股 @ ¥${(trade.price || 0).toFixed(2)}`, 'success');
                });
            }
            
            updateStrategyDisplay();
        }
    } catch (error) {
        console.error('Error refreshing strategy status:', error);
    }
}

// =========================
// 策略监控更新
// =========================

// 更新策略监控显示
function updateStrategyMonitor() {
    if (!currentStrategyRun) {
        // 重置监控显示
        $('monitorCurrentPrice').textContent = '--';
        $('monitorReturn').textContent = '0.00%';
        $('monitorReturn').style.color = '#6c757d';
        $('monitorTodayPnL').textContent = '¥0.00';
        $('monitorTodayPnL').style.color = '#6c757d';
        $('monitorPositionCount').textContent = '0';
        $('monitorTradeCount').textContent = '0';
        $('monitorLastSignal').textContent = '等待策略信号...';
        $('monitorSignalTime').textContent = '--';
        $('monitorUpdateTime').textContent = '--:--:--';
        
        // 清空资产曲线
        if (equityChart) {
            equityData.times = [];
            equityData.values = [];
            equityChart.data.labels = [];
            equityChart.data.datasets[0].data = [];
            equityChart.update();
        }
        return;
    }
    
    const simulation = currentStrategyRun;
    const initialCapital = simulation.initial_capital || 100000;
    const currentCapital = simulation.current_capital || initialCapital;
    const frozenCapital = simulation.frozen_capital || 0;
    const available = currentCapital - frozenCapital;
    
    // 计算持仓市值（使用当前价格，如果有交易记录则用最新价格，否则用成本价）
    let positionValue = 0;
    if (simulation.positions) {
        Object.entries(simulation.positions).forEach(([posSymbol, position]) => {
            const quantity = Math.abs(position.quantity || 0);
            const avgPrice = position.avg_price || 0;
            
            // 尝试从交易记录中获取最新价格（确保价格在合理范围内）
            let currentPrice = avgPrice;
            if (simulation.trades && simulation.trades.length > 0) {
                // 查找该标的的最新交易价格
                const symbolTrades = simulation.trades.filter(t => t.symbol === posSymbol);
                if (symbolTrades.length > 0) {
                    const lastTrade = symbolTrades[symbolTrades.length - 1];
                    const tradePrice = lastTrade.price;
                    // 验证价格是否在合理范围内（过滤掉不合理的高价格）
                    if (tradePrice && tradePrice > 0 && tradePrice < 100) {
                        currentPrice = tradePrice;
                    }
                }
            }
            
            positionValue += quantity * currentPrice;
        });
    }
    
    const totalAssets = available + positionValue;
    const totalPnL = totalAssets - initialCapital;
    const totalReturnNum = initialCapital > 0 ? ((totalPnL / initialCapital) * 100) : 0;
    const totalReturn = totalReturnNum.toFixed(2);
    
    // 更新资产曲线图（只在有变化时更新，避免重复数据点）
    const lastValue = equityData.values.length > 0 ? equityData.values[equityData.values.length - 1] : 0;
    if (Math.abs(totalAssets - lastValue) > 0.01 || equityData.values.length === 0) {
        updateEquityChart(totalAssets);
    }
    
    // 更新关键指标（赚钱红色，亏钱绿色）- 使用数值比较而不是字符串比较
    const returnEl = $('monitorReturn');
    returnEl.textContent = (totalReturnNum >= 0 ? '+' : '') + totalReturn + '%';
    returnEl.style.color = totalReturnNum > 0 ? '#dc3545' : (totalReturnNum < 0 ? '#28a745' : '#6c757d');
    
    const pnlEl = $('monitorTodayPnL');
    pnlEl.textContent = (totalPnL >= 0 ? '+' : '') + '¥' + totalPnL.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    pnlEl.style.color = totalPnL > 0 ? '#dc3545' : (totalPnL < 0 ? '#28a745' : '#6c757d');
    
    // 持仓股数（显示总股数，而不是持仓标的数量）
    let totalPositionQuantity = 0;
    if (simulation.positions) {
        Object.entries(simulation.positions).forEach(([symbol, position]) => {
            totalPositionQuantity += Math.abs(position.quantity || 0);
        });
    }
    $('monitorPositionCount').textContent = totalPositionQuantity;
    
    // 交易次数
    $('monitorTradeCount').textContent = simulation.trades ? simulation.trades.length : 0;
    
    // 实时价格：优先从持仓中获取（后端实时更新），其次从最新交易记录获取
    let currentPrice = null;
    const symbol = simulation.symbol || $('runSymbol')?.value;
    
    // 优先使用持仓的当前价格（后端实时更新）
    if (simulation.positions && symbol) {
        const position = simulation.positions[symbol];
        if (position) {
            if (position.current_price && position.current_price > 0 && position.current_price < 100) {
                currentPrice = position.current_price;
            }
        }
    }
    
    // 如果没有持仓当前价格，使用最新交易价格
    if (!currentPrice && simulation.trades && simulation.trades.length > 0) {
        const lastTrade = simulation.trades[simulation.trades.length - 1];
        if (lastTrade.price && lastTrade.price > 0 && lastTrade.price < 100) {
            currentPrice = lastTrade.price;
        }
    }
    
    // 如果还没有，尝试使用持仓的平均成本价
    if (!currentPrice && simulation.positions && symbol) {
        const position = simulation.positions[symbol];
        if (position && position.avg_price && position.avg_price > 0 && position.avg_price < 100) {
            currentPrice = position.avg_price;
        }
    }
    
    // 更新实时价格显示
    const priceEl = $('monitorCurrentPrice');
    if (currentPrice) {
        priceEl.textContent = '¥' + currentPrice.toFixed(2);
        priceEl.style.color = '#343a40';
    } else {
        priceEl.textContent = '--';
        priceEl.style.color = '#6c757d';
    }
    
    // 最近信号
    if (simulation.trades && simulation.trades.length > 0) {
        const lastTrade = simulation.trades[simulation.trades.length - 1];
        const signalAction = lastTrade.action === 'buy' ? '买入' : '卖出';
        const signalText = `${signalAction} ${lastTrade.symbol} ${lastTrade.quantity}股 @ ¥${(lastTrade.price || 0).toFixed(2)}`;
        $('monitorLastSignal').textContent = signalText;
        $('monitorSignalTime').textContent = formatDateTime(lastTrade.date || lastTrade.timestamp).split(' ')[1] || '--';
    } else {
        $('monitorLastSignal').textContent = '等待策略信号...';
        $('monitorSignalTime').textContent = '--';
    }
    
    // 更新时间
    $('monitorUpdateTime').textContent = new Date().toLocaleTimeString();
}

// =========================
// 账户总览更新
// =========================

// 更新策略运行总览和指标
function updateStrategyDisplay() {
    if (!currentStrategyRun) {
        // 重置显示
        $('runStatusBadge').textContent = '未运行';
        $('runStatusBadge').className = 'status-badge waiting';
        $('totalAssets').textContent = '¥0.00';
        $('availableCapital').textContent = '¥0.00';
        $('positionValue').textContent = '¥0.00';
        $('totalPnL').textContent = '¥0.00';
        $('totalReturn').textContent = '0.00%';
        
        $('accountId').textContent = 'df0002';
        $('commissionDisplay').textContent = '--';
        
        // 更新按钮状态
        const createBtn = $('createAccountBtn');
        const stopBtn = $('stopSimulationBtn');
        const startBtn = $('startStrategyBtn');
        const stopStrategyBtn = $('stopStrategyBtn');
        
        if (createBtn) createBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
        if (startBtn) startBtn.disabled = false;
        if (stopStrategyBtn) stopStrategyBtn.disabled = true;
        
        // 清空表格
        updateOrdersDisplay();
        updateTradesDisplay();
        updatePositionsDisplay();
        return;
    }
    
    const simulation = currentStrategyRun;
    const status = simulation.status || 'stopped';
    
    // 更新状态徽章
    const statusBadge = $('runStatusBadge');
    if (status === 'running') {
        statusBadge.textContent = '运行中';
        statusBadge.className = 'status-badge running';
    } else {
        statusBadge.textContent = '已停止';
        statusBadge.className = 'status-badge stopped';
    }
    
    const initialCapital = simulation.initial_capital || 100000;
    const currentCapital = simulation.current_capital || initialCapital;
    const frozenCapital = simulation.frozen_capital || 0;
    const available = currentCapital - frozenCapital;
    
    // 计算持仓市值（使用当前价格，如果有交易记录则用最新价格，否则用成本价）
    let positionValue = 0;
    if (simulation.positions) {
        Object.entries(simulation.positions).forEach(([posSymbol, position]) => {
            const quantity = Math.abs(position.quantity || 0);
            const avgPrice = position.avg_price || 0;
            
            // 尝试从交易记录中获取最新价格（确保价格在合理范围内）
            let currentPrice = avgPrice;
            if (simulation.trades && simulation.trades.length > 0) {
                // 查找该标的的最新交易价格
                const symbolTrades = simulation.trades.filter(t => t.symbol === posSymbol);
                if (symbolTrades.length > 0) {
                    const lastTrade = symbolTrades[symbolTrades.length - 1];
                    const tradePrice = lastTrade.price;
                    // 验证价格是否在合理范围内（过滤掉不合理的高价格）
                    if (tradePrice && tradePrice > 0 && tradePrice < 100) {
                        currentPrice = tradePrice;
                    }
                }
            }
            
            positionValue += quantity * currentPrice;
        });
    }
    
    const totalAssets = available + positionValue;
    const totalPnL = totalAssets - initialCapital;
    const totalReturnNum = initialCapital > 0 ? ((totalPnL / initialCapital) * 100) : 0;
    const totalReturn = totalReturnNum.toFixed(2);
    
    // 更新总览
    $('totalAssets').textContent = '¥' + totalAssets.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    $('availableCapital').textContent = '¥' + available.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    $('positionValue').textContent = '¥' + positionValue.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    
    const pnlEl = $('totalPnL');
    pnlEl.textContent = (totalPnL >= 0 ? '+' : '') + '¥' + totalPnL.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    pnlEl.className = 'account-value ' + (totalPnL > 0 ? 'text-danger' : (totalPnL < 0 ? 'text-success' : ''));
    pnlEl.style.color = totalPnL > 0 ? '#dc3545' : (totalPnL < 0 ? '#28a745' : '#343a40');
    
    const returnEl = $('totalReturn');
    returnEl.textContent = (totalReturnNum >= 0 ? '+' : '') + totalReturn + '%';
    returnEl.className = 'account-value ' + (totalReturnNum > 0 ? 'text-danger' : (totalReturnNum < 0 ? 'text-success' : ''));
    returnEl.style.color = totalReturnNum > 0 ? '#dc3545' : (totalReturnNum < 0 ? '#28a745' : '#343a40');
    
    // 更新账户信息（显示固定账号df0002）
    $('accountId').textContent = 'df0002';
    $('commissionDisplay').textContent = ((simulation.commission || 0.001) * 100).toFixed(2) + '%';
    
    // 更新按钮状态
    const createBtn = $('createAccountBtn');
    const stopBtn = $('stopSimulationBtn');
    const startBtn = $('startStrategyBtn');
    const stopStrategyBtn = $('stopStrategyBtn');
    
    if (status === 'running') {
        if (createBtn) createBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = false;
        if (startBtn) startBtn.disabled = true;
        if (stopStrategyBtn) stopStrategyBtn.disabled = false;
    } else {
        if (createBtn) createBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
        if (startBtn) startBtn.disabled = false;
        if (stopStrategyBtn) stopStrategyBtn.disabled = true;
    }
    
    // 更新表格
    updateOrdersDisplay();
    updateTradesDisplay();
    updatePositionsDisplay();
    
    // 更新策略监控
    updateStrategyMonitor();
}

// =========================
// 委托 / 成交 / 持仓显示
// =========================

// 更新委托显示
function updateOrdersDisplay() {
    const ordersTableBody = $('ordersTableBody');
    if (!ordersTableBody) return;
    
    if (!currentStrategyRun || !currentStrategyRun.trades || currentStrategyRun.trades.length === 0) {
        ordersTableBody.innerHTML = renderEmptyState(10, 'fa-list-alt', '暂无委托');
        return;
    }
    
    // 从交易记录生成委托记录（简化处理）
    const reversedTrades = currentStrategyRun.trades.slice().reverse().slice(0, 20);
    orders = reversedTrades.map((trade, index) => {
        const orderId = `order_${10000000 + reversedTrades.length - index - 1}`;
        return {
            id: orderId,
            symbol: trade.symbol || '--',
            name: trade.symbol || '--',
            direction: trade.action === 'buy' ? '买入' : '卖出',
            price: trade.price || 0,
            quantity: trade.quantity || 0,
            traded_quantity: trade.quantity || 0,
            status: '全部成交',
            timestamp: trade.date || trade.timestamp
        };
    });
    
    ordersTableBody.innerHTML = orders.map(order => {
        const directionClass = order.direction === '买入' ? 'buy' : 'sell';
        return `
            <tr>
                <td>${order.id.replace('order_', '')}</td>
                <td>${order.symbol}</td>
                <td>${order.name}</td>
                <td><span class="direction-badge ${directionClass}">${order.direction}</span></td>
                <td>¥${order.price.toFixed(2)}</td>
                <td>${order.quantity}</td>
                <td>${order.traded_quantity}</td>
                <td><span class="order-status filled">${order.status}</span></td>
                <td>${formatDateTime(order.timestamp)}</td>
                <td>--</td>
            </tr>
        `;
    }).join('');
}

// 更新成交显示
function updateTradesDisplay() {
    const tradesTableBody = $('tradesTableBody');
    if (!tradesTableBody) return;
    
    if (!currentStrategyRun || !currentStrategyRun.trades || currentStrategyRun.trades.length === 0) {
        tradesTableBody.innerHTML = renderEmptyState(9, 'fa-check-circle', '暂无成交');
        return;
    }
    
    trades = currentStrategyRun.trades.slice().reverse().slice(0, 50);
    tradesTableBody.innerHTML = trades.map((trade, index) => {
        const direction = trade.action === 'buy' ? '买入' : '卖出';
        const directionClass = trade.action === 'buy' ? 'buy' : 'sell';
        const amount = (trade.price || 0) * (trade.quantity || 0);
        const tradeId = `trade_${10000000 + trades.length - index - 1}`;
        const orderId = trade.order_id || `order_${10000000 + trades.length - index - 1}`;
        
        return `
            <tr>
                <td>${tradeId.replace('trade_', '')}</td>
                <td>${orderId.replace('order_', '')}</td>
                <td>${trade.symbol || '--'}</td>
                <td>${trade.symbol || '--'}</td>
                <td><span class="direction-badge ${directionClass}">${direction}</span></td>
                <td>¥${(trade.price || 0).toFixed(2)}</td>
                <td>${trade.quantity || 0}</td>
                <td>¥${amount.toFixed(2)}</td>
                <td>${formatDateTime(trade.date || trade.timestamp)}</td>
            </tr>
        `;
    }).join('');
}

// 更新持仓显示
function updatePositionsDisplay() {
    const positionTableBody = $('positionTableBody');
    if (!positionTableBody) return;
    
    if (!currentStrategyRun || !currentStrategyRun.positions || Object.keys(currentStrategyRun.positions).length === 0) {
        positionTableBody.innerHTML = renderEmptyState(9, 'fa-inbox', '暂无持仓');
        return;
    }
    
    const positionsList = [];
    Object.entries(currentStrategyRun.positions).forEach(([symbol, position]) => {
        const quantity = Math.abs(position.quantity || 0);
        if (quantity > 0) {
            const avgPrice = position.avg_price || 0;
            
            // 优先从交易记录中获取最新价格（确保价格在合理范围内）
            let currentPrice = null;
            if (currentStrategyRun.trades && currentStrategyRun.trades.length > 0) {
                const symbolTrades = currentStrategyRun.trades.filter(t => t.symbol === symbol);
                if (symbolTrades.length > 0) {
                    const lastTrade = symbolTrades[symbolTrades.length - 1];
                    const tradePrice = lastTrade.price;
                    // 验证价格是否在合理范围内（工商银行应该在5-6元之间）
                    if (tradePrice && tradePrice > 0 && tradePrice < 100) {
                        currentPrice = tradePrice;
                    }
                }
            }
            
            // 如果没有合理的最新交易价格，使用后端保存的当前价格
            if (!currentPrice && position.current_price) {
                const backendPrice = position.current_price;
                // 验证后端价格是否在合理范围内
                if (backendPrice && backendPrice > 0 && backendPrice < 100) {
                    currentPrice = backendPrice;
                }
            }
            
            // 最后使用成本价（如果成本价也不合理，至少用成本价）
            if (!currentPrice || currentPrice <= 0) {
                currentPrice = avgPrice || 0;
            }
            
            const profit = (currentPrice - avgPrice) * quantity;
            const profitRate = avgPrice > 0 ? ((currentPrice - avgPrice) / avgPrice * 100).toFixed(2) : '0.00';
            const marketValue = quantity * currentPrice;
            
            positionsList.push({
                symbol: symbol,
                name: symbol,
                position: quantity, // 持仓数量
                avgPrice: avgPrice,
                currentPrice: currentPrice,
                profit: profit,
                profitRate: profitRate,
                marketValue: marketValue
            });
        }
    });
    
    positionTableBody.innerHTML = positionsList.map(pos => {
        const profitClass = pos.profit >= 0 ? 'positive' : 'negative';
        return `
            <tr>
                <td>${pos.symbol}</td>
                <td>${pos.name}</td>
                <td>${pos.position}</td>
                <td>¥${pos.avgPrice.toFixed(2)}</td>
                <td>¥${pos.currentPrice.toFixed(2)}</td>
                <td class="position-profit ${profitClass}">${pos.profit >= 0 ? '+' : ''}¥${pos.profit.toFixed(2)}</td>
                <td class="position-profit ${profitClass}">${pos.profitRate >= 0 ? '+' : ''}${pos.profitRate}%</td>
                <td>¥${pos.marketValue.toFixed(2)}</td>
                <td>--</td>
            </tr>
        `;
    }).join('');
}

// 切换数据视图
function switchDataView(view, buttonElement) {
    document.querySelectorAll('.data-view').forEach(v => v.classList.add('d-none'));
    document.querySelectorAll('.btn-outline-success').forEach(btn => btn.classList.remove('active'));
    const targetView = document.querySelector(`.data-view-${view}`);
    if (targetView) targetView.classList.remove('d-none');
    if (buttonElement) buttonElement.classList.add('active');
}

// =========================
// 日志功能
// =========================

// 添加日志
function addLog(message, type = 'info') {
    const time = new Date().toLocaleTimeString();
    logs.push({ time: time, message: message, type: type });
    
    // 限制日志数量
    if (logs.length > 200) {
        logs.shift();
    }
    
    updateLogDisplay();
}

// 获取日志颜色类型（与手动交易页面保持一致）
function getLogColorType(message) {
    if (message.includes('买入')) {
        return 'buy';  // 买入 - 红色
    } else if (message.includes('卖出')) {
        return 'sell';  // 卖出 - 绿色
    } else {
        return 'info';  // 其他操作 - 蓝色
    }
}

// 更新日志显示
function updateLogDisplay() {
    const logTableBody = $('logTableBody');
    if (!logTableBody) return;
    
    if (logs.length === 0) {
        logTableBody.innerHTML = '<tr><td colspan="2" class="text-center text-muted py-3" style="font-size: 11px;"><i class="fas fa-info-circle me-1"></i>暂无日志</td></tr>';
        return;
    }
    
    logTableBody.innerHTML = logs.slice().reverse().map(log => {
        const colorType = getLogColorType(log.message);
        let colorClass = '';
        if (colorType === 'buy') {
            colorClass = 'log-buy';  // 买入 - 红色
        } else if (colorType === 'sell') {
            colorClass = 'log-sell';  // 卖出 - 绿色
        } else {
            colorClass = 'log-info';  // 其他 - 蓝色
        }
        return `
            <tr>
                <td style="width: 100px; min-width: 100px; font-size: 11px; color: #6c757d;">${log.time}</td>
                <td class="${colorClass}" style="font-size: 11px; word-break: break-word;">${log.message}</td>
            </tr>
        `;
    }).join('');
    
    // 自动滚动到底部
    const logContainer = logTableBody.closest('.table-container');
    if (logContainer) {
        logContainer.scrollTop = logContainer.scrollHeight;
    }
}

// 清空日志
function clearLogs() {
    logs = [];
    updateLogDisplay();
    addLog('日志已清空', 'info');
}

// =========================
// 工具函数
// =========================

// formatDateTime 和 showAlert 已在 common.js 中定义
// 但 run.js 需要完整格式的日期时间，使用 formatDateTimeFull
function formatDateTime(dateTimeStr) {
    if (!dateTimeStr) return '--';
    try {
        const date = new Date(dateTimeStr);
        return date.toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    } catch (e) {
        return dateTimeStr;
    }
}

// 页面卸载时清理定时器
window.addEventListener('beforeunload', function() {
    if (updateInterval) {
        clearInterval(updateInterval);
    }
});
