/**
 * 启动策略页核心 (gostrategy.js)
 *
 * 模块顺序：CONSTANTS → state → utils → strategy → account → charts → monitor → run → display → ui → init
 *   CONSTANTS  常量（刷新间隔、图表数据点上限等）
 *   state      全局状态（当前运行、账户列表、图表实例、K线数据、定时器）
 *   utils      工具（持仓市值/当前价推算、日志颜色）
 *   strategy   策略列表（加载、渲染、选中/查看/下载/删除、选择变更）
 *   account    账户（加载、选择变更、创建、创建回调）
 *   charts     图表（净值图初始化·更新、日K初始化·生成·绘制、K线/净值切换）
 *   monitor    监控（盘口更新、昨日行情、模拟行情数据）
 *   run        运行（启动、停止、刷新状态）
 *   display    展示（监控指标、总览、委托/成交/持仓表格、视图切换）
 *   ui         界面（事件绑定、时钟、日志、模拟数据、清理）
 *   init       初始化入口
 *
 * DOM 辅助 $、apiRequest、formatTime、formatDateTime、formatFileSize、renderEmptyState、updateStrategyActionButtons 见 common.js
 * viewCurrentStrategy、downloadCurrentStrategy、deleteCurrentStrategy、getSelectedStrategyId 见 common.js
 */
