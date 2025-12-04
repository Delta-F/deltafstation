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

