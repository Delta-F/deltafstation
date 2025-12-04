// DeltaFStation 交易页面JavaScript

// 全局变量
let currentSimulation = null;
let updateInterval = null;
let orders = [];
let trades = [];
let marketData = {};
let intradayChart = null;
let intradayData = { times: [], prices: [] };
let logs = []; // 日志数组
let orderIdCounter = 10000000; // 委托号计数器
let tradeIdCounter = 10000000; // 成交号计数器
let marketUpdateInterval = null; // 行情更新定时器

// DOM 辅助函数已在 common.js 中定义

// 常量
const CONSTANTS = {
    MIN_QUANTITY: 100,
    QUANTITY_STEP: 100,
    SUPPORTED_STOCKS: ['601398.SH', '600036.SH'],
    BASE_ID: 10000000,
    MAX_TRADES_DISPLAY: 50,
    MAX_ORDERS_DISPLAY: 20,
    MAX_LOG_ENTRIES: 100
};

// renderEmptyState 已在 common.js 中定义

// 提取 ID 生成逻辑
function generateOrderId(trade, index, baseId = CONSTANTS.BASE_ID) {
    if (trade.order_id) {
        const num = parseInt(String(trade.order_id).match(/\d+/)?.[0] || 0);
        if (num >= CONSTANTS.BASE_ID && num <= 99999999) return num;
    }
    return baseId + index;
}

// 统一表单验证
function validateOrderForm(symbol, price, quantity, type = 'buy') {
    if (!symbol || !price || !quantity || quantity < CONSTANTS.MIN_QUANTITY) {
        showAlert('请填写完整信息，数量至少100股', 'warning');
        return false;
    }
    if (quantity % CONSTANTS.QUANTITY_STEP !== 0) {
        showAlert('数量必须是100的整数倍', 'warning');
        return false;
    }
    if (!CONSTANTS.SUPPORTED_STOCKS.includes(symbol)) {
        showAlert('模拟模式仅支持：工商银行(601398.SH) 或 招商银行(600036.SH)', 'warning');
        return false;
    }
    return true;
}

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
    
    // 启动模拟行情更新
    startMarketDataUpdate();
});

// 初始化交易界面
function initializeTradingInterface() {
    const buyPrice = $('buyPrice');
    const buyQuantity = $('buyQuantity');
    const sellPrice = $('sellPrice');
    const sellQuantity = $('sellQuantity');
    
    if (buyPrice && buyQuantity) {
        buyPrice.addEventListener('input', () => calculateEstimatedAmount('buy'));
        buyQuantity.addEventListener('input', () => calculateEstimatedAmount('buy'));
    }
    if (sellPrice && sellQuantity) {
        sellPrice.addEventListener('input', () => calculateEstimatedAmount('sell'));
        sellQuantity.addEventListener('input', () => calculateEstimatedAmount('sell'));
    }
    initializeIntradayChart();
}

