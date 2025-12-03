// DeltaFStation 交易页面JavaScript

// 全局变量
let currentSimulation = null;
let updateInterval = null;
let orders = [];
let trades = [];
let marketData = {};
let currentStockInfo = {};
let intradayChart = null;
let intradayData = { times: [], prices: [] };

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    initializeTradingInterface();
    initializeDemoData(); // 为便于展示，创建一组示例数据（真实交易时会被实际账户覆盖）
    
    // 设置自动刷新
    updateInterval = setInterval(() => {
        if (currentSimulation) {
            updateSimulationStatus();
        }
    }, 3000); // 每3秒刷新一次
});

// 初始化交易界面
function initializeTradingInterface() {
    // 买入表单事件监听
    const buyPrice = document.getElementById('buyPrice');
    const buyQuantity = document.getElementById('buyQuantity');
    
    if (buyPrice && buyQuantity) {
        buyPrice.addEventListener('input', () => calculateEstimatedAmount('buy'));
        buyQuantity.addEventListener('input', () => calculateEstimatedAmount('buy'));
    }
    
    // 卖出表单事件监听
    const sellPrice = document.getElementById('sellPrice');
    const sellQuantity = document.getElementById('sellQuantity');
    
    if (sellPrice && sellQuantity) {
        sellPrice.addEventListener('input', () => calculateEstimatedAmount('sell'));
        sellQuantity.addEventListener('input', () => calculateEstimatedAmount('sell'));
    }

    // 初始化分时图
    initializeIntradayChart();
}