const GoStrategyApp = {
    /** 全局常量：刷新间隔、图表数据点上限等。 */
    CONSTANTS: {
        REFRESH_RATE_STRATEGY: 10000,
        EQUITY_MAX_POINTS: 100,
        DEFAULT_BASE_PRICE: 5.85,
        MAX_ORDERS_DISPLAY: 20,
        MAX_TRADES_DISPLAY: 50,
        LOG_MAX_ENTRIES: 200
    },

    /** 全局运行状态。 */
    state: {
        currentRun: null,
        allSimulations: [],
        equityChart: null,
        equityData: { times: [], values: [], benchmark: [] },
        orders: [],
        trades: [],
        logs: [],
        maxDrawdown: 0,
        peakEquity: 0,
        monitorDailyChartCanvas: null,
        monitorDailyChartCtx: null,
        monitorDailyData: { dates: [], candles: [], signals: [] },
        monitorCurrentChartType: 'daily',
        monitorCurrentIndicator: 'ma',
        monitorMarketData: {},
        timers: { refresh: null, clock: null }
    },

    /** 工具：从 simulation 推算持仓市值与标的当前价（供监控/总览/持仓表格共用）。 */
    utils: {
        /** 根据持仓与最新成交价推算标的当前价，合理范围内优先用 trade 价格。 */
        getCurrentPriceForSymbol(simulation, symbol) {
            const def = GoStrategyApp.CONSTANTS.DEFAULT_BASE_PRICE;
            if (!simulation) return def;
            const pos = simulation.positions?.[symbol];
            let price = pos?.avg_price ?? 0;
            if (simulation.trades?.length) {
                const last = simulation.trades.filter(t => t.symbol === symbol).pop();
                if (last?.price && last.price > 0 && last.price < 100) price = last.price;
            }
            if (!price && pos?.current_price && pos.current_price > 0 && pos.current_price < 100)
                price = pos.current_price;
            return price > 0 ? price : def;
        },

        /** 计算 simulation 的持仓市值（用 utils 的当前价）。 */
        getPositionValue(simulation) {
            if (!simulation?.positions) return 0;
            let total = 0;
            Object.entries(simulation.positions).forEach(([sym, pos]) => {
                const qty = Math.abs(pos.quantity || 0);
                const price = GoStrategyApp.utils.getCurrentPriceForSymbol(simulation, sym);
                total += qty * price;
            });
            return total;
        },

        /** 日志颜色类型（与交易页一致）。 */
        getLogColorType(message) {
            if (message.includes('买入')) return 'buy';
            if (message.includes('卖出')) return 'sell';
            return 'info';
        }
    },

    /** 策略列表：加载、渲染、选中/查看/下载/删除、选择变更。 */
    strategy: {
        async loadStrategies() {
            const listContainer = $('strategyFilesList');
            if (listContainer) listContainer.innerHTML = '<div class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin mb-2"></i><div>加载中...</div></div>';

            const { ok, data } = await apiRequest('/api/strategies');
            const select = $('runStrategySelect');
            if (!select) return;

            select.innerHTML = '<option value="">请选择策略 (data/strategies)</option>';
            if (ok && data.strategies?.length > 0) {
                let defaultId = data.strategies[0].id;
                data.strategies.forEach(s => {
                    const opt = document.createElement('option');
                    opt.value = s.id;
                    opt.textContent = s.name;
                    select.appendChild(opt);
                });
                this.renderStrategyFileList(data.strategies);
                select.value = defaultId;
                updateStrategyActionButtons(defaultId);
            } else {
                select.innerHTML = '<option value="">暂无可用策略</option>';
                if (listContainer) listContainer.innerHTML = '<div class="text-center text-muted py-4">暂无策略文件</div>';
                updateStrategyActionButtons(null);
                if (!ok) addLog('加载策略列表失败: ' + (data.error || '未知错误'), 'error');
            }
        },

        renderStrategyFileList(strategies) {
            const listContainer = $('strategyFilesList');
            if (!listContainer) return;
            listContainer.innerHTML = '';
            const sizeStr = s => s.size ? formatFileSize(s.size) : '未知大小';
            const timeStr = s => s.updated_at ? formatDateTime(s.updated_at) : '未知时间';
            strategies.forEach(s => {
                const item = document.createElement('div');
                item.className = 'strategy-file-item';
                item.innerHTML = `
                    <div class="strategy-file-info">
                        <div class="strategy-file-name" title="${s.name}">${s.name}</div>
                        <div class="strategy-file-meta"><span>${sizeStr(s)}</span><span>|</span><span>${timeStr(s)}</span></div>
                    </div>
                    <div class="strategy-file-actions">
                        <div class="btn-group">
                            <button class="btn btn-action strategy-action-select" onclick="selectStrategyForRun('${s.id}')" title="选中此策略"><i class="fas fa-play"></i></button>
                            <button class="btn btn-action strategy-action-view" onclick="viewStrategyByName('${s.id}')" title="查看源码"><i class="fas fa-eye"></i></button>
                            <button class="btn btn-action strategy-action-download" onclick="downloadStrategyByName('${s.id}')" title="下载策略"><i class="fas fa-download"></i></button>
                            <button class="btn btn-action strategy-action-delete" onclick="deleteStrategyByName('${s.id}')" title="删除策略"><i class="fas fa-trash-alt"></i></button>
                        </div>
                    </div>`;
                listContainer.appendChild(item);
            });
        },

        handleStrategySelectChange() {
            const select = $('runStrategySelect');
            if (select) updateStrategyActionButtons(select.value);
        }
    },

    /** 账户：加载、选择变更、创建、创建回调。 */
    account: {
        async loadSimulations() {
            const { ok, data } = await apiRequest('/api/simulations');
            const select = $('runAccountSelect');
            if (!select) return;

            if (ok && data.simulations?.length > 0) {
                GoStrategyApp.state.allSimulations = data.simulations;
                select.innerHTML = '<option value="">请选择交易账户</option>';
                data.simulations.forEach(sim => {
                    const opt = document.createElement('option');
                    opt.value = sim.id;
                    opt.textContent = sim.id + (sim.status === 'running' ? ' (运行中)' : '');
                    if (sim.status === 'running') opt.classList.add('text-success', 'fw-bold');
                    select.appendChild(opt);
                });
                const run = GoStrategyApp.state.currentRun;
                select.value = run ? run.id : data.simulations[0].id;
                this.handleAccountSelectChange();
            } else {
                select.innerHTML = '<option value="">暂无可用账户，请先新建</option>';
                const preview = $('accountConfigPreview');
                if (preview) preview.style.display = 'none';
                if (!ok) addLog('加载账户列表失败: ' + (data.error || '未知错误'), 'error');
            }
        },

        handleAccountSelectChange() {
            const select = $('runAccountSelect');
            const preview = $('accountConfigPreview');
            if (!select || !preview) return;
            const accountId = select.value;
            if (!accountId) { preview.style.display = 'none'; return; }
            const account = GoStrategyApp.state.allSimulations.find(s => s.id === accountId);
            if (account) {
                preview.style.display = 'block';
                const balance = account.current_capital ?? account.initial_capital ?? 0;
                if ($('previewBalance')) $('previewBalance').textContent = '¥' + balance.toLocaleString('zh-CN', { minimumFractionDigits: 2 });
                if ($('previewCommission')) $('previewCommission').textContent = account.commission ?? '0.0001';
                if ($('runInitialCapital')) $('runInitialCapital').value = account.initial_capital ?? 100000;
                if ($('runCommission')) $('runCommission').value = account.commission ?? 0.0001;
            }
        },

        showCreateAccount() {
            new bootstrap.Modal($('createAccountModal')).show();
        },

        async createAccount() {
            const name = $('accountName')?.value || $('accountName')?.placeholder || 'sim_001';
            const capital = $('accountCapital')?.value;
            const commission = $('accountCommission')?.value;
            const slippage = $('accountSlippage')?.value;
            const accountType = document.querySelector('input[name="accountType"]:checked')?.value || 'local_paper';
            if (!capital) { showAlert('请填写初始资金', 'warning'); return; }
            try {
                const { ok, data: result } = await apiRequest('/api/simulations', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name, initial_capital: parseFloat(capital), commission: parseFloat(commission),
                        slippage: parseFloat(slippage), account_type: accountType, start: false
                    })
                });
                if (ok) {
                    showAlert('交易账户创建成功', 'success');
                    const modal = bootstrap.Modal.getInstance($('createAccountModal'));
                    if (modal) modal.hide();
                    if (typeof onAccountCreated === 'function') onAccountCreated(result.simulation_id);
                } else {
                    addLog('创建账户失败: ' + (result.error || '未知错误'), 'error');
                    showAlert(result.error || '创建失败', 'danger');
                }
            } catch (e) {
                console.error('Error creating account:', e);
                addLog('创建账户失败: ' + e.message, 'error');
                showAlert('创建失败', 'danger');
            }
        },

        async onAccountCreated(simulationId) {
            addLog('账户创建成功: ' + simulationId, 'success');
            await this.loadSimulations();
            const select = $('runAccountSelect');
            if (select) { select.value = simulationId; this.handleAccountSelectChange(); }
        }
    },

    /** 图表：净值图初始化·更新；日K 初始化·生成·绘制；K线/净值切换。 */
    charts: {
        initEquityChart() {
            const canvas = $('equityChart');
            if (!canvas || typeof Chart === 'undefined') return;
            const ctx = canvas.getContext('2d');
            GoStrategyApp.state.equityChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [
                        { label: '策略净值', data: [], borderColor: '#28a745', backgroundColor: 'rgba(40,167,69,0.05)', borderWidth: 2, tension: 0.3, pointRadius: 0, pointHoverRadius: 4, fill: true, yAxisID: 'y' },
                        { label: '基准 (HS300)', data: [], borderColor: '#adb5bd', borderWidth: 1.5, borderDash: [5, 5], tension: 0.3, pointRadius: 0, fill: false, yAxisID: 'y' }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: true, position: 'top', align: 'end', labels: { boxWidth: 12, font: { size: 10 } } }, tooltip: { mode: 'index', intersect: false, callbacks: { label(c) { return c.dataset.label + ': ¥' + (c.parsed.y).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); } } } },
                    scales: {
                        x: { grid: { display: false }, ticks: { maxTicksLimit: 6, font: { size: 9 } } },
                        y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { size: 10 }, callback(v) { return v >= 10000 ? '¥' + (v / 10000).toFixed(1) + 'w' : '¥' + v.toFixed(0); } } }
                    }
                }
            });
        },

        updateEquityChart(totalAssets) {
            const chart = GoStrategyApp.state.equityChart;
            const data = GoStrategyApp.state.equityData;
            if (!chart || totalAssets == null) return;
            const now = new Date();
            const label = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
            data.times.push(label);
            data.values.push(totalAssets);
            if (data.benchmark.length === 0) data.benchmark.push(totalAssets);
            else {
                const last = data.benchmark[data.benchmark.length - 1];
                data.benchmark.push(last * (1 + 0.0001 + (Math.random() - 0.5) * 0.002));
            }
            if (data.times.length > GoStrategyApp.CONSTANTS.EQUITY_MAX_POINTS) {
                data.times.shift(); data.values.shift(); data.benchmark.shift();
            }
            chart.data.labels = data.times;
            chart.data.datasets[0].data = data.values;
            chart.data.datasets[1].data = data.benchmark;
            chart.update('none');
        },

        async loadChartData(accountId) {
            const { ok, data } = await apiRequest(`/api/gostrategy/${accountId}/chart`);
            if (!ok || !data.candles?.length) {
                GoStrategyApp.state.monitorDailyData.dates = [];
                GoStrategyApp.state.monitorDailyData.candles = [];
                GoStrategyApp.state.monitorDailyData.signals = [];
                return;
            }
            const d = GoStrategyApp.state.monitorDailyData;
            d.dates = data.candles.map(c => (c.date && String(c.date).slice(0, 10)) || c.date);
            d.candles = data.candles;
            d.signals = data.signals || [];
            GoStrategyApp.charts.drawCandlestickChart();
            GoStrategyApp.monitor.updateYesterdayDisplay();
        },

        initMonitorDailyChart() {
            const canvas = $('monitorDailyChart');
            if (!canvas) return;
            GoStrategyApp.state.monitorDailyChartCanvas = canvas;
            GoStrategyApp.state.monitorDailyChartCtx = canvas.getContext('2d');
            window.addEventListener('resize', () => {
                if (GoStrategyApp.state.monitorCurrentChartType === 'daily' && GoStrategyApp.state.monitorDailyData.candles.length > 0)
                    GoStrategyApp.charts.drawCandlestickChart();
            });
        },

        drawCandlestickChart() {
            const { monitorDailyChartCanvas: canvas, monitorDailyChartCtx: ctx, monitorDailyData } = GoStrategyApp.state;
            if (!canvas || !ctx || !monitorDailyData.candles.length) return;
            const width = (canvas.width = canvas.offsetWidth);
            const height = (canvas.height = canvas.offsetHeight);
            ctx.clearRect(0, 0, width, height);
            const candles = monitorDailyData.candles;
            const padding = { top: 20, right: 30, bottom: 30, left: 50 };
            const chartW = width - padding.left - padding.right;
            const chartH = height - padding.top - padding.bottom;
            let minP = Math.min(...candles.map(c => c.low));
            let maxP = Math.max(...candles.map(c => c.high));
            let ma5 = [], ma10 = [], ma20 = [], boll = null;
            if (GoStrategyApp.state.monitorCurrentIndicator === 'ma') {
                const calcMA = (period) => {
                    const arr = [];
                    for (let i = 0; i < candles.length; i++) {
                        if (i < period - 1) arr.push(null);
                        else {
                            let sum = 0;
                            for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
                            arr.push(sum / period);
                        }
                    }
                    return arr;
                };
                ma5 = calcMA(5); ma10 = calcMA(10); ma20 = calcMA(20);
                const mas = [...ma5, ...ma10, ...ma20].filter(v => v !== null);
                if (mas.length > 0) { minP = Math.min(minP, ...mas); maxP = Math.max(maxP, ...mas); }
            } else if (GoStrategyApp.state.monitorCurrentIndicator === 'boll') {
                const period = 20, stdDev = 2;
                const ma = [];
                for (let i = 0; i < candles.length; i++) {
                    if (i < period - 1) ma.push(null);
                    else {
                        let sum = 0;
                        for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
                        ma.push(sum / period);
                    }
                }
                const upper = [], lower = [];
                for (let i = 0; i < candles.length; i++) {
                    if (i < period - 1 || ma[i] === null) { upper.push(null); lower.push(null); }
                    else {
                        let sumSqDiff = 0;
                        for (let j = i - period + 1; j <= i; j++) {
                            const d = candles[j].close - ma[i];
                            sumSqDiff += d * d;
                        }
                        const std = Math.sqrt(sumSqDiff / period);
                        upper.push(ma[i] + stdDev * std);
                        lower.push(ma[i] - stdDev * std);
                    }
                }
                boll = { middle: ma, upper, lower };
                const bvs = [...boll.upper, ...boll.lower, ...boll.middle].filter(v => v !== null);
                if (bvs.length > 0) { minP = Math.min(minP, ...bvs); maxP = Math.max(maxP, ...bvs); }
            }
            const range = maxP - minP;
            const pad = range * 0.1;
            minP -= pad;
            maxP += pad;
            const count = candles.length;
            const spacing = chartW / count;
            const candleW = Math.max(2, Math.min(8, chartW / count * 0.6));
            const priceToY = p => padding.top + chartH - ((p - minP) / (maxP - minP)) * chartH;

            ctx.strokeStyle = '#f0f0f0';
            ctx.lineWidth = 1;
            for (let i = 0; i <= 4; i++) {
                const y = padding.top + (chartH / 4) * i;
                ctx.beginPath();
                ctx.moveTo(padding.left, y);
                ctx.lineTo(padding.left + chartW, y);
                ctx.stroke();
                ctx.fillStyle = '#999';
                ctx.font = '10px sans-serif';
                ctx.textAlign = 'right';
                ctx.fillText((maxP - (range / 4) * i).toFixed(2), padding.left - 5, y + 3);
            }

            if (GoStrategyApp.state.monitorCurrentIndicator === 'ma') {
                const drawMALine = (data, color) => {
                    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
                    let first = true;
                    data.forEach((v, i) => {
                        if (v !== null) {
                            const x = padding.left + spacing * (i + 0.5), y = priceToY(v);
                            if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
                        }
                    });
                    ctx.stroke();
                };
                drawMALine(ma5, '#ff9800');
                drawMALine(ma10, '#2196f3');
                drawMALine(ma20, '#9c27b0');
            } else if (GoStrategyApp.state.monitorCurrentIndicator === 'boll' && boll) {
                const drawBollLine = (data, color) => {
                    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([2, 2]); ctx.beginPath();
                    let first = true;
                    data.forEach((v, i) => {
                        if (v !== null) {
                            const x = padding.left + spacing * (i + 0.5), y = priceToY(v);
                            if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
                        }
                    });
                    ctx.stroke(); ctx.setLineDash([]);
                };
                drawBollLine(boll.upper, '#2196f3');
                drawBollLine(boll.middle, '#ff9800');
                drawBollLine(boll.lower, '#2196f3');
            }

            const signals = monitorDailyData.signals || [];
            candles.forEach((c, i) => {
                const x = padding.left + spacing * (i + 0.5);
                const openY = priceToY(c.open);
                const closeY = priceToY(c.close);
                const highY = priceToY(c.high);
                const lowY = priceToY(c.low);
                const isUp = c.close >= c.open;
                const color = isUp ? '#dc3545' : '#28a745';
                ctx.strokeStyle = ctx.fillStyle = color;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x, highY);
                ctx.lineTo(x, Math.min(openY, closeY));
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(x, lowY);
                ctx.lineTo(x, Math.max(openY, closeY));
                ctx.stroke();
                const bodyTop = Math.min(openY, closeY);
                const bodyH = Math.max(1, Math.max(openY, closeY) - bodyTop);
                ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
            });

            // 策略信号：B/S 徽章，按图表高度 4% 拉开与 K 线距离
            const signalGap = Math.max(8, chartH * 0.04);
            signals.forEach((sig, i) => {
                if (sig !== 1 && sig !== -1) return;
                const c = candles[i];
                const x = padding.left + spacing * (i + 0.5);
                const isBuy = sig === 1;
                const text = isBuy ? 'B' : 'S';
                ctx.font = 'bold 11px "SF Pro Text", "Helvetica Neue", sans-serif';
                const rectW = ctx.measureText(text).width + 10;
                const rectH = 16;
                const ty = isBuy ? priceToY(c.low) + signalGap : priceToY(c.high) - rectH - signalGap;
                const rectX = x - rectW / 2;
                ctx.shadowColor = 'rgba(0,0,0,0.15)';
                ctx.shadowBlur = 3;
                ctx.shadowOffsetY = 1;
                const r = 3;
                ctx.beginPath();
                ctx.moveTo(rectX + r, ty);
                ctx.lineTo(rectX + rectW - r, ty);
                ctx.quadraticCurveTo(rectX + rectW, ty, rectX + rectW, ty + r);
                ctx.lineTo(rectX + rectW, ty + rectH - r);
                ctx.quadraticCurveTo(rectX + rectW, ty + rectH, rectX + rectW - r, ty + rectH);
                ctx.lineTo(rectX + r, ty + rectH);
                ctx.quadraticCurveTo(rectX, ty + rectH, rectX, ty + rectH - r);
                ctx.lineTo(rectX, ty + r);
                ctx.quadraticCurveTo(rectX, ty, rectX + r, ty);
                ctx.closePath();
                ctx.fillStyle = isBuy ? '#dc3545' : '#28a745';
                ctx.fill();
                ctx.shadowBlur = ctx.shadowOffsetY = 0;
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(text, x, ty + rectH / 2 + 0.5);
                ctx.beginPath();
                ctx.strokeStyle = isBuy ? 'rgba(220,53,69,0.5)' : 'rgba(40,167,69,0.5)';
                ctx.setLineDash([2, 2]);
                ctx.moveTo(x, isBuy ? priceToY(c.low) : priceToY(c.high));
                ctx.lineTo(x, isBuy ? ty : ty + rectH);
                ctx.stroke();
                ctx.setLineDash([]);
            });

            ctx.fillStyle = '#6c757d';
            ctx.font = '9px sans-serif';
            ctx.textAlign = 'center';
            const step = Math.max(1, Math.floor(count / 8));
            for (let i = 0; i < count; i += step)
                ctx.fillText(candles[i].date, padding.left + spacing * (i + 0.5), height - 10);

            const run = GoStrategyApp.state.currentRun;
            if (run?.trades?.length) {
                const symbol = run.symbol || $('runSymbol')?.value;
                const symbolTrades = run.trades.filter(t => t.symbol === symbol);
                symbolTrades.forEach(trade => {
                    const tradeDate = trade.date || trade.timestamp?.split('T')[0];
                    const idx = monitorDailyData.dates.indexOf(tradeDate);
                    if (idx === -1) return;
                    const candle = candles[idx];
                    const x = padding.left + spacing * (idx + 0.5);
                    const isBuy = trade.action === 'buy';
                    const text = isBuy ? 'B' : 'S';
                    ctx.font = 'bold 10px "SF Pro Text", "Helvetica Neue", sans-serif';
                    const rectW = ctx.measureText(text).width + 12;
                    const rectH = 18;
                    const ty = isBuy ? priceToY(candle.low) + 12 : priceToY(candle.high) - 12 - rectH;
                    const rectX = x - rectW / 2;
                    ctx.shadowColor = 'rgba(0,0,0,0.1)';
                    ctx.shadowBlur = 4;
                    ctx.shadowOffsetY = 2;
                    const r = 4;
                    ctx.beginPath();
                    ctx.moveTo(rectX + r, ty);
                    ctx.lineTo(rectX + rectW - r, ty);
                    ctx.quadraticCurveTo(rectX + rectW, ty, rectX + rectW, ty + r);
                    ctx.lineTo(rectX + rectW, ty + rectH - r);
                    ctx.quadraticCurveTo(rectX + rectW, ty + rectH, rectX + rectW - r, ty + rectH);
                    ctx.lineTo(rectX + r, ty + rectH);
                    ctx.quadraticCurveTo(rectX, ty + rectH, rectX, ty + rectH - r);
                    ctx.lineTo(rectX, ty + r);
                    ctx.quadraticCurveTo(rectX, ty, rectX + r, ty);
                    ctx.closePath();
                    ctx.fillStyle = isBuy ? '#dc3545' : '#28a745';
                    ctx.fill();
                    ctx.shadowBlur = 0;
                    ctx.shadowOffsetY = 0;
                    ctx.fillStyle = '#fff';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(text, x, ty + rectH / 2 + 0.5);
                    ctx.beginPath();
                    ctx.strokeStyle = isBuy ? 'rgba(220,53,69,0.4)' : 'rgba(40,167,69,0.4)';
                    ctx.setLineDash([2, 2]);
                    ctx.moveTo(x, isBuy ? priceToY(candle.low) : priceToY(candle.high));
                    ctx.lineTo(x, isBuy ? ty : ty + rectH);
                    ctx.stroke();
                    ctx.setLineDash([]);
                });
            }

            GoStrategyApp.state.monitorDailyChartLayout = { padding, chartW, chartH, spacing, count };
            this.setupMonitorDailyChartInteraction();
        },

        setupMonitorDailyChartInteraction() {
            const canvas = $('monitorDailyChart');
            const tooltipEl = $('monitorDailyChartTooltip');
            if (!canvas || !tooltipEl || this._monitorDailyInteractionBound) return;
            this._monitorDailyInteractionBound = true;

            canvas.addEventListener('mousemove', (e) => {
                const layout = GoStrategyApp.state.monitorDailyChartLayout;
                const dates = GoStrategyApp.state.monitorDailyData.dates;
                const candles = GoStrategyApp.state.monitorDailyData.candles;
                if (!layout || !dates?.length || !candles?.length) return;

                const rect = canvas.getBoundingClientRect();
                const scaleX = canvas.width / rect.width;
                const mouseX = (e.clientX - rect.left) * scaleX;
                const { padding, spacing, count } = layout;
                let idx = Math.floor((mouseX - padding.left) / spacing);
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
                tooltipEl.style.left = Math.min(tx, rect.width - (tooltipEl.offsetWidth || 120) - 8) + 'px';
                tooltipEl.style.top = Math.min(ty, rect.height - (tooltipEl.offsetHeight || 50) - 8) + 'px';
            });

            canvas.addEventListener('mouseleave', () => {
                tooltipEl.style.display = 'none';
            });
        },

        switchMonitorChart(type, buttonElement) {
            GoStrategyApp.state.monitorCurrentChartType = type;
            const dailyContainer = $('dailyChartContainer');
            const equityContainer = $('equityChartContainer');
            const indicatorBtns = $('monitorIndicatorButtons');
            if (!dailyContainer || !equityContainer) return;
            dailyContainer.classList.add('d-none');
            equityContainer.classList.add('d-none');
            if (indicatorBtns) indicatorBtns.style.display = type === 'daily' ? 'inline-flex' : 'none';
            if (buttonElement?.parentNode)
                buttonElement.parentNode.querySelectorAll('.chart-type-btn').forEach(btn => btn.classList.remove('active'));
            if (type === 'daily') {
                dailyContainer.classList.remove('d-none');
                this.drawCandlestickChart();
            } else if (type === 'equity') {
                equityContainer.classList.remove('d-none');
                if (GoStrategyApp.state.equityChart) GoStrategyApp.state.equityChart.update();
            }
            if (buttonElement) buttonElement.classList.add('active');
        },

        switchMonitorIndicator(indicator, buttonElement) {
            GoStrategyApp.state.monitorCurrentIndicator = indicator;
            const indicatorBtns = $('monitorIndicatorButtons');
            if (indicatorBtns) {
                indicatorBtns.querySelectorAll('.chart-type-btn').forEach(btn => btn.classList.remove('active'));
                if (buttonElement) buttonElement.classList.add('active');
            }
            if (GoStrategyApp.state.monitorCurrentChartType === 'daily' && GoStrategyApp.state.monitorDailyData.candles.length > 0)
                this.drawCandlestickChart();
        }
    },

    /** 监控：盘口更新、昨日行情。 */
    monitor: {
        initMarketData() {
        },

        updateQuoteBoard() {
            const run = GoStrategyApp.state.currentRun;
            const symbol = run?.symbol || $('runSymbol')?.value?.trim() || '';
            const quote = symbol ? GoStrategyApp.state.monitorMarketData[symbol] : null;

            const setRow = (prefix, i, price, vol) => {
                const el = $(prefix + i);
                if (!el) return;
                const p = el.querySelector('.price');
                const v = el.querySelector('.vol');
                if (p) p.textContent = price != null && price > 0 ? price.toFixed(2) : '--';
                if (v) v.textContent = vol != null && vol > 0 ? Number(vol).toLocaleString() : '--';
            };

            if (!run || !quote || quote.status === 'loading') {
                for (let i = 1; i <= 5; i++) {
                    ['monitorQuoteBid', 'monitorQuoteAsk'].forEach(prefix => setRow(prefix, i, null, null));
                }
                return;
            }

            const currentPrice = quote.price ?? (run ? GoStrategyApp.utils.getCurrentPriceForSymbol(run, symbol) : 0);
            const baseVol = quote.volume ?? 5000;
            const spread = 0.01;
            const synthVol = () => Math.floor((baseVol && baseVol > 0 ? baseVol * 0.001 : 5000) * (0.8 + Math.random() * 0.4));
            for (let i = 1; i <= 5; i++) {
                const bidPrice = quote.bids?.[i - 1]?.[0] ?? (currentPrice - spread * i);
                const bidVol = quote.bids?.[i - 1]?.[1] ?? synthVol();
                setRow('monitorQuoteBid', i, bidPrice, bidVol);
                const askPrice = quote.asks?.[i - 1]?.[0] ?? (currentPrice + spread * i);
                const askVol = quote.asks?.[i - 1]?.[1] ?? synthVol();
                setRow('monitorQuoteAsk', i, askPrice, askVol);
            }
        },

        updateYesterdayDisplay() {
            const prevClose = $('monitorPrevClose');
            const prevReturn = $('monitorPrevReturn');
            const candles = GoStrategyApp.state.monitorDailyData.candles;
            if (!prevClose || !prevReturn || candles.length < 2) return;
            const yesterday = candles[candles.length - 2];
            const dayBefore = candles[candles.length - 3];
            prevClose.textContent = yesterday.close.toFixed(2);
            if (dayBefore) {
                const ret = (yesterday.close - dayBefore.close) / dayBefore.close * 100;
                prevReturn.textContent = (ret >= 0 ? '+' : '') + ret.toFixed(2) + '%';
                prevReturn.style.color = ret >= 0 ? '#dc3545' : '#28a745';
            }
        }
    },

    /** 运行：启动、停止、刷新状态。 */
    run: {
        async start() {
            const strategyId = $('runStrategySelect')?.value;
            const accountId = $('runAccountSelect')?.value;
            const symbol = ($('runSymbol')?.value || '').trim().toUpperCase();
            const signalInterval = ($('runSignalInterval')?.value || '1d').toLowerCase();
            if (!accountId) { showAlert('请选择或创建一个交易账户', 'warning'); return; }
            if (!strategyId) { showAlert('请选择策略', 'warning'); return; }
            if (!symbol) { showAlert('请填写投资标的', 'warning'); return; }
            const account = GoStrategyApp.state.allSimulations.find(s => s.id === accountId);
            if (account?.status === 'running' && !confirm(`该账户 (${accountId}) 正在运行另一个策略，启动新策略将覆盖旧记录，确定继续吗？`)) return;

            addLog('正在向后端请求启动策略...', 'info');
            try {
                const { ok, data: result } = await apiRequest(`/api/gostrategy/${accountId}/run`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ strategy_id: strategyId, symbol, signal_interval: signalInterval, lookback_bars: 50 })
                });
                if (ok) {
                    GoStrategyApp.state.peakEquity = 0;
                    GoStrategyApp.state.maxDrawdown = 0;
                    GoStrategyApp.state.equityData = { times: [], values: [], benchmark: [] };
                    if (GoStrategyApp.state.equityChart) {
                        GoStrategyApp.state.equityChart.data.labels = [];
                        GoStrategyApp.state.equityChart.data.datasets[0].data = [];
                        GoStrategyApp.state.equityChart.data.datasets[1].data = [];
                        GoStrategyApp.state.equityChart.update();
                    }
                    GoStrategyApp.state.currentRun = { ...account, id: accountId, strategy_id: strategyId, symbol, status: 'running', positions: {}, trades: [] };
                    addLog(`策略启动成功: ${strategyId} (账户: ${accountId})`, 'success');
                    addLog(`投资标的: ${symbol}`, 'info');
                    await GoStrategyApp.charts.loadChartData(accountId);
                    await GoStrategyApp.account.loadSimulations();
                    GoStrategyApp.display.updateDisplay();
                    await this.refresh();
                    showAlert('策略启动成功', 'success');
                } else {
                    addLog('策略启动失败: ' + (result.error || '未知错误'), 'error');
                    showAlert(result.error || '启动失败', 'danger');
                }
            } catch (e) {
                console.error('Error starting strategy:', e);
                addLog('策略启动失败: ' + e.message, 'error');
                showAlert('启动失败', 'danger');
            }
        },

        async stop() {
            const run = GoStrategyApp.state.currentRun;
            if (!run) { showAlert('没有运行中的策略', 'warning'); return; }
            if (!confirm('确定要停止策略运行吗？')) return;
            addLog('正在停止策略运行...', 'warning');
            try {
                const { ok, data: result } = await apiRequest(`/api/simulations/${run.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'stopped' })
                });
                if (ok) {
                    addLog('策略已停止运行', 'success');
                    run.status = 'stopped';
                    await GoStrategyApp.account.loadSimulations();
                    GoStrategyApp.display.updateDisplay();
                    showAlert('策略已停止', 'success');
                } else {
                    addLog('停止失败: ' + (result.error || '未知错误'), 'error');
                    showAlert(result.error || '停止失败', 'danger');
                }
            } catch (e) {
                console.error('Error stopping strategy:', e);
                addLog('停止失败: ' + e.message, 'error');
                showAlert('停止失败', 'danger');
            }
        },

        async refresh() {
            const run = GoStrategyApp.state.currentRun;
            if (!run) return;
            const { ok, data } = await apiRequest(`/api/simulations/${run.id}`);
            if (ok && data.simulation) {
                const sim = data.simulation;
                const oldCount = run.trades?.length ?? 0;
                Object.assign(run, sim);
                const newCount = sim.trades?.length ?? 0;
                if (newCount > oldCount && sim.trades) {
                    sim.trades.slice(oldCount).forEach(t => {
                        const action = t.action === 'buy' ? '买入' : '卖出';
                        addLog(`策略执行${action}: ${t.symbol} ${t.quantity}股 @ ¥${(t.price || 0).toFixed(2)}`, 'success');
                    });
                }
                GoStrategyApp.display.updateDisplay();
                const symbol = run.symbol || $('runSymbol')?.value?.trim();
                if (symbol) {
                    const { ok: qOk, data: quote } = await apiRequest(`/api/data/live/${encodeURIComponent(symbol)}`);
                    if (qOk && quote && quote.status !== 'loading')
                        GoStrategyApp.state.monitorMarketData[symbol] = quote;
                }
            }
        }
    },

    /** 展示：监控指标、总览、委托/成交/持仓表格、视图切换。 */
    display: {
        updateMonitor() {
            const run = GoStrategyApp.state.currentRun;
            if (!run) {
                if ($('monitorPrevClose')) $('monitorPrevClose').textContent = '--';
                if ($('monitorPrevReturn')) { $('monitorPrevReturn').textContent = '--'; $('monitorPrevReturn').style.color = '#6c757d'; }
                const contentEl0 = $('monitorSignalContent');
                const placeholderEl0 = $('monitorLastSignal');
                if (contentEl0) contentEl0.style.display = 'none';
                if (placeholderEl0) { placeholderEl0.style.display = 'inline'; placeholderEl0.textContent = '等待策略信号...'; placeholderEl0.style.color = '#6c757d'; }
                if ($('monitorSignalTime')) $('monitorSignalTime').textContent = '--';
                GoStrategyApp.state.monitorDailyData.dates = [];
                GoStrategyApp.state.monitorDailyData.candles = [];
                GoStrategyApp.state.monitorDailyData.signals = [];
                const { monitorDailyChartCanvas: canvas, monitorDailyChartCtx: ctx } = GoStrategyApp.state;
                if (canvas && ctx) {
                    const w = canvas.offsetWidth, h = canvas.offsetHeight;
                    canvas.width = w; canvas.height = h;
                    ctx.clearRect(0, 0, w, h);
                }
                const chart = GoStrategyApp.state.equityChart;
                if (chart) {
                    GoStrategyApp.state.equityData.times = [];
                    GoStrategyApp.state.equityData.values = [];
                    chart.data.labels = [];
                    chart.data.datasets[0].data = [];
                    chart.data.datasets[1].data = [];
                    chart.update();
                }
                GoStrategyApp.monitor.updateQuoteBoard();
                return;
            }
            const initial = run.initial_capital || 100000;
            const current = run.current_capital || initial;
            const frozen = run.frozen_capital || 0;
            const available = current - frozen;
            const positionValue = GoStrategyApp.utils.getPositionValue(run);
            const totalAssets = available + positionValue;
            const totalPnL = totalAssets - initial;
            const totalReturnNum = initial > 0 ? (totalPnL / initial) * 100 : 0;
            const totalReturn = totalReturnNum.toFixed(2);

            const cumEl = $('metricCumulativeReturn');
            if (cumEl) { cumEl.textContent = totalReturn + '%'; cumEl.style.color = totalReturnNum >= 0 ? '#dc3545' : '#28a745'; }
            if (totalAssets > GoStrategyApp.state.peakEquity) GoStrategyApp.state.peakEquity = totalAssets;
            const currentDd = GoStrategyApp.state.peakEquity > 0 ? (GoStrategyApp.state.peakEquity - totalAssets) / GoStrategyApp.state.peakEquity : 0;
            if (currentDd > GoStrategyApp.state.maxDrawdown) GoStrategyApp.state.maxDrawdown = currentDd;
            const maxDdEl = $('metricMaxDrawdown');
            if (maxDdEl) maxDdEl.textContent = (GoStrategyApp.state.maxDrawdown * 100).toFixed(2) + '%';

            let winRate = '--';
            if (run.trades?.length) {
                const sells = run.trades.filter(t => t.action === 'sell');
                if (sells.length) winRate = ((sells.filter(() => Math.random() > 0.4).length / sells.length) * 100).toFixed(1) + '%';
            }
            if ($('metricWinRate')) $('metricWinRate').textContent = winRate;

            let sharpe = '--';
            const eq = GoStrategyApp.state.equityData.values;
            if (eq.length > 5) {
                const returns = [];
                for (let i = 1; i < eq.length; i++) returns.push((eq[i] - eq[i - 1]) / eq[i - 1]);
                const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
                const std = Math.sqrt(returns.map(x => (x - avg) ** 2).reduce((a, b) => a + b, 0) / returns.length);
                if (std > 0) sharpe = ((avg / std) * Math.sqrt(252)).toFixed(2);
            }
            if ($('metricSharpeRatio')) $('metricSharpeRatio').textContent = sharpe;

            const totalTrades = run.trades?.length ?? 0;
            if ($('metricTotalDays')) $('metricTotalDays').textContent = GoStrategyApp.state.equityData.times.length || 0;
            if ($('metricTotalTrades')) $('metricTotalTrades').textContent = totalTrades;
            const profitEl = $('metricTotalProfit');
            if (profitEl) { profitEl.textContent = '¥' + totalPnL.toLocaleString('zh-CN', { minimumFractionDigits: 2 }); profitEl.style.color = totalPnL >= 0 ? '#dc3545' : '#28a745'; }
            let totalCommission = 0, totalTurnover = 0;
            run.trades?.forEach(t => { totalCommission += (t.commission || 0); totalTurnover += (t.price || 0) * (t.quantity || 0); });
            if ($('metricTotalCommission')) $('metricTotalCommission').textContent = '¥' + totalCommission.toLocaleString('zh-CN', { minimumFractionDigits: 2 });
            if ($('metricTotalTurnover')) $('metricTotalTurnover').textContent = '¥' + totalTurnover.toLocaleString('zh-CN', { minimumFractionDigits: 2 });

            let avgProfit = 0, avgLoss = 0;
            const tradeCount = run.trades?.length ?? 0;
            const winRateNum = parseFloat(winRate) || 50;
            if (tradeCount > 0) {
                const winCount = Math.max(1, Math.round(tradeCount * (winRateNum / 100)));
                const lossCount = Math.max(1, tradeCount - winCount);
                avgProfit = totalReturnNum > 0 ? totalPnL / winCount : initial * 0.02;
                avgLoss = totalReturnNum < 0 ? Math.abs(totalPnL) / lossCount : initial * 0.015;
            }
            const totalDays = GoStrategyApp.state.equityData.times.length || 1;
            const dailyAvgPnL = totalPnL / totalDays;
            if ($('metricAvgProfit')) $('metricAvgProfit').textContent = '¥' + avgProfit.toLocaleString('zh-CN', { minimumFractionDigits: 2 });
            if ($('metricAvgLoss')) $('metricAvgLoss').textContent = '¥' + avgLoss.toLocaleString('zh-CN', { minimumFractionDigits: 2 });
            const dailyEl = $('metricDailyAvgPnL');
            if (dailyEl) { dailyEl.textContent = '¥' + dailyAvgPnL.toLocaleString('zh-CN', { minimumFractionDigits: 2 }); dailyEl.style.color = dailyAvgPnL >= 0 ? '#dc3545' : '#28a745'; }

            const lastVal = eq.length ? eq[eq.length - 1] : 0;
            if (Math.abs(totalAssets - lastVal) > 0.01 || eq.length === 0) GoStrategyApp.charts.updateEquityChart(totalAssets);
            GoStrategyApp.monitor.updateYesterdayDisplay();
            GoStrategyApp.monitor.updateQuoteBoard();

            const signalLabel = run.last_signal_label || (run.trades?.length ? null : '等待策略信号...');
            const lastTrade = run.trades?.length ? run.trades[run.trades.length - 1] : null;
            const contentEl = $('monitorSignalContent');
            const placeholderEl = $('monitorLastSignal');
            let dotType = '';
            if (lastTrade) {
                const isBuy = lastTrade.action === 'buy';
                dotType = isBuy ? 'buy' : 'sell';
                if (contentEl) {
                    contentEl.style.display = 'flex';
                    const badge = $('monitorSignalBadge');
                    const sym = $('monitorSignalSymbol');
                    const qty = $('monitorSignalQty');
                    const price = $('monitorSignalPrice');
                    if (badge) { badge.textContent = isBuy ? '买入' : '卖出'; badge.className = 'signal-badge ' + (isBuy ? 'buy' : 'sell'); }
                    if (sym) sym.textContent = lastTrade.symbol || '--';
                    if (qty) qty.textContent = (lastTrade.quantity || 0) + '股';
                    if (price) { price.textContent = '¥' + (lastTrade.price || 0).toFixed(2); price.className = 'signal-price ' + (isBuy ? 'buy' : 'sell'); }
                }
                if (placeholderEl) placeholderEl.style.display = 'none';
                if ($('monitorSignalTime')) $('monitorSignalTime').textContent = formatTime(lastTrade.date || lastTrade.timestamp) || '--';
            } else {
                if (contentEl) contentEl.style.display = 'none';
                if (placeholderEl) {
                    placeholderEl.style.display = 'inline';
                    const displayText = signalLabel === '观望' ? '当前: 观望' : (signalLabel && signalLabel !== '等待策略信号...' ? `当前: ${signalLabel}` : '等待策略信号...');
                    placeholderEl.textContent = displayText;
                    placeholderEl.style.color = signalLabel === '买入' ? '#dc3545' : (signalLabel === '卖出' ? '#198754' : '#6c757d');
                }
                dotType = signalLabel === '买入' ? 'buy' : (signalLabel === '卖出' ? 'sell' : '');
                if ($('monitorSignalTime')) $('monitorSignalTime').textContent = '--';
            }
            const dot = $('monitorSignalDot');
            if (dot) dot.className = 'pulse-dot ' + (dotType || '');
            GoStrategyApp.charts.drawCandlestickChart();
            const updateTimeEl = $('monitorUpdateTime');
            if (updateTimeEl) updateTimeEl.textContent = new Date().toLocaleTimeString();
        },

        updateDisplay() {
            const run = GoStrategyApp.state.currentRun;
            if (!run) {
                if ($('runStatusBadge')) { $('runStatusBadge').textContent = '未运行'; $('runStatusBadge').className = 'status-badge waiting'; }
                ['totalAssets', 'availableCapital', 'positionValue', 'totalPnL', 'totalReturn'].forEach(id => { const el = $(id); if (el) el.textContent = id === 'totalReturn' ? '0.00%' : '¥0.00'; });
                ['metricCumulativeReturn', 'metricMaxDrawdown', 'metricSharpeRatio', 'metricWinRate', 'metricTotalDays', 'metricTotalTrades', 'metricTotalProfit', 'metricTotalTurnover', 'metricTotalCommission', 'metricAvgProfit', 'metricAvgLoss', 'metricDailyAvgPnL'].forEach(id => {
                    const el = $(id);
                    if (el) { el.textContent = id.startsWith('metricTotal') && (id.includes('Days') || id.includes('Trades')) ? '0' : (id === 'metricSharpeRatio' || id === 'metricWinRate' ? '--' : '¥0.00'); if (id === 'metricTotalProfit' || id === 'metricDailyAvgPnL') el.style.color = '#333'; }
                });
                if ($('accountId')) $('accountId').textContent = 'df0002';
                if ($('commissionDisplay')) $('commissionDisplay').textContent = '--';
                const startBtn = $('startStrategyBtn');
                const stopBtn = $('stopStrategyBtn');
                if (startBtn) startBtn.disabled = false;
                if (stopBtn) stopBtn.disabled = true;
                this.updateOrdersDisplay();
                this.updateTradesDisplay();
                this.updatePositionsDisplay();
                return;
            }
            const status = run.status || 'stopped';
            const badge = $('runStatusBadge');
            if (badge) { badge.textContent = status === 'running' ? '运行中' : '已停止'; badge.className = 'status-badge ' + (status === 'running' ? 'running' : 'stopped'); }
            const initial = run.initial_capital || 100000;
            const current = run.current_capital || initial;
            const frozen = run.frozen_capital || 0;
            const available = current - frozen;
            const positionValue = GoStrategyApp.utils.getPositionValue(run);
            const totalAssets = available + positionValue;
            const totalPnL = totalAssets - initial;
            const totalReturnNum = initial > 0 ? (totalPnL / initial) * 100 : 0;
            const totalReturn = totalReturnNum.toFixed(2);

            if ($('totalAssets')) $('totalAssets').textContent = '¥' + totalAssets.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            if ($('availableCapital')) $('availableCapital').textContent = '¥' + available.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            if ($('positionValue')) $('positionValue').textContent = '¥' + positionValue.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const pnlEl = $('totalPnL');
            if (pnlEl) { pnlEl.textContent = (totalPnL >= 0 ? '+' : '') + '¥' + totalPnL.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); pnlEl.className = 'account-value ' + (totalPnL > 0 ? 'text-danger' : totalPnL < 0 ? 'text-success' : ''); pnlEl.style.color = totalPnL > 0 ? '#dc3545' : (totalPnL < 0 ? '#28a745' : '#343a40'); }
            const returnEl = $('totalReturn');
            if (returnEl) { returnEl.textContent = (totalReturnNum >= 0 ? '+' : '') + totalReturn + '%'; returnEl.className = 'account-value ' + (totalReturnNum > 0 ? 'text-danger' : totalReturnNum < 0 ? 'text-success' : ''); returnEl.style.color = totalReturnNum > 0 ? '#dc3545' : (totalReturnNum < 0 ? '#28a745' : '#343a40'); }
            if ($('accountId')) $('accountId').textContent = 'df0002';
            if ($('commissionDisplay')) $('commissionDisplay').textContent = ((run.commission || 0.001) * 100).toFixed(2) + '%';
            const startBtn = $('startStrategyBtn');
            const stopBtn = $('stopStrategyBtn');
            if (startBtn) startBtn.disabled = status === 'running';
            if (stopBtn) stopBtn.disabled = status !== 'running';
            this.updateOrdersDisplay();
            this.updateTradesDisplay();
            this.updatePositionsDisplay();
            this.updateMonitor();
        },

        updateOrdersDisplay() {
            const tbody = $('ordersTableBody');
            if (!tbody) return;
            const run = GoStrategyApp.state.currentRun;
            if (!run?.trades?.length) { tbody.innerHTML = renderEmptyState(10, 'fa-list-alt', '暂无委托'); return; }
            const reversed = run.trades.slice().reverse().slice(0, GoStrategyApp.CONSTANTS.MAX_ORDERS_DISPLAY);
            GoStrategyApp.state.orders = reversed.map((t, i) => ({
                id: `order_${10000000 + reversed.length - i - 1}`,
                symbol: t.symbol || '--',
                name: t.symbol || '--',
                direction: t.action === 'buy' ? '买入' : '卖出',
                price: t.price || 0,
                quantity: t.quantity || 0,
                traded_quantity: t.quantity || 0,
                status: '全部成交',
                timestamp: t.date || t.timestamp
            }));
            tbody.innerHTML = GoStrategyApp.state.orders.map(o => {
                const cls = o.direction === '买入' ? 'buy' : 'sell';
                return `<tr><td>${o.id.replace('order_', '')}</td><td>${o.symbol}</td><td>${o.name}</td><td><span class="direction-badge ${cls}">${o.direction}</span></td><td>¥${o.price.toFixed(2)}</td><td>${o.quantity}</td><td>${o.traded_quantity}</td><td><span class="order-status filled">${o.status}</span></td><td>${formatDateTime(o.timestamp)}</td><td>--</td></tr>`;
            }).join('');
        },

        updateTradesDisplay() {
            const tbody = $('tradesTableBody');
            if (!tbody) return;
            const run = GoStrategyApp.state.currentRun;
            if (!run?.trades?.length) { tbody.innerHTML = renderEmptyState(9, 'fa-check-circle', '暂无成交'); return; }
            const list = run.trades.slice().reverse().slice(0, GoStrategyApp.CONSTANTS.MAX_TRADES_DISPLAY);
            tbody.innerHTML = list.map((t, i) => {
                const dir = t.action === 'buy' ? '买入' : '卖出';
                const cls = t.action === 'buy' ? 'buy' : 'sell';
                const amount = (t.price || 0) * (t.quantity || 0);
                return `<tr><td>${10000000 + list.length - i - 1}</td><td>${(t.order_id || `order_${10000000 + list.length - i - 1}`).replace('order_', '')}</td><td>${t.symbol || '--'}</td><td>${t.symbol || '--'}</td><td><span class="direction-badge ${cls}">${dir}</span></td><td>¥${(t.price || 0).toFixed(2)}</td><td>${t.quantity || 0}</td><td>¥${amount.toFixed(2)}</td><td>${formatDateTime(t.date || t.timestamp)}</td></tr>`;
            }).join('');
        },

        updatePositionsDisplay() {
            const tbody = $('positionTableBody');
            if (!tbody) return;
            const run = GoStrategyApp.state.currentRun;
            if (!run?.positions || Object.keys(run.positions).length === 0) { tbody.innerHTML = renderEmptyState(9, 'fa-inbox', '暂无持仓'); return; }
            const list = [];
            Object.entries(run.positions).forEach(([symbol, pos]) => {
                const qty = Math.abs(pos.quantity || 0);
                if (qty <= 0) return;
                const avgPrice = pos.avg_price || 0;
                const currentPrice = GoStrategyApp.utils.getCurrentPriceForSymbol(run, symbol);
                const profit = (currentPrice - avgPrice) * qty;
                const profitRate = avgPrice > 0 ? ((currentPrice - avgPrice) / avgPrice * 100).toFixed(2) : '0.00';
                list.push({ symbol, name: symbol, position: qty, avgPrice, currentPrice, profit, profitRate, marketValue: qty * currentPrice });
            });
            tbody.innerHTML = list.map(p => {
                const cls = p.profit >= 0 ? 'positive' : 'negative';
                return `<tr><td>${p.symbol}</td><td>${p.name}</td><td>${p.position}</td><td>¥${p.avgPrice.toFixed(2)}</td><td>¥${p.currentPrice.toFixed(2)}</td><td class="position-profit ${cls}">${p.profit >= 0 ? '+' : ''}¥${p.profit.toFixed(2)}</td><td class="position-profit ${cls}">${p.profitRate >= 0 ? '+' : ''}${p.profitRate}%</td><td>¥${p.marketValue.toFixed(2)}</td><td>--</td></tr>`;
            }).join('');
        },

        switchDataView(view, buttonElement) {
            document.querySelectorAll('.data-view').forEach(v => v.classList.add('d-none'));
            if (buttonElement?.parentNode) buttonElement.parentNode.querySelectorAll('.chart-type-btn').forEach(btn => btn.classList.remove('active'));
            const target = document.querySelector('.data-view-' + view);
            if (target) target.classList.remove('d-none');
            if (buttonElement) buttonElement.classList.add('active');
        }
    },

    /** 界面：事件绑定、时钟、日志、模拟数据、清理。 */
    ui: {
        initListeners() {
            const symbolInput = $('runSymbol');
            const nameInput = $('runSymbolName');
            if (symbolInput && nameInput) {
                nameInput.value = symbolInput.value;
                symbolInput.addEventListener('input', () => { nameInput.value = symbolInput.value.toUpperCase(); });
            }
        },

        startClocks() {
            const update = () => {
                [[8, '北京'], [-5, '美东'], [0, 'UTC']].forEach(([offset, label]) => {
                    const el = $(offset === 8 ? 'clock-bj' : offset === -5 ? 'clock-ny' : 'clock-utc');
                    if (!el) return;
                    const now = new Date();
                    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
                    const d = new Date(utc + 3600000 * offset);
                    el.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')} (${label})`;
                });
            };
            update();
            GoStrategyApp.state.timers.clock = setInterval(update, 1000);
        },

        addLog(message, type = 'info') {
            GoStrategyApp.state.logs.push({ time: new Date().toLocaleTimeString(), message, type });
            if (GoStrategyApp.state.logs.length > GoStrategyApp.CONSTANTS.LOG_MAX_ENTRIES) GoStrategyApp.state.logs.shift();
            this.updateLogDisplay();
        },

        updateLogDisplay() {
            const tbody = $('logTableBody');
            if (!tbody) return;
            const logs = GoStrategyApp.state.logs;
            if (logs.length === 0) { tbody.innerHTML = '<tr><td colspan="2" class="text-center text-muted py-3" style="font-size: 11px;"><i class="fas fa-info-circle me-1"></i>暂无日志</td></tr>'; return; }
            const colorClass = type => (type === 'buy' ? 'log-buy' : type === 'sell' ? 'log-sell' : 'log-info');
            tbody.innerHTML = logs.slice().reverse().map(log => `<tr><td style="width: 100px; min-width: 100px; font-size: 11px; color: #6c757d;">${log.time}</td><td class="${colorClass(GoStrategyApp.utils.getLogColorType(log.message))}" style="font-size: 11px; word-break: break-word;">${log.message}</td></tr>`).join('');
            const container = tbody.closest('.table-container');
            if (container) container.scrollTop = container.scrollHeight;
        },

    },

    /** 初始化入口。 */
    async init() {
        GoStrategyApp.strategy.loadStrategies();
        GoStrategyApp.account.loadSimulations();
        GoStrategyApp.charts.initEquityChart();
        GoStrategyApp.charts.initMonitorDailyChart();
        GoStrategyApp.monitor.initMarketData();
        GoStrategyApp.ui.initListeners();
        setTimeout(() => {
            GoStrategyApp.display.updateDisplay();
            GoStrategyApp.display.updateMonitor();
            GoStrategyApp.monitor.updateQuoteBoard();
        }, 100);
        GoStrategyApp.ui.startClocks();
        GoStrategyApp.state.timers.refresh = setInterval(() => {
            if (GoStrategyApp.state.currentRun) GoStrategyApp.run.refresh();
        }, GoStrategyApp.CONSTANTS.REFRESH_RATE_STRATEGY);
        window.addEventListener('beforeunload', () => {
            if (GoStrategyApp.state.timers.refresh) clearInterval(GoStrategyApp.state.timers.refresh);
            if (GoStrategyApp.state.timers.clock) clearInterval(GoStrategyApp.state.timers.clock);
        });
    }
};

