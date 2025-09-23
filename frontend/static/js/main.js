// DeltaFStation 主页面JavaScript

// 全局变量
let currentSimulation = null;
let updateInterval = null;

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    loadDashboardData();
    loadActivities();
    
    // 设置自动刷新
    updateInterval = setInterval(() => {
        loadDashboardData();
        loadActivities();
    }, 30000); // 每30秒刷新一次
});

// 加载仪表板数据
async function loadDashboardData() {
    try {
        // 加载策略数量
        const strategiesResponse = await fetch('/api/strategy/list');
        const strategiesData = await strategiesResponse.json();
        document.getElementById('totalStrategies').textContent = strategiesData.strategies.length;
        
        // 加载活跃仿真数量
        const simulationsResponse = await fetch('/api/simulation/list');
        const simulationsData = await simulationsResponse.json();
        const activeSimulations = simulationsData.simulations.filter(s => s.status === 'running').length;
        document.getElementById('activeSimulations').textContent = activeSimulations;
        
        // 加载回测结果统计
        const backtestResponse = await fetch('/api/backtest/results');
        const backtestData = await backtestResponse.json();
        
        let totalTrades = 0;
        let totalReturn = 0;
        
        if (backtestData.results.length > 0) {
            totalTrades = backtestData.results.reduce((sum, result) => sum + (result.total_trades || 0), 0);
            const latestResult = backtestData.results[0];
            totalReturn = latestResult.total_return ? (latestResult.total_return * 100).toFixed(2) : 0;
        }
        
        document.getElementById('totalTrades').textContent = totalTrades;
        document.getElementById('totalReturn').textContent = totalReturn + '%';
        
    } catch (error) {
        console.error('Error loading dashboard data:', error);
        showAlert('加载仪表板数据失败', 'danger');
    }
}

// 加载最近活动
async function loadActivities() {
    try {
        const activitiesList = document.getElementById('activitiesList');
        
        // 获取策略、回测和仿真数据
        const [strategiesRes, backtestRes, simulationsRes] = await Promise.all([
            fetch('/api/strategy/list'),
            fetch('/api/backtest/results'),
            fetch('/api/simulation/list')
        ]);
        
        const strategies = await strategiesRes.json();
        const backtests = await backtestRes.json();
        const simulations = await simulationsRes.json();
        
        // 合并活动数据
        const activities = [];
        
        // 添加策略活动
        strategies.strategies.forEach(strategy => {
            activities.push({
                type: 'strategy',
                title: `创建策略: ${strategy.name}`,
                time: strategy.created_at,
                icon: 'fas fa-cogs',
                color: 'primary'
            });
        });
        
        // 添加回测活动
        backtests.results.forEach(backtest => {
            activities.push({
                type: 'backtest',
                title: `完成回测: ${backtest.strategy_id}`,
                time: backtest.created_at,
                icon: 'fas fa-chart-bar',
                color: 'success'
            });
        });
        
        // 添加仿真活动
        simulations.simulations.forEach(simulation => {
            activities.push({
                type: 'simulation',
                title: `${simulation.status === 'running' ? '启动' : '停止'}仿真: ${simulation.strategy_id}`,
                time: simulation.created_at,
                icon: 'fas fa-exchange-alt',
                color: simulation.status === 'running' ? 'info' : 'warning'
            });
        });
        
        // 按时间排序
        activities.sort((a, b) => new Date(b.time) - new Date(a.time));
        
        // 显示最近10个活动
        const recentActivities = activities.slice(0, 10);
        
        if (recentActivities.length === 0) {
            activitiesList.innerHTML = '<div class="empty-state"><i class="fas fa-history"></i><p>暂无活动记录</p></div>';
        } else {
            activitiesList.innerHTML = recentActivities.map(activity => `
                <div class="d-flex align-items-center mb-2">
                    <i class="fas ${activity.icon} text-${activity.color} me-3"></i>
                    <div class="flex-grow-1">
                        <div class="fw-bold">${activity.title}</div>
                        <small class="text-muted">${formatDateTime(activity.time)}</small>
                    </div>
                </div>
            `).join('');
        }
        
    } catch (error) {
        console.error('Error loading activities:', error);
        document.getElementById('activitiesList').innerHTML = '<div class="text-center text-muted">加载活动失败</div>';
    }
}

// 显示数据上传模态框
function showDataUpload() {
    const modal = new bootstrap.Modal(document.getElementById('dataUploadModal'));
    modal.show();
}

// 显示策略创建模态框
function showStrategyCreate() {
    const modal = new bootstrap.Modal(document.getElementById('strategyCreateModal'));
    modal.show();
}

// 显示回测运行模态框
async function showBacktestRun() {
    try {
        // 加载策略和数据文件列表
        const [strategiesRes, dataRes] = await Promise.all([
            fetch('/api/strategy/list'),
            fetch('/api/data/list')
        ]);
        
        const strategies = await strategiesRes.json();
        const dataFiles = await dataRes.json();
        
        // 填充策略选择
        const strategySelect = document.getElementById('backtestStrategy');
        strategySelect.innerHTML = '<option value="">请选择策略</option>';
        strategies.strategies.forEach(strategy => {
            strategySelect.innerHTML += `<option value="${strategy.id}">${strategy.name}</option>`;
        });
        
        // 填充数据文件选择
        const dataSelect = document.getElementById('backtestData');
        dataSelect.innerHTML = '<option value="">请选择数据文件</option>';
        dataFiles.files.forEach(file => {
            dataSelect.innerHTML += `<option value="${file.filename}">${file.filename}</option>`;
        });
        
        // 设置默认日期
        const today = new Date();
        const oneYearAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
        document.getElementById('startDate').value = oneYearAgo.toISOString().split('T')[0];
        document.getElementById('endDate').value = today.toISOString().split('T')[0];
        
        const modal = new bootstrap.Modal(document.getElementById('backtestRunModal'));
        modal.show();
        
    } catch (error) {
        console.error('Error loading backtest data:', error);
        showAlert('加载回测数据失败', 'danger');
    }
}

