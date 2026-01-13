// DeltaFStation 策略分析页面JavaScript
// DOM 辅助函数 $ 已在 common.js 中定义
let currentStrategy = null;

function formatDateToMonth(dateStr) {
    if (!dateStr) return '';
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return '';
        const yearShort = String(date.getFullYear()).substring(2);
        const month = date.getMonth() + 1;
        return `${yearShort}/${month}`;
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
                // 尝试解析日期并格式化为 YY/M 格式 (例如 25/1)
                try {
                    const date = new Date(label);
                    if (!isNaN(date.getTime())) {
                        const yearShort = String(date.getFullYear()).substring(2);
                        const month = date.getMonth() + 1;
                        return `${yearShort}/${month}`;
                    }
                } catch (e) {
                    // 如果解析失败，返回原值
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
    // 初始化 Flatpickr 日期选择器
    const datePickerConfig = {
        locale: 'zh',
        dateFormat: 'Y-m-d',
        allowInput: true,
        monthSelectorType: 'static',
        yearSelectorType: 'dropdown', // 关键优化：点击年份直接下拉选择
        onReady: function(selectedDates, dateStr, instance) {
            // 优化外观：让年份和月份更易点击
            const calendar = instance.calendarContainer;
            if (calendar) {
                calendar.style.fontSize = '12px';
            }
        }
    };
    
    flatpickr('.date-picker', datePickerConfig);

    // 先设置默认日期，避免阻塞 UI
    const today = new Date();
    const twoYearsAgo = new Date(today);
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    
    // 设置 input 初始值
    const startInput = $('backtestStartDate');
    const endInput = $('backtestEndDate');
    if (startInput && endInput) {
        startInput.value = twoYearsAgo.toISOString().split('T')[0];
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

    // 初始化 SSE 日志监听
    initLogStream();
});

function initLogStream() {
    const consoleDiv = document.getElementById('liveConsole');
    if (!consoleDiv) return;

    // 使用 EventSource 连接后端 SSE 接口
    const eventSource = new EventSource('/api/logs/stream');

    eventSource.onmessage = function(event) {
        const logLine = document.createElement('div');
        logLine.style.marginBottom = '1px';
        logLine.style.padding = '1px 5px';
        
        // 如果是系统或错误日志，标记颜色
        if (event.data.includes('ERROR')) {
            logLine.style.color = '#dc3545'; // Bootstrap danger color
            logLine.style.fontWeight = 'bold';
        } else if (event.data.includes('WARNING')) {
            logLine.style.color = '#fd7e14'; // Bootstrap warning color
        } else if (event.data.includes('[SYSTEM]')) {
            logLine.style.color = '#0d6efd'; // Bootstrap primary color
        }

        logLine.textContent = event.data;
        
        // 如果是第一次接收，清空占位符
        if (consoleDiv.querySelector('.italic')) {
            consoleDiv.innerHTML = '';
        }

        consoleDiv.appendChild(logLine);

        // 自动滚动到底部
        consoleDiv.scrollTop = consoleDiv.scrollHeight;
        
        // 限制行数，避免内存占用过大
        if (consoleDiv.childNodes.length > 200) {
            consoleDiv.removeChild(consoleDiv.firstChild);
        }
    };

    eventSource.onerror = function() {
        console.error("SSE connection lost. Reconnecting...");
        // 浏览器会自动尝试重新连接，这里仅作记录
    };
}

function clearConsole() {
    const consoleDiv = document.getElementById('liveConsole');
    if (consoleDiv) {
        consoleDiv.innerHTML = '<div class="text-muted italic">控制台已清空...</div>';
    }
}

async function loadStrategies() {
    const { ok, data } = await apiRequest('/api/strategies');
    const select = $('backtestStrategySelect');
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
    const select = $('backtestStrategySelect');
    if (!select || !select.value) {
        currentStrategy = null;
        return;
    }
    selectStrategy(select.value);
}

async function selectStrategy(strategyId) {
    const { ok, data } = await apiRequest(`/api/strategies/${strategyId}`);
    
    if (ok && data.strategy) {
        currentStrategy = data.strategy;
        const card = $('backtestConfigCard');
        if (card) card.style.display = 'block';
    } else {
        showAlert(data.error || '加载策略失败', 'danger');
    }
}

async function loadDataFiles() {
    const { ok, data } = await apiRequest('/api/data/files');
    const list = $('dataFilesList');
    if (!list) return;
    
    if (!ok || !data.files || data.files.length === 0) {
        list.innerHTML = '<div class="empty-state"><i class="fas fa-database"></i><p>暂无数据文件</p></div>';
        return;
    }
    
    // 同时更新回测参数中的 datalist
    const datalist = $('availableSymbols');
    if (datalist) {
        datalist.innerHTML = data.files.map(f => {
            const symbol = f.filename.replace('.csv', '');
            return `<option value="${symbol}">${f.filename}</option>`;
        }).join('');
    }
    
    list.innerHTML = data.files.map(file => {
        const safeFilename = file.filename.replace(/'/g, "\\'");
        return `<div class="data-file-item">
            <div class="d-flex justify-content-between align-items-center">
                <div style="flex: 1; min-width: 0; overflow: hidden;">
                    <div class="text-truncate" style="font-size: 12px; font-weight: 500; margin-bottom: 0.2rem;" title="${file.filename}">${file.filename}</div>
                    <small class="text-muted" style="font-size: 10px;">${formatFileSize(file.size)} | ${formatDateTime(file.modified)}</small>
                </div>
                <div class="btn-group">
                    <button class="btn btn-sm btn-outline-success" style="padding: 0.25rem 0.4rem; font-size: 10px;" onclick="event.stopPropagation(); selectDataFileForBacktest('${safeFilename}')" title="使用此数据进行回测">
                        <i class="fas fa-play"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-primary" style="padding: 0.25rem 0.4rem; font-size: 10px;" onclick="event.stopPropagation(); previewData('${safeFilename}')" title="预览数据">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger" style="padding: 0.25rem 0.4rem; font-size: 10px;" onclick="event.stopPropagation(); deleteDataFile('${safeFilename}')" title="删除文件">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            </div>
        </div>`;
    }).join('');
}

function selectDataFileForBacktest(filename) {
    const symbol = filename.replace('.csv', '');
    const symbolInput = $('backtestSymbol');
    if (symbolInput) {
        symbolInput.value = symbol;
        // 视觉反馈：闪烁一下表示已选中
        symbolInput.classList.add('is-valid');
        setTimeout(() => symbolInput.classList.remove('is-valid'), 1000);
        
        // 自动滚动到参数配置区域
        $('backtestConfigCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        showAlert(`已选择数据文件: ${filename}`, 'info');
    }
}

async function loadBacktestHistory() {
    const { ok, data } = await apiRequest('/api/backtests');
    const list = $('backtestHistoryList');
    if (!list) return;
    
    if (!ok || !data.results || data.results.length === 0) {
        list.innerHTML = '<div class="empty-state"><i class="fas fa-history"></i><p>暂无回测记录</p></div>';
        return;
    }
    
    list.innerHTML = data.results.map(result => {
        const totalReturn = typeof result.total_return === 'number' ? result.total_return : 0;
        const sharpeRatio = typeof result.sharpe_ratio === 'number' ? result.sharpe_ratio : 0;
        
        // 尝试从文件名提取标的（如果旧数据缺失 symbol 字段）
        let symbol = result.symbol;
        if (!symbol && result.data_file) {
            // 兼容新旧格式：000001.SS.csv 或 000001_2025...csv
            symbol = result.data_file.replace('.csv', '').split('_')[0];
        }
        symbol = (symbol || 'ASSET').toUpperCase();

        // 格式化日期范围：YYMMDD-YYMMDD
        const formatDateShort = (dateStr) => {
            if (!dateStr) return '';
            const d = new Date(dateStr);
            return `${String(d.getFullYear()).substring(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
        };
        
        const dateRange = (result.start_date && result.end_date) 
            ? `${formatDateShort(result.start_date)}-${formatDateShort(result.end_date)}`
            : '';
            
        return `
            <div class="backtest-item" onclick="viewBacktestResult('${result.id}')" title="${result.id}">
                <div class="d-flex justify-content-between align-items-center">
                    <div style="flex: 1; min-width: 0;">
                        <div class="d-flex align-items-center mb-1">
                            <h6 class="mb-0 text-truncate" style="font-size: 13px; font-weight: 600;">
                                <span class="text-primary">${result.strategy_id || '未知策略'}</span><span class="text-muted">_${symbol}</span>
                            </h6>
                        </div>
                        <div class="d-flex align-items-center text-muted" style="font-size: 10px;">
                            <span class="me-2"><i class="far fa-calendar-alt me-1"></i>${dateRange}</span>
                            <span><i class="far fa-clock me-1"></i>${formatDateTime(result.created_at || '')}</span>
                        </div>
                    </div>
                    <div class="text-end ms-2" style="flex-shrink: 0;">
                        <div class="fw-bold ${totalReturn >= 0 ? 'text-danger' : 'text-success'}" style="font-size: 14px; line-height: 1.2;">
                            ${totalReturn >= 0 ? '+' : ''}${(totalReturn * 100).toFixed(1)}%
                        </div>
                        <div class="text-muted" style="font-size: 10px;">夏普: ${sharpeRatio.toFixed(2)}</div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

async function clearBacktestHistory() {
    if (!confirm('确定要清空所有回测历史记录吗？此操作不可撤销。')) {
        return;
    }
    
    const { ok, data } = await apiRequest('/api/backtests', {
        method: 'DELETE'
    });
    
    if (ok) {
        showAlert(data.message || '回测历史已清空', 'success');
        loadBacktestHistory();
    } else {
        showAlert(data.error || '清空失败', 'danger');
    }
}

async function runBacktest() {
    if (!currentStrategy) {
        showAlert('请先选择策略', 'warning');
        return;
    }
    
    const symbol = $('backtestSymbol')?.value.trim().toUpperCase() || '';
    const startDate = $('backtestStartDate')?.value || '';
    const endDate = $('backtestEndDate')?.value || '';
    const initialCapital = parseFloat($('backtestInitialCapital')?.value || 100000);
    const commission = parseFloat($('backtestCommission')?.value || 0.001);
    const slippage = 0.0005;
    
    if (!symbol || !startDate || !endDate) {
        showAlert('请填写必填字段（策略、投资标的、日期区间）', 'warning');
        return;
    }
    
    const fetchResult = await apiRequest(`/api/data/symbols/${symbol}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_date: startDate, end_date: endDate })
    });
    
    if (!fetchResult.ok) {
        showAlert(fetchResult.data.error || '获取数据失败', 'danger');
        return;
    }
    
    // 提示下载/同步成功并刷新目录
    const statusMsg = fetchResult.data.status === 'updated' ? '数据同步完成' : '全量数据下载完成';
    showAlert(`${symbol} ${statusMsg}`, 'success');
    loadDataFiles();
    
    // 获取文件名（新API直接返回filename或id）
    const filename = fetchResult.data.filename || fetchResult.data.id;
    
    const result = await apiRequest('/api/backtests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            strategy_id: currentStrategy.id,
            symbol: symbol, // 显式传递标的代码
            data_file: filename,
            start_date: startDate,
            end_date: endDate,
            initial_capital: initialCapital,
            commission,
            slippage
        })
    });
    
    if (!result.ok) {
        showAlert(result.data.error || '回测失败', 'danger');
        const debugOutput = $('debugOutput');
        if (debugOutput) debugOutput.textContent = JSON.stringify(result.data, null, 2);
        return;
    }
    
    showAlert('回测运行成功', 'success');
    
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
        parseFloat($('backtestInitialCapital')?.value || 100000);
    
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
    const element = $(id);
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
        // 如果dates已经存在且是月份标签格式 (YY/M)，直接使用；否则生成月份标签
        if (results.dates && results.dates.length > 0 && results.dates.some(d => d && d.match(/^\d{2}\/\d{1,2}$/))) {
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
    const canvas = $('equityChart');
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
    const canvas = $('drawdownChart');
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
    const canvas = $('dailyReturnChart');
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
    const canvas = $('pnlDistChart');
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
    const { ok, data } = await apiRequest(`/api/backtests/${resultId}`);
    
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
    const { ok, data } = await apiRequest(`/api/data/files/${encodeURIComponent(filename)}`);
    
    if (!ok) {
        showAlert(data.error || '预览数据失败', 'danger');
        return;
    }
    
    const modalDiv = document.createElement('div');
    modalDiv.className = 'modal fade';
    
    // 生成表格行
    let tableRows = '';
    const columns = data.columns || [];
    const records = data.data || [];
    
    if (records.length > 0) {
        records.forEach((row, index) => {
            // 如果有截断，在第 50 条后插入一个分割行
            if (data.is_truncated && index === 50) {
                tableRows += `
                    <tr class="table-light">
                        <td colspan="${columns.length}" class="text-center text-muted" style="padding: 10px; background: #f8f9fa;">
                            <i class="fas fa-ellipsis-h me-2"></i> 中间省略了 ${data.total_rows - 100} 条数据 <i class="fas fa-ellipsis-h ms-2"></i>
                        </td>
                    </tr>
                `;
            }
            
            tableRows += `<tr>${columns.map(col => `<td>${row[col] !== null && row[col] !== undefined ? row[col] : '-'}</td>`).join('')}</tr>`;
        });
    } else {
        tableRows = '<tr><td colspan="100%" class="text-center text-muted">暂无数据</td></tr>';
    }

    modalDiv.innerHTML = `
        <div class="modal-dialog modal-xl">
            <div class="modal-content">
                <div class="modal-header">
                    <div>
                        <h5 class="modal-title" style="font-size: 14px;">数据预览 - ${filename}</h5>
                        <div class="mt-1">
                            <span class="badge bg-primary me-2">数据区间: ${data.start_date} 至 ${data.end_date}</span>
                            <span class="badge bg-secondary">共 ${data.total_rows} 行</span>
                        </div>
                    </div>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body" style="max-height: 70vh; overflow-y: auto; padding-top: 0;">
                    <div class="table-responsive">
                        <table class="table table-sm table-striped table-hover" style="font-size: 12px;">
                            <thead class="table-light" style="position: sticky; top: 0; z-index: 1;">
                                <tr>${columns.map(col => `<th style="font-size: 11px; font-weight: 500;">${col}</th>`).join('')}</tr>
                            </thead>
                            <tbody>
                                ${tableRows}
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
    const name = $('strategyName')?.value;
    const type = $('strategyType')?.value;
    const description = $('strategyDescription')?.value;
    const rules = $('strategyRules')?.value;
    
    if (!name || !type) {
        showAlert('请填写必填字段', 'warning');
        return;
    }
    
    const result = await apiRequest('/api/strategies', {
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
        bootstrap.Modal.getInstance($('strategyCreateModal'))?.hide();
        $('strategyCreateForm')?.reset();
        loadStrategies();
    } else {
        showAlert(result.data.error || '创建失败', 'danger');
    }
}

// editStrategy 功能待实现，暂时删除

// deleteStrategy 和 refreshBacktestHistory 函数未使用，已删除

// =========================
// 数据管理辅助函数
// =========================

async function uploadDataFile(input) {
    if (!input.files || input.files.length === 0) return;
    
    const file = input.files[0];
    const formData = new FormData();
    formData.append('file', file);
    
    showAlert('正在上传文件...', 'info');
    
    try {
        const response = await fetch('/api/data/files', {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('文件上传成功', 'success');
            loadDataFiles();
        } else {
            showAlert(result.error || '上传失败', 'danger');
        }
    } catch (error) {
        console.error('Upload failed:', error);
        showAlert('上传请求失败', 'danger');
    } finally {
        input.value = ''; // 清空选择
    }
}

async function deleteDataFile(filename) {
    if (!confirm(`确定要删除数据文件 ${filename} 吗？`)) return;
    
    const { ok, data } = await apiRequest(`/api/data/files/${encodeURIComponent(filename)}`, {
        method: 'DELETE'
    });
    
    if (ok) {
        showAlert('文件已删除', 'success');
        loadDataFiles();
    } else {
        showAlert(data.error || '删除失败', 'danger');
    }
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

//showAlert 已在 common.js 中定义
//formatDateTimeFull 已在 common.js 中定义
function formatDateTime(dateString) {
    return formatDateTimeFull(dateString);
}
