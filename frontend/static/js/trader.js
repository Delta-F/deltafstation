/**
 * DeltaFStation 交易页面核心模块
 *
 * 采用模块化架构：
 * - State: 全局状态管理
 * - Market: 行情数据流与实时订阅
 * - Charts: Chart.js 封装与 K 线绘制
 * - Account: 仿真账户、订单、成交与持仓管理
 * - UI: 界面事件绑定与实时更新
 */

const TraderApp = {
    // 1. 常量配置
    CONSTANTS: {
        MIN_QUANTITY: 100,
        QUANTITY_STEP: 100,
        BASE_ID: 10000000,
        MAX_TRADES_DISPLAY: 50,
        MAX_ORDERS_DISPLAY: 20,
        MAX_LOG_ENTRIES: 100,
        REFRESH_RATE_ACCOUNT: 3000,
        REFRESH_RATE_MARKET: 5000
    },

    // 2. 核心状态
    state: {
        simulation: null,
        marketData: {},
        orders: [],
        trades: [],
        logs: [],
        currentChartType: 'intraday',
        currentIndicator: 'ma',
        timers: {
            account: null,
            market: null
        }
    },

    // 3. 工具方法
    utils: {
        generateOrderId(trade, index) {
            if (trade.order_id) {
                const num = parseInt(String(trade.order_id).match(/\d+/)?.[0] || 0);
                if (num >= TraderApp.CONSTANTS.BASE_ID && num <= 99999999) return num;
            }
            return TraderApp.CONSTANTS.BASE_ID + index;
        },

        validateOrderForm(symbol, price, quantity) {
            if (!symbol || !price || !quantity || quantity < TraderApp.CONSTANTS.MIN_QUANTITY) {
                showAlert('请填写完整信息，数量至少100股', 'warning');
                return false;
            }
            if (quantity % TraderApp.CONSTANTS.QUANTITY_STEP !== 0) {
                showAlert('数量必须是100的整数倍', 'warning');
                return false;
            }
            return true;
        },

        getAssetType(symbol) {
            if (!symbol) return 'Crypto';
            const s = symbol.toUpperCase();
            if (s.endsWith('.SS') || s.endsWith('.SZ') || s.endsWith('.SH')) return 'A-Share';
            if (s.endsWith('-USD') || s.includes('BTC') || s.includes('ETH')) return 'Crypto';
            return 'US-Stock';
        }
    },

                            // 4. 初始化入口
    async init() {
        console.log('TraderApp initializing...');
        this.ui.initListeners();
        this.charts.initIntraday();
        
        // 加载活跃账户
        await this.account.loadActive();
        
        // 启动定时器
        this.state.timers.account = setInterval(() => {
            if (this.state.simulation) this.account.updateStatus();
        }, this.CONSTANTS.REFRESH_RATE_ACCOUNT);
        
        // 设置默认标的并启动行情更新
        const buySymbolInput = $('buySymbol');
        if (buySymbolInput) {
            if (!buySymbolInput.value) {
                buySymbolInput.value = '000001.SS';
            }
            // 无论是否有初始值，都加载一次信息以初始化图表和价格
            this.market.loadStockInfo('buy');
        }
        
        this.market.startUpdateLoop();
    },

    // 5. 行情管理模块
    market: {
        async startUpdateLoop() {
            if (TraderApp.state.timers.market) clearInterval(TraderApp.state.timers.market);
            
            // 立即执行一次
            await this.updateAll();
            
            TraderApp.state.timers.market = setInterval(async () => {
                await this.updateAll();
                const currentSymbol = $('quoteSymbol')?.textContent;
                if (currentSymbol && currentSymbol !== '--' && TraderApp.state.marketData[currentSymbol]) {
                    this.updateQuoteUI(TraderApp.state.marketData[currentSymbol]);
                }
            }, TraderApp.CONSTANTS.REFRESH_RATE_MARKET);
        },

        async updateAll() {
            const symbols = Object.keys(TraderApp.state.marketData);
            const updatePromises = symbols.map(async (symbol) => {
                try {
                    const stock = TraderApp.state.marketData[symbol];
                    const needHistory = !stock.hasLoadedHistory;
                    const url = `/api/data/quotes/${symbol}${needHistory ? '?history=true' : ''}`;
                    
                    const response = await fetch(url);
                    if (!response.ok) return;
                    
                    const data = await response.json();
                    if (data && !data.error && data.status !== 'loading') {
                        if (data.history) stock.hasLoadedHistory = true;
                        
                        stock.latest_price = data.price;
                        stock.timestamp = data.timestamp;
                        stock.minute = data.minute;
                        if (data.open) stock.open = data.open;
                        if (data.high) stock.high = data.high;
                        if (data.low) stock.low = data.low;
                        if (data.history) stock.history = data.history;
                        
                        const prevClose = data.prev_close || stock.latest_price;
                        stock.change = parseFloat((stock.latest_price - prevClose).toFixed(2));
                        stock.changePercent = prevClose > 0 ? parseFloat(((stock.change / prevClose) * 100).toFixed(2)) : 0.00;
                        
                        const currentSymbol = $('quoteSymbol')?.textContent;
                        if (currentSymbol === symbol) {
                            this.updateQuoteUI(stock);
                        }
                    }
                } catch (error) {
                    console.error(`Failed to fetch live data for ${symbol}:`, error);
                }
            });
            await Promise.all(updatePromises);
        },

        async loadStockInfo(type) {
            const symbolInput = $(type === 'buy' ? 'buySymbol' : 'sellSymbol');
            if (!symbolInput) return;
            
            const symbol = symbolInput.value.toUpperCase().trim();
            if (!symbol) return;
            
            if (!TraderApp.state.marketData[symbol]) {
                TraderApp.state.marketData[symbol] = {
                    symbol: symbol,
                    name: '正在加载...',
                    latest_price: 0
                };
            }
            
            const stock = TraderApp.state.marketData[symbol];
            const price = stock.latest_price || 0;
            
            if (type === 'buy') {
                const buyPriceInput = $('buyPrice');
                const buyNameInput = $('buyName');
                if (buyPriceInput && !buyPriceInput.value && price > 0) buyPriceInput.value = price.toFixed(2);
                // 标的名称默认直接显示投资标的（代码），后续有字典再做映射
                if (buyNameInput) buyNameInput.value = symbol;
                TraderApp.ui.calculateEstimatedAmount('buy');
            } else {
                const sellPriceInput = $('sellPrice');
                if (sellPriceInput && !sellPriceInput.value && price > 0) sellPriceInput.value = price.toFixed(2);
                TraderApp.ui.calculateEstimatedAmount('sell');
            }
            
            this.updateQuoteUI(stock);

            try {
                const response = await fetch(`/api/data/quotes/${symbol}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data && !data.error && data.status !== 'loading') {
                        TraderApp.state.marketData[symbol] = {
                            ...TraderApp.state.marketData[symbol],
                            latest_price: data.price,
                            timestamp: data.timestamp,
                            minute: data.minute,
                            open: data.open,
                            high: data.high,
                            low: data.low,
                            prev_close: data.prev_close,
                            name: data.name || symbol
                        };
                        this.updateQuoteUI(TraderApp.state.marketData[symbol]);
                        
                        if (type === 'buy') {
                            if ($('buyPrice') && (!$('buyPrice').value || $('buyPrice').value == '0.00')) 
                                $('buyPrice').value = data.price.toFixed(2);
                        } else {
                            if ($('sellPrice') && (!$('sellPrice').value || $('sellPrice').value == '0.00')) 
                                $('sellPrice').value = data.price.toFixed(2);
                        }
                        TraderApp.ui.calculateEstimatedAmount(type);
                    }
                }
            } catch (e) {
                console.error('Failed to fetch quote during loadStockInfo:', e);
            }
        },

        updateQuoteUI(stock) {
            if (!stock) return;
            
            const quoteSymbolEl = $('quoteSymbol');
            const currentShownSymbol = quoteSymbolEl ? quoteSymbolEl.textContent : '';
            
            if (currentShownSymbol && currentShownSymbol !== '--' && currentShownSymbol !== stock.symbol) {
                const oldAssetType = TraderApp.utils.getAssetType(currentShownSymbol);
                const newAssetType = TraderApp.utils.getAssetType(stock.symbol);
                
                if (oldAssetType !== newAssetType) {
                    TraderApp.charts.initIntraday(stock.symbol);
                } else {
                    TraderApp.charts.resetData();
                }
            }
            
            const els = {
                symbol: quoteSymbolEl,
                name: $('quoteName'),
                price: $('quotePrice'),
                time: $('quoteTime'),
                open: $('quoteOpen'),
                high: $('quoteHigh'),
                low: $('quoteLow'),
                change: $('quoteChange')
            };
            
            if (els.symbol) els.symbol.textContent = stock.symbol || '--';
            if (els.name) els.name.textContent = stock.name || '--';
            if (els.price) {
                const price = stock.latest_price || 0;
                els.price.textContent = '¥' + price.toFixed(2);
                els.price.className = 'market-price ' + ((stock.change || 0) >= 0 ? 'price-up' : 'price-down');
            }
            if (els.time) {
                if (stock.timestamp) {
                    const t = new Date(stock.timestamp);
                    els.time.textContent = `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}:${String(t.getUTCSeconds()).padStart(2, '0')}`;
                } else {
                    els.time.textContent = '--';
                }
            }
            if (els.open) els.open.textContent = stock.open ? '¥' + stock.open.toFixed(2) : '--';
            if (els.high) {
                els.high.textContent = stock.high ? '¥' + stock.high.toFixed(2) : '--';
                els.high.className = stock.high >= (stock.open || 0) ? 'price-up' : 'price-down';
            }
            if (els.low) {
                els.low.textContent = stock.low ? '¥' + stock.low.toFixed(2) : '--';
                els.low.className = stock.low >= (stock.open || 0) ? 'price-up' : 'price-down';
            }
            if (els.change) {
                const change = stock.change || 0;
                const changePercent = stock.changePercent || 0;
                const changeStr = (change >= 0 ? '+' : '') + change.toFixed(2) + 
                                ' (' + (changePercent >= 0 ? '+' : '') + changePercent.toFixed(2) + '%)';
                els.change.textContent = changeStr;
                els.change.className = change >= 0 ? 'price-up' : 'price-down';
            }
            
            this.updateQuoteBoard(stock);

            if (TraderApp.state.currentChartType === 'daily' && stock.symbol) {
                TraderApp.charts.loadDailyKData(stock.symbol).then(result => {
                    if (result) {
                        TraderApp.charts.data.daily.dates = result.dates;
                        TraderApp.charts.data.daily.candles = result.candles;
                    } else {
                        TraderApp.charts.data.daily = { dates: [], candles: [] };
                    }
                    TraderApp.charts.drawCandlestick();
                });
            }

            if (stock.history && stock.history.length > 0) {
                stock.history.forEach(tick => {
                    TraderApp.charts.addIntradayPoint(tick.price, tick.volume, tick.timestamp, tick.minute);
                });
                stock.history = [];
            }
            
            TraderApp.charts.addIntradayPoint(stock.latest_price, stock.volume, stock.timestamp, stock.minute);
            
            // 跟随现价逻辑
            const buyFollow = $('buyFollow');
            const sellFollow = $('sellFollow');
            const buySymbol = $('buySymbol')?.value.toUpperCase().trim();
            const sellSymbol = $('sellSymbol')?.value.toUpperCase().trim();
            
            if (buyFollow?.checked && buySymbol === stock.symbol) {
                const buyPriceInput = $('buyPrice');
                if (buyPriceInput) {
                    buyPriceInput.value = stock.latest_price.toFixed(2);
                    TraderApp.ui.calculateEstimatedAmount('buy');
                }
            }
            if (sellFollow?.checked && sellSymbol === stock.symbol) {
                const sellPriceInput = $('sellPrice');
                if (sellPriceInput) {
                    sellPriceInput.value = stock.latest_price.toFixed(2);
                    TraderApp.ui.calculateEstimatedAmount('sell');
                }
            }
        },

        updateQuoteBoard(stock) {
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
        },

        setPrice(type, priceType) {
            const symbolInput = (type === 'buy' ? $('buySymbol') : $('sellSymbol'));
            const symbol = symbolInput ? symbolInput.value : '';
            if (!symbol) {
                showAlert('请先输入投资标的', 'warning');
                return;
            }
            
            const stock = TraderApp.state.marketData[symbol.toUpperCase()];
            if (!stock) {
                this.loadStockInfo(type);
                setTimeout(() => this.setPrice(type, priceType), 500);
                return;
            }
            
            let price = 0;
            const currentPrice = stock.latest_price || 0;
            const spread = 0.01;
            
            if (priceType === 'current') {
                price = currentPrice;
                const followCheck = $(type + 'Follow');
                if (followCheck) followCheck.checked = true;
            } else if (priceType === 'bid1') {
                price = currentPrice - spread;
            } else if (priceType === 'ask1') {
                price = currentPrice + spread;
            }
            
            $(type === 'buy' ? 'buyPrice' : 'sellPrice').value = price.toFixed(2);
            TraderApp.ui.calculateEstimatedAmount(type);
        },

        setQuantity(type, val, isPercent = false) {
            let quantity = 0;
            
            if (isPercent) {
                if (type === 'buy') {
                    const price = parseFloat($('buyPrice').value) || 0;
                    if (price <= 0) {
                        showAlert('请先输入买入价格', 'warning');
                        return;
                    }
                    const available = TraderApp.state.simulation ? TraderApp.state.simulation.current_capital : 0;
                    const commission = TraderApp.state.simulation ? TraderApp.state.simulation.commission : 0.001;
                    const maxQty = Math.floor(available / (price * (1 + commission)));
                    quantity = Math.floor((maxQty * val) / 100) * 100;
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
            TraderApp.ui.calculateEstimatedAmount(type);
        },

        getCurrentPrice(sym) {
            return TraderApp.state.marketData[sym]?.latest_price || 0;
        }
    },

    // 6. 图表管理模块
    charts: {
        instance: {
            intraday: null,
            daily: null
        },
        data: {
            intraday: { labels: [], prices: [], vwap: [], volumes: [] },
            daily: { dates: [], candles: [] }
        },

        initIntraday(symbol = '000001.SS') {
            const canvas = $('intradayChart');
            if (!canvas || typeof Chart === 'undefined') return;

            const assetType = TraderApp.utils.getAssetType(symbol);
            const segments = this.getTimeAxisConfig(assetType);
            const labels = [];
            const timeToIndexMap = {};
            
            let currentIndex = 0;
            segments.forEach(seg => {
                const [startH, startM] = seg.start.split(':').map(Number);
                const [endH, endM] = seg.end.split(':').map(Number);
                let h = startH, m = startM;
                while (true) {
                    const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                    labels.push(timeStr);
                    timeToIndexMap[timeStr] = currentIndex++;
                    if (h === endH && m === endM) break;
                    m++;
                    if (m >= 60) { m = 0; h++; if (h >= 24) h = 0; }
                }
            });
            
            this.data.intraday = { 
                assetType, segments, timeToIndexMap, labels, 
                prices: new Array(labels.length).fill(null),
                vwap: new Array(labels.length).fill(null),
                volumes: new Array(labels.length).fill(null),
                _sumPV: 0, _sumVol: 0, _lastTotalVol: 0
            };

            const ctx = canvas.getContext('2d');
            const gradient = ctx.createLinearGradient(0, 0, 0, canvas.offsetHeight || 300);
            gradient.addColorStop(0, 'rgba(0, 123, 255, 0.2)');
            gradient.addColorStop(1, 'rgba(0, 123, 255, 0)');

            if (this.instance.intraday) this.instance.intraday.destroy();

            this.instance.intraday = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: this.data.intraday.labels,
                    datasets: [
                        {
                            label: '价格', type: 'line', data: this.data.intraday.prices,
                            borderColor: '#007bff', backgroundColor: gradient,
                            borderWidth: 1.5, tension: 0.2, pointRadius: 0, fill: true, yAxisID: 'y'
                        },
                        {
                            label: '均价', type: 'line', data: this.data.intraday.vwap,
                            borderColor: '#ff9800', borderWidth: 1, borderDash: [3, 3],
                            tension: 0.2, pointRadius: 0, fill: false, yAxisID: 'y'
                        },
                        {
                            label: '成交量', type: 'bar', data: this.data.intraday.volumes,
                            backgroundColor: (ctx) => {
                                const idx = ctx.dataIndex;
                                const cur = this.data.intraday.prices[idx];
                                const pre = idx > 0 ? this.data.intraday.prices[idx - 1] : null;
                                if (!cur || !pre) return 'rgba(108, 117, 125, 0.4)';
                                return cur >= pre ? 'rgba(220, 53, 69, 0.6)' : 'rgba(40, 167, 69, 0.6)';
                            },
                            yAxisID: 'yVolume', barPercentage: 0.8, categoryPercentage: 0.8
                        }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false, animation: false,
                    plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
                    scales: {
                        x: {
                            grid: { display: true, color: 'rgba(0,0,0,0.03)', drawTicks: true },
                            ticks: { 
                                maxTicksLimit: 15, font: { size: 9 }, autoSkip: false,
                                callback: function(val) {
                                    const label = this.getLabelForValue(val);
                                    if (assetType === 'A-Share') {
                                        return ['09:30', '10:30', '11:30', '14:00', '15:00'].includes(label) ? label : '';
                                    }
                                    return label.endsWith(':00') ? label : '';
                                }
                            }
                        },
                        // 先定义成交量轴（stack 内先定义的在下），再定义价格轴在上
                        yVolume: {
                            type: 'linear',
                            position: 'left',
                            stack: 'v1',
                            stackWeight: 1, // 成交量占下方 25%
                            min: 0,
                            suggestedMax: (ctx) => {
                                const d = ctx.chart.data.datasets[2].data.filter(v => v !== null);
                                return d.length > 0 ? Math.max(...d) * 1.2 : 10;
                            },
                            grid: {
                                display: true,
                                color: 'rgba(0,0,0,0.05)',
                                drawBorder: false
                            },
                            ticks: {
                                font: { size: 8 },
                                maxTicksLimit: 3,
                                callback: (v) => {
                                    if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
                                    if (v >= 1000) return (v / 1000).toFixed(0) + 'K';
                                    return v;
                                }
                            },
                            title: { display: false }
                        },
                        y: {
                            type: 'linear',
                            position: 'left',
                            stack: 'v1',
                            stackWeight: 3, // 价格占上方 75%
                            grid: {
                                color: 'rgba(0,0,0,0.05)',
                                drawBorder: false
                            },
                            ticks: {
                                font: { size: 10 },
                                callback: (v) => v.toFixed(2)
                            },
                            title: { display: false },
                            beginAtZero: false,
                            grace: '2%'
                        }
                    }
                }
            });
        },

        getTimeAxisConfig(assetType) {
            const configs = {
                // 已改为 UTC 时间以匹配后端 Naive UTC 数据
                'A-Share': [{ start: '01:30', end: '03:30' }, { start: '05:00', end: '07:00' }],
                'US-Stock': [{ start: '14:30', end: '21:00' }],
                'Crypto': [{ start: '00:00', end: '23:59' }]
            };
            return configs[assetType] || configs['Crypto'];
        },

        addIntradayPoint(price, totalVolume = 0, timestamp = null, minute = null) {
            if (!this.instance.intraday || !price) return;
            
            let timeStr = minute;
            if (!timeStr) {
                const tickTime = timestamp ? new Date(timestamp) : new Date();
                // 使用 UTC 时间以匹配后端 Naive UTC
                timeStr = `${String(tickTime.getUTCHours()).padStart(2, '0')}:${String(tickTime.getUTCMinutes()).padStart(2, '0')}`;
            }
            
            const idx = this.data.intraday.timeToIndexMap[timeStr];
            if (idx === undefined) return;
            
            let incVol = 0;
            if (this.data.intraday._lastTotalVol > 0 && totalVolume > this.data.intraday._lastTotalVol) {
                incVol = totalVolume - this.data.intraday._lastTotalVol;
            }
            this.data.intraday._lastTotalVol = totalVolume;

            if (incVol > 0) {
                this.data.intraday._sumPV += price * incVol;
                this.data.intraday._sumVol += incVol;
            } else if (this.data.intraday._sumVol === 0) {
                this.data.intraday._sumPV = price;
                this.data.intraday._sumVol = 1;
            }
            const currentVWAP = this.data.intraday._sumPV / this.data.intraday._sumVol;

            this.data.intraday.prices[idx] = price;
            this.data.intraday.vwap[idx] = currentVWAP;
            this.data.intraday.volumes[idx] = (this.data.intraday.volumes[idx] || 0) + incVol;
            
            let lastIdx = -1;
            for (let i = idx - 1; i >= 0; i--) { if (this.data.intraday.prices[i] !== null) { lastIdx = i; break; } }
            if (lastIdx !== -1) {
                for (let i = lastIdx + 1; i < idx; i++) {
                    this.data.intraday.prices[i] = this.data.intraday.prices[lastIdx];
                    this.data.intraday.vwap[i] = this.data.intraday.vwap[lastIdx];
                    this.data.intraday.volumes[i] = 0;
                }
            }
            this.instance.intraday.update('none');
        },

        resetData() {
            if (!this.data.intraday.prices) return;
            const currentSymbol = $('quoteSymbol')?.textContent;
            if (currentSymbol && TraderApp.state.marketData[currentSymbol]) {
                TraderApp.state.marketData[currentSymbol].hasLoadedHistory = false;
            }
            this.data.intraday.prices.fill(null);
            this.data.intraday.vwap.fill(null);
            this.data.intraday.volumes.fill(null);
            this.data.intraday._sumPV = 0;
            this.data.intraday._sumVol = 0;
            this.data.intraday._lastTotalVol = 0;
            this.data.daily = { dates: [], candles: [] };
            if (this.instance.intraday) this.instance.intraday.update();
        },

        /** 拉取当前标的的日K数据：先读本地 data/raw，无则 POST 拉取并保存，再 GET 完整数据。仅展示近半年。 */
        async loadDailyKData(symbol) {
            if (!symbol) return null;
            const sym = symbol.toUpperCase().trim();
            const endDate = new Date();
            const startDate = new Date();
            startDate.setMonth(startDate.getMonth() - 6);
            const start = startDate.toISOString().split('T')[0];
            const end = endDate.toISOString().split('T')[0];
            const halfYearAgo = startDate.getTime();

            let filename = null;
            const fileRes = await apiRequest(`/api/data/symbols/${encodeURIComponent(sym)}/files`, { method: 'GET' });
            if (fileRes.ok && fileRes.data && fileRes.data.filename) {
                filename = fileRes.data.filename;
            }
            if (!filename) {
                const postRes = await apiRequest(`/api/data/symbols/${encodeURIComponent(sym)}/files`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ start_date: start, end_date: end })
                });
                if (!postRes.ok) return null;
                filename = postRes.data.filename || postRes.data.id;
            }
            const fullRes = await apiRequest(`/api/data/files/${encodeURIComponent(filename)}?full=true`);
            if (!fullRes.ok || !fullRes.data || !Array.isArray(fullRes.data.data)) return null;

            const rows = fullRes.data.data;
            const dates = [];
            const candles = [];
            for (const row of rows) {
                const d = row.Date ?? row.date;
                const o = parseFloat(row.Open ?? row.open);
                const h = parseFloat(row.High ?? row.high);
                const l = parseFloat(row.Low ?? row.low);
                const c = parseFloat(row.Close ?? row.close);
                if (d == null || isNaN(o) || isNaN(h) || isNaN(l) || isNaN(c)) continue;
                const dateStr = typeof d === 'string' ? d : (d.split && d.split('T')[0]) || String(d);
                if (new Date(dateStr).getTime() < halfYearAgo) continue;
                dates.push(dateStr);
                candles.push({ open: o, high: h, low: l, close: c });
            }
            return dates.length ? { dates, candles } : null;
        },

        async switchType(type) {
            TraderApp.state.currentChartType = type;
            const intradayBtn = $('chartTypeIntraday');
            const dailyBtn = $('chartTypeDaily');
            const intradayCanvas = $('intradayChart');
            const dailyCanvas = $('dailyChart');
            const indicatorButtons = $('indicatorButtons');

            if (type === 'intraday') {
                if (intradayBtn) intradayBtn.classList.add('active');
                if (dailyBtn) dailyBtn.classList.remove('active');
                if (intradayCanvas) intradayCanvas.style.display = 'block';
                if (dailyCanvas) dailyCanvas.style.display = 'none';
                if (indicatorButtons) indicatorButtons.style.display = 'none';
            } else {
                if (intradayBtn) intradayBtn.classList.remove('active');
                if (dailyBtn) dailyBtn.classList.add('active');
                if (intradayCanvas) intradayCanvas.style.display = 'none';
                if (dailyCanvas) dailyCanvas.style.display = 'block';
                if (indicatorButtons) indicatorButtons.style.display = 'inline-block';

                const symbol = $('quoteSymbol')?.textContent?.trim();
                if (symbol && symbol !== '--') {
                    const result = await this.loadDailyKData(symbol);
                    if (result) {
                        this.data.daily.dates = result.dates;
                        this.data.daily.candles = result.candles;
                    } else {
                        this.data.daily = { dates: [], candles: [] };
                    }
                } else {
                    this.data.daily = { dates: [], candles: [] };
                }
                this.drawCandlestick();
            }
        },

        switchIndicator(indicator, btn) {
            TraderApp.state.currentIndicator = indicator;
            const indicatorButtons = $('indicatorButtons');
            if (indicatorButtons) {
                indicatorButtons.querySelectorAll('button').forEach(b => b.classList.remove('active'));
                if (btn) btn.classList.add('active');
            }
            if ($('dailyChart')?.style.display !== 'none') this.drawCandlestick();
        },

        calculateMA(candles, period) {
            const ma = [];
            for (let i = 0; i < candles.length; i++) {
                if (i < period - 1) ma.push(null);
                else {
                    let sum = 0;
                    for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
                    ma.push(sum / period);
                }
            }
            return ma;
        },

        calculateBOLL(candles, period = 20, stdDev = 2) {
            const ma = this.calculateMA(candles, period);
            const upper = [], lower = [];
            for (let i = 0; i < candles.length; i++) {
                if (i < period - 1 || ma[i] === null) { upper.push(null); lower.push(null); }
                else {
                    let sumSqDiff = 0;
                    for (let j = i - period + 1; j <= i; j++) {
                        const diff = candles[j].close - ma[i];
                        sumSqDiff += diff * diff;
                    }
                    const std = Math.sqrt(sumSqDiff / period);
                    upper.push(ma[i] + stdDev * std);
                    lower.push(ma[i] - stdDev * std);
                }
            }
            return { middle: ma, upper, lower };
        },

        drawCandlestick() {
            const canvas = $('dailyChart');
            const candles = this.data.daily.candles;
            if (!canvas || !candles || candles.length === 0) return;
            
            const ctx = canvas.getContext('2d');
            const width = canvas.width = canvas.offsetWidth;
            const height = canvas.height = canvas.offsetHeight;
            ctx.clearRect(0, 0, width, height);
            
            const padding = { top: 20, right: 30, bottom: 30, left: 50 };
            const chartWidth = width - padding.left - padding.right;
            const chartHeight = height - padding.top - padding.bottom;
            
            let ma5 = [], ma10 = [], ma20 = [], boll = null;
            if (TraderApp.state.currentIndicator === 'ma') {
                ma5 = this.calculateMA(candles, 5); ma10 = this.calculateMA(candles, 10); ma20 = this.calculateMA(candles, 20);
            } else if (TraderApp.state.currentIndicator === 'boll') {
                boll = this.calculateBOLL(candles, 20, 2);
            }
            
            let minP = Math.min(...candles.map(c => c.low));
            let maxP = Math.max(...candles.map(c => c.high));
            if (TraderApp.state.currentIndicator === 'ma') {
                const mas = [...ma5, ...ma10, ...ma20].filter(v => v !== null);
                if (mas.length > 0) { minP = Math.min(minP, ...mas); maxP = Math.max(maxP, ...mas); }
            } else if (TraderApp.state.currentIndicator === 'boll' && boll) {
                const bvs = [...boll.upper, ...boll.lower, ...boll.middle].filter(v => v !== null);
                if (bvs.length > 0) { minP = Math.min(minP, ...bvs); maxP = Math.max(maxP, ...bvs); }
            }
            const range = maxP - minP;
            const pPad = range * 0.1;
            minP -= pPad; maxP += pPad;
            
            const count = candles.length;
            const cWidth = Math.max(2, Math.min(8, chartWidth / count * 0.6));
            const cSpacing = chartWidth / count;
            const pToY = (p) => padding.top + chartHeight - ((p - minP) / (maxP - minP)) * chartHeight;
            
            ctx.strokeStyle = '#e9ecef'; ctx.lineWidth = 1;
            for (let i = 0; i <= 4; i++) {
                const y = padding.top + (chartHeight / 4) * i;
                ctx.beginPath(); ctx.moveTo(padding.left, y); ctx.lineTo(padding.left + chartWidth, y); ctx.stroke();
                ctx.fillStyle = '#6c757d'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
                ctx.fillText((maxP - (range / 4) * i).toFixed(2), padding.left - 5, y + 3);
            }
            
            if (TraderApp.state.currentIndicator === 'ma') {
                const drawMA = (data, color, label) => {
                    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
                    let first = true;
                    data.forEach((v, i) => {
                        if (v !== null) {
                            const x = padding.left + cSpacing * (i + 0.5), y = pToY(v);
                            if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
                        }
                    });
                    ctx.stroke();
                };
                drawMA(ma5, '#ff9800', 'MA5'); drawMA(ma10, '#2196f3', 'MA10'); drawMA(ma20, '#9c27b0', 'MA20');
            } else if (TraderApp.state.currentIndicator === 'boll' && boll) {
                const drawBollLine = (data, color) => {
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash([2, 2]);
                    ctx.beginPath();
                    let first = true;
                    data.forEach((v, i) => {
                        if (v !== null) {
                            const x = padding.left + cSpacing * (i + 0.5), y = pToY(v);
                            if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
                        }
                    });
                    ctx.stroke();
                    ctx.setLineDash([]);
                };
                drawBollLine(boll.upper, '#2196f3');
                drawBollLine(boll.middle, '#ff9800');
                drawBollLine(boll.lower, '#2196f3');
            }
            
            candles.forEach((c, i) => {
                const x = padding.left + cSpacing * (i + 0.5), oY = pToY(c.open), cY = pToY(c.close), hY = pToY(c.high), lY = pToY(c.low);
                const isUp = c.close >= c.open, color = isUp ? '#dc3545' : '#28a745';
                ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(x, hY); ctx.lineTo(x, Math.min(oY, cY)); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(x, lY); ctx.lineTo(x, Math.max(oY, cY)); ctx.stroke();
                ctx.fillRect(x - cWidth / 2, Math.min(oY, cY), cWidth, Math.max(1, Math.abs(oY - cY)));
            });

            this.data.daily._layout = { padding, chartWidth, chartHeight, cSpacing, count };
            this.setupDailyChartInteraction();
        },

        setupDailyChartInteraction() {
            const canvas = $('dailyChart');
            const tooltipEl = $('dailyChartTooltip');
            if (!canvas || !tooltipEl || this._dailyInteractionBound) return;
            this._dailyInteractionBound = true;

            canvas.addEventListener('mousemove', (e) => {
                const layout = this.data.daily._layout;
                const dates = this.data.daily.dates;
                const candles = this.data.daily.candles;
                if (!layout || !dates || !candles || dates.length === 0) return;

                const rect = canvas.getBoundingClientRect();
                const scaleX = canvas.width / rect.width;
                const mouseX = (e.clientX - rect.left) * scaleX;
                const { padding, cSpacing, count } = layout;
                let idx = Math.floor((mouseX - padding.left) / cSpacing);
                if (idx < 0 || idx >= count) {
                    tooltipEl.style.display = 'none';
                    return;
                }
                idx = Math.min(idx, count - 1);
                const d = dates[idx];
                const c = candles[idx];
                tooltipEl.innerHTML = `<div class="tooltip-date">${d}</div><div class="tooltip-ohlc">开 ${c.open.toFixed(2)} &nbsp; 高 ${c.high.toFixed(2)} &nbsp; 低 ${c.low.toFixed(2)} &nbsp; 收 ${c.close.toFixed(2)}</div>`;
                tooltipEl.style.display = 'block';
                const tx = e.clientX - rect.left + 12;
                const ty = e.clientY - rect.top + 12;
                tooltipEl.style.left = Math.min(tx, rect.width - tooltipEl.offsetWidth - 8) + 'px';
                tooltipEl.style.top = Math.min(ty, rect.height - tooltipEl.offsetHeight - 8) + 'px';
            });

            canvas.addEventListener('mouseleave', () => {
                tooltipEl.style.display = 'none';
            });
        }
    },

    // 7. 账户与交易管理模块
    account: {
        async loadActive() {
            try {
                const { ok, data } = await apiRequest('/api/simulations');
                if (ok && data.simulations && data.simulations.length > 0) {
                    const manualSim = data.simulations.find(s => s.status === 'running' && !s.strategy_id);
                    if (manualSim) {
                        const { ok: okDetail, data: detailData } = await apiRequest(`/api/simulations/${manualSim.id}`);
                        if (okDetail && detailData.simulation) {
                            TraderApp.state.simulation = detailData.simulation;
                            this.updateDisplay();
                            TraderApp.ui.addLog('已恢复活跃交易账户', 'local');
                        }
                    }
                }
            } catch (error) { console.error('Error loading active simulations:', error); }
        },

        async updateStatus() {
            if (!TraderApp.state.simulation) return;
            try {
                const { ok, data } = await apiRequest(`/api/simulations/${TraderApp.state.simulation.id}`);
                if (ok && data.simulation) {
                    TraderApp.state.simulation = { ...TraderApp.state.simulation, ...data.simulation };
                    this.updateDisplay();
                }
            } catch (error) { console.error('Error updating simulation status:', error); }
        },

        updateDisplay() {
            if (!TraderApp.state.simulation) return;
            TraderApp.ui.updateAccountOverview();
            TraderApp.ui.updatePositions();
            TraderApp.ui.updateTrades();
            TraderApp.ui.updateOrders();
            
            const createBtn = $('createAccountBtn');
            const stopBtn = $('stopSimulationBtn');
            const isRunning = TraderApp.state.simulation.status === 'running';
            if (createBtn) createBtn.disabled = isRunning;
            if (stopBtn) stopBtn.disabled = !isRunning;
        },

        async submitOrder(type) {
            if (!TraderApp.state.simulation || TraderApp.state.simulation.status !== 'running') {
                showAlert('请先创建并运行交易账户', 'warning'); return;
            }
            const symbol = $(type === 'buy' ? 'buySymbol' : 'sellSymbol').value.toUpperCase().trim();
            const price = parseFloat($(type === 'buy' ? 'buyPrice' : 'sellPrice').value);
            const qty = parseInt($(type === 'buy' ? 'buyQuantity' : 'sellQuantity').value);
            
            if (!TraderApp.utils.validateOrderForm(symbol, price, qty)) return;
            
            const { ok, data: result } = await apiRequest(`/api/simulations/${TraderApp.state.simulation.id}/trades`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbol, action: type, quantity: qty, price })
            });
            
            if (ok) {
                showAlert(`${type === 'buy' ? '买入' : '卖出'}委托已提交`, 'success');
                TraderApp.ui.addLog(`${type === 'buy' ? '买入' : '卖出'}提交: ${symbol} ${qty}股 @ ¥${price.toFixed(2)}`, `/api/simulations/${TraderApp.state.simulation.id}/trades`);
                $(type === 'buy' ? 'buyForm' : 'sellForm').reset();
                await this.updateStatus();
            } else showAlert(result.error || '交易失败', 'danger');
        },

        async create() {
            const initialCapital = parseFloat($('accountCapital').value);
            const commission = parseFloat($('accountCommission').value) || 0.001;
            const slippage = parseFloat($('accountSlippage').value) || 0.0005;
            
            if (isNaN(initialCapital) || initialCapital <= 0) { showAlert('初始资金必须大于0', 'warning'); return; }
            
            const { ok, data: result } = await apiRequest('/api/simulations', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ initial_capital: initialCapital, commission, slippage })
            });
            
            if (ok) {
                TraderApp.state.simulation = { id: result.simulation_id, status: 'running', initial_capital: initialCapital, current_capital: initialCapital, positions: {}, trades: [] };
                showAlert('交易账户创建成功', 'success');
                TraderApp.ui.addLog(`创建账户: 资金 ¥${initialCapital.toLocaleString()}`, '/api/simulations');
                await this.updateStatus();
                bootstrap.Modal.getInstance($('createAccountModal')).hide();
            } else showAlert(result.error || '创建失败', 'danger');
        },

        async stop() {
            if (!TraderApp.state.simulation) return;
            if (!confirm('确定要关闭交易账户吗？')) return;
            const { ok } = await apiRequest(`/api/simulations/${TraderApp.state.simulation.id}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'stopped' })
            });
            if (ok) {
                showAlert('账户已关闭', 'success'); TraderApp.ui.addLog('关闭交易账户');
                TraderApp.state.simulation.status = 'stopped'; this.updateDisplay();
            }
        },

        quickSell(symbol, qty) {
            $('sell-tab').click();
            setTimeout(() => {
                $('sellPositionSelect').value = symbol;
                this.loadSellPosition();
                $('sellQuantity').value = qty;
                TraderApp.ui.calculateEstimatedAmount('sell');
            }, 100);
        },

        loadSellPosition() {
            const sym = $('sellPositionSelect').value;
            if (!sym || !TraderApp.state.simulation?.positions?.[sym]) return;
            const pos = TraderApp.state.simulation.positions[sym];
            const price = TraderApp.market.getCurrentPrice(sym) || pos.avg_price || 0;
            $('sellSymbol').value = sym;
            $('sellAvailable').value = Math.abs(pos.quantity) + ' 股';
            $('sellPrice').value = price.toFixed(2);
            TraderApp.ui.calculateEstimatedAmount('sell');
            TraderApp.market.updateQuoteUI(TraderApp.state.marketData[sym] || { symbol: sym, latest_price: price });
        },

        cancelOrder(id) {
            showAlert('目前仿真模式暂不支持手动撤单，请等待自动撮合', 'info');
        }
    },

    // 8. UI 交互与显示模块
    ui: {
        initListeners() {
            ['buy', 'sell'].forEach(type => {
                $(`${type}Price`)?.addEventListener('input', () => this.calculateEstimatedAmount(type));
                $(`${type}Quantity`)?.addEventListener('input', () => this.calculateEstimatedAmount(type));
            });
            window.addEventListener('resize', () => {
                if (TraderApp.state.currentChartType === 'daily') TraderApp.charts.drawCandlestick();
            });
            window.addEventListener('beforeunload', () => {
                Object.values(TraderApp.state.timers).forEach(t => t && clearInterval(t));
            });
        },

        calculateEstimatedAmount(type) {
            const p = parseFloat($(`${type}Price`).value) || 0;
            const q = parseInt($(`${type}Quantity`).value) || 0;
            $(`${type}EstimatedAmount`).textContent = '¥' + (p * q).toLocaleString('zh-CN', { minimumFractionDigits: 2 });
        },

        updateAccountOverview() {
            const sim = TraderApp.state.simulation;
            if (!sim) return;
            const initial = sim.initial_capital || 1000000;
            const available = (sim.current_capital || initial) - (sim.frozen_capital || 0);
            let posVal = 0;
            if (sim.positions) {
                Object.entries(sim.positions).forEach(([sym, pos]) => {
                    posVal += Math.abs(pos.quantity) * (TraderApp.market.getCurrentPrice(sym) || pos.avg_price || 0);
                });
            }
            const total = available + posVal;
            const pnl = total - initial;
            const ret = ((pnl / initial) * 100).toFixed(2);
            
            $('totalAssets').textContent = '¥' + total.toLocaleString('zh-CN', { minimumFractionDigits: 2 });
            $('availableCapital').textContent = '¥' + available.toLocaleString('zh-CN', { minimumFractionDigits: 2 });
            $('positionValue').textContent = '¥' + posVal.toLocaleString('zh-CN', { minimumFractionDigits: 2 });
            
            const pnlEl = $('totalPnL'), retEl = $('totalReturn');
            pnlEl.textContent = (pnl >= 0 ? '+' : '') + '¥' + pnl.toLocaleString('zh-CN', { minimumFractionDigits: 2 });
            pnlEl.className = 'account-value ' + (pnl >= 0 ? 'text-warning' : 'text-info');
            retEl.textContent = (ret >= 0 ? '+' : '') + ret + '%';
            retEl.className = 'account-value ' + (ret >= 0 ? 'text-warning' : 'text-info');
            
            const statusEl = $('simulationStatus');
            statusEl.textContent = sim.status === 'running' ? '运行中' : '已关闭';
            statusEl.className = 'simulation-status ' + (sim.status === 'running' ? 'running' : 'stopped');
            
            if ($('accountId')) {
                const id = sim.id;
                $('accountId').textContent = id.startsWith('demo') ? 'demo' : (id.match(/\d+/) ? 'df' + id.match(/\d+/)[0].padStart(4, '0') : id);
            }
            if ($('commissionDisplay')) $('commissionDisplay').textContent = ((sim.commission || 0.001) * 100).toFixed(2) + '%';
        },

        updatePositions() {
            const body = $('positionTableBody'); if (!body) return;
            const sim = TraderApp.state.simulation;
            if (!sim?.positions || Object.keys(sim.positions).length === 0) {
                body.innerHTML = renderEmptyState(9, 'fa-inbox', '暂无持仓');
                this.updateSellSelect(); return;
            }
            const rows = Object.entries(sim.positions).map(([sym, pos]) => {
                const qty = Math.abs(pos.quantity); if (qty === 0) return '';
                const curP = TraderApp.market.getCurrentPrice(sym) || pos.avg_price || 0;
                const pnl = (curP - pos.avg_price) * qty;
                const rate = pos.avg_price > 0 ? ((curP - pos.avg_price) / pos.avg_price * 100).toFixed(2) : '0.00';
                return `<tr><td>${sym}</td><td>${TraderApp.state.marketData[sym]?.name || sym}</td><td>${qty}</td><td>¥${pos.avg_price.toFixed(2)}</td><td class="${rate >= 0 ? 'price-up' : 'price-down'}">¥${curP.toFixed(2)}</td><td class="position-profit ${rate >= 0 ? 'positive' : 'negative'}">${pnl >= 0 ? '+' : ''}¥${pnl.toFixed(2)}</td><td class="position-profit ${rate >= 0 ? 'positive' : 'negative'}">${rate >= 0 ? '+' : ''}${rate}%</td><td>¥${(qty * curP).toFixed(2)}</td><td><button class="btn-action" onclick="quickSell('${sym}', ${qty})"><i class="fas fa-arrow-down"></i></button></td></tr>`;
            }).join('');
            body.innerHTML = rows || renderEmptyState(9, 'fa-inbox', '暂无持仓');
            this.updateSellSelect();
        },

        updateSellSelect() {
            const sel = $('sellPositionSelect'); if (!sel) return;
            sel.innerHTML = '<option value="">请选择持仓</option>' + Object.entries(TraderApp.state.simulation?.positions || {}).filter(([_, p]) => Math.abs(p.quantity) > 0).map(([s, p]) => `<option value="${s}">${s} ${TraderApp.state.marketData[s]?.name || s} (${Math.abs(p.quantity)}股)</option>`).join('');
        },

        updateTrades() {
            const body = $('tradesTableBody'); if (!body) return;
            const ts = TraderApp.state.simulation?.trades || [];
            if (ts.length === 0) { body.innerHTML = renderEmptyState(9, 'fa-check-circle', '暂无成交'); return; }
            body.innerHTML = ts.slice().reverse().slice(0, TraderApp.CONSTANTS.MAX_TRADES_DISPLAY).map((t, i) => {
                const amt = (t.price || 0) * (t.quantity || 0);
                return `<tr><td>${(TraderApp.CONSTANTS.BASE_ID + ts.length - i - 1).toString().padStart(8, '0')}</td><td>${TraderApp.utils.generateOrderId(t, ts.length - i - 1).toString().padStart(8, '0')}</td><td>${t.symbol}</td><td>${TraderApp.state.marketData[t.symbol]?.name || t.symbol}</td><td><span class="direction-badge ${t.action}">${t.action === 'buy' ? '买入' : '卖出'}</span></td><td>¥${(t.price || 0).toFixed(2)}</td><td>${t.quantity}</td><td>¥${amt.toFixed(2)}</td><td>${formatDateTime(t.date || t.timestamp)}</td></tr>`;
            }).join('');
        },

        updateOrders() {
            const body = $('ordersTableBody'); if (!body) return;
            const ts = TraderApp.state.simulation?.trades || [];
            if (ts.length === 0) { body.innerHTML = renderEmptyState(10, 'fa-list-alt', '暂无委托'); return; }
            body.innerHTML = ts.slice().reverse().slice(0, TraderApp.CONSTANTS.MAX_ORDERS_DISPLAY).map((t, i) => {
                const oid = TraderApp.utils.generateOrderId(t, ts.length - i - 1).toString().padStart(8, '0');
                return `<tr><td>${oid}</td><td>${t.symbol}</td><td>${TraderApp.state.marketData[t.symbol]?.name || t.symbol}</td><td><span class="direction-badge ${t.action}">${t.action === 'buy' ? '买入' : '卖出'}</span></td><td>¥${(t.price || 0).toFixed(2)}</td><td>${t.quantity}</td><td>${t.quantity}</td><td><span class="order-status filled">全部成交</span></td><td>${formatDateTime(t.date || t.timestamp)}</td><td><button class="btn-action" onclick="cancelOrder('${t.order_id || oid}')"><i class="fas fa-times"></i></button></td></tr>`;
            }).join('');
        },

        addLog(msg, api = '') {
            TraderApp.state.logs.unshift({ time: new Date().toLocaleTimeString(), message: msg, api });
            if (TraderApp.state.logs.length > TraderApp.CONSTANTS.MAX_LOG_ENTRIES) TraderApp.state.logs.pop();
            this.updateLogs();
        },

        updateLogs() {
            const body = $('logTableBody'); if (!body) return;
            if (TraderApp.state.logs.length === 0) { body.innerHTML = '<tr><td colspan="2" class="text-center text-muted py-3">暂无日志</td></tr>'; return; }
            body.innerHTML = TraderApp.state.logs.map(l => `<tr style="font-size: 11px;"><td>${l.time}</td><td class="${l.message.includes('买入') ? 'log-buy' : (l.message.includes('卖出') ? 'log-sell' : 'log-info')}">${l.message}</td></tr>`).join('');
        },

        switchDataView(type, btn) {
            if (btn?.parentElement) btn.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            btn?.classList.add('active');
            document.querySelectorAll('.data-view').forEach(v => v.classList.add('d-none'));
            document.querySelector('.data-view-' + type)?.classList.remove('d-none');
        },

        showCreateAccountModal() { new bootstrap.Modal($('createAccountModal')).show(); },
        clearLogs() { TraderApp.state.logs = []; this.updateLogs(); },
        cancelFollow(type) { const chk = $(type + 'Follow'); if (chk) chk.checked = false; this.calculateEstimatedAmount(type); }
    }
};

