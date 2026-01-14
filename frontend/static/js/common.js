// DeltaFStation 公共工具函数

// DOM 辅助函数
const $ = id => document.getElementById(id);

// 显示警告/提示消息
function showAlert(message, type = 'info') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    const container = document.querySelector('.container-fluid');
    if (container) {
        container.insertBefore(alertDiv, container.firstChild);
    }
    
    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.remove();
        }
    }, 3000);
}

// 格式化日期时间
function formatDateTime(dateString) {
    if (!dateString) return '--:--:--';
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return dateString;
        return date.toLocaleTimeString();
    } catch (e) {
        return dateString;
    }
}

// 格式化日期时间（完整格式，用于策略页面）
function formatDateTimeFull(dateString) {
    if (!dateString) return '';
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return dateString;
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    } catch (e) {
        return dateString;
    }
}

// 统一空状态显示
function renderEmptyState(colspan, icon, text) {
    return `<tr><td colspan="${colspan}" class="text-center text-muted py-5"><i class="fas ${icon} fa-2x mb-3" style="opacity: 0.3;"></i><div>${text}</div></td></tr>`;
}

// =========================
// 策略管理公共函数
// =========================

// 查看当前选中的策略源码
async function viewCurrentStrategy() {
    const strategyId = getSelectedStrategyId();
    if (!strategyId) {
        showAlert('请先选择一个策略', 'warning');
        return;
    }

    try {
        const response = await fetch(`/api/strategies/${strategyId}?action=content`);
        const data = await response.json();
        
        if (response.ok) {
            const modal = new bootstrap.Modal($('strategyCodeModal'));
            $('strategyCodeTitle').textContent = `策略源码 - ${data.filename}`;
            $('strategyCodeContent').textContent = data.content;
            modal.show();
        } else {
            showAlert(data.error || '获取源码失败', 'danger');
        }
    } catch (error) {
        console.error('Error viewing strategy:', error);
        showAlert('获取源码失败', 'danger');
    }
}

// 下载当前选中的策略
function downloadCurrentStrategy() {
    const strategyId = getSelectedStrategyId();
    if (!strategyId) {
        showAlert('请先选择一个策略', 'warning');
        return;
    }
    window.location.href = `/api/strategies/${strategyId}?action=download`;
}

// 上传策略文件
async function uploadStrategyFile(input) {
    if (!input.files || input.files.length === 0) return;
    
    const file = input.files[0];
    if (!file.name.endsWith('.py')) {
        showAlert('只允许上传 .py 策略脚本', 'warning');
        return;
    }

    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const response = await fetch('/api/strategies', {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('策略上传成功', 'success');
            // 重新加载策略列表
            if (typeof loadStrategies === 'function') {
                await loadStrategies();
            }
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

// 删除当前选中的策略
async function deleteCurrentStrategy() {
    const strategyId = getSelectedStrategyId();
    if (!strategyId) {
        showAlert('请先选择一个策略', 'warning');
        return;
    }

    if (!confirm(`确定要删除策略 ${strategyId} 吗？`)) {
        return;
    }

    try {
        const response = await fetch(`/api/strategies/${strategyId}`, {
            method: 'DELETE'
        });
        const result = await response.json();

        if (response.ok) {
            showAlert('策略已成功删除', 'success');
            // 重新加载策略列表
            if (typeof loadStrategies === 'function') {
                await loadStrategies();
            }
        } else {
            showAlert(result.error || '删除失败', 'danger');
        }
    } catch (error) {
        console.error('Delete failed:', error);
        showAlert('删除请求失败', 'danger');
    }
}

// 获取当前页面选中的策略ID (辅助函数)
function getSelectedStrategyId() {
    const backtestSelect = $('backtestStrategySelect');
    if (backtestSelect) return backtestSelect.value;
    
    const runSelect = $('runStrategySelect');
    if (runSelect) return runSelect.value;
    
    return null;
}

// 切换策略操作按钮的可见性
function updateStrategyActionButtons(strategyId) {
    const actions = ['btnViewStrategy', 'btnDownloadStrategy', 'btnDeleteStrategy'];
    actions.forEach(id => {
        const btn = $(id);
        if (btn) {
            btn.style.display = strategyId ? 'inline-block' : 'none';
        }
    });
}
