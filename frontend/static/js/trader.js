/**
 * 交易页核心 (trader.js)
 *
 * 模块顺序：CONSTANTS → state → utils → market → charts → account → ui → init
 *   CONSTANTS  常量（数量步长、刷新间隔等）
 *   state      全局状态（当前账户、行情缓存、图表类型、定时器）
 *   utils      工具（委托校验、资产类型判断）
 *   market     行情（轮询、标的加载、盘口/报价、买一卖一/数量快捷）
 *   charts     图表（分时初始化·加点、日K·MA/BOLL、切换与交互）
 *   account    账户（列表·启停·删除、加载·刷新、下单·撤单·持仓快捷卖）
 *   ui         界面（布局同步、事件绑定、时钟、总览/持仓/成交/委托表格、管理弹窗）
 *   init       初始化入口
 */
const TraderApp = {
    /** 全局常量配置：数量步长、展示条数、轮询刷新间隔等。 */
    CONSTANTS: {
        MIN_QUANTITY: 100,
        QUANTITY_STEP: 100,
        MAX_TRADES_DISPLAY: 50,
        MAX_ORDERS_DISPLAY: 20,
        REFRESH_RATE_ACCOUNT: 5000,
        REFRESH_RATE_MARKET: 5000
    },

    /** 全局运行状态：当前账户、行情缓存、图表偏好与定时器句柄。 */
    state: {
        simulation: null,
        marketData: {},
        orders: [],
        trades: [],
        currentChartType: 'intraday',
        currentIndicator: 'ma',
        timers: {
            account: null,
            market: null,
            clock: null
        }
    },

    /** 工具方法：下单参数校验、资产类型识别等。 */
    utils: {
        /** 校验标的、价格、数量（股票按100股整数倍；加密货币不限制手数），无效则弹窗并返回 false。 */
        validateOrderForm(symbol, price, quantity) {
            if (!symbol) { showAlert('请输入标的代码', 'warning'); return false; }
            if (!price || price <= 0) { showAlert('请输入有效的价格', 'warning'); return false; }
            if (!quantity || quantity <= 0) { showAlert('请输入有效的数量', 'warning'); return false; }

            const assetType = this.getAssetType(symbol);
            const isStock = assetType === 'A-Share' || assetType === 'US-Stock';
            if (isStock) {
                if (quantity < TraderApp.CONSTANTS.MIN_QUANTITY) {
                    showAlert(`股票交易数量至少${TraderApp.CONSTANTS.MIN_QUANTITY}股`, 'warning');
                    return false;
                }
                if (quantity % TraderApp.CONSTANTS.QUANTITY_STEP !== 0) {
                    showAlert('股票交易数量必须是100的整数倍', 'warning');
                    return false;
                }
            }
            return true;
        },

        /** 根据标的代码返回资产类型：A-Share / US-Stock / Crypto。 */
        getAssetType(symbol) {
            if (!symbol) return 'Crypto';
            const s = symbol.toUpperCase();
            if (s.endsWith('.SS') || s.endsWith('.SZ') || s.endsWith('.SH')) return 'A-Share';
            if (s.endsWith('-USD') || s.includes('BTC') || s.includes('ETH')) return 'Crypto';
            return 'US-Stock';
        }
    },

    /** 行情模块：订阅与轮询、标的加载、报价区与盘口更新。 */
    market: {
        /** 启动行情定时轮询，拉取已订阅标的并刷新当前报价。 */
        async startUpdateLoop() {
            if (TraderApp.state.timers.market) clearInterval(TraderApp.state.timers.market);
            await this.updateAll();
            TraderApp.state.timers.market = setInterval(async () => {
                await this.updateAll();
                const currentSymbol = $('quoteSymbol')?.textContent;
                if (currentSymbol && currentSymbol !== '--' && TraderApp.state.marketData[currentSymbol]) {
                    this.updateQuoteUI(TraderApp.state.marketData[currentSymbol]);
                }
            }, TraderApp.CONSTANTS.REFRESH_RATE_MARKET);
        },

        /** 并发请求所有已订阅标的的 live 数据并更新 marketData、报价区。 */
        async updateAll() {
            const symbols = Object.keys(TraderApp.state.marketData);
            const updatePromises = symbols.map(async (symbol) => {
                try {
                    const stock = TraderApp.state.marketData[symbol];
                    const needHistory = !stock.hasLoadedHistory;
                    const url = `/api/data/live/${symbol}${needHistory ? '?history=true' : ''}`;
                    
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

        /** 根据买卖侧输入框加载标的信息并更新报价、价格输入、URL hash。 */
        async loadStockInfo(type) {
            const symbolInput = $(type === 'buy' ? 'buySymbol' : 'sellSymbol');
            if (!symbolInput) return;
            
            const symbol = symbolInput.value.toUpperCase().trim();
            if (!symbol) return;
            symbolInput.value = symbol;

            const symbolChanged = symbolInput.getAttribute('data-last-symbol') !== symbol;
            symbolInput.setAttribute('data-last-symbol', symbol);

            if (!TraderApp.state.marketData[symbol]) {
                TraderApp.state.marketData[symbol] = {
                    symbol: symbol,
                    name: '正在加载...',
                    latest_price: 0
                };
            }
            
            const stock = TraderApp.state.marketData[symbol];
            const price = stock.latest_price || 0;
            
            const priceInput = $(type === 'buy' ? 'buyPrice' : 'sellPrice');
            if (priceInput) {
                if (symbolChanged) priceInput.value = price > 0 ? price.toFixed(2) : '';
                else if (!priceInput.value && price > 0) priceInput.value = price.toFixed(2);
            }
            if (type === 'buy' && $('buyName')) $('buyName').value = symbol;
            TraderApp.ui.calculateEstimatedAmount(type);
            this.updateQuoteUI(stock);
            if (type === 'buy') window.location.hash = symbol;

            try {
                const response = await fetch(`/api/data/live/${symbol}`);
                if (!response.ok) return;
                const data = await response.json();
                if (!data || data.error || data.status === 'loading') return;
                TraderApp.state.marketData[symbol] = {
                    ...TraderApp.state.marketData[symbol],
                    latest_price: data.price, timestamp: data.timestamp, minute: data.minute,
                    open: data.open, high: data.high, low: data.low, name: data.name || symbol
                };
                this.updateQuoteUI(TraderApp.state.marketData[symbol]);
                const priceEl = $(type === 'buy' ? 'buyPrice' : 'sellPrice');
                if (priceEl && (!priceEl.value || priceEl.value === '0.00')) priceEl.value = data.price.toFixed(2);
                TraderApp.ui.calculateEstimatedAmount(type);
            } catch (e) {
                console.error('Failed to fetch quote during loadStockInfo:', e);
            }
        },

        /** 将 stock 数据写入行情区（代码、名称、今开最高最低、现价、涨跌幅、盘口）并驱动分时/日 K。 */
        updateQuoteUI(stock) {
            if (!stock) return;
            
            const quoteSymbolEl = $('quoteSymbol');
            const currentShownSymbol = quoteSymbolEl ? quoteSymbolEl.textContent : '';
            const newAssetType = TraderApp.utils.getAssetType(stock.symbol);
            
            if (currentShownSymbol === '--' || currentShownSymbol === '') {
                TraderApp.charts.initIntraday(stock.symbol);
            } else if (currentShownSymbol !== stock.symbol) {
                const oldAssetType = TraderApp.utils.getAssetType(currentShownSymbol);
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
                open: $('quoteOpen'),
                high: $('quoteHigh'),
                low: $('quoteLow'),
                dailyReturn: $('quoteDailyReturn')
            };
            
            if (els.symbol) els.symbol.textContent = stock.symbol || '--';
            if (els.name) els.name.textContent = stock.name || '--';
            if (els.price) {
                const price = stock.latest_price || 0;
                const open = stock.open;
                const pct = (open && open > 0) ? (price - open) / open : 0;
                els.price.textContent = '¥' + price.toFixed(2);
                els.price.className = 'market-price ' + (pct >= 0 ? 'price-up' : 'price-down');
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
            if (els.dailyReturn) {
                const price = stock.latest_price || 0;
                const open = stock.open;
                if (open && open > 0) {
                    const pct = ((price - open) / open * 100);
                    els.dailyReturn.textContent = '日内 ' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
                    els.dailyReturn.className = (pct >= 0 ? 'price-up' : 'price-down');
                } else {
                    els.dailyReturn.textContent = '--';
                    els.dailyReturn.className = 'text-muted';
                }
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
        },

        /** 用当前价 ± 档位更新买卖五档盘口（模拟量）。 */
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

        /** 按买一/现价/卖一填入买卖侧价格输入框。 */
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
            } else if (priceType === 'bid1') {
                price = currentPrice - spread;
            } else if (priceType === 'ask1') {
                price = currentPrice + spread;
            }
            
            $(type === 'buy' ? 'buyPrice' : 'sellPrice').value = price.toFixed(2);
            TraderApp.ui.calculateEstimatedAmount(type);
        },

        /** 按比例或固定值设置买卖数量（股票按100股取整，加密货币按单位数量）。 */
        setQuantity(type, val, isPercent = false) {
            let quantity = 0;
            const symbolInputId = type === 'buy' ? 'buySymbol' : 'sellSymbol';
            const symbol = ($(symbolInputId)?.value || '').toUpperCase().trim();
            const assetType = TraderApp.utils.getAssetType(symbol);
            const isStock = assetType === 'A-Share' || assetType === 'US-Stock';
            
            if (isPercent) {
                // 兼容两种调用方式：
                //  - HTML 传入 0.25 / 0.5 / 1.0 表示 25% / 50% / 100%
                //  - 也支持传入 25 / 50 / 100 表示百分比
                const ratio = val > 1 ? (val / 100) : val;

                if (type === 'buy') {
                    const price = parseFloat($('buyPrice').value) || 0;
                    if (price <= 0) {
                        showAlert('请先输入买入价格', 'warning');
                        return;
                    }
                    const available = TraderApp.state.simulation ? TraderApp.state.simulation.current_capital : 0;
                    const commission = TraderApp.state.simulation ? TraderApp.state.simulation.commission : 0.001;
                    const maxQty = Math.floor(available / (price * (1 + commission)));
                    const baseQty = Math.floor(maxQty * ratio);
                    quantity = isStock ? Math.floor(baseQty / TraderApp.CONSTANTS.QUANTITY_STEP) * TraderApp.CONSTANTS.QUANTITY_STEP : baseQty;
                } else {
                    const available = parseInt($('sellAvailable')?.dataset.rawQty || $('sellAvailable')?.value) || 0;
                    const baseQty = Math.floor(available * ratio);
                    quantity = isStock ? Math.floor(baseQty / TraderApp.CONSTANTS.QUANTITY_STEP) * TraderApp.CONSTANTS.QUANTITY_STEP : baseQty;
                }
            } else if (type === 'sell' && val === 'all') {
                const available = parseInt($('sellAvailable')?.dataset.rawQty || $('sellAvailable')?.value) || 0;
                quantity = isStock
                    ? Math.floor(available / TraderApp.CONSTANTS.QUANTITY_STEP) * TraderApp.CONSTANTS.QUANTITY_STEP
                    : available;
            } else {
                quantity = val;
            }
            
            $(type === 'buy' ? 'buyQuantity' : 'sellQuantity').value = quantity;
            TraderApp.ui.calculateEstimatedAmount(type);
        },

        /** 返回指定标的的最新价，无则 0。 */
        getCurrentPrice(sym) {
            return TraderApp.state.marketData[sym]?.latest_price || 0;
        }
    },

    /** 图表模块：分时/日 K 数据管理、MA/BOLL 计算与绘制及鼠标交互。 */
    charts: {
        instance: { intraday: null, daily: null },
        data: {
            intraday: { labels: [], prices: [], vwap: [], volumes: [] },
            daily: { dates: [], candles: [] }
        },

        /** 按资产类型返回分时时间轴区间（A 股/美股/加密货币）。 */
        getTimeAxisConfig(assetType) {
            const configs = {
                'A-Share': [{ start: '09:30', end: '11:30' }, { start: '13:00', end: '15:00' }],
                'US-Stock': [{ start: '09:30', end: '16:00' }],
                'Crypto': [{ start: '00:00', end: '23:59' }]
            };
            return configs[assetType] || configs['Crypto'];
        },

        /** 初始化分时图：时间轴、价格/均价/成交量数据集与 Chart 实例。 */
        initIntraday(symbol = 'BTC-USD') {
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
                                callback: (v, index, ticks) => {
                                    if (index === ticks.length - 1) return '';
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

        /** 向分时图追加一个 tick（价格、增量成交量、VWAP 及前填）。 */
        addIntradayPoint(price, totalVolume = 0, timestamp = null, minute = null) {
            if (!this.instance.intraday || !price) return;
            
            const timeStr = minute || (() => {
                const t = timestamp ? new Date(timestamp) : new Date();
                return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
            })();
            
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

        /** 清空分时与日 K 数据并刷新图表。 */
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

        /** 拉取近半年日 K（GET/POST 文件接口），返回 { dates, candles }。 */
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

        /** 切换分时/日 K 展示并刷新日 K 数据与蜡烛图。 */
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

        /** 切换 MA/BOLL 指标并重绘日 K。 */
        switchIndicator(indicator, btn) {
            TraderApp.state.currentIndicator = indicator;
            const indicatorButtons = $('indicatorButtons');
            if (indicatorButtons) {
                indicatorButtons.querySelectorAll('button').forEach(b => b.classList.remove('active'));
                if (btn) btn.classList.add('active');
            }
            if ($('dailyChart')?.style.display !== 'none') this.drawCandlestick();
        },

        /** 计算指定周期的收盘价简单移动平均。 */
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

        /** 计算布林带中轨、上轨、下轨。 */
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

        /** 在 canvas 上绘制日 K 蜡烛图及当前指标（MA 或 BOLL）。 */
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

        /** 绑定日 K 图 mousemove/mouseleave，显示当日 OHLC tooltip。 */
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

    /** 账户模块：账户列表管理、启停/删除、状态刷新与下单/撤单。 */
    account: {
        _pendingConfirm: { id: null, action: null },

        /** 计算某标的的可卖数量：持仓数量减去未完成卖出委托数量。 */
        getAvailableSellQuantity(symbol) {
            const sim = TraderApp.state.simulation;
            if (!sim?.positions?.[symbol]) return 0;
            const total = Math.abs(sim.positions[symbol].quantity);
            const pendingSell = (sim.orders || [])
                .filter(o => o.symbol === symbol && o.action === 'sell' && o.status === 'pending')
                .reduce((sum, o) => sum + (o.quantity || 0), 0);
            return Math.max(total - pendingSell, 0);
        },

        /** 拉取仿真列表并渲染管理弹窗内的账户行（含行内停止/删除确认）。 */
        async renderManageAccountList() {
            const body = $('manageAccountListBody');
            if (!body) return;
            const { ok, data } = await apiRequest('/api/simulations');
            body.innerHTML = '';
            if (!ok || !data.simulations || data.simulations.length === 0) {
                body.innerHTML = '<div class="list-group-item text-muted small text-center py-3">暂无账户，请新建</div>';
                return;
            }
            const pending = this._pendingConfirm;
            data.simulations.forEach(s => {
                const div = document.createElement('div');
                div.className = 'list-group-item list-group-item-action d-flex justify-content-between align-items-center py-2';
                div.style.cursor = 'pointer';
                const isRunning = s.status === 'running';

                const leftDiv = document.createElement('div');
                leftDiv.className = 'd-flex align-items-center gap-2 flex-grow-1';
                leftDiv.innerHTML = `
                    <span class="fw-500 text-dark" style="font-size: 14px;">${s.name || s.id}</span>
                    ${isRunning 
                        ? '<span class="badge bg-success bg-opacity-10 text-success rounded-pill" style="font-size: 11px; font-weight: 500;">运行中</span>' 
                        : '<span class="badge bg-secondary bg-opacity-10 text-secondary rounded-pill" style="font-size: 11px; font-weight: 500;">已停止</span>'}
                `;
                leftDiv.onclick = async () => {
                    if (pending.id) return;
                    await this.loadAccount(s.id);
                    bootstrap.Modal.getInstance($('manageAccountModal'))?.hide();
                };
                div.appendChild(leftDiv);

                const rightDiv = document.createElement('div');
                rightDiv.className = 'd-flex align-items-center gap-2';

                if (pending.id === s.id && pending.action === 'stop') {
                    rightDiv.className = 'd-flex align-items-center gap-2 account-inline-confirm';
                    rightDiv.innerHTML = '<span class="account-inline-confirm-text">确定停止当前账户？</span><button type="button" class="btn btn-sm btn-danger account-inline-btn">确定</button><button type="button" class="btn btn-sm btn-outline-secondary account-inline-btn">取消</button>';
                    rightDiv.querySelector('.btn-danger').onclick = async (e) => {
                        e.stopPropagation();
                        await this.doStopAccount(s.id);
                        this._pendingConfirm = { id: null, action: null };
                        await this.renderManageAccountList();
                    };
                    rightDiv.querySelector('.btn-outline-secondary').onclick = (e) => {
                        e.stopPropagation();
                        this._pendingConfirm = { id: null, action: null };
                        this.renderManageAccountList();
                    };
                } else if (pending.id === s.id && pending.action === 'delete') {
                    rightDiv.className = 'd-flex align-items-center gap-2 account-inline-confirm';
                    rightDiv.innerHTML = '<span class="account-inline-confirm-text">确定删除？此操作不可恢复。</span><button type="button" class="btn btn-sm btn-danger account-inline-btn">确定</button><button type="button" class="btn btn-sm btn-outline-secondary account-inline-btn">取消</button>';
                    rightDiv.querySelector('.btn-danger').onclick = async (e) => {
                        e.stopPropagation();
                        this._pendingConfirm = { id: null, action: null };
                        await this.deleteAccount(s.id, true);
                    };
                    rightDiv.querySelector('.btn-outline-secondary').onclick = (e) => {
                        e.stopPropagation();
                        this._pendingConfirm = { id: null, action: null };
                        this.renderManageAccountList();
                    };
                } else {
                    if (isRunning) {
                        const btn = document.createElement('button');
                        btn.className = 'btn btn-icon-only text-danger stop-account-btn';
                        btn.title = '停止账户';
                        btn.innerHTML = '<i class="fas fa-power-off"></i>';
                        btn.onclick = async (e) => {
                            e.stopPropagation();
                            this._pendingConfirm = { id: s.id, action: 'stop' };
                            await this.renderManageAccountList();
                        };
                        rightDiv.appendChild(btn);
                    }
                    const delBtn = document.createElement('button');
                    delBtn.className = 'btn btn-icon-only text-muted delete-account-btn';
                    delBtn.title = '删除账户';
                    delBtn.innerHTML = '<i class="fas fa-trash-alt" style="font-size: 13px;"></i>';
                    delBtn.onclick = async (e) => {
                        e.stopPropagation();
                        this._pendingConfirm = { id: s.id, action: 'delete' };
                        await this.renderManageAccountList();
                    };
                    rightDiv.appendChild(delBtn);
                }
                div.appendChild(rightDiv);
                body.appendChild(div);
            });
        },

        /** 调用 PUT 停止指定账户并更新本地状态与界面。 */
        async doStopAccount(id) {
            const { ok } = await apiRequest(`/api/simulations/${id}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'stopped' })
            });
            if (ok) {
                showAlert('账户已关闭', 'success');
                if (TraderApp.state.simulation && TraderApp.state.simulation.id === id) {
                    TraderApp.state.simulation.status = 'stopped';
                    TraderApp.state.simulation.positions = {};
                    TraderApp.state.simulation.trades = [];
                    TraderApp.state.simulation.orders = [];
                    TraderApp.state.simulation.frozen_capital = 0;
                    this.updateDisplay();
                }
            }
        },

        /** 删除账户配置（可选跳过确认），若为当前账户则清空 state 并刷新列表。 */
        async deleteAccount(id, skipConfirm = false) {
            if (!skipConfirm && !confirm('确定要删除该账户吗？此操作不可恢复。')) return;
            const { ok, data } = await apiRequest(`/api/simulations/${id}`, { method: 'DELETE' });
            if (ok) {
                // If deleted active account, clear state
                if (TraderApp.state.simulation && TraderApp.state.simulation.id === id) {
                    TraderApp.state.simulation = null;
                    this.updateDisplay();
                }
                this.renderManageAccountList();
            } else {
                showAlert(data.error || '删除失败', 'danger');
            }
        },

        /** 加载指定账户详情，若未运行则尝试启动，并刷新总览/持仓/委托/成交。 */
        async loadAccount(id) {
            if (!id) { TraderApp.state.simulation = null; TraderApp.ui.updateAccountOverview(); return; }
            const { ok, data } = await apiRequest(`/api/simulations/${id}`);
            if (!ok || !data.simulation) return;
            const sim = data.simulation;
            if (sim.status !== 'running') {
                const { ok: okStart, data: startData } = await apiRequest(`/api/simulations/${id}/start`, { method: 'POST' });
                if (okStart && startData.simulation) {
                    TraderApp.state.simulation = startData.simulation;
                } else {
                    TraderApp.state.simulation = sim;
                }
            } else {
                TraderApp.state.simulation = sim;
            }
            this.updateDisplay();
        },

        /** 页面加载时拉取运行中的手动账户并设为当前 simulation。 */
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
                        }
                    }
                }
            } catch (error) { console.error('Error loading active simulations:', error); }
        },

        /** 拉取当前账户最新状态并合并到 state，刷新界面。 */
        async updateStatus() {
            if (!TraderApp.state.simulation) return;
            try {
                const { ok, data } = await apiRequest(`/api/simulations/${TraderApp.state.simulation.id}`);
                if (ok && data.simulation) {
                    TraderApp.state.simulation = { ...TraderApp.state.simulation, ...data.simulation };
                    if (!data.simulation.orders) {
                        TraderApp.state.simulation.orders = [];
                    }
                    this.updateDisplay();
                }
            } catch (error) { console.error('Error updating simulation status:', error); }
        },

        /** 刷新总览、主按钮、持仓表、成交表、委托表。 */
        updateDisplay() {
            TraderApp.ui.updateAccountOverview();
            const btn = $('accountActionBtn');
            if (btn) {
                const isRunning = TraderApp.state.simulation && TraderApp.state.simulation.status === 'running';
                if (isRunning) {
                    btn.className = 'btn btn-sm btn-outline-secondary w-100 mt-auto';
                    btn.innerHTML = '<i class="fas fa-th-list me-1"></i>管理账户';
                } else {
                    btn.className = 'btn btn-sm btn-primary w-100 mt-auto';
                    btn.innerHTML = '<i class="fas fa-play me-1"></i>启动账户';
                }
            }

            if (!TraderApp.state.simulation) return;
            TraderApp.ui.updatePositions();
            TraderApp.ui.updateTrades();
            TraderApp.ui.updateOrders();
        },

        /** 校验后提交买卖限价单并刷新状态。 */
        async submitOrder(type) {
            if (!TraderApp.state.simulation || TraderApp.state.simulation.status !== 'running') {
                showAlert('请先创建并运行交易账户', 'warning'); return;
            }
            const symbol = $(type === 'buy' ? 'buySymbol' : 'sellSymbol').value.toUpperCase().trim();
            const price = parseFloat($(type === 'buy' ? 'buyPrice' : 'sellPrice').value);
            const qty = parseInt($(type === 'buy' ? 'buyQuantity' : 'sellQuantity').value);
            
            if (!TraderApp.utils.validateOrderForm(symbol, price, qty)) return;
            const sim = TraderApp.state.simulation;
            if (type === 'buy') {
                const initial = sim.initial_capital || 1000000;
                const currentCash = sim.current_capital !== undefined ? sim.current_capital : initial;
                const available = currentCash - (sim.frozen_capital || 0);
                const cost = price * qty * (1 + (sim.commission || 0.001)); // 预估含手续费
                if (cost > available) {
                    showAlert(`资金不足，可用: ¥${available.toLocaleString()}，需要: ¥${cost.toLocaleString()}`, 'warning');
                    return;
                }
            } else {
                const available = this.getAvailableSellQuantity(symbol);
                if (qty > available) {
                    showAlert(`持仓不足，可卖: ${available}，卖出: ${qty}`, 'warning');
                    return;
                }
            }

            const { ok, data: result } = await apiRequest(`/api/simulations/${TraderApp.state.simulation.id}/trades`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbol, action: type, quantity: qty, price })
            });
            
            if (ok) {
                showAlert(`${type === 'buy' ? '买入' : '卖出'}委托已提交`, 'success');
                await this.updateStatus();
            } else showAlert(result.error || '交易失败', 'danger');
        },

        /** 根据新建表单创建仿真账户（不自动启动），成功后刷新列表。 */
        async create() {
            const accountType = document.querySelector('input[name="accountType"]:checked')?.value || 'local_paper';
            if (accountType === 'broker') {
                showAlert('券商实盘暂未开通此功能', 'warning');
                return;
            }
            const name = ($('accountName') && $('accountName').value || '').trim();
            if (!name) { showAlert('请填写账户名称', 'warning'); return; }
            const initialCapital = parseFloat($('accountCapital').value);
            const commission = parseFloat($('accountCommission').value) || 0.001;
            const slippage = parseFloat($('accountSlippage').value) || 0.0005;
            if (isNaN(initialCapital) || initialCapital <= 0) { showAlert('初始资金必须大于0', 'warning'); return; }
            const { ok, data: result } = await apiRequest('/api/simulations', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ account_type: accountType, name, initial_capital: initialCapital, commission, slippage, start: false })
            });
            if (ok) {
                showAlert('交易账户创建成功', 'success');
                switchManageView('list');
                await this.renderManageAccountList();
            } else showAlert(result.error || '创建失败', 'danger');
        },

        /** 切到卖出 Tab 并填入指定标的与数量。 */
        quickSell(symbol, qty) {
            $('sell-tab').click();
            setTimeout(() => {
                $('sellPositionSelect').value = symbol;
                this.loadSellPosition();
                $('sellQuantity').value = qty;
                TraderApp.ui.calculateEstimatedAmount('sell');
            }, 100);
        },

        /** 根据卖出持仓下拉框选中项填充卖出标的、可卖数量与价格（可卖数量已扣除挂单）。 */
        loadSellPosition() {
            const sym = $('sellPositionSelect').value;
            if (!sym || !TraderApp.state.simulation?.positions?.[sym]) return;
            const pos = TraderApp.state.simulation.positions[sym];
            const price = TraderApp.market.getCurrentPrice(sym) || pos.avg_price || 0;
            const available = this.getAvailableSellQuantity(sym);
            $('sellSymbol').value = sym;
            if ($('sellAvailable')) {
                $('sellAvailable').value = available;
                $('sellAvailable').dataset.rawQty = String(available);
            }
            $('sellPrice').value = price.toFixed(2);
            TraderApp.ui.calculateEstimatedAmount('sell');
            TraderApp.market.updateQuoteUI(TraderApp.state.marketData[sym] || { symbol: sym, latest_price: price });
        },

        /** 确认后撤销指定委托并刷新状态。 */
        async cancelOrder(id) {
            if (!confirm('确定要撤销该委托吗？')) return;
            const { ok, data } = await apiRequest(`/api/simulations/${TraderApp.state.simulation.id}/orders/${id}`, {
                method: 'DELETE'
            });
            if (ok) {
                showAlert('撤单成功', 'success');
                await this.updateStatus();
            } else {
                showAlert(data.error || '撤单失败', 'danger');
            }
        }
    },

    /** 界面模块：布局同步、事件绑定、时钟与各表格/弹窗渲染。 */
    ui: {
        /** 以左侧买卖卡片高度同步右侧行情卡高度，保证分时图与买卖区等高。 */
        syncChartCardHeight() {
            const formCard = document.querySelector('.trading-left-panel .trade-form-card');
            const chartCard = document.querySelector('.trading-right-panel > .card.flex-fill');
            if (formCard && chartCard) {
                const h = formCard.offsetHeight;
                chartCard.style.height = h ? `${h}px` : '';
                chartCard.style.maxHeight = h ? `${h}px` : '';
            }
        },

        /** 绑定买卖/新建/管理/撤单/分时日K/持仓选择等事件。 */
        initListeners() {
            ['buy', 'sell'].forEach(type => {
                $(`${type}Price`)?.addEventListener('input', () => this.calculateEstimatedAmount(type));
                $(`${type}Quantity`)?.addEventListener('input', () => this.calculateEstimatedAmount(type));
            });
            window.addEventListener('resize', () => {
                this.syncChartCardHeight();
                if (TraderApp.state.currentChartType === 'daily') TraderApp.charts.drawCandlestick();
            });
            window.addEventListener('beforeunload', () => {
                Object.values(TraderApp.state.timers).forEach(t => t && clearInterval(t));
            });

            window.addEventListener('hashchange', () => {
                const hashSymbol = window.location.hash.substring(1).toUpperCase().trim();
                const buySymbolInput = $('buySymbol');
                if (hashSymbol && buySymbolInput && buySymbolInput.value !== hashSymbol) {
                    buySymbolInput.value = hashSymbol;
                    TraderApp.market.loadStockInfo('buy');
                }
            });
        },

        /** 每秒更新页面顶部时间显示。 */
        startClock() {
            if (TraderApp.state.timers.clock) clearInterval(TraderApp.state.timers.clock);
            TraderApp.state.timers.clock = setInterval(() => {
                const now = new Date();
                const utcBase = now.getTime() + (now.getTimezoneOffset() * 60000);

                const updateClock = (id, offset, label) => {
                    const el = $(id);
                    if (!el) return;
                    const t = new Date(utcBase + (3600000 * offset));
                    const timeStr = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
                    el.textContent = `${timeStr} (${label})`;
                };

                updateClock('clock-bj', 8, '北京');
                updateClock('clock-ny', -5, '美东');
                updateClock('clock-utc', 0, 'UTC');
            }, 1000);
        },

        /** 根据价格与数量计算并显示预估金额。 */
        calculateEstimatedAmount(type) {
            const p = parseFloat($(`${type}Price`).value) || 0;
            const q = parseInt($(`${type}Quantity`).value) || 0;
            $(`${type}EstimatedAmount`).textContent = '¥' + (p * q).toLocaleString('zh-CN', { minimumFractionDigits: 2 });
        },

        /** 用 state 中的现金与总资产更新顶部总览区域。 */
        updateAccountOverview() {
            const sim = TraderApp.state.simulation;
            if (!sim) {
                if ($('accountId')) $('accountId').textContent = '--';
                if ($('brokerName')) $('brokerName').textContent = '--';
                if ($('commissionDisplay')) $('commissionDisplay').textContent = '--';
                return;
            }
            const initial = sim.initial_capital || 1000000;
            const currentCash = sim.current_capital !== undefined ? sim.current_capital : initial;
            const available = currentCash - (sim.frozen_capital || 0);
            let posVal = 0;
            if (sim.positions) {
                Object.entries(sim.positions).forEach(([sym, pos]) => {
                    posVal += Math.abs(pos.quantity) * (TraderApp.market.getCurrentPrice(sym) || pos.avg_price || 0);
                });
            }
            const total = currentCash + posVal;
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
            
            if ($('accountId')) $('accountId').textContent = sim.name || sim.id || '--';
            if ($('brokerName')) $('brokerName').textContent = sim.account_type === 'broker' ? '券商实盘' : '本地模拟';
            if ($('commissionDisplay')) $('commissionDisplay').textContent = ((sim.commission || 0.001) * 100).toFixed(2) + '%';
        },

        /** 用 state.positions 渲染持仓表并同步卖出下拉选项。 */
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
                return `<tr><td>${sym}</td><td>${sym}</td><td>${qty}</td><td>¥${pos.avg_price.toFixed(2)}</td><td class="${rate >= 0 ? 'price-up' : 'price-down'}">¥${curP.toFixed(2)}</td><td class="position-profit ${rate >= 0 ? 'positive' : 'negative'}">${pnl >= 0 ? '+' : ''}¥${pnl.toFixed(2)}</td><td class="position-profit ${rate >= 0 ? 'positive' : 'negative'}">${rate >= 0 ? '+' : ''}${rate}%</td><td>¥${(qty * curP).toFixed(2)}</td><td><button class="btn-action" onclick="quickSell('${sym}', ${qty})"><i class="fas fa-arrow-down"></i></button></td></tr>`;
            }).join('');
            body.innerHTML = rows || renderEmptyState(9, 'fa-inbox', '暂无持仓');
            this.updateSellSelect();
        },

        /** 用持仓列表填充卖出 Tab 的标的下拉框。 */
        updateSellSelect() {
            const sel = $('sellPositionSelect'); if (!sel) return;
            const currentVal = sel.value;
            sel.innerHTML = '<option value="">请选择持仓</option>' + 
                Object.entries(TraderApp.state.simulation?.positions || {})
                    .filter(([_, p]) => Math.abs(p.quantity) > 0)
                    .map(([s, p]) => `<option value="${s}">${s} ${TraderApp.state.marketData[s]?.name || s} (${Math.abs(p.quantity)}股)</option>`)
                    .join('');
            
            if (currentVal && sel.querySelector(`option[value="${currentVal}"]`)) {
                sel.value = currentVal;
            }
        },

        /** 用 state.trades 渲染成交表。 */
        updateTrades() {
            const body = $('tradesTableBody'); if (!body) return;
            const ts = TraderApp.state.simulation?.trades || [];
            if (ts.length === 0) { body.innerHTML = renderEmptyState(9, 'fa-check-circle', '暂无成交'); return; }
            
            const sortedTrades = ts.slice().reverse().slice(0, TraderApp.CONSTANTS.MAX_TRADES_DISPLAY);
            
            body.innerHTML = sortedTrades.map((t, i) => {
                const amt = (t.price || 0) * (t.quantity || 0);
                const iso = typeof t.timestamp === 'string' && !/Z|[+-]\d{2}:?\d{2}$/.test(t.timestamp) ? t.timestamp + 'Z' : t.timestamp;
                const timeStr = new Date(iso).toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
                const directionText = t.action === 'buy' ? '买入' : '卖出';
                const tradeId = 'sim_' + (ts.length - i).toString().padStart(6, '0');
                
                return `<tr>
                    <td>${tradeId}</td>
                    <td>${t.order_id || '--'}</td>
                    <td>${t.symbol}</td>
                    <td>${t.symbol}</td>
                    <td><span class="direction-badge ${t.action}">${directionText}</span></td>
                    <td>¥${(t.price || 0).toFixed(2)}</td>
                    <td>${t.quantity}</td>
                    <td>¥${amt.toFixed(2)}</td>
                    <td>${timeStr}</td>
                </tr>`;
            }).join('');
        },

        /** 用 state.orders 渲染委托表并绑定撤单按钮。 */
        updateOrders() {
            const body = $('ordersTableBody'); if (!body) return;
            const orders = TraderApp.state.simulation?.orders || [];
            if (orders.length === 0) { body.innerHTML = renderEmptyState(10, 'fa-list-alt', '暂无委托'); return; }
            
            const sortedOrders = orders.slice().reverse().slice(0, TraderApp.CONSTANTS.MAX_ORDERS_DISPLAY);
            
            body.innerHTML = sortedOrders.map(o => {
                const isBuy = o.action === 'buy';
                const statusMap = { 'pending': '已报', 'executed': '全部成交', 'cancelled': '已撤单' };
                const statusClass = { 'pending': 'text-primary', 'executed': 'text-success', 'cancelled': 'text-muted' };
                const filledQty = o.status === 'executed' ? o.quantity : 0; 
                const timeStr = new Date(o.time).toLocaleTimeString('zh-CN', { hour12: false });

                let actionBtn = '';
                if (o.status === 'pending') {
                    actionBtn = `<button class="btn-action text-danger" onclick="cancelOrder('${o.id}')" title="撤单"><i class="fas fa-times"></i></button>`;
                }
                
                return `<tr>
                    <td>${o.id}</td>
                    <td>${o.symbol}</td>
                    <td>${o.symbol}</td>
                    <td><span class="direction-badge ${o.action}">${isBuy ? '买入' : '卖出'}</span></td>
                    <td>¥${(o.price || 0).toFixed(2)}</td>
                    <td>${o.quantity}</td>
                    <td>${filledQty}</td>
                    <td><span class="${statusClass[o.status] || ''}">${statusMap[o.status] || o.status}</span></td>
                    <td>${timeStr}</td>
                    <td>${actionBtn}</td>
                </tr>`;
            }).join('');
        },

        /** 切换委托/成交 Tab 显示并高亮对应按钮。 */
        switchDataView(type, btn) {
            if (btn?.parentElement) btn.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            btn?.classList.add('active');
            document.querySelectorAll('.data-view').forEach(v => v.classList.add('d-none'));
            document.querySelector('.data-view-' + type)?.classList.remove('d-none');
        },

        /** 打开管理账户弹窗并刷新弹窗内列表。 */
        async showManageAccountModal() {
            switchManageView('list');
            await TraderApp.account.renderManageAccountList();
            new bootstrap.Modal($('manageAccountModal')).show();
        },

        /** 委托 account 层刷新管理弹窗内的账户列表。 */
        renderManageAccountList() { TraderApp.account.renderManageAccountList(); },
    },

    /** 入口：绑定事件、同步布局、初始化分时图与账户状态。 */
    async init() {
        this.ui.initListeners();
        this.ui.syncChartCardHeight();
        this.charts.initIntraday();
        this.ui.startClock();
        await this.account.loadActive();
        this.state.timers.account = setInterval(() => {
            if (this.state.simulation) this.account.updateStatus();
        }, this.CONSTANTS.REFRESH_RATE_ACCOUNT);
        const buySymbolInput = $('buySymbol');
        if (buySymbolInput) {
            const hashSymbol = window.location.hash.substring(1).toUpperCase().trim();
            buySymbolInput.value = hashSymbol || buySymbolInput.value || 'BTC-USD';
            this.market.loadStockInfo('buy');
        }
        this.market.startUpdateLoop();
    }
};

/* 全局导出供 HTML onclick 使用 */
const loadStockInfo = (type) => TraderApp.market.loadStockInfo(type);
const submitBuyOrder = () => TraderApp.account.submitOrder('buy');
const submitSellOrder = () => TraderApp.account.submitOrder('sell');
const quickSell = (symbol, qty) => TraderApp.account.quickSell(symbol, qty);
const setPrice = (type, pType) => TraderApp.market.setPrice(type, pType);
const setQuantity = (type, val, isPct) => TraderApp.market.setQuantity(type, val, isPct);
const switchChartType = (type) => TraderApp.charts.switchType(type);
const switchIndicator = (ind, btn) => TraderApp.charts.switchIndicator(ind, btn);
const switchDataView = (type, btn) => TraderApp.ui.switchDataView(type, btn);
function showManageAccount() { TraderApp.ui.showManageAccountModal(); }
function switchManageView(view) {
    const listEl = $('manageAccountList');
    const formEl = $('manageAccountForm');
    const backBtn = $('manageBackBtn');
    const createBtn = $('manageCreateBtn');
    if (view === 'list') {
        if (listEl) listEl.style.display = '';
        if (formEl) formEl.style.display = 'none';
        if (backBtn) backBtn.style.display = 'none';
        if (createBtn) createBtn.style.display = 'none';
    } else {
        if (listEl) listEl.style.display = 'none';
        if (formEl) formEl.style.display = 'block';
        if (backBtn) backBtn.style.display = 'inline-block';
        if (createBtn) createBtn.style.display = 'inline-block';
    }
}
const handleAccountAction = () => showManageAccount();

const createAccount = () => TraderApp.account.create();
const cancelOrder = (id) => TraderApp.account.cancelOrder(id);
const loadSellPosition = () => TraderApp.account.loadSellPosition();

document.addEventListener('DOMContentLoaded', () => TraderApp.init());