// 初始化分时K线（简单折线图）
function initializeIntradayChart() {
    const canvas = $('intradayChart');
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
                    ticks: { 
                        maxTicksLimit: 8, 
                        font: { size: 9 },
                        maxRotation: 45,
                        minRotation: 45,
                        callback: function(value, index) {
                            const label = this.getLabelForValue(value);
                            return label || '';
                        }
                    }
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
    // 显示完整时间，格式：HH:MM:SS
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const label = `${hours}:${minutes}:${seconds}`;

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

    // 模拟行情数据：工商银行、招商银行
    marketData['601398.SH'] = {
        symbol: '601398.SH',
        name: '工商银行',
        latest_price: 5.85,
        open: 5.80,
        high: 5.92,
        low: 5.78,
        bid1_price: 5.84,
        bid1_quantity: 15000,
        ask1_price: 5.86,
        ask1_quantity: 12000,
        volume: 125000000,
        change: 0.05,
        changePercent: 0.86
    };
    
    marketData['600036.SH'] = {
        symbol: '600036.SH',
        name: '招商银行',
        latest_price: 42.58,
        open: 42.30,
        high: 42.88,
        low: 42.15,
        bid1_price: 42.56,
        bid1_quantity: 8000,
        ask1_price: 42.60,
        ask1_quantity: 7500,
        volume: 15600000,
        change: 0.28,
        changePercent: 0.66
    };

    // 生成多条模拟交易记录
    const now = new Date();
    const baseTime = now.getTime();
    const demoTrades = [];
    
    // 买入工商银行
    demoTrades.push({
        id: `trade_${tradeIdCounter++}`,
        order_id: `order_${orderIdCounter++}`,
        symbol: '601398.SH',
        action: 'buy',
        quantity: 1000,
        price: 5.80,
        date: new Date(baseTime - 600000).toISOString(),
        timestamp: new Date(baseTime - 600000).toISOString()
    });
    
    // 买入招商银行
    demoTrades.push({
        id: `trade_${tradeIdCounter++}`,
        order_id: `order_${orderIdCounter++}`,
        symbol: '600036.SH',
        action: 'buy',
        quantity: 200,
        price: 42.50,
        date: new Date(baseTime - 480000).toISOString(),
        timestamp: new Date(baseTime - 480000).toISOString()
    });
    
    // 卖出部分工商银行
    demoTrades.push({
        id: `trade_${tradeIdCounter++}`,
        order_id: `order_${orderIdCounter++}`,
        symbol: '601398.SH',
        action: 'sell',
        quantity: 500,
        price: 5.85,
        date: new Date(baseTime - 360000).toISOString(),
        timestamp: new Date(baseTime - 360000).toISOString()
    });
    
    // 再次买入工商银行
    demoTrades.push({
        id: `trade_${tradeIdCounter++}`,
        order_id: `order_${orderIdCounter++}`,
        symbol: '601398.SH',
        action: 'buy',
        quantity: 800,
        price: 5.82,
        date: new Date(baseTime - 240000).toISOString(),
        timestamp: new Date(baseTime - 240000).toISOString()
    });
    
    // 买入更多招商银行
    demoTrades.push({
        id: `trade_${tradeIdCounter++}`,
        order_id: `order_${orderIdCounter++}`,
        symbol: '600036.SH',
        action: 'buy',
        quantity: 100,
        price: 42.55,
        date: new Date(baseTime - 120000).toISOString(),
        timestamp: new Date(baseTime - 120000).toISOString()
    });
    
    // 计算持仓和资金
    let totalCost = 0;
    const positions = {};
    
    demoTrades.forEach(trade => {
        if (trade.action === 'buy') {
            const cost = trade.price * trade.quantity * 1.001; // 包含手续费
            totalCost += cost;
            
            if (!positions[trade.symbol]) {
                positions[trade.symbol] = { quantity: 0, avg_price: 0 };
            }
            const pos = positions[trade.symbol];
            const oldTotal = pos.quantity * pos.avg_price;
            const newTotal = trade.quantity * trade.price;
            pos.quantity += trade.quantity;
            pos.avg_price = (oldTotal + newTotal) / pos.quantity;
        } else if (trade.action === 'sell') {
            const revenue = trade.price * trade.quantity * 0.999; // 扣除手续费
            totalCost -= revenue;
            
            if (positions[trade.symbol]) {
                positions[trade.symbol].quantity -= trade.quantity;
                if (positions[trade.symbol].quantity <= 0) {
                    delete positions[trade.symbol];
                }
            }
        }
    });
    
    currentSimulation = {
        id: 'demo',
        status: 'running',
        initial_capital: 100000,
        current_capital: 100000 - totalCost,
        frozen_capital: 0,
        commission: 0.001,
        slippage: 0.0005,
        positions: positions,
        trades: demoTrades
    };
    
    // 初始化模拟日志数据（多条）
    logs = [
        { time: new Date(baseTime - 900000).toLocaleTimeString(), message: '系统初始化完成', api: '--' },
        { time: new Date(baseTime - 840000).toLocaleTimeString(), message: '创建交易账户: 初始资金 ¥100,000', api: '/api/simulation/start' },
        { time: new Date(baseTime - 600000).toLocaleTimeString(), message: '买入成交: 601398.SH 1000股 @ ¥5.80', api: '/api/simulation/trade/demo' },
        { time: new Date(baseTime - 480000).toLocaleTimeString(), message: '买入成交: 600036.SH 200股 @ ¥42.50', api: '/api/simulation/trade/demo' },
        { time: new Date(baseTime - 360000).toLocaleTimeString(), message: '卖出成交: 601398.SH 500股 @ ¥5.85', api: '/api/simulation/trade/demo' },
        { time: new Date(baseTime - 240000).toLocaleTimeString(), message: '买入成交: 601398.SH 800股 @ ¥5.82', api: '/api/simulation/trade/demo' },
        { time: new Date(baseTime - 120000).toLocaleTimeString(), message: '买入成交: 600036.SH 100股 @ ¥42.55', api: '/api/simulation/trade/demo' },
        { time: new Date(baseTime - 60000).toLocaleTimeString(), message: '账户状态更新成功', api: '/api/simulation/status/demo' }
    ];

    // 更新界面展示
    updateSimulationDisplay();
    updateLogDisplay();
    
    // 默认显示工商银行行情
    $('buySymbol').value = '601398.SH';
    loadStockInfo('buy');
}

