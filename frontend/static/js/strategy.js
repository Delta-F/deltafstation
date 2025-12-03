// DeltaFStation 策略分析页面JavaScript
let currentStrategy = null;

function formatDateToMonth(dateStr) {
    if (!dateStr) return '';
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return '';
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        return `${year}-${month}`;
    } catch (e) {
        return '';
    }
}

function generateMonthLabels(dateArray) {
    const monthSet = new Set();
    return dateArray.map(d => {
        if (!d) return '';
        const monthKey = formatDateToMonth(d);
        if (!monthKey || monthSet.has(monthKey)) return '';
        monthSet.add(monthKey);
        return monthKey;
    });
}

function parseValuesDf(valuesDf) {
    const portfolioValues = [];
    const rawDates = [];
    
    if (!valuesDf || !Array.isArray(valuesDf)) return { portfolioValues, dates: [], rawDates: [] };
    
    const valueKeys = ['total_value', 'portfolio_value', 'value', 'equity', 'capital', 'balance'];
    const dateKeys = ['date', 'Date', 'index', 'timestamp', 'time'];
    
    valuesDf.forEach(row => {
        let value = null;
        for (const key of valueKeys) {
            if (row[key] !== undefined && row[key] !== null) {
                value = row[key];
                break;
            }
        }
        
        if (value === null) {
            for (const key of Object.keys(row)) {
                const val = row[key];
                if (typeof val === 'number' && val > 0 && !dateKeys.includes(key)) {
                    value = val;
                    break;
                }
            }
        }
        
        if (value !== null && value !== undefined) {
            portfolioValues.push(parseFloat(value));
            let date = null;
            for (const key of dateKeys) {
                if (row[key]) {
                    date = row[key];
                    break;
                }
            }
            
            if (date) {
                const dateStr = typeof date === 'string' ? date : new Date(date).toISOString().split('T')[0];
                rawDates.push(dateStr);
            } else {
                rawDates.push(null);
            }
        }
    });
    
    // 如果没有日期数据，生成默认日期
    if (rawDates.length === 0 && portfolioValues.length > 0) {
        rawDates.push(...portfolioValues.map((_, i) => `Day ${i + 1}`));
    }
    
    // 生成月份标签用于x轴显示
    const dates = rawDates.length > 0 ? generateMonthLabels(rawDates) : [];
    
    return { portfolioValues, dates, rawDates };
}

async function apiRequest(url, options = {}) {
    try {
        const response = await fetch(url, options);
        const data = await response.json();
        return { ok: response.ok, data, response };
    } catch (error) {
        console.error(`API request failed: ${url}`, error);
        return { ok: false, data: { error: error.message }, response: null };
    }
}

function getChartBaseOptions() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
            tooltip: {
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                padding: 12,
                titleFont: { size: 14, weight: 'bold' },
                bodyFont: { size: 13 }
            }
        },
        scales: {
            y: {
                grid: { 
                    color: 'rgba(0, 0, 0, 0.1)', 
                    drawBorder: true,
                    lineWidth: 1
                }
            },
            x: {
                grid: { 
                    color: 'rgba(0, 0, 0, 0.1)', 
                    drawBorder: true,
                    lineWidth: 1
                }
            }
        }
    };
}

function getStandardXAxisConfig() {
    return {
        title: { display: false },
        ticks: {
            font: { size: 11 },
            maxRotation: 0,
            minRotation: 0,
            callback: function(value) {
                const label = this.getLabelForValue(value);
                if (!label || label.trim() === '') return '';
                // 如果已经是年月格式（YYYY-MM），直接返回
                if (label.match(/^\d{4}-\d{2}$/)) {
                    return label;
                }
                // 尝试解析日期并格式化为年月
                try {
                    const date = new Date(label);
                    if (!isNaN(date.getTime())) {
                        const year = date.getFullYear();
                        const month = String(date.getMonth() + 1).padStart(2, '0');
                        return `${year}-${month}`;
                    }
                } catch (e) {
                    // 如果解析失败，尝试直接截取年月部分
                    if (label.length >= 7 && label.includes('-')) {
                        return label.substring(0, 7);
                    }
                }
                return label;
            },
            maxTicksLimit: undefined,
            autoSkip: false,
            autoSkipPadding: 0
        },
        grid: { 
            color: 'rgba(0, 0, 0, 0.1)', 
            drawBorder: true,
            lineWidth: 1
        }
    };
}

