/**
 * DeltaFStation 公共工具函数 (common.js)
 *
 * 模块顺序：
 *   1. 基础工具：DOM 辅助、全局悬浮提示
 *   2. 通用请求与格式化：apiRequest / formatXXX
 *   3. 表格空状态渲染
 *   4. 策略管理辅助函数：查看 / 下载 / 上传 / 删除 / 按钮状态
 */

// ========== 1. 基础工具：DOM & 全局提示 ==========

/** DOM 辅助：按 id 获取元素。 */
const $ = id => document.getElementById(id);

/** 全局悬浮提示：左上 logo 右侧浮层，不挤占页面布局。 */
function showAlert(message, type = 'info') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show mb-2 shadow-sm`;
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="关闭"></button>
    `;

    // 悬浮容器：页面左上方、靠近 logo 右侧，避免撑开主内容高度
    let container = document.getElementById('globalAlertContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'globalAlertContainer';
        container.style.position = 'fixed';
        container.style.top = '16px';
        container.style.left = '220px';              // 约略在 DeltaFStation logo 右侧
        container.style.zIndex = '1080';
        container.style.display = 'flex';
        container.style.flexDirection = 'row';       // 多个提示横向叠加
        container.style.gap = '8px';
        container.style.maxWidth = 'calc(100vw - 240px)';
        container.style.width = 'auto';
        container.style.pointerEvents = 'none';    // 点击透传，单个 alert 再开启 pointer events
        (document.body || document.documentElement).appendChild(container);
    }

    alertDiv.style.pointerEvents = 'auto';
    container.appendChild(alertDiv);

    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.remove();
        }
    }, 3000);
}

// ========== 2. 通用请求与格式化 ==========

/** 统一封装 fetch 请求，返回 { ok, data, response }。 */
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

/** 格式化文件大小（Bytes / KB / MB / GB）。 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/** 格式化时间（仅时间部分），无效时回退原字符串。 */
function formatTime(dateString) {
    if (!dateString) return '--:--:--';
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return dateString;
        return date.toLocaleTimeString();
    } catch (e) {
        return dateString;
    }
}

/** 格式化日期时间（日期 + 时间），无效时回退原字符串。 */
function formatDateTime(dateString) {
    if (!dateString) return '';
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return dateString;
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    } catch (e) {
        return dateString;
    }
}

// ========== 3. 表格空状态渲染 ==========

/** 统一表格空状态行 HTML 生成。 */
function renderEmptyState(colspan, icon, text) {
    return `<tr><td colspan="${colspan}" class="text-center text-muted py-5"><i class="fas ${icon} fa-2x mb-3" style="opacity: 0.3;"></i><div>${text}</div></td></tr>`;
}

// ========== 4. 策略管理公共函数 ==========

/** 查看当前选中的策略源码并弹出 Modal。 */
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

/** 下载当前选中的策略文件。 */
function downloadCurrentStrategy() {
    const strategyId = getSelectedStrategyId();
    if (!strategyId) {
        showAlert('请先选择一个策略', 'warning');
        return;
    }
    window.location.href = `/api/strategies/${strategyId}?action=download`;
}

/** 上传本地策略脚本（仅 .py），成功后刷新列表。 */
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

/** 删除当前选中的策略，确认后调用 DELETE 接口。 */
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

/** 获取当前页面选中的策略 ID（兼容回测页 / 运行页）。 */
function getSelectedStrategyId() {
    const backtestSelect = $('backtestStrategySelect');
    if (backtestSelect) return backtestSelect.value;
    
    const runSelect = $('runStrategySelect');
    if (runSelect) return runSelect.value;
    
    return null;
}

/** 根据是否选中策略，控制查看/下载/删除按钮显隐。 */
function updateStrategyActionButtons(strategyId) {
    const actions = ['btnViewStrategy', 'btnDownloadStrategy', 'btnDeleteStrategy'];
    actions.forEach(id => {
        const btn = $(id);
        if (btn) {
            btn.style.display = strategyId ? 'inline-block' : 'none';
        }
    });
}
