// DeltaFStation 策略分析页面JavaScript
// DOM 辅助函数 $ 已在 common.js 中定义
let currentStrategy = null;

// =========================
// 日期处理辅助函数（优化：统一日期格式化）
// =========================
function formatDateToYYYYMMDD(date) {
    if (!date) return '';
    if (typeof date === 'string') {
        return date.split(' ')[0].split('T')[0];
    }
    return new Date(date).toISOString().split('T')[0];
}

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

// 优化：简化日期序列生成
function generateDateSequence(startDate, count) {
    const start = startDate ? new Date(startDate) : new Date();
    return Array.from({ length: count }, (_, i) => {
        const date = new Date(start);
        date.setDate(date.getDate() + i);
        return formatDateToYYYYMMDD(date);
    });
}

function parseValuesDf(valuesDf) {
    if (!valuesDf || !Array.isArray(valuesDf) || valuesDf.length === 0) {
        return { portfolioValues: [], dates: [], rawDates: [] };
    }
    
    const portfolioValues = [];
    const rawDates = [];
    
    valuesDf.forEach(row => {
        // 优先尝试首字母大写的键名，否则使用常见键名
        const value = row['Value'] || row['total_value'] || row['portfolio_value'];
        const date = row['Date'] || row['date'];

        if (value !== undefined && value !== null) {
            portfolioValues.push(parseFloat(value));
            rawDates.push(date ? formatDateToYYYYMMDD(date) : null);
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
                const formatted = formatDateToMonth(label);
                return formatted || label;
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
        startInput.value = formatDateToYYYYMMDD(twoYearsAgo);
        endInput.value = formatDateToYYYYMMDD(today);
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

    select.innerHTML = '<option value="">请选择策略 (data/strategies)</option>' +
        data.strategies.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    
    if (data.strategies.length > 0) {
        select.value = data.strategies[0].id;
        await selectStrategy(data.strategies[0].id);
        updateStrategyActionButtons(data.strategies[0].id);
    }
}

function handleStrategySelectChange() {
    const select = $('backtestStrategySelect');
    if (!select || !select.value) {
        currentStrategy = null;
        updateStrategyActionButtons(null);
        return;
    }
    selectStrategy(select.value);
    updateStrategyActionButtons(select.value);
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

async function selectDataFileForBacktest(filename) {
    const symbol = filename.replace('.csv', '');
    const symbolInput = $('backtestSymbol');
    if (symbolInput) {
        symbolInput.value = symbol;
        symbolInput.classList.add('is-valid');
        setTimeout(() => symbolInput.classList.remove('is-valid'), 1000);
    }
    
    // 获取文件日期信息并填充
    const { ok, data } = await apiRequest(`/api/data/files/${encodeURIComponent(filename)}`);
    if (ok && data.start_date && data.end_date) {
        const startInput = $('backtestStartDate');
        const endInput = $('backtestEndDate');
        if (startInput) startInput.value = data.start_date;
        if (endInput) endInput.value = data.end_date;
    }
    
    $('backtestConfigCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showAlert(`已选择数据文件: ${filename}`, 'info');
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
    if (!confirm('确定要清空所有回测历史记录吗？')) {
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

function getBacktestParams() {
    return {
        strategyId: currentStrategy?.id,
        symbol: $('backtestSymbol')?.value.trim().toUpperCase() || '',
        startDate: $('backtestStartDate')?.value || '',
        endDate: $('backtestEndDate')?.value || '',
        initialCapital: parseFloat($('backtestInitialCapital')?.value || 100000),
        commission: parseFloat($('backtestCommission')?.value || 0.001),
        slippage: 0.0005
    };
}

async function syncMarketData(symbol, startDate, endDate, silent = false) {
    // 首先检查本地文件是否存在，以及日期范围是否已包含所需数据
    const { ok, data } = await apiRequest(`/api/data/symbols/${symbol}/files`, {
        method: 'GET'
    });
    
    // 如果文件存在，检查日期范围
    if (ok && data && data.filename) {
        // 获取文件详细信息，检查日期范围
        const fileInfo = await apiRequest(`/api/data/files/${data.filename}`);
        if (fileInfo.ok && fileInfo.data.start_date && fileInfo.data.end_date) {
            const fileStartDate = new Date(fileInfo.data.start_date);
            const fileEndDate = new Date(fileInfo.data.end_date);
            const requiredStartDate = new Date(startDate);
            const requiredEndDate = new Date(endDate);
            
            // 检查文件的日期范围是否包含所需的日期范围
            if (fileStartDate <= requiredStartDate && fileEndDate >= requiredEndDate) {
                // 日期范围已存在，无需重新下载
                if (!silent) {
                    showAlert(`${symbol} 数据已存在，无需下载`, 'info');
                }
                return data.filename;
            }
        }
    }
    
    // 文件不存在或日期范围不完整，需要全量重新下载
    const fetchResult = await apiRequest(`/api/data/symbols/${symbol}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_date: startDate, end_date: endDate })
    });
    
    if (!fetchResult.ok) {
        if (!silent) showAlert(fetchResult.data?.error || '获取数据失败', 'danger');
        return null;
    }
    
    if (!silent) {
        const statusMsg = fetchResult.data.status === 'exists' ? '数据已存在' : '全量数据下载完成';
        showAlert(`${symbol} ${statusMsg}`, 'success');
        loadDataFiles();
    }
    
    return fetchResult.data.filename || fetchResult.data.id;
}

async function runBacktest() {
    if (!currentStrategy) {
        showAlert('请先选择策略', 'warning');
        return;
    }
    
    const params = getBacktestParams();
    if (!params.symbol || !params.startDate || !params.endDate) {
        showAlert('请填写必填字段（策略、投资标的、日期区间）', 'warning');
        return;
    }
    
    const filename = await syncMarketData(params.symbol, params.startDate, params.endDate);
    if (!filename) return;
    
    const result = await apiRequest('/api/backtests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            strategy_id: params.strategyId,
            symbol: params.symbol,
            data_file: filename,
            start_date: params.startDate,
            end_date: params.endDate,
            initial_capital: params.initialCapital,
            commission: params.commission,
            slippage: params.slippage
        })
    });
    
    if (!result.ok) {
        showAlert(result.data.error || '回测失败', 'danger');
        return;
    }
    
    showAlert('回测运行成功', 'success');
    
    try {
        const { portfolioValues, dates, rawDates } = parseValuesDf(result.data.values_df);
        const resultsWithParams = {
            metrics: result.data.metrics || {},
            portfolio_values: portfolioValues,
            dates,
            rawDates: rawDates || dates,
            trades: result.data.trades_df || [],
            initial_capital: params.initialCapital,
            start_date: params.startDate,
            end_date: params.endDate,
            symbol: params.symbol
        };
        showBacktestResult(resultsWithParams);
        loadBacktestHistory();
    } catch (error) {
        console.error('Error displaying results:', error);
        showAlert('数据解析失败，请查看调试信息', 'warning');
    }
}

function showBacktestResult(results) {
    const m = results.metrics || {};
    const initialCapital = m.start_capital || results.initial_capital || 
        parseFloat($('backtestInitialCapital')?.value || 100000);
    const endingCapital = m.end_capital || initialCapital;
    const growth = endingCapital - initialCapital;
    const growthPercent = initialCapital > 0 ? (growth / initialCapital * 100) : 0;
    
    // 配置化指标映射
    const indicatorConfig = [
        { id: 'resultTotalTradingDays', val: m.total_trading_days || 0 },
        { id: 'resultProfitableDays', val: m.profitable_days || 0, cls: 'text-danger' },
        { id: 'resultLossDays', val: m.losing_days || 0, cls: 'text-success' },
        { id: 'resultInitialCapital', val: formatCurrency(initialCapital) },
        { id: 'resultEndingCapital', val: formatCurrency(endingCapital) },
        { id: 'resultCapitalGrowth', val: `${growthPercent >= 0 ? '+' : ''}${growthPercent.toFixed(2)}%`, cls: growth >= 0 ? 'text-danger' : 'text-success' },
        { id: 'resultTotalReturn', val: `${((m.total_return || 0) * 100).toFixed(2)}%`, cls: (m.total_return || 0) >= 0 ? 'text-danger' : 'text-success' },
        { id: 'resultAnnualizedReturn', val: `${((m.annualized_return || 0) * 100).toFixed(2)}%`, cls: (m.annualized_return || 0) >= 0 ? 'text-danger' : 'text-success' },
        { id: 'resultDailyAvgReturn', val: `${((m.avg_daily_return || 0) * 100).toFixed(2)}%`, cls: (m.avg_daily_return || 0) >= 0 ? 'text-danger' : 'text-success' },
        { id: 'resultMaxDrawdown', val: `${((m.max_drawdown || 0) * 100).toFixed(2)}%` },
        { id: 'resultStdDev', val: `${((m.return_std || 0) * 100).toFixed(2)}%` },
        { id: 'resultVolatility', val: `${((m.volatility || 0) * 100).toFixed(2)}%` },
        { id: 'resultSharpeRatio', val: (m.sharpe_ratio || 0).toFixed(2) },
        { id: 'resultReturnDrawdownRatio', val: (m.return_drawdown_ratio || 0).toFixed(2) },
        { id: 'resultWinRate', val: `${((m.win_rate || 0) * 100).toFixed(2)}%` },
        { id: 'resultProfitLossRatio', val: m.profit_loss_ratio === Infinity ? 'inf' : (m.profit_loss_ratio || 0).toFixed(2) },
        { id: 'resultAvgProfit', val: formatCurrency(m.avg_win || 0), cls: 'text-danger' },
        { id: 'resultAvgLoss', val: formatCurrency(Math.abs(m.avg_loss || 0)), cls: 'text-success' },
        { id: 'resultTotalPnL', val: formatCurrency(growth), cls: growth >= 0 ? 'text-danger' : 'text-success' },
        { id: 'resultTotalCommission', val: formatCurrency(m.total_commission || 0) },
        { id: 'resultTotalTurnover', val: formatCurrency(m.total_turnover || 0) },
        { id: 'resultTotalTrades', val: m.total_trade_count || 0 },
        { id: 'resultDailyAvgPnL', val: formatCurrency(m.avg_daily_pnl || 0), cls: (m.avg_daily_pnl || 0) >= 0 ? 'text-danger' : 'text-success' },
        { id: 'resultDailyAvgCommission', val: formatCurrency(m.avg_daily_commission || 0) },
        { id: 'resultDailyAvgTurnover', val: formatCurrency(m.avg_daily_turnover || 0) },
        { id: 'resultDailyAvgTrades', val: (m.avg_daily_trade_count || 0).toFixed(2) }
    ];
    
    indicatorConfig.forEach(item => setElementText(item.id, item.val, item.cls));
    
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

let charts = { priceTrend: null, equity: null, drawdown: null, dailyReturn: null, pnlDist: null };

async function getBenchmarkNormalizedData(symbol, rawDates) {
    if (!rawDates || rawDates.length === 0) return null;
    
    const startDate = rawDates[0];
    const endDate = rawDates[rawDates.length - 1];
    
    try {
        // 1. 直接复用同步逻辑 (开启静默模式)，确保本地有基准数据
        const filename = await syncMarketData(symbol, startDate, endDate, true);
        if (!filename) return null;
        
        // 2. 获取完整数据内容
        const { ok, data } = await apiRequest(`/api/data/files/${filename}?full=true`);
        if (!ok || !data.data || data.data.length === 0) return null;
        
        // 3. 将基准数据转为 Map 以便快速对齐日期
        const priceMap = new Map();
        data.data.forEach(row => {
            const dateVal = row['Date'];
            // 优先使用 Close，否则使用 Price，最后使用第二列
            const priceVal = parseFloat(row['Close'] || row['Price'] || row[Object.keys(row)[1]]);
            
            if (dateVal && !isNaN(priceVal)) {
                const cleanDate = formatDateToYYYYMMDD(dateVal);
                priceMap.set(cleanDate, priceVal);
            }
        });
        
        // 4. 按照回测的日期序列提取基准价格并归一化
        let firstPrice = null;
        const normalizedBenchmark = rawDates.map(date => {
            const cleanTargetDate = formatDateToYYYYMMDD(date);
            const price = priceMap.get(cleanTargetDate);
            
            if (price !== undefined && price !== null) {
                if (firstPrice === null) firstPrice = price;
                return price / firstPrice;
            }
            return null; 
        });
        
        // 5. 线性填充缺失值：确保曲线连续
        for (let i = 0; i < normalizedBenchmark.length; i++) {
            if (normalizedBenchmark[i] === null && i > 0) {
                normalizedBenchmark[i] = normalizedBenchmark[i-1];
            }
        }
        // 反向填充第一天可能缺失的情况
        if (normalizedBenchmark[0] === null) {
            const firstValid = normalizedBenchmark.find(v => v !== null);
            if (firstValid) {
                for (let i = 0; i < normalizedBenchmark.length && normalizedBenchmark[i] === null; i++) {
                    normalizedBenchmark[i] = firstValid;
                }
            }
        }
        
        return normalizedBenchmark;
    } catch (e) {
        console.error("Fetch benchmark failed:", e);
        return null;
    }
}

// 辅助函数：标准化日期数据（优化）
function normalizeBacktestDates(results, portfolioValues) {
    // 如果已有 rawDates，直接使用
    if (results.rawDates?.length > 0) {
        const dates = results.dates?.some(d => d?.match(/^\d{2}\/\d{1,2}$/)) 
            ? results.dates 
            : generateMonthLabels(results.rawDates);
        return { rawDates: results.rawDates, dates };
    }
    
    // 如果有 dates 且是月份格式
    if (results.dates?.length > 0 && results.dates[0]?.includes('/')) {
        const rawDates = generateDateSequence(results.start_date, portfolioValues.length);
        return { rawDates, dates: results.dates };
    }
    
    // 其他情况
    const rawDates = results.dates?.length > 0 && !results.dates[0]?.includes('/')
        ? (results.start_date ? generateDateSequence(results.start_date, portfolioValues.length) : results.dates)
        : generateDateSequence(results.start_date, portfolioValues.length);
    
    const dates = results.dates?.length > 0 ? results.dates : generateMonthLabels(rawDates);
    return { rawDates, dates };
}

async function drawBacktestCharts(results) {
    if (!results.portfolio_values?.length) return;
    
    const portfolioValues = results.portfolio_values;
    const { rawDates, dates } = normalizeBacktestDates(results, portfolioValues);
    
    const initialCapital = results.initial_capital || portfolioValues[0] || 100000;
    const dailyReturnRawDates = rawDates.slice(1);
    const dailyReturnDates = generateMonthLabels(dailyReturnRawDates);
    
    // 获取 000001.SS 作为 Benchmark
    const benchmarkData = await getBenchmarkNormalizedData('000001.SS', rawDates);
    
    // 获取投资标的本身的归一化价格 (Underlying Asset)
    let underlyingData = null;
    if (results.symbol && results.symbol.toUpperCase() !== '000001.SS') {
        underlyingData = await getBenchmarkNormalizedData(results.symbol, rawDates);
    }
    
    drawPriceTrendChart(dates, rawDates, benchmarkData, underlyingData, results.symbol);
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

function getChartTooltipCallbacks(originalDates) {
    return {
        title: function(context) {
            const index = context[0].dataIndex;
            const dateStr = originalDates?.[index] || context[0].label;
            return dateStr ? (formatDateToYYYYMMDD(dateStr) || dateStr) : '';
        },
        label: function(ctx) {
            const label = ctx.dataset.label || '';
            const value = ctx.parsed.y;
            const format = label.includes('收益率') || label.includes('回撤') ? 2 : 4;
            return `${label}: ${value.toFixed(format)}%`;
        }
    };
}

function updateHeaderLegend(elementId, datasets) {
    const container = $(elementId);
    if (!container) return;
    
    container.innerHTML = datasets.map(ds => {
        const color = ds.borderColor;
        const lastValue = ds.data && ds.data.length > 0 ? ds.data[ds.data.length - 1] : null;
        const displayValue = lastValue !== null ? ` <span class="fw-bold ms-1">${lastValue.toFixed(4)}</span>` : '';
        return `<span class="d-flex align-items-center"><i class="fas fa-minus me-1" style="color: ${color}; width: 12px;"></i>${ds.label}${displayValue}</span>`;
    }).join('');
}

function drawPriceTrendChart(dates, rawDates = null, benchmarkData = null, underlyingData = null, symbol = '') {
    const canvas = $('priceTrendChart');
    if (!canvas) return;
    
    if (charts.priceTrend) charts.priceTrend.destroy();
    
    const baseOptions = getChartBaseOptions();
    const originalDates = rawDates || dates;
    
    const datasets = [];

    // 如果投资标的不是上证指数，增加标的自身的价格线
    if (underlyingData) {
        datasets.push({
            label: `标的 (${symbol})`,
            data: underlyingData,
            borderColor: 'rgba(255, 193, 7, 0.7)', // 降低饱和度的琥珀色
            borderWidth: 1.5,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.1,
            fill: false,
            spanGaps: true
        });
    }

    // 增加基准线 (上证指数)
    datasets.push({
        label: benchmarkData ? '基准 (000001.SS)' : '基准',
        data: benchmarkData || dates.map(() => 1),
        borderColor: 'rgba(108, 117, 125, 0.5)', // 降低饱和度的灰色
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0,
        fill: false,
        spanGaps: true
    });
    
    // 更新标题栏 Legend
    updateHeaderLegend('priceTrendLegend', datasets);

    charts.priceTrend = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: dates,
            datasets: datasets
        },
        options: {
            ...baseOptions,
            plugins: {
                ...baseOptions.plugins,
                legend: {
                    display: false // 隐藏内置 Legend
                },
                tooltip: {
                    ...baseOptions.plugins.tooltip,
                    displayColors: true,
                    callbacks: getChartTooltipCallbacks(originalDates)
                }
            },
            scales: {
                y: getStandardYAxisConfig(v => v.toFixed(3), false),
                x: getStandardXAxisConfig()
            }
        }
    });
}

function drawEquityChart(dates, portfolioValues, initialCapital, rawDates = null) {
    const canvas = $('equityChart');
    if (!canvas) return;
    
    if (charts.equity) charts.equity.destroy();
    
    const normalizedValues = portfolioValues.map(v => v / initialCapital);
    const baseOptions = getChartBaseOptions();
    const originalDates = rawDates || dates;
    
    const datasets = [{
        label: '策略净值',
        data: normalizedValues,
        borderColor: '#dc3545',
        backgroundColor: 'rgba(220, 53, 69, 0.1)',
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.1,
        fill: false
    }];

    // 更新标题栏 Legend
    updateHeaderLegend('equityLegend', datasets);

    charts.equity = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: dates,
            datasets: datasets
        },
        options: {
            ...baseOptions,
            plugins: {
                ...baseOptions.plugins,
                legend: {
                    display: false // 隐藏内置 Legend
                },
                tooltip: {
                    ...baseOptions.plugins.tooltip,
                    displayColors: true,
                    callbacks: getChartTooltipCallbacks(originalDates)
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
                    callbacks: getChartTooltipCallbacks(originalDates)
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
                    callbacks: getChartTooltipCallbacks(originalDates)
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
    
    let dailyReturns = calculateDailyReturns(portfolioValues);
    // 过滤掉日收益率为 0 的样本（空仓或无波动日），使分布图更聚焦于实际盈亏分布
    dailyReturns = dailyReturns.filter(r => r !== 0);
    
    if (dailyReturns.length === 0) return;
    
    const bins = 50;
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
        plugins: [{
            id: 'zeroLine',
            beforeDraw: (chart) => {
                const {ctx, chartArea: {top, bottom, left, right}} = chart;
                if (min <= 0 && max >= 0) {
                    const ratio = (0 - min) / (max - min);
                    const zeroX = left + ratio * (right - left);
                    ctx.save();
                    ctx.beginPath();
                    ctx.lineWidth = 1.5;
                    ctx.strokeStyle = 'rgba(220, 53, 69, 0.6)';
                    ctx.setLineDash([4, 4]);
                    ctx.moveTo(zeroX, top);
                    ctx.lineTo(zeroX, bottom);
                    ctx.stroke();
                    ctx.restore();
                }
            }
        }],
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
        end_date: resultData.end_date || '',
        symbol: resultData.symbol || ''
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

// =========================
// 数据管理辅助函数
// =========================

async function uploadDataFile(input) {
    if (!input.files || input.files.length === 0) return;
    
    const file = input.files[0];
    const formData = new FormData();
    formData.append('file', file);
    
    showAlert('正在上传文件...', 'info');
    
    const { ok, data } = await apiRequest('/api/data/files', {
        method: 'POST',
        body: formData
    });
    
    if (ok) {
        showAlert('文件上传成功', 'success');
        loadDataFiles();
    } else {
        showAlert(data.error || '上传失败', 'danger');
    }
    input.value = ''; // 清空选择
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