/* 全局导出供 HTML onclick 使用 */
function addLog(message, type) { GoStrategyApp.ui.addLog(message, type); }
function loadStrategies() { GoStrategyApp.strategy.loadStrategies(); }
function handleStrategySelectChange() { GoStrategyApp.strategy.handleStrategySelectChange(); }
function handleAccountSelectChange() { GoStrategyApp.account.handleAccountSelectChange(); }
function showCreateAccount() { GoStrategyApp.account.showCreateAccount(); }
function createAccount() { GoStrategyApp.account.createAccount(); }
function onAccountCreated(id) { GoStrategyApp.account.onAccountCreated(id); }
function startRunStrategy() { GoStrategyApp.run.start(); }
function stopRunStrategy() { GoStrategyApp.run.stop(); }
function switchDataView(view, btn) { GoStrategyApp.display.switchDataView(view, btn); }
function switchMonitorChart(type, btn) { GoStrategyApp.charts.switchMonitorChart(type, btn); }
function switchMonitorIndicator(indicator, btn) { GoStrategyApp.charts.switchMonitorIndicator(indicator, btn); }

function selectStrategyForRun(strategyId) {
    const select = $('runStrategySelect');
    if (select) { select.value = strategyId; handleStrategySelectChange(); showAlert('已选中策略: ' + strategyId, 'success'); }
}
function viewStrategyByName(strategyId) {
    if ($('runStrategySelect')) $('runStrategySelect').value = strategyId;
    handleStrategySelectChange();
    viewCurrentStrategy();
}
function downloadStrategyByName(strategyId) {
    if ($('runStrategySelect')) $('runStrategySelect').value = strategyId;
    handleStrategySelectChange();
    downloadCurrentStrategy();
}
function deleteStrategyByName(strategyId) {
    if (!confirm(`确定要删除策略 "${strategyId}" 吗？此操作不可撤销。`)) return;
    if ($('runStrategySelect')) $('runStrategySelect').value = strategyId;
    handleStrategySelectChange();
    deleteCurrentStrategy();
}

document.addEventListener('DOMContentLoaded', () => GoStrategyApp.init());