function getStandardYAxisConfig(callback = null, beginAtZero = false) {
    return {
        beginAtZero,
        title: { display: false },
        ticks: {
            font: { size: 12 },
            callback: callback || (v => v.toFixed(2))
        },
        grid: { 
            color: 'rgba(0, 0, 0, 0.1)', 
            drawBorder: true,
            lineWidth: 1
        }
    };
}

document.addEventListener('DOMContentLoaded', async function() {
    // 先设置默认日期，避免阻塞 UI
    const today = new Date();
    const halfYearAgo = new Date(today);
    halfYearAgo.setMonth(halfYearAgo.getMonth() - 6);
    const startInput = document.getElementById('backtestStartDate');
    const endInput = document.getElementById('backtestEndDate');
    if (startInput && endInput) {
        startInput.value = halfYearAgo.toISOString().split('T')[0];
        endInput.value = today.toISOString().split('T')[0];
    }

    // 首先加载策略列表（最关键的交互）
    await loadStrategies();

    // 回测历史和数据文件改为分步、延迟加载，减轻首屏卡顿
    setTimeout(() => {
        loadBacktestHistory();
    }, 300);

    setTimeout(() => {
        loadDataFiles();
    }, 800);
});

async function loadStrategies() {
    const { ok, data } = await apiRequest('/api/strategy/list');
    const select = document.getElementById('backtestStrategySelect');
    if (!select) return;

    if (!ok || !data.strategies || data.strategies.length === 0) {
        select.innerHTML = '<option value="">暂无策略，请先创建策略</option>';
        return;
    }

    select.innerHTML = '<option value="">请选择策略（自动扫描 data/strategies 下的 .py 脚本）</option>' +
        data.strategies.map(s => `<option value="${s.id}">${s.name} (${s.type})</option>`).join('');
    
    if (data.strategies.length > 0) {
        select.value = data.strategies[0].id;
        await selectStrategy(data.strategies[0].id);
    }
}

function handleStrategySelectChange() {
    const select = document.getElementById('backtestStrategySelect');
    if (!select || !select.value) {
        currentStrategy = null;
        return;
    }
    selectStrategy(select.value);
}

async function selectStrategy(strategyId) {
    const { ok, data } = await apiRequest(`/api/strategy/${strategyId}`);
    
    if (ok && data.strategy) {
        currentStrategy = data.strategy;
        const card = document.getElementById('backtestConfigCard');
        if (card) card.style.display = 'block';
    } else {
        showAlert(data.error || '加载策略失败', 'danger');
    }
}

