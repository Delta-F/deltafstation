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
        peakEquity: 0,
        monitorDailyChartCanvas: null,
        monitorDailyChartCtx: null,
        monitorDailyData: { dates: [], candles: [], signals: [] },
        liveSignalHistory: [],
        lastLiveSignalRunId: null,
        monitorMarketData: {},
        symbolCatalogItems: [],
        symbolSuggestionIndex: -1,
        symbolDataSource: 'yfinance',
        timers: { refresh: null, clock: null }
    },

    /** 从 DOM 读取当前监控图类型（daily/equity）与副图指标（ma/boll），周期来自表单 runSignalInterval。 */
    _monitorChartType() {
        const el = $('chartTypeDaily');
        return el?.classList.contains('active') ? 'daily' : 'equity';
    },
    _monitorIndicator() {
        const btn = $('monitorIndicatorButtons')?.querySelector('.chart-type-btn.active');
        return btn?.dataset?.indicator || 'ma';
    },

    /** 是否为券商实盘（QMT）账户。 */
    isBrokerAccount(sim) {
        return (sim?.account_type || '').toLowerCase() === 'broker';
    },

    /** 投资标的：目录与联想（QMT / YF 随账户切换，逻辑对齐 trader 页）。 */
    symbol: {
        dataSource() {
            const id = $('runAccountSelect')?.value;
            const acc = GoStrategyApp.state.allSimulations.find(s => s.id === id);
            return GoStrategyApp.isBrokerAccount(acc) ? 'miniqmt' : 'yfinance';
        },

        extractCode(raw) {
            const input = (raw || '').trim().toUpperCase();
            if (!input) return '';
            const m = input.match(/[A-Z0-9]+(?:\.[A-Z]{2,3})?(?:-[A-Z]{3,4})?/);
            return m ? m[0] : input.split(/\s|-/)[0];
        },

        resolveName(code) {
            const sym = (code || '').toUpperCase();
            return (GoStrategyApp.state.symbolCatalogItems || []).find(i => i.code === sym)?.name || '';
        },

        async loadCatalog(source) {
            const src = source === 'miniqmt' ? 'miniqmt' : 'yfinance';
            GoStrategyApp.state.symbolDataSource = src;
            const { ok, data } = await apiRequest(`/api/data/symbols/catalog?source=${encodeURIComponent(src)}`);
            if (ok && Array.isArray(data?.items)) {
                GoStrategyApp.state.symbolCatalogItems = data.items
                    .map(i => ({ code: String(i.code || '').trim().toUpperCase(), name: String(i.name || '').trim() }))
                    .filter(i => i.code);
            }
        },

        hideSuggestions() {
            const panel = $('runSymbolSuggestions');
            if (panel) panel.classList.add('d-none');
            GoStrategyApp.state.symbolSuggestionIndex = -1;
        },

        renderSuggestions(keyword = '') {
            const panel = $('runSymbolSuggestions');
            const input = $('runSymbol');
            if (!panel || !input) return;
            const key = this.extractCode(keyword);
            const list = GoStrategyApp.state.symbolCatalogItems || [];
            if (!list.length) { this.hideSuggestions(); return; }
            const filtered = key
                ? list.filter(i => i.code.includes(key) || i.name.toUpperCase().includes(key))
                : list;
            const items = filtered.slice(0, 50);
            if (!items.length) { this.hideSuggestions(); return; }
            const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
            panel.innerHTML = items.map((item, idx) => `
                <div class="symbol-suggestion-item${idx === GoStrategyApp.state.symbolSuggestionIndex ? ' active' : ''}"
                     data-code="${esc(item.code)}" data-name="${esc(item.name)}">
                    <span class="symbol-suggestion-code">${esc(item.code)}</span>
                    <span class="symbol-suggestion-name">${esc(item.name || '--')}</span>
                </div>`).join('');
            panel.classList.remove('d-none');
        },

        applySelection(code, name = '') {
            const input = $('runSymbol');
            const nameEl = $('runSymbolName');
            if (!input) return;
            const sym = (code || '').toUpperCase();
            input.value = sym;
            if (nameEl) nameEl.value = name || this.resolveName(sym) || '';
            if (sym) {
                const q = GoStrategyApp.state.monitorMarketData[sym] || { symbol: sym, price: 0 };
                if (name) q.name = name;
                GoStrategyApp.state.monitorMarketData[sym] = q;
            }
            this.hideSuggestions();
        },

        async onAccountSelect(account) {
            const isBroker = GoStrategyApp.isBrokerAccount(account);
            const src = isBroker ? 'miniqmt' : 'yfinance';
            const input = $('runSymbol');
            const nameEl = $('runSymbolName');
            if (GoStrategyApp.state.symbolDataSource !== src) {
                if (input) { input.value = ''; input.removeAttribute('data-last-symbol'); }
                if (nameEl) nameEl.value = '';
            }
            if (input) input.placeholder = '代码';
            await this.loadCatalog(src);
            this.hideSuggestions();
        },

        async syncName() {
            const input = $('runSymbol');
            const nameEl = $('runSymbolName');
            if (!input) return;
            const sym = this.extractCode(input.value);
            if (!sym) { if (nameEl) nameEl.value = ''; return; }
            input.value = sym;
            let name = this.resolveName(sym);
            const src = this.dataSource();
            const { ok, data } = await apiRequest(`/api/data/live/${encodeURIComponent(sym)}?source=${src}`);
            if (ok && data && data.status !== 'loading') {
                name = data.name || name;
                GoStrategyApp.state.monitorMarketData[sym] = { ...data, symbol: sym, price: data.price, name };
            }
            if (nameEl) nameEl.value = name || '';
        },

        bindAutocomplete() {
            const input = $('runSymbol');
            const panel = $('runSymbolSuggestions');
            if (!input || !panel) return;
            input.addEventListener('focus', () => this.renderSuggestions(input.value));
            input.addEventListener('input', () => {
                GoStrategyApp.state.symbolSuggestionIndex = -1;
                this.renderSuggestions(input.value);
            });
            input.addEventListener('keydown', (e) => {
                const items = panel.querySelectorAll('.symbol-suggestion-item');
                if (panel.classList.contains('d-none') || !items.length) return;
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    GoStrategyApp.state.symbolSuggestionIndex = (GoStrategyApp.state.symbolSuggestionIndex + 1) % items.length;
                    this.renderSuggestions(input.value);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    const i = GoStrategyApp.state.symbolSuggestionIndex;
                    GoStrategyApp.state.symbolSuggestionIndex = i <= 0 ? items.length - 1 : i - 1;
                    this.renderSuggestions(input.value);
                } else if (e.key === 'Enter' && GoStrategyApp.state.symbolSuggestionIndex >= 0) {
                    e.preventDefault();
                    const t = items[GoStrategyApp.state.symbolSuggestionIndex];
                    this.applySelection(t.dataset.code, t.dataset.name);
                } else if (e.key === 'Escape') this.hideSuggestions();
            });
            panel.addEventListener('mousedown', (e) => {
                const t = e.target.closest('.symbol-suggestion-item');
                if (!t) return;
                e.preventDefault();
                this.applySelection(t.dataset.code, t.dataset.name);
            });
            document.addEventListener('click', (e) => {
                if (!input.contains(e.target) && !panel.contains(e.target)) this.hideSuggestions();
            });
        },

        async init() {
            this.bindAutocomplete();
            await this.syncName();
        }
    },

    /** 工具：从 simulation 推算持仓市值与标的当前价（供监控/总览/持仓表格共用）。 */
    utils: {
        /** 有实时行情或成交价则返回当前价，否则返回 null（界面显示占位符，不模拟数据）。 */
        getCurrentPriceForSymbol(simulation, symbol) {
            if (!simulation || !symbol) return null;
            const quote = GoStrategyApp.state.monitorMarketData[symbol];
            if (quote?.price != null && quote.status !== 'loading' && Number(quote.price) > 0)
                return Number(quote.price);
            if (simulation.trades?.length) {
                const last = simulation.trades.filter(t => t.symbol === symbol).pop();
                if (last?.price && last.price > 0) return last.price;
            }
            return null;
        },

        /** 从柜台持仓行构建 positions 条目（与 trader 页一致）。 */
        mapBrokerPositionRow(p) {
            const sym = String(p.symbol || '').toUpperCase();
            const qty = parseInt(p.can_use_volume ?? p.volume ?? 0, 10);
            if (!sym || qty <= 0) return null;
            return {
                quantity: qty,
                avg_price: parseFloat(p.avg_price || p.open_price || 0),
                last_price: parseFloat(p.last_price || 0),
                market_value: parseFloat(p.market_value || 0),
                position_profit: parseFloat(p.position_profit || 0),
                profit_rate: parseFloat(p.profit_rate || 0),
            };
        },

        /** broker 持仓盈亏率：兼容 0.0123 小数与 1.23 百分数。 */
        brokerProfitRatePercent(raw) {
            const r = parseFloat(raw);
            if (!Number.isFinite(r)) return 0;
            return Math.abs(r) <= 1 ? r * 100 : r;
        },

        /**
         * 总资产与盈亏（paper：initial_capital；broker：策略启动时 _brokerBaseline，不用单次投入）。
         */
        computeAccountTotals(run) {
            if (!run) {
                return { totalAssets: 0, available: 0, positionValue: 0, totalPnL: 0, totalReturnNum: 0, hasPnl: false };
            }
            const current = run.current_capital ?? 0;
            const frozen = run.frozen_capital || 0;
            const available = current - frozen;
            const positionValue = GoStrategyApp.utils.getPositionValue(run);
            const totalAssets = available + positionValue;
            if (GoStrategyApp.isBrokerAccount(run)) {
                const baseline = parseFloat(run._brokerBaseline);
                const hasPnl = Number.isFinite(baseline) && baseline > 0;
                const totalPnL = hasPnl ? totalAssets - baseline : 0;
                const totalReturnNum = hasPnl ? (totalPnL / baseline) * 100 : 0;
                return { totalAssets, available, positionValue, totalPnL, totalReturnNum, hasPnl, initial: hasPnl ? baseline : 0 };
            }
            const initial = run.initial_capital || 100000;
            const totalPnL = totalAssets - initial;
            const totalReturnNum = initial > 0 ? (totalPnL / initial) * 100 : 0;
            return { totalAssets, available, positionValue, totalPnL, totalReturnNum, hasPnl: true, initial };
        },

        _brokerBaselineKey(accountId) {
            return `gostrategy_broker_baseline_${accountId}`;
        },
        loadBrokerBaseline(run) {
            if (!run?.id || !GoStrategyApp.isBrokerAccount(run)) return;
            try {
                const v = sessionStorage.getItem(GoStrategyApp.utils._brokerBaselineKey(run.id));
                const n = parseFloat(v);
                if (Number.isFinite(n) && n > 0) run._brokerBaseline = n;
            } catch (_) { /* ignore */ }
        },
        saveBrokerBaseline(run) {
            if (!run?.id || run._brokerBaseline == null || run._brokerBaseline <= 0) return;
            try {
                sessionStorage.setItem(GoStrategyApp.utils._brokerBaselineKey(run.id), String(run._brokerBaseline));
            } catch (_) { /* ignore */ }
        },
        clearBrokerBaseline(accountId) {
            try { sessionStorage.removeItem(GoStrategyApp.utils._brokerBaselineKey(accountId)); } catch (_) { /* ignore */ }
        },
        /** 记录 QMT 本轮策略启动时的总资产基准（仅记一次）。 */
        ensureBrokerBaseline(run, totalAsset) {
            if (!run || !GoStrategyApp.isBrokerAccount(run)) return;
            if (run._brokerBaseline != null && run._brokerBaseline > 0) return;
            const ta = parseFloat(totalAsset);
            if (Number.isFinite(ta) && ta > 0) {
                run._brokerBaseline = ta;
                GoStrategyApp.utils.saveBrokerBaseline(run);
            }
        },

        /** 计算 simulation 的持仓市值。 */
        getPositionValue(simulation) {
            if (!simulation?.positions) return 0;
            let total = 0;
            const isBroker = GoStrategyApp.isBrokerAccount(simulation);
            Object.entries(simulation.positions).forEach(([sym, pos]) => {
                const qty = Math.abs(pos.quantity || 0);
                if (qty <= 0) return;
                if (isBroker) {
                    const mv = parseFloat(pos.market_value || 0);
                    if (mv > 0) { total += mv; return; }
                    const lp = parseFloat(pos.last_price || 0);
                    if (lp > 0) { total += qty * lp; return; }
                }
                const price = GoStrategyApp.utils.getCurrentPriceForSymbol(simulation, sym);
                if (price != null && price > 0) total += qty * price;
            });
            return total;
        },

        /** 根据日志内容返回颜色类型：买入→buy，卖出→sell，否则→info。 */
        getLogColorType(message) {
            if (message.includes('买入')) return 'buy';
            if (message.includes('卖出')) return 'sell';
            return 'info';
        },
        /** 将原始日志消息格式化为带徽章/图标的 HTML 片段。 */
        formatLogMessage(msg, type) {
            if (msg.includes('策略执行买入:')) {
                const m = msg.replace(/^策略执行买入:\s*/, '');
                return `<span class="log-action-badge log-buy"><i class="fas fa-arrow-up me-1"></i>买入</span> ${m}`;
            }
            if (msg.includes('策略执行卖出:')) {
                const m = msg.replace(/^策略执行卖出:\s*/, '');
                return `<span class="log-action-badge log-sell"><i class="fas fa-arrow-down me-1"></i>卖出</span> ${m}`;
            }
            const icon = type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-times-circle' : type === 'warning' ? 'fa-exclamation-triangle' : 'fa-info-circle';
            return `<i class="fas ${icon} log-msg-icon log-${type} me-1"></i>${msg}`;
        },

        /** 前端全量指标计算：基于全量成交历史 (trades) 和当前实时资产。 */
        calculateAccountMetrics(run) {
            if (!run) return {};
            const totals = GoStrategyApp.utils.computeAccountTotals(run);
            const { totalAssets, totalPnL, totalReturnNum, hasPnl, initial } = totals;
            const totalReturn = hasPnl && initial > 0 ? totalReturnNum / 100 : 0;
            const trades = run.trades || [];

            // 2. 遍历成交：统计笔数、佣金、成交额
            let totalCommission = 0;
            let totalTurnover = 0;
            trades.forEach(t => {
                totalCommission += (t.commission || 0);
                totalTurnover += Math.abs(t.quantity || 0) * (t.price || 0);
            });

            // 3. FIFO 胜率与盈亏分布
            const closedPnLs = [];
            const inventory = {}; // {symbol: {buys: [], sells: []}}
            
            // 简单 FIFO 配对逻辑
            trades.forEach(t => {
                const sym = t.symbol;
                const qty = Math.abs(t.quantity || 0);
                const price = t.price || 0;
                if (!inventory[sym]) inventory[sym] = { buys: [], sells: [] };
                
                if (t.action === 'buy') {
                    let remaining = qty;
                    while (remaining > 0 && inventory[sym].sells.length > 0) {
                        const top = inventory[sym].sells[0];
                        const exec = Math.min(remaining, top.q);
                        closedPnLs.push((top.p - price) * exec);
                        remaining -= exec;
                        top.q -= exec;
                        if (top.q <= 0) inventory[sym].sells.shift();
                    }
                    if (remaining > 0) inventory[sym].buys.push({ q: remaining, p: price });
                } else {
                    let remaining = qty;
                    while (remaining > 0 && inventory[sym].buys.length > 0) {
                        const top = inventory[sym].buys[0];
                        const exec = Math.min(remaining, top.q);
                        closedPnLs.push((price - top.p) * exec);
                        remaining -= exec;
                        top.q -= exec;
                        if (top.q <= 0) inventory[sym].buys.shift();
                    }
                    if (remaining > 0) inventory[sym].sells.push({ q: remaining, p: price });
                }
            });

            const winCount = closedPnLs.filter(p => p > 0).length;
            const winRate = closedPnLs.length > 0 ? (winCount / closedPnLs.length) : 0;
            const profits = closedPnLs.filter(p => p > 0);
            const losses = closedPnLs.filter(p => p < 0);
            const avgProfit = profits.length ? (profits.reduce((a, b) => a + b, 0) / profits.length) : 0;
            const avgLoss = losses.length ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 0;

            // 4. 时间统计
            let totalDays = 0;
            if (trades.length > 0) {
                const firstTs = trades[0].timestamp || trades[0].date;
                const firstDate = new Date(firstTs);
                totalDays = Math.max(1, Math.ceil((new Date() - firstDate) / (1000 * 86400)));
            }

            return {
                total_return: totalReturn,
                total_pnl: totalPnL,
                total_commission: totalCommission,
                total_turnover: totalTurnover,
                total_trades: trades.length,
                win_rate: winRate,
                avg_profit: avgProfit,
                avg_loss: avgLoss,
                total_days: totalDays,
                daily_avg_pnl: totalPnL / (totalDays || 1),
                profit_loss_ratio: avgLoss > 0 ? (avgProfit / avgLoss) : 0,
                // 回撤和夏普在前端基于 trades 重建净值曲线较复杂，暂设为 0 或从后端取
                max_drawdown: run.metrics?.max_drawdown || 0,
                sharpe_ratio: run.metrics?.sharpe_ratio || 0
            };
        }
    },

    /** 策略列表：加载、渲染、选中/查看/下载/删除、选择变更。 */
    strategy: {
        /** 从接口拉取策略列表，填充下拉框并渲染左侧策略文件列表。 */
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

        /** 将策略数组渲染为左侧卡片列表（名称、大小、时间、操作按钮）。 */
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

        /** 策略下拉框变更时，同步更新策略操作按钮状态。 */
        handleStrategySelectChange() {
            const select = $('runStrategySelect');
            if (select) updateStrategyActionButtons(select.value);
        }
    },

    /** 账户：加载、选择变更、创建、创建回调。 */
    account: {
        /** 从接口拉取模拟账户列表，填充账户下拉框并同步预览。 */
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
                    const typeTag = GoStrategyApp.isBrokerAccount(sim) ? ' [QMT]' : '';
                    const label = (sim.name || sim.id || '') + typeTag + (sim.id ? ` (${sim.id})` : '');
                    opt.textContent = label;
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

        /** 账户下拉框变更时，显示/隐藏余额与费率预览。 */
        handleAccountSelectChange() {
            const select = $('runAccountSelect');
            const preview = $('accountConfigPreview');
            if (!select || !preview) return;
            const accountId = select.value;
            if (!accountId) { preview.style.display = 'none'; return; }
            const account = GoStrategyApp.state.allSimulations.find(s => s.id === accountId);
            if (account) {
                preview.style.display = 'block';
                const isBroker = GoStrategyApp.isBrokerAccount(account);
                const balance = account.current_capital ?? account.initial_capital ?? 0;
                if ($('previewBalance')) {
                    $('previewBalance').textContent = isBroker && balance <= 0
                        ? '（启动后同步柜台）'
                        : '¥' + balance.toLocaleString('zh-CN', { minimumFractionDigits: 2 });
                }
                if ($('previewCommission')) {
                    $('previewCommission').textContent = isBroker ? '券商实盘' : (account.commission ?? '0.0001');
                }
                if ($('runInitialCapital')) $('runInitialCapital').value = account.initial_capital ?? 100000;
                if ($('runCommission')) $('runCommission').value = account.commission ?? 0.0001;
                GoStrategyApp.symbol.onAccountSelect(account);
                const paperRow = $('runSizingPaper');
                const brokerRow = $('runSizingBroker');
                if (paperRow) paperRow.classList.toggle('d-none', isBroker);
                if (brokerRow) brokerRow.classList.toggle('d-none', !isBroker);
            }
        },

        /** 刷新后恢复运行中账户状态（设置 currentRun、同步表单、加载 K 线） */
        async restoreRunningState() {
            let list = GoStrategyApp.state.allSimulations;
            if (!list?.length) {
                const { ok, data } = await apiRequest('/api/simulations');
                list = ok ? data.simulations : [];
            }
            const running = list?.find(s => s.status === 'running');
            if (!running) return;
            const { ok: ok2, data: simData } = await apiRequest(`/api/simulations/${running.id}`);
            if (!ok2 || !simData.simulation) return;
            const sim = simData.simulation;
            GoStrategyApp.state.currentRun = { ...sim, id: running.id };
            GoStrategyApp.utils.loadBrokerBaseline(GoStrategyApp.state.currentRun);
            const select = $('runAccountSelect');
            if (select) { select.value = running.id; this.handleAccountSelectChange(); }
            if (sim.strategy_id && $('runStrategySelect')) $('runStrategySelect').value = sim.strategy_id;
            if (sim.symbol && $('runSymbol')) {
                $('runSymbol').value = sim.symbol;
                await GoStrategyApp.symbol.syncName();
            }
            if ($('runSignalInterval')) $('runSignalInterval').value = sim.signal_interval || '1m';
            const isBrokerSim = GoStrategyApp.isBrokerAccount(sim);
            if (isBrokerSim && sim.order_quantity != null && $('runOrderQuantity')) {
                $('runOrderQuantity').value = String(Math.trunc(sim.order_quantity));
            } else if (!isBrokerSim && sim.order_amount != null && $('runSingleAmount')) {
                $('runSingleAmount').value = Number(sim.order_amount).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
            }
            await GoStrategyApp.charts.loadChartData(running.id);
            GoStrategyApp.display.updateDisplay();
        }
    },

    /** 图表：净值图初始化·更新；日K 初始化·生成·绘制；K线/净值切换。 */
    charts: {
        /** 初始化策略净值图（Chart.js 折线图，双数据集：净值 + 基准）。 */
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

        /** 将当前总资产追加到净值曲线并刷新图表，超过最大点数时剔除最早点。 */
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

        /** 历史K线，启动策略后拉一次；若引擎尚未就绪则短暂重试，拿到数据后不再请求。 */
        async loadChartData(accountId) {
            const maxRetries = 5;
            const retryDelay = 2000;
            for (let i = 0; i < maxRetries; i++) {
                const { ok, data } = await apiRequest(`/api/gostrategy/${accountId}/chart`);
                if (ok && data?.candles?.length) {
                    const d = GoStrategyApp.state.monitorDailyData;
                    d.dates = data.candles.map(c => (c.date && String(c.date)) || c.date || '');
                    d.candles = data.candles;
                    d.signals = data.signals || [];
                    GoStrategyApp.charts.drawCandlestickChart();
                    GoStrategyApp.monitor.updateYesterdayDisplay();
                    return; /* 已获取到数据，结束 */
                }
                if (i < maxRetries - 1) await new Promise(r => setTimeout(r, retryDelay));
            }
            /* 重试结束仍无数据，不覆盖已有数据 */
        },

        /** 获取日 K 画布与上下文，并注册 resize 时重绘。 */
        initMonitorDailyChart() {
            const canvas = $('monitorDailyChart');
            if (!canvas) return;
            GoStrategyApp.state.monitorDailyChartCanvas = canvas;
            GoStrategyApp.state.monitorDailyChartCtx = canvas.getContext('2d');
            window.addEventListener('resize', () => {
                if (GoStrategyApp._monitorChartType() === 'daily' && GoStrategyApp.state.monitorDailyData.candles.length > 0)
                    GoStrategyApp.charts.drawCandlestickChart();
            });
        },

        /** 根据当前 K 线数据与 MA/BOLL 指标在 canvas 上绘制 K 线、均线/布林线及信号标记。 */
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
            if (GoStrategyApp._monitorIndicator() === 'ma') {
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
            } else if (GoStrategyApp._monitorIndicator() === 'boll') {
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

            if (GoStrategyApp._monitorIndicator() === 'ma') {
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
            } else if (GoStrategyApp._monitorIndicator() === 'boll' && boll) {
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
                    let tradeDateTime = trade.date || trade.timestamp || '';
                    if (tradeDateTime && String(tradeDateTime).includes('T')) {
                        const [d, t] = String(tradeDateTime).split('T');
                        tradeDateTime = d + ' ' + (t || '').slice(0, 5);
                    }
                    const tradeDate = (trade.date || trade.timestamp?.split?.('T')[0]) || '';
                    let idx = monitorDailyData.dates.indexOf(tradeDateTime);
                    if (idx === -1) idx = monitorDailyData.dates.indexOf(tradeDate);
                    if (idx === -1) idx = monitorDailyData.dates.findIndex(d => d && String(d).startsWith(tradeDate));
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

        /** 为日 K 画布绑定 mousemove/mouseleave，显示 OHLC 悬浮提示框。 */
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

        /** 在「历史K线」与「策略净值」视图间切换，并更新对应按钮 active 状态。 */
        switchMonitorChart(type, buttonElement) {
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

        /** 切换 K 线副图指标（MA / BOLL），更新按钮状态并重绘日 K。 */
        switchMonitorIndicator(indicator, buttonElement) {
            const indicatorBtns = $('monitorIndicatorButtons');
            if (indicatorBtns) {
                indicatorBtns.querySelectorAll('.chart-type-btn').forEach(btn => btn.classList.remove('active'));
                if (buttonElement) buttonElement.classList.add('active');
            }
            if (GoStrategyApp._monitorChartType() === 'daily' && GoStrategyApp.state.monitorDailyData.candles.length > 0)
                this.drawCandlestickChart();
        }
    },

    /** 监控：盘口更新、昨日行情。 */
    monitor: {
        /**
         * 更新策略运行页右侧五档盘口。
         * 注意：/api/data/live 当前只返回 price、volume 等，不返回 bids/asks。
         * 若接口未提供真实盘口，则用当前价 + 固定价差 + 合成量显示五档，与交易页 trader.js 逻辑一致。
         * 后续若后端增加 bids/asks 字段，此处会优先使用真实数据，请勿删除 fallback 合成逻辑以免无数据时全显示 --。
         */
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

            const currentPrice = quote.price != null ? Number(quote.price) : 0;
            const baseVol = quote.volume ?? 5000;
            const spread = 0.01;
            const synthVol = () => Math.floor((baseVol && baseVol > 0 ? baseVol * 0.001 : 5000) * (0.8 + Math.random() * 0.4));

            const hasBids = Array.isArray(quote.bids) && quote.bids.length > 0;
            const hasAsks = Array.isArray(quote.asks) && quote.asks.length > 0;

            for (let i = 1; i <= 5; i++) {
                const bid = hasBids ? quote.bids[i - 1] : null;
                const ask = hasAsks ? quote.asks[i - 1] : null;
                const bidPrice = bid?.[0] ?? (currentPrice > 0 ? currentPrice - spread * i : null);
                const bidVol = bid?.[1] ?? (currentPrice > 0 ? synthVol() : null);
                const askPrice = ask?.[0] ?? (currentPrice > 0 ? currentPrice + spread * i : null);
                const askVol = ask?.[1] ?? (currentPrice > 0 ? synthVol() : null);
                setRow('monitorQuoteBid', i, bidPrice, bidVol);
                setRow('monitorQuoteAsk', i, askPrice, askVol);
            }
        },

        /** 更新「较上根/昨日」价格与涨跌幅显示（依赖当前行情与最后一根 K 线收盘价）。 */
        updateYesterdayDisplay() {
            const priceEl = $('monitorPrevClose');
            const returnEl = $('monitorPrevReturn');
            const labelEl = $('monitorPrevLabel');
            if (!priceEl || !returnEl) return;
            const interval = ($('runSignalInterval')?.value || '1m').toLowerCase();
            if (labelEl) labelEl.textContent = interval === '1d' ? '昨日' : '较上根';
            const run = GoStrategyApp.state.currentRun;
            const symbol = run?.symbol || $('runSymbol')?.value?.trim() || '';
            const quote = symbol ? GoStrategyApp.state.monitorMarketData[symbol] : null;
            const hasValidQuote = quote && quote.status !== 'loading' && quote?.price != null && Number(quote.price) > 0;
            if (!run || !hasValidQuote) {
                priceEl.textContent = '--';
                returnEl.textContent = '--';
                returnEl.style.color = '#6c757d';
                return;
            }
            const currentPrice = Number(quote.price);
            const candles = GoStrategyApp.state.monitorDailyData.candles;
            priceEl.textContent = currentPrice.toFixed(2);
            if (candles?.length >= 1) {
                const lastClose = candles[candles.length - 1].close;
                if (lastClose && lastClose > 0) {
                    const ret = (currentPrice - lastClose) / lastClose * 100;
                    returnEl.textContent = (ret >= 0 ? '+' : '') + ret.toFixed(2) + '%';
                    returnEl.style.color = ret >= 0 ? '#dc3545' : '#28a745';
                } else {
                    returnEl.textContent = '--';
                    returnEl.style.color = '#6c757d';
                }
            } else {
                returnEl.textContent = '--';
                returnEl.style.color = '#6c757d';
            }
        }
    },

    /** 运行：启动、停止、刷新状态。 */
    run: {
        /** 校验表单后请求后端启动策略，拉 K 线、刷新账户与展示。 */
        async start() {
            const strategyId = $('runStrategySelect')?.value;
            const accountId = $('runAccountSelect')?.value;
            const symbol = ($('runSymbol')?.value || '').trim().toUpperCase();
            const signalInterval = ($('runSignalInterval')?.value || '1m').toLowerCase();
            if (!accountId) { showAlert('请选择或创建一个交易账户', 'warning'); return; }
            if (!strategyId) { showAlert('请选择策略', 'warning'); return; }
            if (!symbol) { showAlert('请填写投资标的', 'warning'); return; }
            const account = GoStrategyApp.state.allSimulations.find(s => s.id === accountId);
            if (account?.status === 'running' && !confirm(`该账户 (${accountId}) 正在运行另一个策略，启动新策略将覆盖旧记录，确定继续吗？`)) return;
            if (GoStrategyApp.isBrokerAccount(account)) {
                if (!confirm('券商实盘账户将断开交易页 QMT 连接并由策略自动真实下单，确定继续？')) return;
            }
            if (GoStrategyApp.isBrokerAccount(account)) {
                GoStrategyApp.utils.clearBrokerBaseline(accountId);
            }

            const body = { strategy_id: strategyId, symbol, signal_interval: signalInterval, lookback_bars: 50 };
            if (GoStrategyApp.isBrokerAccount(account)) {
                const qtyRaw = ($('runOrderQuantity')?.value || '').replace(/,/g, '').trim();
                const orderQuantity = qtyRaw ? parseInt(qtyRaw, 10) : null;
                if (orderQuantity != null && !isNaN(orderQuantity) && orderQuantity > 0) body.order_quantity = orderQuantity;
            } else {
                const singleAmountRaw = ($('runSingleAmount')?.value || '').replace(/,/g, '').trim();
                const orderAmount = singleAmountRaw ? parseFloat(singleAmountRaw) : null;
                if (orderAmount != null && !isNaN(orderAmount) && orderAmount > 0) body.order_amount = orderAmount;
            }
            addLog('正在向后端请求启动策略...', 'info');
            try {
                const { ok, data: result } = await apiRequest(`/api/gostrategy/${accountId}/strategy`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                if (ok) {
                    GoStrategyApp.state.peakEquity = 0;
                    GoStrategyApp.state.equityData = { times: [], values: [], benchmark: [] };
                    if (GoStrategyApp.state.equityChart) {
                        GoStrategyApp.state.equityChart.data.labels = [];
                        GoStrategyApp.state.equityChart.data.datasets[0].data = [];
                        GoStrategyApp.state.equityChart.data.datasets[1].data = [];
                        GoStrategyApp.state.equityChart.update();
                    }
                    GoStrategyApp.state.currentRun = {
                        ...account,
                        id: accountId,
                        strategy_id: strategyId,
                        symbol,
                        status: 'running',
                        account_type: account?.account_type || 'local_paper',
                        positions: {},
                        trades: [],
                        _brokerBaseline: undefined
                    };
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

        /** 请求后端停止当前运行策略，并刷新账户与展示。 */
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

        /** 拉取当前运行的最新状态，合并 trades/orders 等，追加新成交日志并刷新展示与行情。 */
        async refresh() {
            const run = GoStrategyApp.state.currentRun;
            if (!run) return;
            const { ok, data } = await apiRequest(`/api/simulations/${run.id}`);
            if (ok && data.simulation) {
                const sim = data.simulation;
                const oldCount = run.trades?.length ?? 0;
                const savedBaseline = run._brokerBaseline;
                Object.assign(run, sim);
                if (GoStrategyApp.isBrokerAccount(run) && savedBaseline != null) {
                    run._brokerBaseline = savedBaseline;
                }
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
                    const liveSource = GoStrategyApp.isBrokerAccount(run) ? 'miniqmt' : 'yfinance';
                    const { ok: qOk, data: quote } = await apiRequest(
                        `/api/data/live/${encodeURIComponent(symbol)}?source=${liveSource}`
                    );
                    if (qOk && quote && quote.status !== 'loading')
                        GoStrategyApp.state.monitorMarketData[symbol] = quote;
                }
                if (GoStrategyApp.isBrokerAccount(run) && run.status === 'running') {
                    const { ok: snapOk, data: snap } = await apiRequest('/api/broker/snapshot');
                    if (snapOk && snap && !snap.error) {
                        const cash = snap.asset?.cash ?? run.current_capital;
                        run.current_capital = cash;
                        run.frozen_capital = snap.asset?.frozen_cash ?? 0;
                        if (snap.orders) run.orders = snap.orders;
                        if (snap.trades) {
                            run.trades = snap.trades.map(t => ({
                                symbol: t.symbol,
                                action: t.action,
                                quantity: t.quantity,
                                price: t.price,
                                timestamp: t.timestamp,
                                order_id: t.order_id,
                                strategy_id: t.strategy_id
                            }));
                        }
                        const posMap = {};
                        (snap.positions || []).forEach(p => {
                            const row = GoStrategyApp.utils.mapBrokerPositionRow(p);
                            if (row) posMap[String(p.symbol || '').toUpperCase()] = row;
                        });
                        if (Object.keys(posMap).length) run.positions = posMap;
                        GoStrategyApp.utils.ensureBrokerBaseline(run, snap.asset?.total_asset);
                        GoStrategyApp.display.updateDisplay();
                    }
                }
                if (run.status === 'running' && !GoStrategyApp.state.monitorDailyData.candles?.length) {
                    await GoStrategyApp.charts.loadChartData(run.id);
                    GoStrategyApp.display.updateDisplay();
                }
            }
        }
    },

    /** 展示：监控指标、总览、委托/成交/持仓表格、视图切换。 */
    display: {
        /** 根据 currentRun 与 K 线数据更新监控区：指标、净值、盘口、信号按钮、日 K 重绘。 */
        updateMonitor() {
            const run = GoStrategyApp.state.currentRun;
            const hasCandles = (GoStrategyApp.state.monitorDailyData.candles?.length || 0) > 0;
            if (!run) {
                GoStrategyApp.state.liveSignalHistory = [];
                GoStrategyApp.state.lastLiveSignalRunId = null;
                if ($('monitorPrevClose')) $('monitorPrevClose').textContent = '--';
                if ($('monitorPrevReturn')) { $('monitorPrevReturn').textContent = '--'; $('monitorPrevReturn').style.color = '#6c757d'; }
                const sigBtn = $('monitorSignalBtn');
                if (sigBtn) {
                    sigBtn.className = 'monitor-signal-btn';
                    const icon = sigBtn.querySelector('.monitor-signal-icon');
                    const text = sigBtn.querySelector('.monitor-signal-text');
                    if (icon) { icon.className = 'fas monitor-signal-icon'; }
                    if (text) text.textContent = '等待策略信号';
                }
                if (!hasCandles) {
                    const { monitorDailyChartCanvas: canvas, monitorDailyChartCtx: ctx } = GoStrategyApp.state;
                    if (canvas && ctx) {
                        const w = canvas.offsetWidth, h = canvas.offsetHeight;
                        canvas.width = w; canvas.height = h;
                        ctx.clearRect(0, 0, w, h);
                    }
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
                const chartPlaceholder = $('monitorChartPlaceholder');
                if (chartPlaceholder) {
                    if (hasCandles) {
                        chartPlaceholder.classList.add('hide');
                        GoStrategyApp.charts.drawCandlestickChart();
                    } else chartPlaceholder.classList.remove('hide');
                }
                return;
            }
            const chartPlaceholder = $('monitorChartPlaceholder');
            if (chartPlaceholder) {
                if (hasCandles) chartPlaceholder.classList.add('hide');
                else chartPlaceholder.classList.remove('hide');
            }

            // 核心修改：使用前端计算出的全量指标，而非仅依赖后端的 run.metrics
            const m = GoStrategyApp.utils.calculateAccountMetrics(run);
            
            const pct = (x) => {
                if (x == null || x === '') return '0.00%';
                const n = Number(x);
                if (!isFinite(n)) return '0.00%';
                return (Math.abs(n) <= 2 ? n * 100 : n).toFixed(2) + '%';
            };
            const num = (x) => (x == null || x === '') ? '0' : String(Number(x).toFixed(0));
            const cur = (x) => {
                if (x == null || x === '') return '¥0.00';
                const n = Number(x);
                if (!isFinite(n)) return '¥0.00';
                return '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: 2 });
            };

            const cumEl = $('metricCumulativeReturn');
            if (cumEl) {
                cumEl.textContent = pct(m.total_return);
                cumEl.style.color = m.total_pnl >= 0 ? '#dc3545' : '#28a745';
            }

            if ($('metricMaxDrawdown')) $('metricMaxDrawdown').textContent = pct(m.max_drawdown);
            if ($('metricSharpeRatio')) $('metricSharpeRatio').textContent = Number(m.sharpe_ratio).toFixed(2);
            if ($('metricWinRate')) $('metricWinRate').textContent = (m.win_rate * 100).toFixed(1) + '%';
            if ($('metricTotalDays')) $('metricTotalDays').textContent = num(m.total_days);
            if ($('metricTotalTrades')) $('metricTotalTrades').textContent = num(m.total_trades);

            const profitEl = $('metricTotalProfit');
            if (profitEl) {
                profitEl.textContent = cur(m.total_pnl);
                profitEl.style.color = m.total_pnl >= 0 ? '#dc3545' : '#28a745';
            }

            if ($('metricTotalCommission')) $('metricTotalCommission').textContent = cur(m.total_commission);
            if ($('metricTotalTurnover')) $('metricTotalTurnover').textContent = cur(m.total_turnover);
            if ($('metricAvgProfit')) $('metricAvgProfit').textContent = cur(m.avg_profit);
            if ($('metricAvgLoss')) $('metricAvgLoss').textContent = cur(m.avg_loss);

            const dailyEl = $('metricDailyAvgPnL');
            if (dailyEl) {
                dailyEl.textContent = cur(m.daily_avg_pnl);
                dailyEl.style.color = m.daily_avg_pnl >= 0 ? '#dc3545' : '#28a745';
            }

            const totals = GoStrategyApp.utils.computeAccountTotals(run);
            const { totalAssets, available, positionValue, totalPnL, totalReturnNum, hasPnl } = totals;

            if ($('totalAssets')) $('totalAssets').textContent = cur(totalAssets);
            if ($('availableCapital')) $('availableCapital').textContent = cur(available);
            if ($('positionValue')) $('positionValue').textContent = cur(positionValue);
            if ($('totalPnL')) {
                if (hasPnl) {
                    $('totalPnL').textContent = (totalPnL >= 0 ? '+' : '') + cur(totalPnL);
                    $('totalPnL').style.color = totalPnL >= 0 ? '#dc3545' : '#28a745';
                } else {
                    $('totalPnL').textContent = '--';
                    $('totalPnL').style.color = '#6c757d';
                }
            }
            if ($('totalReturn')) {
                if (hasPnl) {
                    $('totalReturn').textContent = (totalReturnNum >= 0 ? '+' : '') + totalReturnNum.toFixed(2) + '%';
                    $('totalReturn').style.color = totalReturnNum >= 0 ? '#dc3545' : '#28a745';
                } else {
                    $('totalReturn').textContent = '--';
                    $('totalReturn').style.color = '#6c757d';
                }
            }

            const eq = GoStrategyApp.state.equityData.values;
            const lastVal = eq.length ? eq[eq.length - 1] : 0;
            if (hasPnl && (Math.abs(totalAssets - lastVal) > 0.01 || eq.length === 0)) {
                GoStrategyApp.charts.updateEquityChart(totalAssets);
            }
            
            // 实时信号按钮状态更新
            const signalLabel = run.last_signal_label || (run.trades?.length ? null : '等待策略信号...');
            const lastTrade = run.trades?.length ? run.trades[run.trades.length - 1] : null;
            const sigBtn = $('monitorSignalBtn');
            if (sigBtn) {
                const iconEl = sigBtn.querySelector('.monitor-signal-icon');
                const textEl = sigBtn.querySelector('.monitor-signal-text');
                let btnType = '';
                let displayText = '等待策略信号';
                let iconClass = 'fa-pause';
                if (lastTrade) {
                    const isBuy = lastTrade.action === 'buy';
                    btnType = isBuy ? 'buy' : 'sell';
                    iconClass = isBuy ? 'fa-arrow-up' : 'fa-arrow-down';
                    displayText = (isBuy ? '买入' : '卖出') + ' ' + (lastTrade.symbol || '') + ' ' + (lastTrade.quantity || 0) + '股 @ ¥' + (lastTrade.price || 0).toFixed(2);
                } else {
                    displayText = signalLabel === '观望' ? '观望' : (signalLabel && signalLabel !== '等待策略信号...' ? signalLabel : '等待策略信号');
                    btnType = signalLabel === '买入' ? 'buy' : (signalLabel === '卖出' ? 'sell' : '');
                    iconClass = signalLabel === '买入' ? 'fa-arrow-up' : (signalLabel === '卖出' ? 'fa-arrow-down' : 'fa-pause');
                }
                sigBtn.className = 'monitor-signal-btn ' + (btnType || '');
                if (iconEl) iconEl.className = 'fas ' + iconClass + ' monitor-signal-icon';
                if (textEl) textEl.textContent = displayText;
            }

            GoStrategyApp.monitor.updateYesterdayDisplay();
            GoStrategyApp.monitor.updateQuoteBoard();
            GoStrategyApp.charts.drawCandlestickChart();
            const updateTimeEl = $('monitorUpdateTime');
            if (updateTimeEl) updateTimeEl.textContent = new Date().toLocaleTimeString();
        },

        /** 根据 currentRun 更新顶部总览、指标区、启停按钮及委托/成交/持仓/信号表格；无运行则重置为默认值。 */
        updateDisplay() {
            const run = GoStrategyApp.state.currentRun;
            if (!run) {
                if ($('runStatusBadge')) { $('runStatusBadge').textContent = '未运行'; $('runStatusBadge').className = 'status-badge waiting'; }
                ['totalAssets', 'availableCapital', 'positionValue', 'totalPnL', 'totalReturn'].forEach(id => { const el = $(id); if (el) el.textContent = id === 'totalReturn' ? '0.00%' : '¥0.00'; });
                ['metricCumulativeReturn', 'metricMaxDrawdown', 'metricSharpeRatio', 'metricWinRate', 'metricTotalDays', 'metricTotalTrades', 'metricTotalProfit', 'metricTotalTurnover', 'metricTotalCommission', 'metricAvgProfit', 'metricAvgLoss', 'metricDailyAvgPnL'].forEach(id => {
                    const el = $(id);
                    if (el) { el.textContent = id.startsWith('metricTotal') && (id.includes('Days') || id.includes('Trades')) ? '0' : (id === 'metricSharpeRatio' || id === 'metricWinRate' ? '--' : '¥0.00'); if (id === 'metricTotalProfit' || id === 'metricDailyAvgPnL') el.style.color = '#333'; }
                });
                if ($('accountId')) $('accountId').textContent = '--';
                if ($('commissionDisplay')) $('commissionDisplay').textContent = '--';
                const startBtn = $('startStrategyBtn');
                const stopBtn = $('stopStrategyBtn');
                if (startBtn) startBtn.disabled = false;
                if (stopBtn) stopBtn.disabled = true;
                this.updateOrdersDisplay();
                this.updateTradesDisplay();
                this.updatePositionsDisplay();
                this.updateSignalsDisplay();
                return;
            }
            const status = run.status || 'stopped';
            const badge = $('runStatusBadge');
            if (badge) { badge.textContent = status === 'running' ? '运行中' : '已停止'; badge.className = 'status-badge ' + (status === 'running' ? 'running' : 'stopped'); }
            const totals = GoStrategyApp.utils.computeAccountTotals(run);
            const { totalAssets, available, positionValue, totalPnL, totalReturnNum, hasPnl } = totals;
            const totalReturn = totalReturnNum.toFixed(2);

            if ($('totalAssets')) $('totalAssets').textContent = '¥' + totalAssets.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            if ($('availableCapital')) $('availableCapital').textContent = '¥' + available.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            if ($('positionValue')) $('positionValue').textContent = '¥' + positionValue.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const pnlEl = $('totalPnL');
            if (pnlEl) {
                if (hasPnl) {
                    pnlEl.textContent = (totalPnL >= 0 ? '+' : '') + '¥' + totalPnL.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    pnlEl.style.color = totalPnL > 0 ? '#dc3545' : (totalPnL < 0 ? '#28a745' : '#343a40');
                } else {
                    pnlEl.textContent = '--';
                    pnlEl.style.color = '#6c757d';
                }
            }
            const returnEl = $('totalReturn');
            if (returnEl) {
                if (hasPnl) {
                    returnEl.textContent = (totalReturnNum >= 0 ? '+' : '') + totalReturn + '%';
                    returnEl.style.color = totalReturnNum > 0 ? '#dc3545' : (totalReturnNum < 0 ? '#28a745' : '#343a40');
                } else {
                    returnEl.textContent = '--';
                    returnEl.style.color = '#6c757d';
                }
            }
            if ($('accountId')) {
                const accLabel = (run.name || run.id || '--') + (run.id ? ` (${run.id})` : '');
                $('accountId').textContent = accLabel;
            }
            if ($('commissionDisplay')) {
                $('commissionDisplay').textContent = isBroker
                    ? '券商实盘（QMT）'
                    : ((run.commission || 0.001) * 100).toFixed(2) + '%';
            }
            const startBtn = $('startStrategyBtn');
            const stopBtn = $('stopStrategyBtn');
            if (startBtn) startBtn.disabled = status === 'running';
            if (stopBtn) stopBtn.disabled = status !== 'running';
            this.updateOrdersDisplay();
            this.updateTradesDisplay();
            this.updatePositionsDisplay();
            this.updateSignalsDisplay();
            this.updateMonitor();
        },

        /** 将历史信号与实时信号合并后渲染到信号表格。 */
        updateSignalsDisplay() {
            const tbody = $('signalsTableBody');
            if (!tbody) return;
            const { dates, candles, signals } = GoStrategyApp.state.monitorDailyData;
            const run = GoStrategyApp.state.currentRun;
            const hasHist = signals?.length && dates?.length && candles?.length;
            const liveLabel = run?.last_signal_label;
            const liveSig = run?.last_signal;
            if (!hasHist && !liveLabel && !GoStrategyApp.state.liveSignalHistory?.length) {
                tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted empty-state-cell"><div class="empty-state-placeholder"><i class="fas fa-chart-line fa-2x"></i><div>暂无信号</div></div></td></tr>';
                return;
            }
            const formatDateTimeForCol = (d) => {
                if (!d) return '--';
                const str = String(d);
                if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(str)) return str;
                if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str + ' 00:00';
                return str;
            };
            const rows = [];
            if (liveLabel && run?.status === 'running') {
                if (GoStrategyApp.state.lastLiveSignalRunId !== run.id) {
                    GoStrategyApp.state.liveSignalHistory = [];
                    GoStrategyApp.state.lastLiveSignalRunId = run.id;
                }
                const lastEntry = GoStrategyApp.state.liveSignalHistory[0];
                const sym = run.symbol || $('runSymbol')?.value || '';
                if (!lastEntry || lastEntry.label !== liveLabel) {
                    const quote = sym ? GoStrategyApp.state.monitorMarketData[sym] : null;
                    const livePrice = quote?.price ?? (candles?.length ? candles[candles.length - 1]?.close : null);
                    const now = new Date();
                    const liveTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
                    GoStrategyApp.state.liveSignalHistory.unshift({ time: liveTime, label: liveLabel, sig: liveSig, price: livePrice, symbol: sym });
                    if (GoStrategyApp.state.liveSignalHistory.length > 200) GoStrategyApp.state.liveSignalHistory.pop();
                }
                GoStrategyApp.state.liveSignalHistory.forEach(entry => {
                    const icon = entry.sig === 1 ? 'fa-arrow-up' : entry.sig === -1 ? 'fa-arrow-down' : 'fa-pause';
                    const cls = entry.sig === 1 ? 'signal-icon-buy' : entry.sig === -1 ? 'signal-icon-sell' : 'signal-icon-hold';
                    const priceStr = entry.price != null ? '¥' + Number(entry.price).toFixed(2) : '--';
                    const s = entry.symbol ?? sym;
                    const sName = s;
                    rows.push(`<tr class="signal-row-live"><td>实时</td><td>${entry.time}</td><td>${s || '--'}</td><td>${sName || '--'}</td><td><span class="signal-log-badge ${cls}"><i class="fas ${icon} me-1"></i>${entry.label}</span></td><td>${priceStr}</td></tr>`);
                });
            }
            const histSym = run?.symbol || $('runSymbol')?.value || '';
            const histSymName = histSym;
            if (hasHist) {
                for (let i = signals.length - 1; i >= 0; i--) {
                    const sig = signals[i];
                    const label = sig === 1 ? '买入' : sig === -1 ? '卖出' : '观望';
                    const icon = sig === 1 ? 'fa-arrow-up' : sig === -1 ? 'fa-arrow-down' : 'fa-pause';
                    const cls = sig === 1 ? 'signal-icon-buy' : sig === -1 ? 'signal-icon-sell' : 'signal-icon-hold';
                    const date = formatDateTimeForCol(dates[i]);
                    const triggerPrice = candles[i]?.close != null ? candles[i].close.toFixed(2) : '--';
                    rows.push(`<tr><td>历史信号</td><td>${date}</td><td>${histSym || '--'}</td><td>${histSymName || '--'}</td><td><span class="signal-log-badge ${cls}"><i class="fas ${icon} me-1"></i>${label}</span></td><td>¥${triggerPrice}</td></tr>`);
                }
            }
            tbody.innerHTML = rows.length ? rows.join('') : '<tr><td colspan="6" class="text-center text-muted empty-state-cell"><div class="empty-state-placeholder"><i class="fas fa-chart-line fa-2x"></i><div>暂无信号</div></div></td></tr>';
        },

        /** 用 currentRun.orders 渲染委托表格（按当前策略过滤，逆序显示全部）。 */
        updateOrdersDisplay() {
            const tbody = $('ordersTableBody');
            if (!tbody) return;
            const run = GoStrategyApp.state.currentRun;
            let orders = run?.orders || [];
            if (!orders.length) { tbody.innerHTML = renderEmptyState(10, 'fa-list-alt', '暂无委托'); return; }
            const statusMap = { 'pending': '已报', 'executed': '全部成交', 'cancelled': '已撤单' };
            const statusClass = { 'pending': 'text-primary', 'executed': 'text-success', 'cancelled': 'text-muted' };
            const reversed = orders.slice().reverse();
            tbody.innerHTML = reversed.map(o => {
                const isBuy = o.action === 'buy';
                const cls = isBuy ? 'buy' : 'sell';
                const filledQty = o.status === 'executed' ? (o.quantity || 0) : 0;
                const statusText = statusMap[o.status] || o.status || '--';
                const statusCls = statusClass[o.status] || '';
                const oid = (o.id || '').replace(/^order_/, '');
                const rawTime = o.time;
                let timeStr = '--';
                if (rawTime) {
                    const d = new Date(rawTime);
                    timeStr = isNaN(d.getTime())
                        ? String(rawTime)
                        : d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', { hour12: false });
                }
                return `<tr><td>${oid}</td><td>${o.symbol || '--'}</td><td>${o.symbol || '--'}</td><td><span class="direction-badge ${cls}">${isBuy ? '买入' : '卖出'}</span></td><td>¥${(o.price || 0).toFixed(2)}</td><td>${o.quantity || 0}</td><td>${filledQty}</td><td><span class="order-status ${statusCls}">${statusText}</span></td><td>${o.strategy_id || '--'}</td><td>${timeStr}</td></tr>`;
            }).join('');
        },

        /** 用 currentRun.trades 渲染成交表格（按当前策略过滤，逆序显示全部）。 */
        updateTradesDisplay() {
            const tbody = $('tradesTableBody');
            if (!tbody) return;
            const run = GoStrategyApp.state.currentRun;
            let trades = run?.trades || [];
            if (!trades.length) { tbody.innerHTML = renderEmptyState(10, 'fa-check-circle', '暂无成交'); return; }
            const list = trades.slice().reverse();
            tbody.innerHTML = list.map((t, i) => {
                const dir = t.action === 'buy' ? '买入' : '卖出';
                const cls = t.action === 'buy' ? 'buy' : 'sell';
                const amount = (t.price || 0) * (t.quantity || 0);
                const rawTs = t.date || t.timestamp;
                const timeStr = rawTs ? formatEngineTimeToLocal(rawTs) : '--';
                return `<tr><td>${10000001 + list.length - i - 1}</td><td>${(t.order_id || `order_${10000001 + list.length - i - 1}`).replace('order_', '')}</td><td>${t.symbol || '--'}</td><td>${t.symbol || '--'}</td><td><span class="direction-badge ${cls}">${dir}</span></td><td>¥${(t.price || 0).toFixed(2)}</td><td>${t.quantity || 0}</td><td>¥${amount.toFixed(2)}</td><td>${t.strategy_id || '--'}</td><td>${timeStr}</td></tr>`;
            }).join('');
        },

        /** 用 currentRun.positions 渲染持仓表格（含成本价、现价、盈亏、市值）。 */
        updatePositionsDisplay() {
            const tbody = $('positionTableBody');
            if (!tbody) return;
            const run = GoStrategyApp.state.currentRun;
            if (!run?.positions || Object.keys(run.positions).length === 0) { tbody.innerHTML = renderEmptyState(9, 'fa-inbox', '暂无持仓'); return; }
            const isBroker = GoStrategyApp.isBrokerAccount(run);
            const list = [];
            Object.entries(run.positions).forEach(([symbol, pos]) => {
                const qty = Math.abs(pos.quantity || 0);
                if (qty <= 0) return;
                const avgPrice = pos.avg_price || 0;
                const displayName = GoStrategyApp.symbol.resolveName(symbol) || symbol;
                let currentPrice = 0;
                let profit = 0;
                let rateNum = 0;
                let marketValue = 0;
                let hasPrice = false;
                if (isBroker) {
                    currentPrice = parseFloat(pos.last_price || 0);
                    marketValue = parseFloat(pos.market_value || 0);
                    if (pos.position_profit != null && pos.position_profit !== '') {
                        profit = parseFloat(pos.position_profit);
                    }
                    if (pos.profit_rate != null && pos.profit_rate !== '') {
                        rateNum = GoStrategyApp.utils.brokerProfitRatePercent(pos.profit_rate);
                    }
                    if (currentPrice <= 0) {
                        const fallback = GoStrategyApp.utils.getCurrentPriceForSymbol(run, symbol);
                        if (fallback != null && fallback > 0) currentPrice = fallback;
                    }
                    if (marketValue <= 0 && currentPrice > 0) marketValue = qty * currentPrice;
                    if ((pos.position_profit == null || pos.position_profit === '') && currentPrice > 0 && avgPrice > 0) {
                        profit = (currentPrice - avgPrice) * qty;
                    }
                    if ((pos.profit_rate == null || pos.profit_rate === '') && avgPrice > 0 && currentPrice > 0) {
                        rateNum = (currentPrice - avgPrice) / avgPrice * 100;
                    }
                    hasPrice = currentPrice > 0;
                } else {
                    const px = GoStrategyApp.utils.getCurrentPriceForSymbol(run, symbol);
                    hasPrice = px != null && px > 0;
                    currentPrice = hasPrice ? px : 0;
                    profit = hasPrice ? (currentPrice - avgPrice) * qty : 0;
                    rateNum = hasPrice && avgPrice > 0 ? (currentPrice - avgPrice) / avgPrice * 100 : 0;
                    marketValue = hasPrice ? qty * currentPrice : 0;
                }
                list.push({
                    symbol,
                    name: displayName,
                    position: qty,
                    avgPrice,
                    currentPrice,
                    profit,
                    profitRate: rateNum.toFixed(2),
                    marketValue,
                    hasPrice
                });
            });
            tbody.innerHTML = list.map(p => {
                const priceStr = p.hasPrice ? '¥' + p.currentPrice.toFixed(2) : '--';
                const profitStr = p.hasPrice ? (p.profit >= 0 ? '+' : '') + '¥' + p.profit.toFixed(2) : '--';
                const rateStr = p.hasPrice ? (parseFloat(p.profitRate) >= 0 ? '+' : '') + p.profitRate + '%' : '--';
                const valueStr = p.hasPrice && p.marketValue > 0 ? '¥' + p.marketValue.toFixed(2) : (p.hasPrice ? '¥' + (p.position * p.currentPrice).toFixed(2) : '--');
                const rateN = parseFloat(p.profitRate);
                const cls = p.hasPrice ? (rateN >= 0 ? 'positive' : 'negative') : '';
                return `<tr><td>${p.symbol}</td><td>${p.name}</td><td>${p.position}</td><td>¥${p.avgPrice.toFixed(2)}</td><td>${priceStr}</td><td class="position-profit ${cls}">${profitStr}</td><td class="position-profit ${cls}">${rateStr}</td><td>${valueStr}</td><td>--</td></tr>`;
            }).join('');
        },

        /** 切换底部数据视图（委托/成交/持仓/信号/日志），仅显示对应 .data-view-* 容器。 */
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
        /** 绑定标的输入与标的名称同步；paper 单次投入千分位；broker 单次股数为整数。 */
        initListeners() {
            const singleAmountEl = $('runSingleAmount');
            if (singleAmountEl) {
                const formatWithSeparator = (v) => {
                    const num = parseFloat(String(v).replace(/,/g, '')) || 0;
                    return num.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
                };
                singleAmountEl.addEventListener('blur', () => {
                    const raw = singleAmountEl.value.replace(/,/g, '');
                    if (raw !== '') singleAmountEl.value = formatWithSeparator(raw);
                });
            }
            const orderQtyEl = $('runOrderQuantity');
            if (orderQtyEl) {
                orderQtyEl.addEventListener('blur', () => {
                    const raw = orderQtyEl.value.replace(/,/g, '').trim();
                    if (raw === '') return;
                    const n = parseInt(raw, 10);
                    if (!isNaN(n) && n > 0) orderQtyEl.value = String(n);
                });
            }
        },

        /** 启动北京/美东/UTC 三地时钟，每秒更新一次。 */
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

        /** 追加一条日志并刷新日志表格显示，超过 LOG_MAX_ENTRIES 时剔除最早。 */
        addLog(message, type = 'info') {
            GoStrategyApp.state.logs.push({ time: new Date().toLocaleTimeString(), message, type });
            if (GoStrategyApp.state.logs.length > GoStrategyApp.CONSTANTS.LOG_MAX_ENTRIES) GoStrategyApp.state.logs.shift();
            this.updateLogDisplay();
        },

        /** 将 state.logs 逆序渲染到日志表格并滚动到底部。 */
        updateLogDisplay() {
            const tbody = $('logTableBody');
            if (!tbody) return;
            const logs = GoStrategyApp.state.logs;
            if (logs.length === 0) { tbody.innerHTML = '<tr><td colspan="2" class="text-center text-muted empty-state-cell"><div class="empty-state-placeholder"><i class="fas fa-list-alt fa-2x"></i><div>暂无日志</div></div></td></tr>'; return; }
            const colorType = msg => GoStrategyApp.utils.getLogColorType(msg);
            tbody.innerHTML = logs.slice().reverse().map((log, i) => {
                const ct = colorType(log.message);
                const rowClass = `log-row log-row-${i % 2 === 0 ? 'even' : 'odd'} log-type-${ct}`;
                const msgHtml = GoStrategyApp.utils.formatLogMessage(log.message, log.type);
                return `<tr class="${rowClass}"><td class="log-time">${log.time}</td><td class="log-msg">${msgHtml}</td></tr>`;
            }).join('');
            const container = tbody.closest('.table-container');
            if (container) container.scrollTop = container.scrollHeight;
        },

    },

    /** 初始化入口。 */
    async init() {
        GoStrategyApp.charts.initEquityChart();           // 净值图
        GoStrategyApp.charts.initMonitorDailyChart();    // 日K画布+resize
        GoStrategyApp.ui.initListeners();                // 表单事件
        await GoStrategyApp.strategy.loadStrategies();   // 策略列表
        await GoStrategyApp.account.loadSimulations();    // 账户列表
        await GoStrategyApp.symbol.init();
        await GoStrategyApp.account.restoreRunningState(); // 有在跑则恢复
        GoStrategyApp.display.updateDisplay();           // 总览+表格
        GoStrategyApp.display.updateMonitor();           // 刷新监控区：指标、净值、盘口等
        GoStrategyApp.monitor.updateQuoteBoard();        // 盘口：有行情就显示，没有就占位符
        GoStrategyApp.ui.startClocks();                  // 三地时钟
        GoStrategyApp.state.timers.refresh = setInterval(() => {
            if (GoStrategyApp.state.currentRun) GoStrategyApp.run.refresh(); // 定时拉状态+行情
        }, GoStrategyApp.CONSTANTS.REFRESH_RATE_STRATEGY);
        window.addEventListener('beforeunload', () => {
            if (GoStrategyApp.state.timers.refresh) clearInterval(GoStrategyApp.state.timers.refresh);
            if (GoStrategyApp.state.timers.clock) clearInterval(GoStrategyApp.state.timers.clock); // 离页清定时器
        });
    }
};

/* 全局导出供 HTML onclick 使用 */
function addLog(message, type) { GoStrategyApp.ui.addLog(message, type); } // 写日志
function loadStrategies() { GoStrategyApp.strategy.loadStrategies(); } // 拉策略列表
function handleStrategySelectChange() { GoStrategyApp.strategy.handleStrategySelectChange(); } // 策略变更→按钮
function handleAccountSelectChange() { GoStrategyApp.account.handleAccountSelectChange(); } // 账户变更→预览
function startRunStrategy() { GoStrategyApp.run.start(); } // 启动策略
function stopRunStrategy() { GoStrategyApp.run.stop(); } // 停止策略
function switchDataView(view, btn) { GoStrategyApp.display.switchDataView(view, btn); } // 底部Tab
function switchMonitorChart(type, btn) { GoStrategyApp.charts.switchMonitorChart(type, btn); } // 历史K线/净值
function switchMonitorIndicator(indicator, btn) { GoStrategyApp.charts.switchMonitorIndicator(indicator, btn); } // MA/BOLL

/** 失焦时同步标的代码与名称（对齐 trader.loadStockInfo）。 */
function loadRunSymbolInfo() {
    GoStrategyApp.symbol.syncName();
}

/** 从策略列表中选中指定策略并提示。 */
function selectStrategyForRun(strategyId) {
    const select = $('runStrategySelect');
    if (select) { select.value = strategyId; handleStrategySelectChange(); showAlert('已选中策略: ' + strategyId, 'success'); }
}
/** 选中策略并打开源码查看。 */
function viewStrategyByName(strategyId) {
    if ($('runStrategySelect')) $('runStrategySelect').value = strategyId;
    handleStrategySelectChange();
    viewCurrentStrategy();
}
/** 选中策略并触发下载。 */
function downloadStrategyByName(strategyId) {
    if ($('runStrategySelect')) $('runStrategySelect').value = strategyId;
    handleStrategySelectChange();
    downloadCurrentStrategy();
}
/** 选中策略并确认后删除（调用 common 删除逻辑）。 */
function deleteStrategyByName(strategyId) {
    if (!confirm(`确定要删除策略 "${strategyId}" 吗？此操作不可撤销。`)) return;
    if ($('runStrategySelect')) $('runStrategySelect').value = strategyId;
    handleStrategySelectChange();
    deleteCurrentStrategy();
}

document.addEventListener('DOMContentLoaded', () => GoStrategyApp.init());