// 显示仿真启动模态框
async function showSimulationStart() {
    try {
        // 加载策略列表
        const strategiesRes = await fetch('/api/strategy/list');
        const strategies = await strategiesRes.json();
        
        // 填充策略选择
        const strategySelect = document.getElementById('simulationStrategy');
        strategySelect.innerHTML = '<option value="">请选择策略</option>';
        strategies.strategies.forEach(strategy => {
            strategySelect.innerHTML += `<option value="${strategy.id}">${strategy.name}</option>`;
        });
        
        const modal = new bootstrap.Modal(document.getElementById('simulationStartModal'));
        modal.show();
        
    } catch (error) {
        console.error('Error loading simulation data:', error);
        showAlert('加载仿真数据失败', 'danger');
    }
}

// 上传数据文件
async function uploadData() {
    const fileInput = document.getElementById('dataFile');
    const file = fileInput.files[0];
    
    if (!file) {
        showAlert('请选择文件', 'warning');
        return;
    }
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const response = await fetch('/api/data/upload', {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('文件上传成功', 'success');
            bootstrap.Modal.getInstance(document.getElementById('dataUploadModal')).hide();
            fileInput.value = '';
            loadActivities();
        } else {
            showAlert(result.error || '上传失败', 'danger');
        }
        
    } catch (error) {
        console.error('Error uploading file:', error);
        showAlert('上传失败', 'danger');
    }
}

// 创建策略
async function createStrategy() {
    const name = document.getElementById('strategyName').value;
    const type = document.getElementById('strategyType').value;
    const description = document.getElementById('strategyDescription').value;
    
    if (!name || !type) {
        showAlert('请填写必填字段', 'warning');
        return;
    }
    
    try {
        const response = await fetch('/api/strategy/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name,
                type,
                description,
                parameters: {},
                rules: []
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('策略创建成功', 'success');
            bootstrap.Modal.getInstance(document.getElementById('strategyCreateModal')).hide();
            document.getElementById('strategyCreateForm').reset();
            loadActivities();
        } else {
            showAlert(result.error || '创建失败', 'danger');
        }
        
    } catch (error) {
        console.error('Error creating strategy:', error);
        showAlert('创建失败', 'danger');
    }
}

// 运行回测
async function runBacktest() {
    const strategyId = document.getElementById('backtestStrategy').value;
    const dataFile = document.getElementById('backtestData').value;
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    const initialCapital = document.getElementById('initialCapital').value;
    const commission = document.getElementById('commission').value;
    const slippage = document.getElementById('slippage').value;
    
    if (!strategyId || !dataFile || !startDate || !endDate) {
        showAlert('请填写必填字段', 'warning');
        return;
    }
    
    try {
        const response = await fetch('/api/backtest/run', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                strategy_id: strategyId,
                data_file: dataFile,
                start_date: startDate,
                end_date: endDate,
                initial_capital: parseFloat(initialCapital),
                commission: parseFloat(commission),
                slippage: parseFloat(slippage)
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('回测运行成功', 'success');
            bootstrap.Modal.getInstance(document.getElementById('backtestRunModal')).hide();
            loadActivities();
        } else {
            showAlert(result.error || '回测失败', 'danger');
        }
        
    } catch (error) {
        console.error('Error running backtest:', error);
        showAlert('回测失败', 'danger');
    }
}

// 启动仿真
async function startSimulation() {
    const strategyId = document.getElementById('simulationStrategy').value;
    const initialCapital = document.getElementById('simulationCapital').value;
    
    if (!strategyId || !initialCapital) {
        showAlert('请填写必填字段', 'warning');
        return;
    }
    
    try {
        const response = await fetch('/api/simulation/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                strategy_id: strategyId,
                initial_capital: parseFloat(initialCapital),
                commission: 0.001,
                slippage: 0.0005
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('仿真启动成功', 'success');
            bootstrap.Modal.getInstance(document.getElementById('simulationStartModal')).hide();
            currentSimulation = result.simulation_id;
            loadActivities();
        } else {
            showAlert(result.error || '启动失败', 'danger');
        }
        
    } catch (error) {
        console.error('Error starting simulation:', error);
        showAlert('启动失败', 'danger');
    }
}

// 刷新活动
function refreshActivities() {
    loadActivities();
}

// 显示警告消息
function showAlert(message, type = 'info') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    // 插入到页面顶部
    const container = document.querySelector('.container-fluid');
    container.insertBefore(alertDiv, container.firstChild);
    
    // 3秒后自动消失
    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.remove();
        }
    }, 3000);
}

// 格式化日期时间
function formatDateTime(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) { // 1分钟内
        return '刚刚';
    } else if (diff < 3600000) { // 1小时内
        return Math.floor(diff / 60000) + '分钟前';
    } else if (diff < 86400000) { // 1天内
        return Math.floor(diff / 3600000) + '小时前';
    } else {
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }
}

// 页面卸载时清理定时器
window.addEventListener('beforeunload', function() {
    if (updateInterval) {
        clearInterval(updateInterval);
    }
});