async function loadDataFiles() {
    const { ok, data } = await apiRequest('/api/data/list');
    const list = document.getElementById('dataFilesList');
    if (!list) return;
    
    if (!ok || !data.files || data.files.length === 0) {
        list.innerHTML = '<div class="empty-state"><i class="fas fa-database"></i><p>暂无数据文件</p></div>';
        return;
    }
    
    list.innerHTML = data.files.map(file => {
        const safeFilename = file.filename.replace(/'/g, "\\'");
        return `<div class="data-file-item">
            <div class="d-flex justify-content-between align-items-center">
                <div style="flex: 1; min-width: 0; overflow: hidden;">
                    <div class="text-truncate" style="font-size: 12px; font-weight: 500; margin-bottom: 0.2rem;" title="${file.filename}">${file.filename}</div>
                    <small class="text-muted" style="font-size: 10px;">${formatFileSize(file.size)} | ${formatDateTime(file.modified)}</small>
                </div>
                <button class="btn btn-sm btn-outline-primary ms-2" style="flex-shrink: 0; padding: 0.25rem 0.5rem; font-size: 11px;" onclick="event.stopPropagation(); previewData('${safeFilename}')" title="预览数据">
                    <i class="fas fa-eye"></i>
                </button>
            </div>
        </div>`;
    }).join('');
}

async function loadBacktestHistory() {
    const { ok, data } = await apiRequest('/api/backtest/results');
    const list = document.getElementById('backtestHistoryList');
    if (!list) return;
    
    if (!ok || !data.results || data.results.length === 0) {
        list.innerHTML = '<div class="empty-state"><i class="fas fa-history"></i><p>暂无回测记录</p></div>';
        return;
    }
    
    list.innerHTML = data.results.map(result => {
        const totalReturn = typeof result.total_return === 'number' ? result.total_return : 0;
        const sharpeRatio = typeof result.sharpe_ratio === 'number' ? result.sharpe_ratio : 0;
        return `
            <div class="backtest-item" onclick="viewBacktestResult('${result.id}')">
                <div class="d-flex justify-content-between align-items-center">
                    <div style="flex: 1; min-width: 0;">
                        <h6 class="mb-1">${result.strategy_id || '未知策略'}</h6>
                        <small class="text-muted d-block" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${result.data_file || '未知文件'}</small>
                        <small class="text-muted">${formatDateTime(result.created_at || '')}</small>
                    </div>
                    <div class="text-end ms-2" style="flex-shrink: 0;">
                        <div class="fw-bold ${totalReturn >= 0 ? 'text-danger' : 'text-success'}" style="font-size: 13px;">
                            ${(totalReturn * 100).toFixed(2)}%
                        </div>
                        <small class="text-muted">夏普: ${sharpeRatio.toFixed(2)}</small>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

async function runBacktest() {
    if (!currentStrategy) {
        showAlert('请先选择策略', 'warning');
        return;
    }
    
    const symbol = document.getElementById('backtestSymbol')?.value.trim().toUpperCase() || '';
    const startDate = document.getElementById('backtestStartDate')?.value || '';
    const endDate = document.getElementById('backtestEndDate')?.value || '';
    const initialCapital = parseFloat(document.getElementById('backtestInitialCapital')?.value || 100000);
    const commission = parseFloat(document.getElementById('backtestCommission')?.value || 0.001);
    const slippage = 0.0005;
    
    if (!symbol || !startDate || !endDate) {
        showAlert('请填写必填字段（策略、投资标的、日期区间）', 'warning');
        return;
    }
    
    const fetchResult = await apiRequest('/api/data/fetch_symbol', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, start_date: startDate, end_date: endDate })
    });
    
    if (!fetchResult.ok) {
        showAlert(fetchResult.data.error || '获取数据失败', 'danger');
        return;
    }
    
    const result = await apiRequest('/api/backtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            strategy_id: currentStrategy.id,
            data_file: fetchResult.data.filename,
            start_date: startDate,
            end_date: endDate,
            initial_capital: initialCapital,
            commission,
            slippage
        })
    });
    
    if (!result.ok) {
        showAlert(result.data.error || '回测失败', 'danger');
        const debugOutput = document.getElementById('debugOutput');
        if (debugOutput) debugOutput.textContent = JSON.stringify(result.data, null, 2);
        return;
    }
    
    showAlert('回测运行成功', 'success');
    
    const debugOutput = document.getElementById('debugOutput');
    if (debugOutput) {
        const debugInfo = {
            message: result.data.message,
            result_id: result.data.result_id,
            metrics_keys: result.data.metrics ? Object.keys(result.data.metrics) : [],
            values_df_length: result.data.values_df?.length || 0,
            trades_df_length: result.data.trades_df?.length || 0,
            metrics_summary: result.data.metrics ? {
                total_return: result.data.metrics.total_return,
                sharpe_ratio: result.data.metrics.sharpe_ratio,
                max_drawdown: result.data.metrics.max_drawdown,
                total_trade_count: result.data.metrics.total_trade_count
            } : null
        };
        debugOutput.textContent = JSON.stringify(debugInfo, null, 2);
    }
    
    try {
        const { portfolioValues, dates, rawDates } = parseValuesDf(result.data.values_df);
        const resultsWithParams = {
            metrics: result.data.metrics || {},
            portfolio_values: portfolioValues,
            dates,
            rawDates: rawDates || dates, // 保存原始日期数组
            trades: result.data.trades_df || [],
            initial_capital: initialCapital,
            start_date: startDate,
            end_date: endDate
        };
        showBacktestResult(resultsWithParams);
        loadBacktestHistory();
    } catch (error) {
        console.error('Error displaying results:', error);
        showAlert('数据解析失败，请查看调试信息', 'warning');
    }
}

function showBacktestResult(results) {
    const metrics = results.metrics || {};
    const initialCapital = metrics.start_capital || results.initial_capital || 
        parseFloat(document.getElementById('backtestInitialCapital')?.value || 100000);
    
    const indicators = {
        resultTotalTradingDays: metrics.total_trading_days || 0,
        resultProfitableDays: [metrics.profitable_days || 0, 'text-danger'],
        resultLossDays: [metrics.losing_days || 0, 'text-success'],
        resultInitialCapital: formatCurrency(initialCapital),
        resultEndingCapital: formatCurrency(metrics.end_capital || initialCapital),
        resultCapitalGrowth: (() => {
            const ending = metrics.end_capital || initialCapital;
            const growth = ending - initialCapital;
            const percent = initialCapital > 0 ? (growth / initialCapital * 100) : 0;
            return [`${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%`, growth >= 0 ? 'text-danger' : 'text-success'];
        })(),
        resultTotalReturn: [`${((metrics.total_return || 0) * 100).toFixed(2)}%`, (metrics.total_return || 0) >= 0 ? 'text-danger' : 'text-success'],
        resultAnnualizedReturn: [`${((metrics.annualized_return || 0) * 100).toFixed(2)}%`, (metrics.annualized_return || 0) >= 0 ? 'text-danger' : 'text-success'],
        resultDailyAvgReturn: [`${((metrics.avg_daily_return || 0) * 100).toFixed(2)}%`, (metrics.avg_daily_return || 0) >= 0 ? 'text-danger' : 'text-success'],
        resultMaxDrawdown: `${((metrics.max_drawdown || 0) * 100).toFixed(2)}%`,
        resultStdDev: `${((metrics.return_std || 0) * 100).toFixed(2)}%`,
        resultVolatility: `${((metrics.volatility || 0) * 100).toFixed(2)}%`,
        resultSharpeRatio: (metrics.sharpe_ratio || 0).toFixed(2),
        resultReturnDrawdownRatio: (metrics.return_drawdown_ratio || 0).toFixed(2),
        resultWinRate: `${((metrics.win_rate || 0) * 100).toFixed(2)}%`,
        resultProfitLossRatio: metrics.profit_loss_ratio === Infinity ? 'inf' : (metrics.profit_loss_ratio || 0).toFixed(2),
        resultAvgProfit: [formatCurrency(metrics.avg_win || 0), 'text-danger'],
        resultAvgLoss: [formatCurrency(Math.abs(metrics.avg_loss || 0)), 'text-success'],
        resultTotalPnL: [formatCurrency(metrics.total_pnl || 0), (metrics.total_pnl || 0) >= 0 ? 'text-danger' : 'text-success'],
        resultTotalCommission: formatCurrency(metrics.total_commission || 0),
        resultTotalTurnover: formatCurrency(metrics.total_turnover || 0),
        resultTotalTrades: metrics.total_trade_count || 0,
        resultDailyAvgPnL: [formatCurrency(metrics.avg_daily_pnl || 0), (metrics.avg_daily_pnl || 0) >= 0 ? 'text-danger' : 'text-success'],
        resultDailyAvgCommission: formatCurrency(metrics.avg_daily_commission || 0),
        resultDailyAvgTurnover: formatCurrency(metrics.avg_daily_turnover || 0),
        resultDailyAvgTrades: (metrics.avg_daily_trade_count || 0).toFixed(2)
    };
    
    Object.entries(indicators).forEach(([id, value]) => {
        const [text, className] = Array.isArray(value) ? value : [value, ''];
        setElementText(id, text, className);
    });
    
    setTimeout(() => {
        if (results.portfolio_values?.length > 0) {
            drawBacktestCharts(results);
        }
    }, 100);
}

function setElementText(id, text, className = '') {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = text;
        if (className) element.className = className;
    }
}

function formatCurrency(value) {
    if (value === null || value === undefined || isNaN(value)) return '-';
    return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

let charts = { equity: null, drawdown: null, dailyReturn: null, pnlDist: null };

function drawBacktestCharts(results) {
    if (!results.portfolio_values?.length) return;
    
    let dates;
    let rawDates = [];
    
    // 优先使用传入的原始日期数组
    if (results.rawDates && results.rawDates.length > 0) {
        rawDates = results.rawDates;
        // 如果dates已经存在且是月份标签格式，直接使用；否则生成月份标签
        if (results.dates && results.dates.length > 0 && results.dates.some(d => d && d.match(/^\d{4}-\d{2}$/))) {
            dates = results.dates;
        } else {
            dates = generateMonthLabels(rawDates);
        }
    } else if (results.dates?.length > 0) {
        // 如果没有原始日期，尝试从dates推断
        if (results.dates[0] && results.dates[0].includes('/')) {
            const startDate = results.start_date ? new Date(results.start_date) : new Date();
            rawDates = results.portfolio_values.map((_, i) => {
                const date = new Date(startDate);
                date.setDate(date.getDate() + i);
                return date.toISOString().split('T')[0];
            });
            dates = results.dates;
        } else {
            // 如果dates已经是月份标签，尝试从start_date生成原始日期
            if (results.start_date) {
                const startDate = new Date(results.start_date);
                rawDates = results.portfolio_values.map((_, i) => {
                    const date = new Date(startDate);
                    date.setDate(date.getDate() + i);
                    return date.toISOString().split('T')[0];
                });
            } else {
                rawDates = results.dates; // 降级方案
            }
            dates = results.dates;
        }
    } else {
        // 完全没有日期数据，从start_date生成
        const startDate = results.start_date ? new Date(results.start_date) : new Date();
        rawDates = results.portfolio_values.map((_, i) => {
            const date = new Date(startDate);
            date.setDate(date.getDate() + i);
            return date.toISOString().split('T')[0];
        });
        dates = generateMonthLabels(rawDates);
    }
    
    const portfolioValues = results.portfolio_values;
    const initialCapital = results.initial_capital || portfolioValues[0] || 100000;
    const dailyReturnRawDates = rawDates.slice(1);
    const dailyReturnDates = generateMonthLabels(dailyReturnRawDates);
    
    drawEquityChart(dates, portfolioValues, initialCapital, rawDates);
    drawDrawdownChart(dates, portfolioValues, rawDates);
    drawDailyReturnChart(dailyReturnDates, portfolioValues, dailyReturnRawDates);
    drawPnlDistChart(portfolioValues);
}

function calculateDailyReturns(portfolioValues) {
    const returns = [];
    for (let i = 1; i < portfolioValues.length; i++) {
        returns.push((portfolioValues[i] - portfolioValues[i-1]) / portfolioValues[i-1] * 100);
    }
    return returns;
}

function drawEquityChart(dates, portfolioValues, initialCapital, rawDates = null) {
    const canvas = document.getElementById('equityChart');
    if (!canvas) return;
    
    if (charts.equity) charts.equity.destroy();
    
    const normalizedValues = portfolioValues.map(v => v / initialCapital);
    const baseOptions = getChartBaseOptions();
    
    // 保存原始日期数组到图表实例
    const originalDates = rawDates || dates;
    
    charts.equity = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: dates,
            datasets: [{
                label: '策略净值',
                data: normalizedValues,
                borderColor: '#dc3545',
                backgroundColor: 'rgba(220, 53, 69, 0.1)',
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 4,
                tension: 0.1,
                fill: false
            }, {
                label: '基准净值',
                data: portfolioValues.map(() => 1),
                borderColor: '#6c757d',
                borderDash: [5, 5],
                backgroundColor: 'rgba(108, 117, 125, 0.1)',
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 4,
                tension: 0,
                fill: false
            }]
        },
        options: {
            ...baseOptions,
            plugins: {
                ...baseOptions.plugins,
                legend: {
                    display: true,
                    position: 'top',
                    labels: { font: { size: 10, weight: 'normal' }, padding: 5, usePointStyle: true, boxWidth: 8, boxHeight: 8 }
                },
                tooltip: {
                    ...baseOptions.plugins.tooltip,
                    displayColors: true,
                    callbacks: {
                        title: function(context) {
                            const index = context[0].dataIndex;
                            if (originalDates && originalDates[index]) {
                                const dateStr = originalDates[index];
                                // 显示完整日期
                                try {
                                    const date = new Date(dateStr);
                                    if (!isNaN(date.getTime())) {
                                        const year = date.getFullYear();
                                        const month = String(date.getMonth() + 1).padStart(2, '0');
                                        const day = String(date.getDate()).padStart(2, '0');
                                        return `${year}-${month}-${day}`;
                                    }
                                } catch (e) {
                                    // 如果解析失败，返回原始日期字符串
                                }
                                return dateStr;
                            }
                            return context[0].label || '';
                        },
                        label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(4)}`
                    }
                }
            },
            scales: {
                y: getStandardYAxisConfig(v => v.toFixed(3), false),
                x: getStandardXAxisConfig()
            }
        }
    });
}