// 初始化分时K线（简单折线图）
function initializeIntradayChart() {
    const canvas = document.getElementById('intradayChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const ctx = canvas.getContext('2d');
    intradayChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: '价格',
                data: [],
                borderColor: '#007bff',
                backgroundColor: 'rgba(0, 123, 255, 0.1)',
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

function addIntradayPoint(price) {
    if (!intradayChart || !price) return;
    const now = new Date();
    const label = now.toLocaleTimeString().slice(0, 5);

    intradayData.times.push(label);
    intradayData.prices.push(price);

    if (intradayData.times.length > 60) {
        intradayData.times.shift();
        intradayData.prices.shift();
    }

    intradayChart.data.labels = intradayData.times;
    intradayChart.data.datasets[0].data = intradayData.prices;
    intradayChart.update('none');
}

// 初始化示例数据，便于界面展示（仅当前没有真实账户时生效）
function initializeDemoData() {
    if (currentSimulation) return;

    const now = new Date();

    // 示例行情数据
    marketData['600000.SH'] = {
        symbol: '600000.SH',
        name: '浦发银行',
        latest_price: 10.25,
        bid1_price: 10.23,
        bid1_quantity: 1200,
        ask1_price: 10.27,
        ask1_quantity: 800
    };
    marketData['000001.SZ'] = {
        symbol: '000001.SZ',
        name: '平安银行',
        latest_price: 12.68,
        bid1_price: 12.66,
        bid1_quantity: 500,
        ask1_price: 12.70,
        ask1_quantity: 600
    };

    currentSimulation = {
        id: 'demo',
        status: 'running',
        initial_capital: 100000,
        current_capital: 102500,
        frozen_capital: 0,
        commission: 0.001,
        slippage: 0.0005,
        positions: {
            '600000.SH': { quantity: 1000, avg_price: 10.0 },
            '000001.SZ': { quantity: 500, avg_price: 12.5 }
        },
        trades: [
            {
                id: 'demo_trade_1',
                symbol: '600000.SH',
                action: 'buy',
                quantity: 1000,
                price: 10.0,
                timestamp: now.toISOString()
            },
            {
                id: 'demo_trade_2',
                symbol: '000001.SZ',
                action: 'buy',
                quantity: 500,
                price: 12.5,
                timestamp: now.toISOString()
            }
        ]
    };

    // 更新界面展示
    updateSimulationDisplay();

    // 用示例行情填充行情卡片与分时图
    loadStockInfo('buy');
}

// 更新账户总览
function updateAccountOverview() {
    if (!currentSimulation) {
        document.getElementById('totalAssets').textContent = '¥0.00';
        document.getElementById('availableCapital').textContent = '¥0.00';
        document.getElementById('positionValue').textContent = '¥0.00';
        document.getElementById('totalPnL').textContent = '¥0.00';
        document.getElementById('totalReturn').textContent = '0.00%';
        return;
    }
    
    const initialCapital = currentSimulation.initial_capital || 100000;
    const currentCapital = currentSimulation.current_capital || initialCapital;
    const frozenCapital = currentSimulation.frozen_capital || 0;
    const available = currentCapital - frozenCapital;
    
    // 计算持仓市值
    let positionValue = 0;
    let totalCost = 0;
    if (currentSimulation.positions) {
        Object.entries(currentSimulation.positions).forEach(([symbol, position]) => {
            const quantity = Math.abs(position.quantity || 0);
            const avgPrice = position.avg_price || 0;
            const currentPrice = getCurrentPrice(symbol) || avgPrice;
            positionValue += quantity * currentPrice;
            totalCost += quantity * avgPrice;
        });
    }
    
    // 总资产 = 可用资金 + 持仓市值
    const totalAssets = available + positionValue;
    
    // 总盈亏 = 总资产 - 初始资金
    const totalPnL = totalAssets - initialCapital;
    
    // 总收益率
    const totalReturn = initialCapital > 0 ? ((totalPnL / initialCapital) * 100).toFixed(2) : '0.00';
    
    // 更新显示
    document.getElementById('totalAssets').textContent = '¥' + totalAssets.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    document.getElementById('availableCapital').textContent = '¥' + available.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    document.getElementById('positionValue').textContent = '¥' + positionValue.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    
    const pnlElement = document.getElementById('totalPnL');
    pnlElement.textContent = (totalPnL >= 0 ? '+' : '') + '¥' + totalPnL.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    pnlElement.className = 'account-value ' + (totalPnL >= 0 ? 'text-warning' : 'text-info');
    
    const returnElement = document.getElementById('totalReturn');
    returnElement.textContent = (totalReturn >= 0 ? '+' : '') + totalReturn + '%';
    returnElement.className = 'account-value ' + (totalReturn >= 0 ? 'text-warning' : 'text-info');
    
    // 更新状态
    const statusElement = document.getElementById('simulationStatus');
    if (currentSimulation.status === 'running') {
        statusElement.textContent = '运行中';
        statusElement.className = 'simulation-status running';
    } else {
        statusElement.textContent = '已关闭';
        statusElement.className = 'simulation-status stopped';
    }
    
    // 更新账户设置显示
    document.getElementById('initialCapitalDisplay').textContent = '¥' + initialCapital.toLocaleString();
    document.getElementById('commissionDisplay').textContent = ((currentSimulation.commission || 0.001) * 100).toFixed(2) + '%';
    document.getElementById('totalTrades').textContent = (currentSimulation.trades || []).length;
}

// 获取当前价格（模拟）
function getCurrentPrice(symbol) {
    if (marketData[symbol]) {
        return marketData[symbol].latest_price || 0;
    }
    // 如果没有行情数据，尝试从持仓中获取成本价
    if (currentSimulation && currentSimulation.positions && currentSimulation.positions[symbol]) {
        return currentSimulation.positions[symbol].avg_price || 0;
    }
    return 0;
}

// 更新持仓显示
function updatePositionsDisplay() {
    const positionTableBody = document.getElementById('positionTableBody');
    if (!positionTableBody) return;
    
    if (!currentSimulation || !currentSimulation.positions || Object.keys(currentSimulation.positions).length === 0) {
        positionTableBody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">暂无持仓</td></tr>';
        updateSellPositionSelect();
        return;
    }
    
    const positions = [];
    Object.entries(currentSimulation.positions).forEach(([symbol, position]) => {
        const quantity = Math.abs(position.quantity || 0);
        if (quantity > 0) {
            const avgPrice = position.avg_price || 0;
            const currentPrice = getCurrentPrice(symbol) || avgPrice;
            const profit = (currentPrice - avgPrice) * quantity;
            const profitRate = avgPrice > 0 ? ((currentPrice - avgPrice) / avgPrice * 100).toFixed(2) : '0.00';
            const marketValue = quantity * currentPrice;
            
            positions.push({
                symbol,
                name: marketData[symbol]?.name || symbol,
                quantity,
                avgPrice,
                currentPrice,
                profit,
                profitRate,
                marketValue
            });
        }
    });
    
    if (positions.length === 0) {
        positionTableBody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">暂无持仓</td></tr>';
        updateSellPositionSelect();
        return;
    }
    
    positionTableBody.innerHTML = positions.map(pos => {
        const profitClass = parseFloat(pos.profitRate) >= 0 ? 'positive' : 'negative';
        return `
            <tr>
                <td>${pos.symbol}</td>
                <td>${pos.name}</td>
                <td>${pos.quantity}</td>
                <td>¥${pos.avgPrice.toFixed(2)}</td>
                <td class="${parseFloat(pos.profitRate) >= 0 ? 'price-up' : 'price-down'}">¥${pos.currentPrice.toFixed(2)}</td>
                <td class="position-profit ${profitClass}">
                    ${pos.profit >= 0 ? '+' : ''}¥${pos.profit.toFixed(2)}
                </td>
                <td class="position-profit ${profitClass}">
                    ${pos.profitRate >= 0 ? '+' : ''}${pos.profitRate}%
                </td>
                <td>¥${pos.marketValue.toFixed(2)}</td>
                <td>
                    <button class="btn btn-sm btn-outline-primary" onclick="quickSell('${pos.symbol}', ${pos.quantity})">
                        <i class="fas fa-arrow-down"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
    
    updateSellPositionSelect();
}

// 更新卖出持仓选择
function updateSellPositionSelect() {
    const select = document.getElementById('sellPositionSelect');
    if (!select) return;
    
    select.innerHTML = '<option value="">请选择持仓</option>';
    
    if (currentSimulation && currentSimulation.positions) {
        Object.entries(currentSimulation.positions).forEach(([symbol, position]) => {
            const quantity = Math.abs(position.quantity || 0);
            if (quantity > 0) {
                const name = marketData[symbol]?.name || symbol;
                select.innerHTML += `<option value="${symbol}">${symbol} ${name} (${quantity}股)</option>`;
            }
        });
    }
}

// 快速卖出
function quickSell(symbol, quantity) {
    // 切换到卖出标签
    const sellTab = document.getElementById('sell-tab');
    if (sellTab) {
        sellTab.click();
    }
    
    // 设置卖出信息
    setTimeout(() => {
        document.getElementById('sellPositionSelect').value = symbol;
        loadSellPosition();
        document.getElementById('sellQuantity').value = quantity;
        calculateEstimatedAmount('sell');
    }, 100);
}

// 加载卖出持仓信息
function loadSellPosition() {
    const select = document.getElementById('sellPositionSelect');
    const symbol = select.value;
    
    if (!symbol || !currentSimulation || !currentSimulation.positions || !currentSimulation.positions[symbol]) {
        document.getElementById('sellSymbol').value = '';
        document.getElementById('sellAvailable').value = '';
        return;
    }
    
    const position = currentSimulation.positions[symbol];
    const quantity = Math.abs(position.quantity || 0);
    const currentPrice = getCurrentPrice(symbol) || position.avg_price || 0;
    
    document.getElementById('sellSymbol').value = symbol;
    document.getElementById('sellAvailable').value = quantity + ' 股';
    
    // 自动设置价格为现价
    document.getElementById('sellPrice').value = currentPrice.toFixed(2);
    calculateEstimatedAmount('sell');

    // 更新行情卡片
    const stock = marketData[symbol] || { name: symbol, latest_price: currentPrice };
    const priceDisplay = document.getElementById('quotePrice');
    const symbolDisplay = document.getElementById('quoteSymbol');
    const nameDisplay = document.getElementById('quoteName');
    const timeDisplay = document.getElementById('quoteTime');
    const bid1PriceEl = document.getElementById('quoteBid1Price');
    const bid1VolEl = document.getElementById('quoteBid1Volume');
    const ask1PriceEl = document.getElementById('quoteAsk1Price');
    const ask1VolEl = document.getElementById('quoteAsk1Volume');

    if (priceDisplay && symbolDisplay && nameDisplay && timeDisplay) {
        symbolDisplay.textContent = symbol;
        nameDisplay.textContent = stock.name || symbol;
        priceDisplay.textContent = '¥' + currentPrice.toFixed(2);
        priceDisplay.className = 'market-price ' + (currentPrice >= 0 ? 'price-up' : 'price-down');
        timeDisplay.textContent = new Date().toLocaleTimeString();
    }

    if (bid1PriceEl && bid1VolEl && ask1PriceEl && ask1VolEl) {
        bid1PriceEl.textContent = stock.bid1_price ? stock.bid1_price.toFixed(2) : '--';
        bid1VolEl.textContent = stock.bid1_quantity || '--';
        ask1PriceEl.textContent = stock.ask1_price ? stock.ask1_price.toFixed(2) : '--';
        ask1VolEl.textContent = stock.ask1_quantity || '--';
    }

    addIntradayPoint(currentPrice);
}

// 加载股票信息
async function loadStockInfo(type) {
    const symbolInput = document.getElementById(type === 'buy' ? 'buySymbol' : 'sellSymbol');
    const symbol = symbolInput.value.toUpperCase().trim();
    
    if (!symbol) return;
    
    // 模拟加载股票信息
    if (!marketData[symbol]) {
        // 这里应该调用实际的API获取股票信息
        marketData[symbol] = {
            symbol: symbol,
            name: symbol,
            latest_price: 10 + Math.random() * 5, // 模拟价格
            bid1_price: 0,
            ask1_price: 0
        };
    }
    
    const stock = marketData[symbol];
    const price = stock.latest_price || 0;
    
    // 更新左侧表单（保持简单）
    if (type === 'buy') {
        const buyPriceInput = document.getElementById('buyPrice');
        if (buyPriceInput && !buyPriceInput.value) {
            buyPriceInput.value = price.toFixed(2);
        }
        calculateEstimatedAmount('buy');
    } else {
        const sellPriceInput = document.getElementById('sellPrice');
        if (sellPriceInput && !sellPriceInput.value) {
            sellPriceInput.value = price.toFixed(2);
        }
        calculateEstimatedAmount('sell');
    }
    
    // 更新中间行情卡片（价格 & 买卖盘）
    const priceDisplay = document.getElementById('quotePrice');
    const symbolDisplay = document.getElementById('quoteSymbol');
    const nameDisplay = document.getElementById('quoteName');
    const timeDisplay = document.getElementById('quoteTime');
    const bid1PriceEl = document.getElementById('quoteBid1Price');
    const bid1VolEl = document.getElementById('quoteBid1Volume');
    const ask1PriceEl = document.getElementById('quoteAsk1Price');
    const ask1VolEl = document.getElementById('quoteAsk1Volume');
    
    if (priceDisplay && symbolDisplay && nameDisplay && timeDisplay) {
        symbolDisplay.textContent = symbol;
        nameDisplay.textContent = stock.name || symbol;
        priceDisplay.textContent = '¥' + price.toFixed(2);
        priceDisplay.className = 'market-price ' + (price >= 0 ? 'price-up' : 'price-down');
        timeDisplay.textContent = new Date().toLocaleTimeString();
    }

    if (bid1PriceEl && bid1VolEl && ask1PriceEl && ask1VolEl) {
        bid1PriceEl.textContent = stock.bid1_price ? stock.bid1_price.toFixed(2) : '--';
        bid1VolEl.textContent = stock.bid1_quantity || '--';
        ask1PriceEl.textContent = stock.ask1_price ? stock.ask1_price.toFixed(2) : '--';
        ask1VolEl.textContent = stock.ask1_quantity || '--';
    }

    // 更新分时图
    addIntradayPoint(price);
}

// 设置价格
function setPrice(type, priceType) {
    const symbol = type === 'buy' ? document.getElementById('buySymbol').value : document.getElementById('sellSymbol').value;
    if (!symbol) {
        showAlert('请先输入股票代码', 'warning');
        return;
    }
    
    const stock = marketData[symbol.toUpperCase()];
    if (!stock) {
        loadStockInfo(type);
        setTimeout(() => setPrice(type, priceType), 500);
        return;
    }
    
    let price = 0;
    if (priceType === 'current') {
        price = stock.latest_price || 0;
    } else if (priceType === 'bid1') {
        price = stock.bid1_price || stock.latest_price || 0;
    } else if (priceType === 'ask1') {
        price = stock.ask1_price || stock.latest_price || 0;
    }
    
    if (type === 'buy') {
        document.getElementById('buyPrice').value = price.toFixed(2);
        calculateEstimatedAmount('buy');
    } else {
        document.getElementById('sellPrice').value = price.toFixed(2);
        calculateEstimatedAmount('sell');
    }
}

// 设置数量
function setQuantity(type, quantity) {
    if (type === 'sell' && quantity === 'all') {
        const available = document.getElementById('sellAvailable').value;
        const qty = parseInt(available) || 0;
        document.getElementById('sellQuantity').value = qty;
    } else {
        const input = type === 'buy' ? document.getElementById('buyQuantity') : document.getElementById('sellQuantity');
        input.value = quantity;
    }
    calculateEstimatedAmount(type);
}

// 计算预计金额
function calculateEstimatedAmount(type) {
    const priceInput = type === 'buy' ? document.getElementById('buyPrice') : document.getElementById('sellPrice');
    const quantityInput = type === 'buy' ? document.getElementById('buyQuantity') : document.getElementById('sellQuantity');
    const amountElement = type === 'buy' ? document.getElementById('buyEstimatedAmount') : document.getElementById('sellEstimatedAmount');
    
    const price = parseFloat(priceInput.value) || 0;
    const quantity = parseInt(quantityInput.value) || 0;
    const amount = price * quantity;
    
    amountElement.textContent = '¥' + amount.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

// 提交买入订单
async function submitBuyOrder() {
    if (!currentSimulation) {
        showAlert('请先创建交易账户', 'warning');
        return;
    }
    
    if (currentSimulation.status !== 'running') {
        showAlert('账户未运行', 'warning');
        return;
    }
    
    const symbol = document.getElementById('buySymbol').value.toUpperCase().trim();
    const price = parseFloat(document.getElementById('buyPrice').value);
    const quantity = parseInt(document.getElementById('buyQuantity').value);
    
    if (!symbol || !price || !quantity || quantity < 100) {
        showAlert('请填写完整信息，数量至少100股', 'warning');
        return;
    }
    
    try {
        const response = await fetch(`/api/simulation/trade/${currentSimulation.id}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                symbol: symbol,
                action: 'buy',
                quantity: quantity,
                price: price
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('买入委托成功', 'success');
            document.getElementById('buyForm').reset();
            updateSimulationStatus();
        } else {
            showAlert(result.error || '买入失败', 'danger');
        }
    } catch (error) {
        console.error('Error submitting buy order:', error);
        showAlert('买入失败', 'danger');
    }
}

// 提交卖出订单
async function submitSellOrder() {
    if (!currentSimulation) {
        showAlert('请先创建交易账户', 'warning');
        return;
    }
    
    if (currentSimulation.status !== 'running') {
        showAlert('账户未运行', 'warning');
        return;
    }
    
    const symbol = document.getElementById('sellSymbol').value.toUpperCase().trim();
    const price = parseFloat(document.getElementById('sellPrice').value);
    const quantity = parseInt(document.getElementById('sellQuantity').value);
    
    if (!symbol || !price || !quantity || quantity < 100) {
        showAlert('请填写完整信息，数量至少100股', 'warning');
        return;
    }
    
    // 检查持仓
    if (!currentSimulation.positions || !currentSimulation.positions[symbol] || 
        Math.abs(currentSimulation.positions[symbol].quantity || 0) < quantity) {
        showAlert('持仓不足', 'warning');
        return;
    }
    
    try {
        const response = await fetch(`/api/simulation/trade/${currentSimulation.id}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                symbol: symbol,
                action: 'sell',
                quantity: quantity,
                price: price
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('卖出委托成功', 'success');
            document.getElementById('sellForm').reset();
            updateSimulationStatus();
        } else {
            showAlert(result.error || '卖出失败', 'danger');
        }
    } catch (error) {
        console.error('Error submitting sell order:', error);
        showAlert('卖出失败', 'danger');
    }
}

// 更新交易记录显示
function updateTradesDisplay() {
    const tradesTableBody = document.getElementById('tradesTableBody');
    if (!tradesTableBody) return;
    
    if (!currentSimulation || !currentSimulation.trades || currentSimulation.trades.length === 0) {
        tradesTableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">暂无成交</td></tr>';
        return;
    }
    
    trades = currentSimulation.trades.slice().reverse().slice(0, 50); // 只显示最近50条
    tradesTableBody.innerHTML = trades.map(trade => {
        const direction = trade.action === 'buy' ? '买入' : '卖出';
        const directionClass = trade.action === 'buy' ? 'price-up' : 'price-down';
        const amount = (trade.price || 0) * (trade.quantity || 0);
        return `
            <tr>
                <td>${trade.symbol || '--'}</td>
                <td class="${directionClass}">${direction}</td>
                <td>¥${(trade.price || 0).toFixed(2)}</td>
                <td>${trade.quantity || 0}</td>
                <td>¥${amount.toFixed(2)}</td>
                <td>${formatDateTime(trade.date || trade.timestamp)}</td>
            </tr>
        `;
    }).join('');
}

// 更新委托显示
function updateOrdersDisplay() {
    const ordersTableBody = document.getElementById('ordersTableBody');
    if (!ordersTableBody) return;
    
    // 简化处理：从交易记录生成委托记录
    if (!currentSimulation || !currentSimulation.trades || currentSimulation.trades.length === 0) {
        ordersTableBody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-3">暂无委托</td></tr>';
        return;
    }
    
    orders = currentSimulation.trades.slice().reverse().slice(0, 20).map(trade => ({
        id: trade.order_id || trade.id,
        symbol: trade.symbol,
        direction: trade.action === 'buy' ? '买入' : '卖出',
        price: trade.price || 0,
        quantity: trade.quantity || 0,
        traded_quantity: trade.quantity || 0,
        status: '全部成交',
        timestamp: trade.date || trade.timestamp
    }));
    
    ordersTableBody.innerHTML = orders.map(order => {
        const directionClass = order.direction === '买入' ? 'price-up' : 'price-down';
        return `
            <tr>
                <td>${order.symbol || '--'}</td>
                <td class="${directionClass}">${order.direction}</td>
                <td>¥${order.price.toFixed(2)}</td>
                <td>${order.quantity}</td>
                <td>${order.traded_quantity}</td>
                <td><span class="badge bg-success">${order.status}</span></td>
                <td>${formatDateTime(order.timestamp)}</td>
                <td>
                    <button class="btn btn-sm btn-outline-danger" onclick="cancelOrder('${order.id}')" disabled>
                        <i class="fas fa-times"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// 撤销委托
function cancelOrder(orderId) {
    showAlert('撤销功能待实现', 'info');
}

// 过滤委托
function filterOrders(type, button) {
    // 预留过滤逻辑
    updateOrdersDisplay();
}

// 切换数据视图：持仓 / 委托 / 成交
function switchDataView(type, button) {
    // 更新按钮状态
    document.querySelectorAll('.data-toggle-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    if (button) button.classList.add('active');

    // 切换视图显示
    document.querySelectorAll('.data-view').forEach(view => {
        view.classList.add('d-none');
    });
    const target = document.querySelector('.data-view-' + type);
    if (target) target.classList.remove('d-none');
}

// 刷新持仓
function refreshPositions() {
    if (currentSimulation) {
        updateSimulationStatus();
    }
}

// 刷新成交
function refreshTrades() {
    if (currentSimulation) {
        updateSimulationStatus();
    }
}

// 更新仿真显示
function updateSimulationDisplay() {
    if (!currentSimulation) return;
    
    updateAccountOverview();
    updatePositionsDisplay();
    updateTradesDisplay();
    updateOrdersDisplay();
    
    // 更新按钮状态
    const createBtn = document.getElementById('createAccountBtn');
    const stopBtn = document.getElementById('stopSimulationBtn');
    
    if (currentSimulation.status === 'running') {
        if (createBtn) createBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = false;
    } else {
        if (createBtn) createBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
    }
}

// 显示创建账户模态框
function showCreateAccount() {
    const modal = new bootstrap.Modal(document.getElementById('createAccountModal'));
    modal.show();
}

// 创建交易账户（纯手动交易，不选策略）
async function createAccount() {
    const initialCapital = document.getElementById('accountCapital').value;
    const commission = document.getElementById('accountCommission').value;
    const slippage = document.getElementById('accountSlippage').value;
    
    if (!initialCapital) {
        showAlert('请填写初始资金', 'warning');
        return;
    }
    
    try {
        const body = {
            initial_capital: parseFloat(initialCapital),
            commission: parseFloat(commission),
            slippage: parseFloat(slippage)
            // 不传 strategy_id，表示纯手动交易
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
            bootstrap.Modal.getInstance(document.getElementById('createAccountModal')).hide();
            currentSimulation = { id: result.simulation_id, status: 'running' };
            updateSimulationStatus();
        } else {
            showAlert(result.error || '创建失败', 'danger');
        }
    } catch (error) {
        console.error('Error creating account:', error);
        showAlert('创建失败', 'danger');
    }
}

// 关闭账户
async function stopSimulation() {
    if (!currentSimulation) {
        showAlert('没有运行中的账户', 'warning');
        return;
    }
    
    if (!confirm('确定要关闭交易账户吗？关闭后需要重新创建账户才能继续交易。')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/simulation/stop/${currentSimulation.id}`, {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('账户已关闭', 'success');
            currentSimulation.status = 'stopped';
            updateSimulationDisplay();
        } else {
            showAlert(result.error || '关闭失败', 'danger');
        }
    } catch (error) {
        console.error('Error stopping account:', error);
        showAlert('关闭失败', 'danger');
    }
}

// 更新仿真状态
async function updateSimulationStatus() {
    if (!currentSimulation || currentSimulation.id === 'demo') return;
    
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

// 已移除，使用 showCreateAccount 代替

// 显示警告消息
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

// 格式化日期时间
function formatDateTime(dateString) {
    if (!dateString) return '--:--:--';
    try {
    const date = new Date(dateString);
        if (isNaN(date.getTime())) return dateString;
        return date.toLocaleTimeString();
    } catch (e) {
        return dateString;
    }
}

// 页面卸载时清理定时器
window.addEventListener('beforeunload', function() {
    if (updateInterval) {
        clearInterval(updateInterval);
    }
});