// 启动模拟行情数据更新
function startMarketDataUpdate() {
    if (marketUpdateInterval) {
        clearInterval(marketUpdateInterval);
    }
    
    // 每2秒更新一次行情数据
    marketUpdateInterval = setInterval(() => {
        updateMarketData();
        const currentSymbol = $('quoteSymbol')?.textContent;
        if (currentSymbol && marketData[currentSymbol]) {
            updateQuoteDisplay(currentSymbol);
        }
    }, 2000);
}

// 更新模拟行情数据（价格小幅波动）
function updateMarketData() {
    Object.keys(marketData).forEach(symbol => {
        const stock = marketData[symbol];
        if (!stock) return;
        
        // 价格小幅随机波动（-0.02 到 +0.02）
        const priceChange = (Math.random() - 0.5) * 0.04;
        stock.latest_price = Math.max(0.01, stock.latest_price + priceChange);
        stock.latest_price = parseFloat(stock.latest_price.toFixed(2));
        
        // 更新买卖盘
        stock.bid1_price = parseFloat((stock.latest_price - 0.01).toFixed(2));
        stock.ask1_price = parseFloat((stock.latest_price + 0.01).toFixed(2));
        
        // 买卖盘量小幅变化
        stock.bid1_quantity = Math.max(100, stock.bid1_quantity + Math.floor((Math.random() - 0.5) * 2000));
        stock.ask1_quantity = Math.max(100, stock.ask1_quantity + Math.floor((Math.random() - 0.5) * 2000));
        
        // 更新涨跌
        const basePrice = symbol === '601398.SH' ? 5.80 : 42.30;
        stock.change = parseFloat((stock.latest_price - basePrice).toFixed(2));
        stock.changePercent = parseFloat(((stock.change / basePrice) * 100).toFixed(2));
        
        // 更新最高最低
        if (stock.latest_price > stock.high) stock.high = stock.latest_price;
        if (stock.latest_price < stock.low) stock.low = stock.latest_price;
    });
}

// 统一行情UI更新函数
function updateQuoteUI(stock) {
    if (!stock) return;
    
    const els = {
        symbol: $('quoteSymbol'),
        name: $('quoteName'),
        price: $('quotePrice'),
        time: $('quoteTime'),
        open: $('quoteOpen'),
        high: $('quoteHigh'),
        low: $('quoteLow'),
        change: $('quoteChange'),
        bid1Price: $('quoteBid1Price'),
        bid1Vol: $('quoteBid1Volume'),
        ask1Price: $('quoteAsk1Price'),
        ask1Vol: $('quoteAsk1Volume')
    };
    
    if (els.symbol) els.symbol.textContent = stock.symbol;
    if (els.name) els.name.textContent = stock.name;
    if (els.price) {
        els.price.textContent = '¥' + stock.latest_price.toFixed(2);
        els.price.className = 'market-price ' + (stock.change >= 0 ? 'price-up' : 'price-down');
    }
    if (els.time) els.time.textContent = new Date().toLocaleTimeString();
    if (els.open) els.open.textContent = stock.open ? '¥' + stock.open.toFixed(2) : '--';
    if (els.high) {
        els.high.textContent = stock.high ? '¥' + stock.high.toFixed(2) : '--';
        els.high.className = stock.high >= stock.open ? 'price-up' : 'price-down';
    }
    if (els.low) {
        els.low.textContent = stock.low ? '¥' + stock.low.toFixed(2) : '--';
        els.low.className = stock.low >= stock.open ? 'price-up' : 'price-down';
    }
    if (els.change) {
        const changeStr = (stock.change >= 0 ? '+' : '') + stock.change.toFixed(2) + 
                         ' (' + (stock.changePercent >= 0 ? '+' : '') + stock.changePercent.toFixed(2) + '%)';
        els.change.textContent = changeStr;
        els.change.className = stock.change >= 0 ? 'price-up' : 'price-down';
    }
    if (els.bid1Price) els.bid1Price.textContent = stock.bid1_price ? stock.bid1_price.toFixed(2) : '--';
    if (els.bid1Vol) els.bid1Vol.textContent = stock.bid1_quantity || '--';
    if (els.ask1Price) els.ask1Price.textContent = stock.ask1_price ? stock.ask1_price.toFixed(2) : '--';
    if (els.ask1Vol) els.ask1Vol.textContent = stock.ask1_quantity || '--';
    
    addIntradayPoint(stock.latest_price);
}