// =========================================================
// 全局兼容性导出 (供 HTML onclick 属性调用)
// =========================================================
const initializeTradingInterface = () => TraderApp.init();
const loadActiveSimulations = () => TraderApp.account.loadActive();
const updateSimulationStatus = () => TraderApp.account.updateStatus();
const loadStockInfo = (type) => TraderApp.market.loadStockInfo(type);
const submitBuyOrder = () => TraderApp.account.submitOrder('buy');
const submitSellOrder = () => TraderApp.account.submitOrder('sell');
const quickSell = (symbol, qty) => TraderApp.account.quickSell(symbol, qty);
const setPrice = (type, pType) => TraderApp.market.setPrice(type, pType);
const setQuantity = (type, val, isPct) => TraderApp.market.setQuantity(type, val, isPct);
const switchChartType = (type) => TraderApp.charts.switchType(type);
const switchIndicator = (ind, btn) => TraderApp.charts.switchIndicator(ind, btn);
const switchDataView = (type, btn) => TraderApp.ui.switchDataView(type, btn);
const showCreateAccount = () => TraderApp.ui.showCreateAccountModal();
const createAccount = () => TraderApp.account.create();
const stopSimulation = () => TraderApp.account.stop();
const cancelOrder = (id) => TraderApp.account.cancelOrder(id);
const clearLogs = () => TraderApp.ui.clearLogs();
const loadSellPosition = () => TraderApp.account.loadSellPosition();
const cancelFollow = (type) => TraderApp.ui.cancelFollow(type);

// 启动应用
document.addEventListener('DOMContentLoaded', () => TraderApp.init());