function drawDrawdownChart(dates, portfolioValues, rawDates = null) {
    const canvas = document.getElementById('drawdownChart');
    if (!canvas) return;
    
    if (charts.drawdown) charts.drawdown.destroy();
    
    let maxPeak = portfolioValues[0];
    const drawdowns = portfolioValues.map(value => {
        if (value > maxPeak) maxPeak = value;
        return (value - maxPeak) / maxPeak * 100;
    });
    
    const baseOptions = getChartBaseOptions();
    const originalDates = rawDates || dates;
    
    charts.drawdown = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: dates,
            datasets: [{
                label: '回撤',
                data: drawdowns,
                borderColor: '#28a745',
                backgroundColor: 'rgba(40, 167, 69, 0.3)',
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 4,
                fill: true,
                tension: 0.1
            }]
        },
        options: {
            ...baseOptions,
            plugins: {
                ...baseOptions.plugins,
                legend: { display: false },
                tooltip: {
                    ...baseOptions.plugins.tooltip,
                    callbacks: {
                        title: function(context) {
                            const index = context[0].dataIndex;
                            if (originalDates && originalDates[index]) {
                                const dateStr = originalDates[index];
                                // 显示完整日期
                                try {
                                    const date = new Date(dateStr);
                                    if (!isNaN(date.getTime())) {
                                        const year = date.getFullYear();
                                        const month = String(date.getMonth() + 1).padStart(2, '0');
                                        const day = String(date.getDate()).padStart(2, '0');
                                        return `${year}-${month}-${day}`;
                                    }
                                } catch (e) {
                                    // 如果解析失败，返回原始日期字符串
                                }
                                return dateStr;
                            }
                            return context[0].label || '';
                        },
                        label: ctx => `回撤: ${ctx.parsed.y.toFixed(2)}%`
                    }
                }
            },
            scales: {
                y: getStandardYAxisConfig(v => `${v.toFixed(2)}%`, false),
                x: getStandardXAxisConfig()
            }
        }
    });
}

