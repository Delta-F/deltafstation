// DeltaFStation 交易页面JavaScript

// 全局变量
let currentSimulation = null;
let updateInterval = null;
let orders = [];
let trades = [];
let marketData = {};
let intradayChart = null;
let dailyChartCanvas = null;
let dailyChartCtx = null;
let intradayData = { times: [], prices: [] };
let dailyData = { dates: [], candles: [] }; // candles: [{date, open, high, low, close}]
let currentChartType = 'intraday'; // 'intraday' 或 'daily'
let logs = []; // 日志数组
let orderIdCounter = 10000000; // 委托号计数器
let tradeIdCounter = 10000000; // 成交号计数器
let marketUpdateInterval = null; // 行情更新定时器
let currentIndicator = 'ma'; // 当前选中的技术指标：'ma' 或 'boll'

// DOM 辅助函数已在 common.js 中定义

// 常量
const CONSTANTS = {
    MIN_QUANTITY: 100,
    QUANTITY_STEP: 100,
    SUPPORTED_STOCKS: ['000001.SS', '600036.SS'],
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
        showAlert('模拟模式仅支持：上证指数(000001.SS) 或 招商银行(600036.SS)', 'warning');
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
    
    // 初始化日K图（K线图，使用Canvas手动绘制）
    const dailyCanvas = $('dailyChart');
    if (dailyCanvas) {
        dailyChartCanvas = dailyCanvas;
        dailyChartCtx = dailyCanvas.getContext('2d');
    }
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
    marketData['000001.SS'] = {
        symbol: '000001.SS',
        name: '上证指数',
        latest_price: 3150.00,
        open: 3140.00,
        high: 3165.00,
        low: 3135.00,
        bid1_price: 3149.50,
        bid1_quantity: 100000,
        ask1_price: 3150.50,
        ask1_quantity: 80000,
        volume: 500000000,
        change: 10.00,
        changePercent: 0.32
    };
    
    marketData['600036.SS'] = {
        symbol: '600036.SS',
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
    
    // 买入上证指数
    demoTrades.push({
        id: `trade_${tradeIdCounter++}`,
        order_id: `order_${orderIdCounter++}`,
        symbol: '000001.SS',
        action: 'buy',
        quantity: 100,
        price: 3140.00,
        date: new Date(baseTime - 600000).toISOString(),
        timestamp: new Date(baseTime - 600000).toISOString()
    });
    
    // 买入招商银行
    demoTrades.push({
        id: `trade_${tradeIdCounter++}`,
        order_id: `order_${orderIdCounter++}`,
        symbol: '600036.SS',
        action: 'buy',
        quantity: 2000,
        price: 42.50,
        date: new Date(baseTime - 480000).toISOString(),
        timestamp: new Date(baseTime - 480000).toISOString()
    });
    
    // 卖出部分上证指数
    demoTrades.push({
        id: `trade_${tradeIdCounter++}`,
        order_id: `order_${orderIdCounter++}`,
        symbol: '000001.SS',
        action: 'sell',
        quantity: 50,
        price: 3155.00,
        date: new Date(baseTime - 360000).toISOString(),
        timestamp: new Date(baseTime - 360000).toISOString()
    });
    
    // 再次买入上证指数
    demoTrades.push({
        id: `trade_${tradeIdCounter++}`,
        order_id: `order_${orderIdCounter++}`,
        symbol: '000001.SS',
        action: 'buy',
        quantity: 80,
        price: 3145.00,
        date: new Date(baseTime - 240000).toISOString(),
        timestamp: new Date(baseTime - 240000).toISOString()
    });
    
    // 买入更多招商银行
    demoTrades.push({
        id: `trade_${tradeIdCounter++}`,
        order_id: `order_${orderIdCounter++}`,
        symbol: '600036.SS',
        action: 'buy',
        quantity: 1000,
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
    
    // 调整价格以实现约18%的收益率
    // 计算所需的价格调整以达到约18%的收益率
    const initialCapital = 1000000;
    // 计算目标总资产（18%收益率）
    const targetReturn = 0.182; // 18.2%的收益率
    const targetTotalAssets = initialCapital * (1 + targetReturn); // 1,182,000
    
    // 估算当前持仓市值（基于平均成本价）
    let estimatedPositionValue = 0;
    Object.entries(positions).forEach(([symbol, position]) => {
        const quantity = Math.abs(position.quantity || 0);
        const avgPrice = position.avg_price || 0;
        estimatedPositionValue += quantity * avgPrice;
    });
    
    // 计算所需的价格涨幅倍数
    const availableCapital = initialCapital - totalCost;
    const targetPositionValue = targetTotalAssets - availableCapital;
    const priceMultiplier = estimatedPositionValue > 0 ? targetPositionValue / estimatedPositionValue : 1.18;
    
    // 调整市场价格
    if (marketData['000001.SS'] && positions['000001.SS']) {
        const avgPrice = positions['000001.SS'].avg_price || 5.81;
        marketData['000001.SS'].latest_price = parseFloat((avgPrice * priceMultiplier).toFixed(2));
        // 同时更新其他价格字段以保持一致性
        marketData['000001.SS'].bid1_price = parseFloat((marketData['000001.SS'].latest_price - 0.01).toFixed(2));
        marketData['000001.SS'].ask1_price = parseFloat((marketData['000001.SS'].latest_price + 0.01).toFixed(2));
    }
    if (marketData['600036.SS'] && positions['600036.SS']) {
        const avgPrice = positions['600036.SS'].avg_price || 42.52;
        marketData['600036.SS'].latest_price = parseFloat((avgPrice * priceMultiplier).toFixed(2));
        marketData['600036.SS'].bid1_price = parseFloat((marketData['600036.SS'].latest_price - 0.04).toFixed(2));
        marketData['600036.SS'].ask1_price = parseFloat((marketData['600036.SS'].latest_price + 0.04).toFixed(2));
    }
    
    currentSimulation = {
        id: 'demo',
        status: 'running',
        initial_capital: initialCapital,
        current_capital: initialCapital - totalCost,
        frozen_capital: 0,
        commission: 0.001,
        slippage: 0.0005,
        positions: positions,
        trades: demoTrades
    };
    
    // 初始化模拟日志数据（多条）
    logs = [
        { time: new Date(baseTime - 900000).toLocaleTimeString(), message: '系统初始化完成', api: '--' },
        { time: new Date(baseTime - 840000).toLocaleTimeString(), message: '创建交易账户: 初始资金 ¥1,000,000', api: '/api/simulations' },
        { time: new Date(baseTime - 600000).toLocaleTimeString(), message: '买入成交: 000001.SS 100股 @ ¥3140.00', api: '/api/simulations/demo/trades' },
        { time: new Date(baseTime - 480000).toLocaleTimeString(), message: '买入成交: 600036.SS 2000股 @ ¥42.50', api: '/api/simulations/demo/trades' },
        { time: new Date(baseTime - 360000).toLocaleTimeString(), message: '卖出成交: 000001.SS 50股 @ ¥3155.00', api: '/api/simulations/demo/trades' },
        { time: new Date(baseTime - 240000).toLocaleTimeString(), message: '买入成交: 000001.SS 80股 @ ¥3145.00', api: '/api/simulations/demo/trades' },
        { time: new Date(baseTime - 120000).toLocaleTimeString(), message: '买入成交: 600036.SS 1000股 @ ¥42.55', api: '/api/simulations/demo/trades' },
        { time: new Date(baseTime - 60000).toLocaleTimeString(), message: '账户状态更新成功', api: '/api/simulations/demo' }
    ];

    // 更新界面展示
    updateSimulationDisplay();
    updateLogDisplay();
    
    // 默认显示上证指数行情
    $('buySymbol').value = '000001.SS';
    loadStockInfo('buy');
}

// 启动市场行情数据更新
function startMarketDataUpdate() {
    if (marketUpdateInterval) {
        clearInterval(marketUpdateInterval);
    }
    
    // 立即执行一次
    updateMarketData().then(() => {
        const currentSymbol = $('quoteSymbol')?.textContent;
        if (currentSymbol) updateQuoteDisplay(currentSymbol);
    });

    // 每 5 秒更新一次行情数据 (YFinance 轮询建议不要太频繁)
    marketUpdateInterval = setInterval(async () => {
        await updateMarketData();
        const currentSymbol = $('quoteSymbol')?.textContent;
        if (currentSymbol && marketData[currentSymbol]) {
            updateQuoteDisplay(currentSymbol);
        }
    }, 5000);
}

// 从后端 API 获取实时行情数据
async function updateMarketData() {
    const symbols = Object.keys(marketData);
    
    // 我们只更新当前显示的股票，或者所有已关注的股票
    // 为了性能，这里我们并行请求所有已关注股票的最新价格
    const updatePromises = symbols.map(async (symbol) => {
        try {
            const response = await fetch(`/api/data/quotes/${symbol}`);
            if (!response.ok) {
                if (response.status === 404) {
                    console.warn(`Quote for ${symbol} not yet available from YFinance.`);
                }
                return;
            }
            
            const data = await response.json();
            if (data && !data.error) {
                const stock = marketData[symbol];
                
                // 更新实时价格和基本信息
                stock.latest_price = data.price;
                stock.timestamp = data.timestamp;
                
                // 更新开高低
                if (data.open) stock.open = data.open;
                if (data.high) stock.high = data.high;
                if (data.low) stock.low = data.low;
                
                // 计算涨跌幅
                // 优先使用 prev_close，如果没有则使用 hardcoded basePrice
                const prevClose = data.prev_close || (symbol === '000001.SS' ? 5.80 : 42.30);
                stock.change = parseFloat((stock.latest_price - prevClose).toFixed(2));
                stock.changePercent = parseFloat(((stock.change / prevClose) * 100).toFixed(2));
                
                // 如果是当前正在查看的股票，同步更新 UI
                const currentSymbol = $('quoteSymbol')?.textContent;
                if (currentSymbol === symbol) {
                    updateQuoteUI(stock);
                }
            }
        } catch (error) {
            console.error(`Failed to fetch live data for ${symbol}:`, error);
        }
    });

    await Promise.all(updatePromises);
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
        change: $('quoteChange')
    };
    
    if (els.symbol) els.symbol.textContent = stock.symbol;
    if (els.name) els.name.textContent = stock.name;
    if (els.price) {
        els.price.textContent = '¥' + stock.latest_price.toFixed(2);
        els.price.className = 'market-price ' + (stock.change >= 0 ? 'price-up' : 'price-down');
    }
    if (els.time) els.time.textContent = formatTime(new Date());
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
    
    updateQuoteBoard(stock);
    addIntradayPoint(stock.latest_price);
}

// 更新盘口（买5卖5）
function updateQuoteBoard(stock) {
    const currentPrice = stock.latest_price || 0;
    const spread = 0.01;
    
    for (let i = 1; i <= 5; i++) {
        const bidEl = $('quoteBid' + i);
        if (bidEl) {
            const price = currentPrice - spread * i;
            const volume = Math.floor(Math.random() * 5000 + 5000);
            const priceEl = bidEl.querySelector('.price');
            const volEl = bidEl.querySelector('.vol');
            if (priceEl) priceEl.textContent = price.toFixed(2);
            if (volEl) volEl.textContent = volume.toLocaleString();
        }
        const askEl = $('quoteAsk' + i);
        if (askEl) {
            const price = currentPrice + spread * i;
            const volume = Math.floor(Math.random() * 5000 + 5000);
            const priceEl = askEl.querySelector('.price');
            const volEl = askEl.querySelector('.vol');
            if (priceEl) priceEl.textContent = price.toFixed(2);
            if (volEl) volEl.textContent = volume.toLocaleString();
        }
    }
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
    
    const initialCapital = currentSimulation.initial_capital || 1000000;
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
    
    // 显示账户ID（如果是demo账户，显示简化ID）
    if ($('accountId')) {
        const accountId = currentSimulation.id;
        if (accountId === 'demo' || accountId.startsWith('demo_')) {
            $('accountId').textContent = 'demo';
        } else {
            // 尝试从ID中提取数字部分，或使用默认值
            const idMatch = accountId.match(/\d+/);
            $('accountId').textContent = idMatch ? 'df' + idMatch[0].padStart(4, '0') : accountId;
        }
    }
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
        showAlert('模拟模式仅支持：上证指数(000001.SS) 或 招商银行(600036.SS)', 'warning');
        return;
    }
    
    // 如果股票数据不存在，初始化
    if (!marketData[symbol]) {
        if (symbol === '000001.SS') {
            marketData[symbol] = {
                symbol: '000001.SS', name: '上证指数', latest_price: 3150.00, open: 3140.00, high: 3165.00, low: 3135.00,
                bid1_price: 3149.50, bid1_quantity: 100000, ask1_price: 3150.50, ask1_quantity: 80000
            };
        } else if (symbol === '600036.SS') {
            marketData[symbol] = {
                symbol: '600036.SS', name: '招商银行', latest_price: 42.58, open: 42.30, high: 42.88, low: 42.15,
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
    const currentPrice = stock.latest_price || 0;
    const spread = 0.01;
    
    if (priceType === 'current') {
        price = currentPrice;
    } else if (priceType === 'bid1') {
        // 买1价 = 现价 - 最小价差
        price = currentPrice - spread;
    } else if (priceType === 'ask1') {
        // 卖1价 = 现价 + 最小价差
        price = currentPrice + spread;
    }
    
    $(type === 'buy' ? 'buyPrice' : 'sellPrice').value = price.toFixed(2);
    calculateEstimatedAmount(type);
}

// 设置数量
function setQuantity(type, val, isPercent = false) {
    let quantity = 0;
    
    if (isPercent) {
        if (type === 'buy') {
            const price = parseFloat($('buyPrice').value) || 0;
            if (price <= 0) {
                showAlert('请先输入买入价格', 'warning');
                return;
            }
            // 考虑手续费
            const available = currentSimulation ? currentSimulation.current_capital : 0;
            const maxQty = Math.floor(available / (price * (1 + (currentSimulation ? currentSimulation.commission : 0.001))));
            quantity = Math.floor((maxQty * val) / 100) * 100; // 100股整数倍
        } else {
            const available = parseInt($('sellAvailable').value) || 0;
            quantity = Math.floor((available * val) / 100) * 100;
        }
    } else if (type === 'sell' && val === 'all') {
        quantity = parseInt($('sellAvailable').value) || 0;
    } else {
        quantity = val;
    }
    
    $(type === 'buy' ? 'buyQuantity' : 'sellQuantity').value = quantity;
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
           `/api/simulations/${currentSimulation.id}/trades`);
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
    
    const initialCapitalNum = parseFloat(initialCapital);
    const commissionNum = parseFloat(commission) || 0.001;
    const slippageNum = parseFloat(slippage) || 0.0005;
    
    if (isNaN(initialCapitalNum) || initialCapitalNum <= 0) {
        showAlert('初始资金必须大于0', 'warning');
        return;
    }
    
    try {
        const body = {
            initial_capital: initialCapitalNum,
            commission: commissionNum,
            slippage: slippageNum
            // 不传 strategy_id，表示纯手动交易
        };
        
        const { ok, data: result } = await apiRequest('/api/simulations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        
        // 无论API是否成功，都创建模拟账户以展示功能
        const simulationId = ok ? result.simulation_id : 'demo_' + Date.now();
        
        // 完整初始化账户对象
        currentSimulation = {
            id: simulationId,
            status: 'running',
            initial_capital: initialCapitalNum,
            current_capital: initialCapitalNum,
            available_capital: initialCapitalNum,
            frozen_capital: 0,
            commission: commissionNum,
            slippage: slippageNum,
            positions: {},
            orders: [],
            trades: [],
            created_at: new Date().toISOString()
        };
        
        if (ok) {
            showAlert('交易账户创建成功', 'success');
            addLog(`创建交易账户: 初始资金 ¥${initialCapitalNum.toLocaleString()}`, '/api/simulations');
            // 尝试从服务器获取完整信息
            updateSimulationStatus();
        } else {
            // 模拟模式：即使API失败也创建账户
            showAlert('交易账户创建成功（模拟模式）', 'success');
            addLog(`创建交易账户（模拟）: 初始资金 ¥${initialCapitalNum.toLocaleString()}`, '/api/simulations');
        }
        
        bootstrap.Modal.getInstance($('createAccountModal')).hide();
        updateSimulationDisplay();
        
    } catch (error) {
        console.error('Error creating account:', error);
        // 即使出错也创建模拟账户
        const initialCapitalNum = parseFloat(initialCapital);
        const commissionNum = parseFloat(commission) || 0.001;
        const slippageNum = parseFloat(slippage) || 0.0005;
        
        currentSimulation = {
            id: 'demo_' + Date.now(),
            status: 'running',
            initial_capital: initialCapitalNum,
            current_capital: initialCapitalNum,
            available_capital: initialCapitalNum,
            frozen_capital: 0,
            commission: commissionNum,
            slippage: slippageNum,
            positions: {},
            orders: [],
            trades: [],
            created_at: new Date().toISOString()
        };
        
        showAlert('交易账户创建成功（模拟模式）', 'success');
        addLog(`创建交易账户（模拟）: 初始资金 ¥${initialCapitalNum.toLocaleString()}`, '/api/simulations');
        bootstrap.Modal.getInstance($('createAccountModal')).hide();
        updateSimulationDisplay();
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
    
    const simulationId = currentSimulation.id;
    const isDemo = simulationId === 'demo' || simulationId.startsWith('demo_');
    
    try {
        // 如果是真实账户，尝试调用API
        if (!isDemo) {
            const { ok, data: result } = await apiRequest(`/api/simulations/${simulationId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ status: 'stopped' })
            });
            
            if (ok) {
                showAlert('账户已关闭', 'success');
                addLog('关闭交易账户', `/api/simulations/${simulationId}`);
            } else {
                // API失败时仍执行本地关闭
                showAlert('账户已关闭（本地）', 'success');
                addLog(`关闭交易账户（本地）`, `/api/simulations/${simulationId}`);
            }
        } else {
            showAlert('账户已关闭', 'success');
            addLog('关闭交易账户（模拟）', 'local');
        }
        
        // 更新状态为已关闭
        currentSimulation.status = 'stopped';
        updateSimulationDisplay();
        
        // 可选：完全清除账户（如果需要重新创建）
        // 如果希望关闭后完全清除，取消下面的注释
        // currentSimulation = null;
        // updateSimulationDisplay();
        
    } catch (error) {
        console.error('Error stopping account:', error);
        // 即使出错也执行本地关闭
        currentSimulation.status = 'stopped';
        showAlert('账户已关闭（本地）', 'success');
        addLog('关闭交易账户（本地）', 'local');
        updateSimulationDisplay();
    }
}

// 更新仿真状态
async function updateSimulationStatus() {
    if (!currentSimulation) return;
    
    const simulationId = currentSimulation.id;
    const isDemo = simulationId === 'demo' || simulationId.startsWith('demo_');
    
    // 如果是模拟账户，跳过API调用
    if (isDemo) {
        updateSimulationDisplay();
        return;
    }
    
    try {
        const { ok, data } = await apiRequest(`/api/simulations/${simulationId}`);
        
        if (ok && data.simulation) {
            // 合并服务器数据，保留本地可能新增的字段
            currentSimulation = {
                ...currentSimulation,
                ...data.simulation,
                // 确保关键字段存在
                initial_capital: data.simulation.initial_capital || currentSimulation.initial_capital,
                current_capital: data.simulation.current_capital || currentSimulation.current_capital,
                commission: data.simulation.commission || currentSimulation.commission,
                slippage: data.simulation.slippage || currentSimulation.slippage,
                positions: data.simulation.positions || currentSimulation.positions || {},
                orders: data.simulation.orders || currentSimulation.orders || [],
                trades: data.simulation.trades || currentSimulation.trades || []
            };
            updateSimulationDisplay();
        } else {
            // API失败时使用本地数据
            updateSimulationDisplay();
        }
    } catch (error) {
        console.error('Error updating simulation status:', error);
        // 出错时使用本地数据
        updateSimulationDisplay();
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

// 切换图表类型（分时/日K）
function switchChartType(type) {
    currentChartType = type;
    
    const intradayBtn = $('chartTypeIntraday');
    const dailyBtn = $('chartTypeDaily');
    const intradayCanvas = $('intradayChart');
    const dailyCanvas = $('dailyChart');
    
    const indicatorButtons = document.getElementById('indicatorButtons');
    
    if (type === 'intraday') {
        if (intradayBtn) intradayBtn.classList.add('active');
        if (dailyBtn) dailyBtn.classList.remove('active');
        if (intradayCanvas) intradayCanvas.style.display = 'block';
        if (dailyCanvas) dailyCanvas.style.display = 'none';
        if (indicatorButtons) indicatorButtons.style.display = 'none';
    } else if (type === 'daily') {
        if (intradayBtn) intradayBtn.classList.remove('active');
        if (dailyBtn) dailyBtn.classList.add('active');
        if (intradayCanvas) intradayCanvas.style.display = 'none';
        if (dailyCanvas) dailyCanvas.style.display = 'block';
        if (indicatorButtons) indicatorButtons.style.display = 'inline-block';
        
        // 如果日K图还没有数据，生成模拟数据
        if (dailyData.candles.length === 0) {
            generateDemoDailyData();
        } else {
            // 重新绘制K线图
            drawCandlestickChart();
        }
    }
}

// 窗口大小改变时重新绘制K线图
window.addEventListener('resize', function() {
    if (currentChartType === 'daily' && dailyData.candles.length > 0) {
        drawCandlestickChart();
    }
});

// 生成模拟日K数据（用于演示）
function generateDemoDailyData() {
    const symbol = $('quoteSymbol')?.textContent;
    if (!symbol || symbol === '--') return;
    
    const stock = marketData[symbol];
    if (!stock) return;
    
    // 生成最近3个月（约90天）的模拟K线数据（OHLC）
    const basePrice = stock.latest_price || 5.85;
    dailyData.dates = [];
    dailyData.candles = [];
    
    let currentPrice = basePrice;
    // 3个月约90个交易日
    for (let i = 89; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
        dailyData.dates.push(dateStr);
        
        // 模拟K线数据：开盘、最高、最低、收盘
        const change = (Math.random() - 0.5) * 0.08;
        const open = currentPrice;
        const close = Math.max(0.01, open * (1 + change));
        const high = Math.max(open, close) * (1 + Math.random() * 0.03);
        const low = Math.min(open, close) * (1 - Math.random() * 0.03);
        
        dailyData.candles.push({
            date: dateStr,
            open: parseFloat(open.toFixed(2)),
            high: parseFloat(high.toFixed(2)),
            low: parseFloat(low.toFixed(2)),
            close: parseFloat(close.toFixed(2))
        });
        
        currentPrice = close;
    }
    
    drawCandlestickChart();
}

// 计算MA指标
function calculateMA(candles, period) {
    const ma = [];
    for (let i = 0; i < candles.length; i++) {
        if (i < period - 1) {
            ma.push(null);
        } else {
            let sum = 0;
            for (let j = i - period + 1; j <= i; j++) {
                sum += candles[j].close;
            }
            ma.push(sum / period);
        }
    }
    return ma;
}

// 计算BOLL指标（布林带）
function calculateBOLL(candles, period = 20, stdDev = 2) {
    const ma = calculateMA(candles, period); // 中轨
    const upper = []; // 上轨
    const lower = []; // 下轨
    
    for (let i = 0; i < candles.length; i++) {
        if (i < period - 1 || ma[i] === null) {
            upper.push(null);
            lower.push(null);
        } else {
            // 计算标准差
            let sumSquaredDiff = 0;
            for (let j = i - period + 1; j <= i; j++) {
                const diff = candles[j].close - ma[i];
                sumSquaredDiff += diff * diff;
            }
            const std = Math.sqrt(sumSquaredDiff / period);
            
            upper.push(ma[i] + stdDev * std);
            lower.push(ma[i] - stdDev * std);
        }
    }
    
    return { middle: ma, upper: upper, lower: lower };
}

// 切换技术指标
function switchIndicator(indicator, btnElement) {
    currentIndicator = indicator;
    
    // 更新按钮状态
    const indicatorButtons = document.getElementById('indicatorButtons');
    if (indicatorButtons) {
        indicatorButtons.querySelectorAll('button').forEach(btn => {
            btn.classList.remove('active');
        });
        if (btnElement) {
            btnElement.classList.add('active');
        }
    }
    
    // 重新绘制K线图
    if ($('dailyChart')?.style.display !== 'none') {
        drawCandlestickChart();
    }
}

// 绘制K线图（蜡烛图）
function drawCandlestickChart() {
    if (!dailyChartCanvas || !dailyChartCtx || dailyData.candles.length === 0) return;
    
    const canvas = dailyChartCanvas;
    const ctx = dailyChartCtx;
    const width = canvas.width = canvas.offsetWidth;
    const height = canvas.height = canvas.offsetHeight;
    
    // 清空画布
    ctx.clearRect(0, 0, width, height);
    
    const candles = dailyData.candles;
    const padding = { top: 20, right: 30, bottom: 30, left: 50 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    
    // 根据选中的指标计算数据
    let ma5 = [], ma10 = [], ma20 = [];
    let bollData = null;
    
    if (currentIndicator === 'ma') {
        ma5 = calculateMA(candles, 5);
        ma10 = calculateMA(candles, 10);
        ma20 = calculateMA(candles, 20);
    } else if (currentIndicator === 'boll') {
        bollData = calculateBOLL(candles, 20, 2);
    }
    
    // 计算价格范围（包含指标）
    let minPrice = Math.min(...candles.map(c => c.low));
    let maxPrice = Math.max(...candles.map(c => c.high));
    
    if (currentIndicator === 'ma') {
        const maValues = [...ma5, ...ma10, ...ma20].filter(v => v !== null);
        if (maValues.length > 0) {
            minPrice = Math.min(minPrice, ...maValues);
            maxPrice = Math.max(maxPrice, ...maValues);
        }
    } else if (currentIndicator === 'boll' && bollData) {
        const bollValues = [...bollData.upper, ...bollData.lower, ...bollData.middle].filter(v => v !== null);
        if (bollValues.length > 0) {
            minPrice = Math.min(minPrice, ...bollValues);
            maxPrice = Math.max(maxPrice, ...bollValues);
        }
    }
    const priceRange = maxPrice - minPrice;
    const pricePadding = priceRange * 0.1; // 上下各留10%空间
    minPrice -= pricePadding;
    maxPrice += pricePadding;
    
    // 计算每根K线的宽度和间距
    const candleCount = candles.length;
    const candleWidth = Math.max(2, Math.min(8, chartWidth / candleCount * 0.6));
    const candleSpacing = chartWidth / candleCount;
    
    // 价格转换为坐标的函数
    const priceToY = (price) => {
        return padding.top + chartHeight - ((price - minPrice) / (maxPrice - minPrice)) * chartHeight;
    };
    
    // 绘制网格线
    ctx.strokeStyle = '#e9ecef';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = padding.top + (chartHeight / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(padding.left + chartWidth, y);
        ctx.stroke();
        
        // 绘制价格标签
        const price = maxPrice - (priceRange / 4) * i;
        ctx.fillStyle = '#6c757d';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(price.toFixed(2), padding.left - 5, y + 3);
    }
    
    // 绘制MA指标线
    if (currentIndicator === 'ma') {
        const drawMALine = (maData, color, label) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            let firstPoint = true;
            maData.forEach((value, index) => {
                if (value !== null) {
                    const x = padding.left + candleSpacing * (index + 0.5);
                    const y = priceToY(value);
                    if (firstPoint) {
                        ctx.moveTo(x, y);
                        firstPoint = false;
                    } else {
                        ctx.lineTo(x, y);
                    }
                }
            });
            ctx.stroke();
            
            // 绘制MA标签（在最后一点）
            const lastValue = maData.filter(v => v !== null).pop();
            if (lastValue !== undefined) {
                const lastIndex = maData.lastIndexOf(lastValue);
                const x = padding.left + candleSpacing * (lastIndex + 0.5);
                const y = priceToY(lastValue);
                ctx.fillStyle = color;
                ctx.font = '9px sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText(label, x + 3, y - 3);
            }
        };
        
        // 绘制MA5、MA10、MA20
        drawMALine(ma5, '#ff9800', 'MA5');   // 橙色
        drawMALine(ma10, '#2196f3', 'MA10'); // 蓝色
        drawMALine(ma20, '#9c27b0', 'MA20'); // 紫色
    }
    
    // 绘制BOLL指标（布林带）
    if (currentIndicator === 'boll' && bollData) {
        const { middle, upper, lower } = bollData;
        
        // 绘制布林带区域（填充）
        ctx.fillStyle = 'rgba(33, 150, 243, 0.1)';
        ctx.beginPath();
        let firstUpper = true, firstLower = true;
        for (let i = 0; i < upper.length; i++) {
            if (upper[i] !== null && lower[i] !== null) {
                const x = padding.left + candleSpacing * (i + 0.5);
                const upperY = priceToY(upper[i]);
                const lowerY = priceToY(lower[i]);
                if (firstUpper) {
                    ctx.moveTo(x, upperY);
                    firstUpper = false;
                } else {
                    ctx.lineTo(x, upperY);
                }
                if (i === upper.length - 1) {
                    // 连接下轨
                    for (let j = upper.length - 1; j >= 0; j--) {
                        if (lower[j] !== null) {
                            const x2 = padding.left + candleSpacing * (j + 0.5);
                            const lowerY2 = priceToY(lower[j]);
                            ctx.lineTo(x2, lowerY2);
                        }
                    }
                    ctx.closePath();
                }
            }
        }
        ctx.fill();
        
        // 绘制上轨、中轨、下轨线
        const drawBOLLLine = (data, color, label) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            let firstPoint = true;
            data.forEach((value, index) => {
                if (value !== null) {
                    const x = padding.left + candleSpacing * (index + 0.5);
                    const y = priceToY(value);
                    if (firstPoint) {
                        ctx.moveTo(x, y);
                        firstPoint = false;
                    } else {
                        ctx.lineTo(x, y);
                    }
                }
            });
            ctx.stroke();
            
            // 绘制标签（在最后一点）
            const lastValue = data.filter(v => v !== null).pop();
            if (lastValue !== undefined) {
                const lastIndex = data.lastIndexOf(lastValue);
                const x = padding.left + candleSpacing * (lastIndex + 0.5);
                const y = priceToY(lastValue);
                ctx.fillStyle = color;
                ctx.font = '9px sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText(label, x + 3, y - 3);
            }
        };
        
        drawBOLLLine(upper, '#2196f3', 'BOLL上'); // 蓝色
        drawBOLLLine(middle, '#ff9800', 'BOLL中'); // 橙色
        drawBOLLLine(lower, '#2196f3', 'BOLL下'); // 蓝色
    }
    
    // 绘制K线
    candles.forEach((candle, index) => {
        const x = padding.left + candleSpacing * (index + 0.5);
        const openY = priceToY(candle.open);
        const closeY = priceToY(candle.close);
        const highY = priceToY(candle.high);
        const lowY = priceToY(candle.low);
        
        const isUp = candle.close >= candle.open;
        const color = isUp ? '#dc3545' : '#28a745'; // 涨红跌绿
        
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1;
        
        // 绘制上影线
        ctx.beginPath();
        ctx.moveTo(x, highY);
        ctx.lineTo(x, Math.min(openY, closeY));
        ctx.stroke();
        
        // 绘制下影线
        ctx.beginPath();
        ctx.moveTo(x, lowY);
        ctx.lineTo(x, Math.max(openY, closeY));
        ctx.stroke();
        
        // 绘制实体（矩形）
        const bodyTop = Math.min(openY, closeY);
        const bodyBottom = Math.max(openY, closeY);
        const bodyHeight = Math.max(1, bodyBottom - bodyTop);
        
        if (isUp) {
            // 阳线：红色实心
            ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
        } else {
            // 阴线：绿色实心
            ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
        }
    });
    
    // 绘制日期标签
    ctx.fillStyle = '#6c757d';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    const labelStep = Math.max(1, Math.floor(candleCount / 8));
    for (let i = 0; i < candleCount; i += labelStep) {
        const x = padding.left + candleSpacing * (i + 0.5);
        ctx.fillText(candles[i].date, x, height - 10);
    }
}

// 页面卸载时清理定时器
window.addEventListener('beforeunload', function() {
    if (updateInterval) {
        clearInterval(updateInterval);
    }
    if (marketUpdateInterval) {
        clearInterval(marketUpdateInterval);
    }
});