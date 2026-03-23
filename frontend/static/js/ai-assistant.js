/**
 * AI 智能助手核心逻辑 (ai-assistant.js)
 * 
 * 模块顺序：CONSTANTS → state → storage → context → chat → ui → events → init
 *   CONSTANTS  常量定义（存储键名、动画时间等）
 *   state      全局状态管理（打开状态、对话历史、当前上下文）
 *   storage    持久化存储逻辑（LocalStorage 操作）
 *   context    环境感知逻辑（页面路径检测）
 *   chat       对话核心逻辑（消息发送、模拟回复生成、Markdown 格式化）
 *   ui         界面控制逻辑（窗口开关、自动滚动、加载动画、Toast 提示）
 *   events     事件绑定逻辑（按钮点击、键盘回车）
 *   init       初始化入口
 */

const AIAssistantApp = {
    /** 全局常量定义 */
    CONSTANTS: {
        STORAGE_KEY: 'ai_conversation_history',
        OPEN_STATE_KEY: 'ai_assistant_open',
        MAX_HISTORY: 100
    },

    /** 全局状态 */
    state: {
        isOpen: false,
        currentContext: 'home',
        conversationHistory: [],
        elements: {} // 存放 DOM 引用
    },

    /** 持久化存储模块 */
    storage: {
        /** 保存对话历史到 LocalStorage */
        save() {
            // 限制历史记录数量，防止存储溢出
            const history = AIAssistantApp.state.conversationHistory.slice(-AIAssistantApp.CONSTANTS.MAX_HISTORY);
            localStorage.setItem(AIAssistantApp.CONSTANTS.STORAGE_KEY, JSON.stringify(history));
        },

        /** 从 LocalStorage 加载对话历史 */
        load() {
            const saved = localStorage.getItem(AIAssistantApp.CONSTANTS.STORAGE_KEY);
            return saved ? JSON.parse(saved) : [];
        },

        /** 保存/读取侧边栏打开状态（sessionStorage，仅当前标签页） */
        saveOpenState(open) {
            sessionStorage.setItem(AIAssistantApp.CONSTANTS.OPEN_STATE_KEY, open ? '1' : '0');
        },
        loadOpenState() {
            return sessionStorage.getItem(AIAssistantApp.CONSTANTS.OPEN_STATE_KEY) === '1';
        },

        /** 清空所有存储的历史记录 */
        clear() {
            AIAssistantApp.state.conversationHistory = [];
            AIAssistantApp.storage.save();
            AIAssistantApp.state.elements.chatBody.innerHTML = '';
            
            // 重新显示欢迎卡片
            const welcomeCard = document.getElementById('aiWelcomeCard');
            if (welcomeCard) welcomeCard.classList.remove('hidden');
            
            AIAssistantApp.ui.showAlert('对话已清空', 'success');
        }
    },

    /** 环境感知模块 */
    context: {
        /** 根据当前页面 URL 探测功能上下文 */
        detect() {
            const path = window.location.pathname;
            if (path.includes('/strategy') || path.includes('backtest')) return 'backtest';
            if (path.includes('/trading') || path.includes('trader')) return 'trading';
            if (path.includes('/run') || path.includes('gostrategy')) return 'strategy_run';
            return 'home';
        }
    },

    /** 对话核心模块 */
    chat: {
        /** 将本地 history 映射为 OpenAI messages */
        toChatHistory(maxItems = 20) {
            const hist = AIAssistantApp.state.conversationHistory || [];
            return hist
                .slice(-maxItems)
                .filter(m => m && (m.type === 'user' || m.type === 'assistant') && typeof m.content === 'string')
                .map(m => ({ role: m.type === 'user' ? 'user' : 'assistant', content: m.content }));
        },

        /** 发送用户消息 */
        async sendMessage() {
            const input = AIAssistantApp.state.elements.input;
            const text = input.value.trim();
            if (!text) return;

            // 处理特殊命令
            if (text.toLowerCase() === '/new' || text.toLowerCase() === '/reset') {
                AIAssistantApp.storage.clear();
                input.value = '';
                return;
            }

            // 1. 添加用户消息到 UI 和状态
            AIAssistantApp.chat.addMessage(text, 'user');
            input.value = '';
            AIAssistantApp.state.elements.sendBtn.disabled = true;

            // 2. 显示加载状态
            const loadingId = AIAssistantApp.ui.showLoading();

            // 3. 调用后端 AI Chat API (stream)
            try {
                const res = await fetch('/api/ai/chat/stream', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: text,
                        context: AIAssistantApp.state.currentContext,
                        history: AIAssistantApp.chat.toChatHistory(20)
                    })
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    throw new Error(data?.error || 'AI request failed');
                }
                if (!res.body) throw new Error('No stream body');

                // 将 loading 气泡替换为可更新的 assistant 消息容器
                const loadingEl = document.getElementById(loadingId);
                let contentEl = null;
                if (loadingEl) {
                    contentEl = loadingEl.querySelector('.ai-content');
                    if (contentEl) contentEl.innerHTML = '';
                }

                const reader = res.body.getReader();
                const decoder = new TextDecoder('utf-8');
                let buf = '';
                let fullText = '';

                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    buf += decoder.decode(value, { stream: true });

                    // SSE: events separated by \n\n
                    const parts = buf.split('\n\n');
                    buf = parts.pop() || '';

                    for (const part of parts) {
                        const line = part.split('\n').find(l => l.startsWith('data: '));
                        if (!line) continue;
                        const dataStr = line.slice(6).trim();
                        if (dataStr === '[DONE]') continue;
                        let obj = null;
                        try { obj = JSON.parse(dataStr); } catch (_) { obj = null; }
                        if (obj?.error) throw new Error(obj.error);
                        const delta = obj?.delta || '';
                        if (!delta) continue;
                        fullText += delta;

                        if (contentEl) {
                            contentEl.innerHTML = AIAssistantApp.chat.formatMarkdown(fullText);
                            AIAssistantApp.ui.scrollToBottom();
                        }
                    }
                }

                // 流结束：把最终文本写入历史（避免中途逐 token 存储）
                AIAssistantApp.ui.hideLoading(loadingId);
                AIAssistantApp.chat.addMessage(fullText || '(empty response)', 'assistant');
            } catch (e) {
                AIAssistantApp.ui.hideLoading(loadingId);
                AIAssistantApp.chat.addMessage(`**请求失败：** ${e.message || e}`, 'assistant');
            } finally {
                AIAssistantApp.state.elements.sendBtn.disabled = false;
            }
        },

        /** 添加单条消息 */
        addMessage(content, type) {
            // 更新内存和存储
            AIAssistantApp.state.conversationHistory.push({ type, content });
            AIAssistantApp.storage.save();
            
            // 更新 UI
            AIAssistantApp.chat.addMessageToUI(content, type);
        },

        /** 仅渲染消息到 DOM 结构 */
        addMessageToUI(content, type) {
            const { chatBody } = AIAssistantApp.state.elements;
            
            // 隐藏欢迎卡片
            const welcomeCard = document.getElementById('aiWelcomeCard');
            if (welcomeCard) welcomeCard.classList.add('hidden');

            const messageDiv = document.createElement('div');
            messageDiv.className = `ai-message ai-${type}-msg`;

            const avatar = document.createElement('div');
            avatar.className = 'ai-avatar';
            avatar.innerHTML = type === 'user' ? '<i class="fas fa-user"></i>' : '<i class="fas fa-robot"></i>';

            const contentDiv = document.createElement('div');
            contentDiv.className = 'ai-content';
            contentDiv.innerHTML = AIAssistantApp.chat.formatMarkdown(content);

            messageDiv.appendChild(avatar);
            messageDiv.appendChild(contentDiv);
            chatBody.appendChild(messageDiv);
            
            AIAssistantApp.ui.scrollToBottom();
        },

        /** 极简 Markdown 格式化处理 */
        formatMarkdown(text) {
            return text
                .replace(/```(\w+)?\n([\s\S]*?)```/g, (m, lang, code) => `<pre><code>${AIAssistantApp.chat.escapeHtml(code.trim())}</code></pre>`)
                .replace(/`([^`]+)`/g, '<code>$1</code>')
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\n/g, '<br>');
        },

        /** HTML 字符转义，防止 XSS */
        escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    },

    /** 界面交互模块 */
    ui: {
        /** 切换侧边栏窗口开关 */
        toggleWindow() {
            const { window: win, btn } = AIAssistantApp.state.elements;
            AIAssistantApp.state.isOpen = !AIAssistantApp.state.isOpen;
            AIAssistantApp.storage.saveOpenState(AIAssistantApp.state.isOpen);

            if (AIAssistantApp.state.isOpen) {
                win.classList.add('active');
                if (btn) btn.classList.add('active');
                document.body.classList.add('ai-sidebar-open');
                AIAssistantApp.state.elements.input.focus();
            } else {
                AIAssistantApp.ui.close();
            }
        },

        /** 关闭/收起侧边栏 */
        close() {
            const { window: win, btn } = AIAssistantApp.state.elements;
            AIAssistantApp.state.isOpen = false;
            AIAssistantApp.storage.saveOpenState(false);
            if (win) win.classList.remove('active');
            if (btn) btn.classList.remove('active');
            document.body.classList.remove('ai-sidebar-open');
        },

        /** 滚动聊天区域到底部 */
        scrollToBottom() {
            const { chatBody } = AIAssistantApp.state.elements;
            if (chatBody) chatBody.scrollTop = chatBody.scrollHeight;
        },

        /** 显示加载动画 */
        showLoading() {
            const loadingId = 'ai-loading-' + Date.now();
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'ai-message ai-assistant-msg';
            loadingDiv.id = loadingId;
            loadingDiv.innerHTML = `
                <div class="ai-avatar"><i class="fas fa-robot"></i></div>
                <div class="ai-content"><div class="ai-loading"><span></span><span></span><span></span></div></div>
            `;
            AIAssistantApp.state.elements.chatBody.appendChild(loadingDiv);
            AIAssistantApp.ui.scrollToBottom();
            return loadingId;
        },

        /** 移除加载动画 */
        hideLoading(id) {
            const el = document.getElementById(id);
            if (el) el.remove();
        },

        /** 弹出 Toast 提示框 */
        showAlert(message, type = 'info') {
            const alertDiv = document.createElement('div');
            alertDiv.className = 'ai-alert-toast';
            alertDiv.style.cssText = `
                position: fixed; top: 20px; right: 20px; padding: 12px 20px;
                background: ${type === 'info' ? '#667eea' : '#28a745'};
                color: white; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                z-index: 10000; font-size: 14px; animation: slideInRight 0.3s ease;
            `;
            alertDiv.textContent = message;
            document.body.appendChild(alertDiv);
            
            setTimeout(() => {
                alertDiv.style.animation = 'slideOutRight 0.3s ease';
                setTimeout(() => alertDiv.remove(), 300);
            }, 2000);
        }
    },

    /** 事件监听模块 */
    events: {
        /** 绑定所有交互事件 */
        bindAll() {
            const { btn, input, sendBtn } = AIAssistantApp.state.elements;
            
            // 侧边栏开关
            if (btn) btn.addEventListener('click', () => AIAssistantApp.ui.toggleWindow());
            
            // 发送逻辑
            if (sendBtn) sendBtn.addEventListener('click', () => AIAssistantApp.chat.sendMessage());
            if (input) {
                input.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        AIAssistantApp.chat.sendMessage();
                    }
                });
            }

            // 头部按钮
            const closeBtn = document.getElementById('aiCloseBtn');
            const historyBtn = document.getElementById('aiHistoryBtn');
            
            if (closeBtn) closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                AIAssistantApp.ui.close();
            });
            
            if (historyBtn) historyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm('是否清空当前对话历史？')) AIAssistantApp.storage.clear();
            });

            // 快捷操作代理
            const quickActions = document.getElementById('aiQuickActions');
            if (quickActions) {
                quickActions.addEventListener('click', (e) => {
                    if (e.target.classList.contains('ai-quick-btn')) {
                        AIAssistantApp.state.elements.input.value = e.target.textContent;
                        AIAssistantApp.chat.sendMessage();
                    }
                });
            }
        }
    },

    /** 初始化入口 */
    init() {
        // 1. 获取核心 DOM 引用
        AIAssistantApp.state.elements = {
            btn: document.getElementById('aiAssistantBtn'),
            window: document.getElementById('aiAssistantWindow'),
            chatBody: document.getElementById('aiChatBody'),
            input: document.getElementById('aiInput'),
            sendBtn: document.getElementById('aiSendBtn')
        };

        if (!AIAssistantApp.state.elements.btn) return;

        // 2. 初始化状态
        AIAssistantApp.state.currentContext = AIAssistantApp.context.detect();
        AIAssistantApp.state.conversationHistory = AIAssistantApp.storage.load();

        // 3. 渲染历史记录
        if (AIAssistantApp.state.conversationHistory.length > 0) {
            AIAssistantApp.state.conversationHistory.forEach(msg => {
                AIAssistantApp.chat.addMessageToUI(msg.content, msg.type);
            });
        }

        // 4. 加载快捷操作 (模拟)
        const container = document.getElementById('aiQuickActions');
        if (container) {
            const actions = ['如何上传数据？', '怎么开发策略？', '如何快速开始？'];
            container.innerHTML = actions.map(a => `<button class="ai-quick-btn">${a}</button>`).join('');
        }

        // 5. 绑定事件
        AIAssistantApp.events.bindAll();

        // 6. 恢复打开状态（跨页面保持）
        if (AIAssistantApp.storage.loadOpenState()) {
            AIAssistantApp.state.isOpen = true;
            const { window: win, btn } = AIAssistantApp.state.elements;
            if (win) win.classList.add('active');
            if (btn) btn.classList.add('active');
            document.body.classList.add('ai-sidebar-open');
        }
    }
};

// 启动应用
document.addEventListener('DOMContentLoaded', () => AIAssistantApp.init());