function drawDailyReturnChart(dates, portfolioValues, rawDates = null) {
    const canvas = document.getElementById('dailyReturnChart');
    if (!canvas) return;
    
    if (charts.dailyReturn) charts.dailyReturn.destroy();
    
    const dailyReturns = calculateDailyReturns(portfolioValues);
    const colors = dailyReturns.map(r => r >= 0 ? '#dc3545' : '#28a745');
    const baseOptions = getChartBaseOptions();
    const originalDates = rawDates || dates;
    
    charts.dailyReturn = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: dates,
            datasets: [{
                label: '收益率',
                data: dailyReturns,
                backgroundColor: colors,
                borderColor: colors,
                borderWidth: 1.5,
                borderRadius: 2
            }]
        },
        options: {
            ...baseOptions,
            plugins: {
                ...baseOptions.plugins,
                legend: { display: false },
                tooltip: {
                    ...baseOptions.plugins.tooltip,
                    callbacks: {
                        title: function(context) {
                            const index = context[0].dataIndex;
                            if (originalDates && originalDates[index]) {
                                const dateStr = originalDates[index];
                                // 显示完整日期
                                try {
                                    const date = new Date(dateStr);
                                    if (!isNaN(date.getTime())) {
                                        const year = date.getFullYear();
                                        const month = String(date.getMonth() + 1).padStart(2, '0');
                                        const day = String(date.getDate()).padStart(2, '0');
                                        return `${year}-${month}-${day}`;
                                    }
                                } catch (e) {
                                    // 如果解析失败，返回原始日期字符串
                                }
                                return dateStr;
                            }
                            return context[0].label || '';
                        },
                        label: ctx => `收益率: ${ctx.parsed.y.toFixed(2)}%`
                    }
                }
            },
            scales: {
                y: getStandardYAxisConfig(v => `${v.toFixed(2)}%`, true),
                x: getStandardXAxisConfig()
            }
        }
    });
}