// 更新行情显示
function updateQuoteDisplay(symbol) {
    const stock = marketData[symbol];
    if (!stock) return;
    updateQuoteUI(stock);
}

// 更新账户总览
function updateAccountOverview() {
    if (!currentSimulation) {
        $('totalAssets').textContent = '¥0.00';
        $('availableCapital').textContent = '¥0.00';
        $('positionValue').textContent = '¥0.00';
        $('totalPnL').textContent = '¥0.00';
        $('totalReturn').textContent = '0.00%';
        return;
    }
    
    const initialCapital = currentSimulation.initial_capital || 100000;
    const currentCapital = currentSimulation.current_capital || initialCapital;
    const frozenCapital = currentSimulation.frozen_capital || 0;
    const available = currentCapital - frozenCapital;
    
    // 计算持仓市值
    let positionValue = 0;
    if (currentSimulation.positions) {
        Object.entries(currentSimulation.positions).forEach(([symbol, position]) => {
            const quantity = Math.abs(position.quantity || 0);
            const avgPrice = position.avg_price || 0;
            const currentPrice = getCurrentPrice(symbol) || avgPrice;
            positionValue += quantity * currentPrice;
        });
    }
    
    const totalAssets = available + positionValue;
    const totalPnL = totalAssets - initialCapital;
    const totalReturn = initialCapital > 0 ? ((totalPnL / initialCapital) * 100).toFixed(2) : '0.00';
    
    // 更新显示
    $('totalAssets').textContent = '¥' + totalAssets.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    $('availableCapital').textContent = '¥' + available.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    $('positionValue').textContent = '¥' + positionValue.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    
    const pnlEl = $('totalPnL');
    pnlEl.textContent = (totalPnL >= 0 ? '+' : '') + '¥' + totalPnL.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    pnlEl.className = 'account-value ' + (totalPnL >= 0 ? 'text-warning' : 'text-info');
    
    const returnEl = $('totalReturn');
    returnEl.textContent = (totalReturn >= 0 ? '+' : '') + totalReturn + '%';
    returnEl.className = 'account-value ' + (totalReturn >= 0 ? 'text-warning' : 'text-info');
    
    const statusEl = $('simulationStatus');
    if (currentSimulation.status === 'running') {
        statusEl.textContent = '运行中';
        statusEl.className = 'simulation-status running';
    } else {
        statusEl.textContent = '已关闭';
        statusEl.className = 'simulation-status stopped';
    }
    
    if ($('accountId')) $('accountId').textContent = 'df0001';
    if ($('brokerName')) $('brokerName').textContent = 'DeltaFStation';
    $('commissionDisplay').textContent = ((currentSimulation.commission || 0.001) * 100).toFixed(2) + '%';
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
    const positionTableBody = $('positionTableBody');
    if (!positionTableBody) return;
    
    if (!currentSimulation || !currentSimulation.positions || Object.keys(currentSimulation.positions).length === 0) {
        positionTableBody.innerHTML = renderEmptyState(9, 'fa-inbox', '暂无持仓');
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
                position: quantity, // 持仓数量
                avgPrice,
                currentPrice,
                profit,
                profitRate,
                marketValue
            });
        }
    });
    
    if (positions.length === 0) {
        positionTableBody.innerHTML = renderEmptyState(9, 'fa-inbox', '暂无持仓');
        updateSellPositionSelect();
        return;
    }
    
    positionTableBody.innerHTML = positions.map(pos => {
        const profitClass = parseFloat(pos.profitRate) >= 0 ? 'positive' : 'negative';
        return `
            <tr>
                <td>${pos.symbol}</td>
                <td>${pos.name}</td>
                <td>${pos.position}</td>
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
                    <button class="btn-action" onclick="quickSell('${pos.symbol}', ${pos.position})" title="卖出">
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
    const select = $('sellPositionSelect');
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
    const sellTab = $('sell-tab');
    if (sellTab) sellTab.click();
    setTimeout(() => {
        $('sellPositionSelect').value = symbol;
        loadSellPosition();
        $('sellQuantity').value = quantity;
        calculateEstimatedAmount('sell');
    }, 100);
}

// 加载卖出持仓信息
function loadSellPosition() {
    const select = $('sellPositionSelect');
    const symbol = select.value;
    
    if (!symbol || !currentSimulation || !currentSimulation.positions || !currentSimulation.positions[symbol]) {
        $('sellSymbol').value = '';
        $('sellAvailable').value = '';
        return;
    }
    
    const position = currentSimulation.positions[symbol];
    const quantity = Math.abs(position.quantity || 0);
    const currentPrice = getCurrentPrice(symbol) || position.avg_price || 0;
    
    $('sellSymbol').value = symbol;
    $('sellAvailable').value = quantity + ' 股';
    $('sellPrice').value = currentPrice.toFixed(2);
    calculateEstimatedAmount('sell');

    // 更新行情卡片
    const stock = marketData[symbol] || { symbol, name: symbol, latest_price: currentPrice };
    updateQuoteUI(stock);
}

// 加载股票信息
async function loadStockInfo(type) {
    const symbolInput = $(type === 'buy' ? 'buySymbol' : 'sellSymbol');
    const symbol = symbolInput.value.toUpperCase().trim();
    
    if (!symbol) return;
    
    if (!CONSTANTS.SUPPORTED_STOCKS.includes(symbol)) {
        showAlert('模拟模式仅支持：工商银行(601398.SH) 或 招商银行(600036.SH)', 'warning');
        return;
    }
    
    // 如果股票数据不存在，初始化
    if (!marketData[symbol]) {
        if (symbol === '601398.SH') {
            marketData[symbol] = {
                symbol: '601398.SH', name: '工商银行', latest_price: 5.85, open: 5.80, high: 5.92, low: 5.78,
                bid1_price: 5.84, bid1_quantity: 15000, ask1_price: 5.86, ask1_quantity: 12000
            };
        } else if (symbol === '600036.SH') {
            marketData[symbol] = {
                symbol: '600036.SH', name: '招商银行', latest_price: 42.58, open: 42.30, high: 42.88, low: 42.15,
                bid1_price: 42.56, bid1_quantity: 8000, ask1_price: 42.60, ask1_quantity: 7500
            };
        }
    }
    
    const stock = marketData[symbol];
    const price = stock.latest_price || 0;
    
    // 更新左侧表单
    if (type === 'buy') {
        const buyPriceInput = $('buyPrice');
        const buyNameInput = $('buyName');
        if (buyPriceInput && !buyPriceInput.value) buyPriceInput.value = price.toFixed(2);
        if (buyNameInput) buyNameInput.value = stock.name || symbol;
        calculateEstimatedAmount('buy');
    } else {
        const sellPriceInput = $('sellPrice');
        if (sellPriceInput && !sellPriceInput.value) sellPriceInput.value = price.toFixed(2);
        calculateEstimatedAmount('sell');
    }
    
    updateQuoteDisplay(symbol);
}

// 设置价格
function setPrice(type, priceType) {
    const symbol = (type === 'buy' ? $('buySymbol') : $('sellSymbol')).value;
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
    if (priceType === 'current') price = stock.latest_price || 0;
    else if (priceType === 'bid1') price = stock.bid1_price || stock.latest_price || 0;
    else if (priceType === 'ask1') price = stock.ask1_price || stock.latest_price || 0;
    
    $(type === 'buy' ? 'buyPrice' : 'sellPrice').value = price.toFixed(2);
    calculateEstimatedAmount(type);
}

// 设置数量
function setQuantity(type, quantity) {
    if (type === 'sell' && quantity === 'all') {
        const qty = parseInt($('sellAvailable').value) || 0;
        $('sellQuantity').value = qty;
    } else {
        $(type === 'buy' ? 'buyQuantity' : 'sellQuantity').value = quantity;
    }
    calculateEstimatedAmount(type);
}

// 计算预计金额
function calculateEstimatedAmount(type) {
    const price = parseFloat($(type === 'buy' ? 'buyPrice' : 'sellPrice').value) || 0;
    const quantity = parseInt($(type === 'buy' ? 'buyQuantity' : 'sellQuantity').value) || 0;
    const amount = price * quantity;
    $(type === 'buy' ? 'buyEstimatedAmount' : 'sellEstimatedAmount').textContent = 
        '¥' + amount.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

// 统一订单提交处理（买入/卖出）
async function submitOrder(type) {
    if (!currentSimulation) {
        showAlert('请先创建交易账户', 'warning');
        return;
    }
    if (currentSimulation.status !== 'running') {
        showAlert('账户未运行', 'warning');
        return;
    }
    
    const symbol = $(type === 'buy' ? 'buySymbol' : 'sellSymbol').value.toUpperCase().trim();
    const price = parseFloat($(type === 'buy' ? 'buyPrice' : 'sellPrice').value);
    const quantity = parseInt($(type === 'buy' ? 'buyQuantity' : 'sellQuantity').value);
    
    if (!validateOrderForm(symbol, price, quantity, type)) return;
    
    // 买入：检查资金；卖出：检查持仓
    if (type === 'buy') {
        const totalCost = price * quantity * (1 + currentSimulation.commission);
        if (currentSimulation.current_capital < totalCost) {
            showAlert('资金不足', 'warning');
            return;
        }
    } else {
        if (!currentSimulation.positions || !currentSimulation.positions[symbol] || 
            Math.abs(currentSimulation.positions[symbol].quantity || 0) < quantity) {
            showAlert('持仓不足', 'warning');
            return;
        }
    }
    
    // 创建交易记录
    const orderId = orderIdCounter++;
    const tradeId = tradeIdCounter++;
    const now = new Date().toISOString();
    const trade = {
        id: `trade_${tradeId}`,
        order_id: `order_${orderId}`,
        symbol, action: type, quantity, price, date: now, timestamp: now
    };
    
    if (!currentSimulation.trades) currentSimulation.trades = [];
    currentSimulation.trades.push(trade);
    
    // 更新持仓
    if (!currentSimulation.positions) currentSimulation.positions = {};
    
    if (type === 'buy') {
        if (!currentSimulation.positions[symbol]) {
            currentSimulation.positions[symbol] = { quantity: 0, avg_price: 0 };
        }
        const pos = currentSimulation.positions[symbol];
        const totalQuantity = pos.quantity + quantity;
        pos.avg_price = (pos.quantity * pos.avg_price + quantity * price) / totalQuantity;
        pos.quantity = totalQuantity;
        currentSimulation.current_capital -= price * quantity * (1 + currentSimulation.commission);
    } else {
        const pos = currentSimulation.positions[symbol];
        pos.quantity -= quantity;
        if (pos.quantity <= 0) delete currentSimulation.positions[symbol];
        const revenue = price * quantity;
        currentSimulation.current_capital += revenue * (1 - currentSimulation.commission);
    }
    
    // 更新显示
    showAlert(`${type === 'buy' ? '买入' : '卖出'}成交成功`, 'success');
    addLog(`${type === 'buy' ? '买入' : '卖出'}成交: ${symbol} ${quantity}股 @ ¥${price.toFixed(2)}`, 
           `/api/simulation/trade/${currentSimulation.id}`);
    $(type === 'buy' ? 'buyForm' : 'sellForm').reset();
    updateSimulationDisplay();
}

// 提交买入订单
async function submitBuyOrder() {
    await submitOrder('buy');
}

// 提交卖出订单
async function submitSellOrder() {
    await submitOrder('sell');
}

// 更新交易记录显示
function updateTradesDisplay() {
    const tradesTableBody = $('tradesTableBody');
    if (!tradesTableBody) return;
    
    if (!currentSimulation || !currentSimulation.trades || currentSimulation.trades.length === 0) {
        tradesTableBody.innerHTML = renderEmptyState(9, 'fa-check-circle', '暂无成交');
        return;
    }
    
    trades = currentSimulation.trades.slice().reverse().slice(0, CONSTANTS.MAX_TRADES_DISPLAY);
    tradesTableBody.innerHTML = trades.map((trade, index) => {
        const direction = trade.action === 'buy' ? '买入' : '卖出';
        const directionClass = trade.action === 'buy' ? 'buy' : 'sell';
        const amount = (trade.price || 0) * (trade.quantity || 0);
        const tradeIdNum = CONSTANTS.BASE_ID + (trades.length - index - 1);
        const orderIdNum = generateOrderId(trade, trades.length - index - 1);
        const symbol = trade.symbol || '--';
        const name = marketData[symbol]?.name || symbol;
        return `
            <tr>
                <td>${tradeIdNum.toString().padStart(8, '0')}</td>
                <td>${orderIdNum.toString().padStart(8, '0')}</td>
                <td>${symbol}</td>
                <td>${name}</td>
                <td><span class="direction-badge ${directionClass}">${direction}</span></td>
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
    const ordersTableBody = $('ordersTableBody');
    if (!ordersTableBody) return;
    
    if (!currentSimulation || !currentSimulation.trades || currentSimulation.trades.length === 0) {
        ordersTableBody.innerHTML = renderEmptyState(10, 'fa-list-alt', '暂无委托');
        return;
    }
    
    const reversedTrades = currentSimulation.trades.slice().reverse().slice(0, CONSTANTS.MAX_ORDERS_DISPLAY);
    orders = reversedTrades.map((trade, index) => {
        const orderIdNum = generateOrderId(trade, reversedTrades.length - index - 1);
        return {
            id: orderIdNum.toString().padStart(8, '0'),
            originalId: trade.order_id || trade.id || '',
            symbol: trade.symbol,
            name: marketData[trade.symbol]?.name || trade.symbol,
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
                <td>${order.id}</td>
                <td>${order.symbol || '--'}</td>
                <td>${order.name || '--'}</td>
                <td><span class="direction-badge ${directionClass}">${order.direction}</span></td>
                <td>¥${order.price.toFixed(2)}</td>
                <td>${order.quantity}</td>
                <td>${order.traded_quantity}</td>
                <td><span class="order-status filled">${order.status}</span></td>
                <td>${formatDateTime(order.timestamp)}</td>
                <td>
                    <button class="btn-action" onclick="cancelOrder('${order.originalId || order.id}')" title="撤销">
                        <i class="fas fa-times"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// 撤销委托（模拟模式）
function cancelOrder(orderId) {
    if (!currentSimulation || !currentSimulation.trades) {
        showAlert('没有可撤销的委托', 'warning');
        return;
    }
    
    const orderIdStr = String(orderId);
    
    // 查找对应的交易记录
    const tradeIndex = currentSimulation.trades.findIndex(t => {
        const tid = String(t.order_id || t.id || '');
        return tid === orderIdStr || tid.includes(orderIdStr) || orderIdStr.includes(tid);
    });
    
    if (tradeIndex === -1) {
        showAlert('委托不存在', 'warning');
        return;
    }
    
    const trade = currentSimulation.trades[tradeIndex];
    
    // 撤销交易：如果是买入，退回资金并减少持仓；如果是卖出，恢复持仓
    if (trade.action === 'buy') {
        // 退回资金
        const cost = trade.price * trade.quantity;
        const commission = cost * currentSimulation.commission;
        currentSimulation.current_capital += (cost + commission);
        
        // 减少持仓
        if (currentSimulation.positions && currentSimulation.positions[trade.symbol]) {
            const pos = currentSimulation.positions[trade.symbol];
            pos.quantity -= trade.quantity;
            if (pos.quantity <= 0) {
                delete currentSimulation.positions[trade.symbol];
            }
        }
        
        showAlert('撤销买入委托成功，已退回资金', 'success');
        addLog(`撤销买入: ${trade.symbol} ${trade.quantity}股 @ ¥${trade.price.toFixed(2)}`, '/api/simulation/cancel');
    } else if (trade.action === 'sell') {
        // 恢复持仓
        if (!currentSimulation.positions) {
            currentSimulation.positions = {};
        }
        if (!currentSimulation.positions[trade.symbol]) {
            currentSimulation.positions[trade.symbol] = { quantity: 0, avg_price: trade.price };
        }
        
        const pos = currentSimulation.positions[trade.symbol];
        pos.quantity += trade.quantity;
        // 重新计算平均成本（简化处理，使用原成本价）
        if (pos.avg_price === 0) {
            pos.avg_price = trade.price;
        }
        
        // 扣除资金
        const revenue = trade.price * trade.quantity;
        const commission = revenue * currentSimulation.commission;
        currentSimulation.current_capital -= (revenue - commission);
        
        showAlert('撤销卖出委托成功，已恢复持仓', 'success');
        addLog(`撤销卖出: ${trade.symbol} ${trade.quantity}股 @ ¥${trade.price.toFixed(2)}`, '/api/simulation/cancel');
    }
    
    // 从交易记录中移除
    currentSimulation.trades.splice(tradeIndex, 1);
    
    // 更新显示
    updateOrdersDisplay();
    updateSimulationDisplay();
}

// 切换数据视图：持仓 / 委托 / 成交
function switchDataView(type, button) {
    // 更新按钮状态 - 所有视图切换按钮在同一父容器下
    const buttonContainer = button ? button.parentElement : null;
    if (buttonContainer) {
        const allButtons = buttonContainer.querySelectorAll('button');
        allButtons.forEach(btn => {
            btn.classList.remove('active');
        });
        if (button) {
            button.classList.add('active');
        }
    }

    // 切换视图显示
    document.querySelectorAll('.data-view').forEach(view => {
        view.classList.add('d-none');
    });
    const target = document.querySelector('.data-view-' + type);
    if (target) target.classList.remove('d-none');
}

// 更新仿真显示
function updateSimulationDisplay() {
    if (!currentSimulation) return;
    
    updateAccountOverview();
    updatePositionsDisplay();
    updateTradesDisplay();
    updateOrdersDisplay();
    
    const createBtn = $('createAccountBtn');
    const stopBtn = $('stopSimulationBtn');
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
    new bootstrap.Modal($('createAccountModal')).show();
}

// 创建交易账户（纯手动交易，不选策略）
async function createAccount() {
    const initialCapital = $('accountCapital').value;
    const commission = $('accountCommission').value;
    const slippage = $('accountSlippage').value;
    
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
            addLog(`创建交易账户: 初始资金 ¥${parseFloat(initialCapital).toLocaleString()}`, '/api/simulation/start');
            bootstrap.Modal.getInstance($('createAccountModal')).hide();
            currentSimulation = { id: result.simulation_id, status: 'running' };
            updateSimulationStatus();
        } else {
            showAlert(result.error || '创建失败', 'danger');
            addLog(`创建账户失败: ${result.error || '未知错误'}`, '/api/simulation/start');
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
            addLog('关闭交易账户', `/api/simulation/stop/${currentSimulation.id}`);
            currentSimulation.status = 'stopped';
            updateSimulationDisplay();
        } else {
            showAlert(result.error || '关闭失败', 'danger');
            addLog(`关闭账户失败: ${result.error || '未知错误'}`, `/api/simulation/stop/${currentSimulation.id}`);
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

// showAlert 和 formatDateTime 已在 common.js 中定义

// 添加日志
function addLog(message, api = '') {
    const now = new Date();
    const time = now.toLocaleTimeString();
    logs.unshift({ time, message, api }); // 新日志添加到开头
    
    if (logs.length > CONSTANTS.MAX_LOG_ENTRIES) {
        logs = logs.slice(0, CONSTANTS.MAX_LOG_ENTRIES);
    }
    
    updateLogDisplay();
}

// 获取日志颜色类型
function getLogColorType(message) {
    if (message.includes('买入')) {
        return 'buy'; // 买入相关 - 绿色
    } else if (message.includes('卖出')) {
        return 'sell'; // 卖出相关 - 红色
    } else {
        return 'info'; // 其他操作 - 蓝色
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
    
    logTableBody.innerHTML = logs.map(log => {
        const colorType = getLogColorType(log.message);
        let colorClass = '';
        if (colorType === 'buy') {
            colorClass = 'log-buy';
        } else if (colorType === 'sell') {
            colorClass = 'log-sell';
        } else {
            colorClass = 'log-info';
        }
        return `
            <tr>
                <td style="font-size: 11px; white-space: nowrap;">${log.time}</td>
                <td class="${colorClass}" style="font-size: 11px; word-break: break-word;">${log.message}</td>
            </tr>
        `;
    }).join('');
}

// 清空日志
function clearLogs() {
    logs = [];
    updateLogDisplay();
}

// 页面卸载时清理定时器
window.addEventListener('beforeunload', function() {
    if (updateInterval) {
        clearInterval(updateInterval);
    }
});