function drawPnlDistChart(portfolioValues) {
    const canvas = document.getElementById('pnlDistChart');
    if (!canvas) return;
    
    if (charts.pnlDist) charts.pnlDist.destroy();
    
    const dailyReturns = calculateDailyReturns(portfolioValues);
    if (dailyReturns.length === 0) return;
    
    const bins = 20;
    const min = Math.min(...dailyReturns);
    const max = Math.max(...dailyReturns);
    const binSize = (max - min) / bins;
    const frequency = new Array(bins).fill(0);
    
    dailyReturns.forEach(r => {
        const binIndex = Math.min(Math.floor((r - min) / binSize), bins - 1);
        frequency[binIndex]++;
    });
    
    const binLabels = Array.from({ length: bins }, (_, i) => (min + i * binSize).toFixed(2));
    const baseOptions = getChartBaseOptions();
    
    charts.pnlDist = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: binLabels,
            datasets: [{
                label: '频数',
                data: frequency,
                borderColor: '#007bff',
                backgroundColor: 'rgba(0, 123, 255, 0.3)',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 0,
                pointHoverRadius: 4
            }]
        },
        options: {
            ...baseOptions,
            plugins: {
                ...baseOptions.plugins,
                legend: { display: false },
                tooltip: {
                    ...baseOptions.plugins.tooltip,
                    callbacks: { label: ctx => `频数: ${ctx.parsed.y}` }
                }
            },
            scales: {
                ...baseOptions.scales,
                y: {
                    ...baseOptions.scales.y,
                    beginAtZero: true,
                    title: { display: false },
                    ticks: { font: { size: 12 }, stepSize: 1 }
                },
                x: {
                    ...baseOptions.scales.x,
                    title: { display: false },
                    ticks: { font: { size: 11 }, maxRotation: 0, minRotation: 0 }
                }
            }
        }
    });
}

async function viewBacktestResult(resultId) {
    const { ok, data } = await apiRequest(`/api/backtest/results/${resultId}`);
    
    if (!ok || !data.result) {
        showAlert(data.error || '加载回测结果失败', 'danger');
        return;
    }
    
    const resultData = data.result;
    const results = resultData.result || resultData.results || {};
    const { portfolioValues, dates, rawDates } = parseValuesDf(results.values_df);
    
    const resultsWithParams = {
        metrics: results.metrics || {},
        portfolio_values: portfolioValues,
        dates,
        rawDates: rawDates || dates, // 保存原始日期数组
        trades: results.trades_df || [],
        initial_capital: resultData.initial_capital || 100000,
        start_date: resultData.start_date || '',
        end_date: resultData.end_date || ''
    };
    
    showBacktestResult(resultsWithParams);
}

async function previewData(filename) {
    const { ok, data } = await apiRequest(`/api/data/preview/${encodeURIComponent(filename)}`);
    
    if (!ok) {
        showAlert(data.error || '预览数据失败', 'danger');
        return;
    }
    
    const modalDiv = document.createElement('div');
    modalDiv.className = 'modal fade';
    modalDiv.innerHTML = `
        <div class="modal-dialog modal-xl">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" style="font-size: 14px;">数据预览 - ${filename}</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body" style="max-height: 70vh; overflow-y: auto;">
                    <div class="mb-2">
                        <small class="text-muted">共 ${data.shape?.[0] || 0} 行，${data.shape?.[1] || 0} 列（仅显示前100行）</small>
                    </div>
                    <div class="table-responsive">
                        <table class="table table-sm table-striped table-hover" style="font-size: 12px;">
                            <thead class="table-light">
                                <tr>${data.columns?.map(col => `<th style="font-size: 11px; font-weight: 500;">${col}</th>`).join('') || ''}</tr>
                            </thead>
                            <tbody>
                                ${data.data?.length > 0 ? data.data.map(row => `
                                    <tr>${data.columns?.map(col => `<td>${row[col] !== null && row[col] !== undefined ? row[col] : '-'}</td>`).join('') || ''}</tr>
                                `).join('') : '<tr><td colspan="100%" class="text-center text-muted">暂无数据</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">关闭</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modalDiv);
    const modal = new bootstrap.Modal(modalDiv);
    modal.show();
    
    modalDiv.addEventListener('hidden.bs.modal', () => document.body.removeChild(modalDiv));
}

async function createStrategy() {
    const name = document.getElementById('strategyName')?.value;
    const type = document.getElementById('strategyType')?.value;
    const description = document.getElementById('strategyDescription')?.value;
    const rules = document.getElementById('strategyRules')?.value;
    
    if (!name || !type) {
        showAlert('请填写必填字段', 'warning');
        return;
    }
    
    const result = await apiRequest('/api/strategy/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name, type, description,
            parameters: {},
            rules: rules.split('\n').filter(rule => rule.trim())
        })
    });
    
    if (result.ok) {
        showAlert('策略创建成功', 'success');
        bootstrap.Modal.getInstance(document.getElementById('strategyCreateModal'))?.hide();
        document.getElementById('strategyCreateForm')?.reset();
        loadStrategies();
    } else {
        showAlert(result.data.error || '创建失败', 'danger');
    }
}

function editStrategy(strategyId) {
    showAlert('编辑功能待实现', 'info');
}

async function deleteStrategy(strategyId) {
    if (!confirm('确定要删除这个策略吗？')) return;
    
    const result = await apiRequest(`/api/strategy/${strategyId}`, { method: 'DELETE' });
    
    if (result.ok) {
        showAlert('策略删除成功', 'success');
        loadStrategies();
    } else {
        showAlert(result.data.error || '删除失败', 'danger');
    }
}


function refreshBacktestHistory() {
    loadBacktestHistory();
}

function showAlert(message, type = 'info') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
    alertDiv.innerHTML = `${message}<button type="button" class="btn-close" data-bs-dismiss="alert"></button>`;
    
    const container = document.querySelector('.container-fluid');
    if (container) container.insertBefore(alertDiv, container.firstChild);
    setTimeout(() => alertDiv.parentNode?.removeChild(alertDiv), 3000);
}

function formatDateTime(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
