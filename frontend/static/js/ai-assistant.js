// AI 小助手 - 前端实现（模拟对话）
class AIAssistant {
    constructor() {
        this.isOpen = false;
        this.currentContext = this.detectContext();
        this.conversationHistory = [];
        this.init();
    }
    
    init() {
        this.setupElements();
        this.setupEvents();
        this.loadQuickActions();
        this.showWelcomeMessage();
    }
    
    setupElements() {
        this.btn = document.getElementById('aiAssistantBtn');
        this.window = document.getElementById('aiAssistantWindow');
        this.chatBody = document.getElementById('aiChatBody');
        this.input = document.getElementById('aiInput');
        this.sendBtn = document.getElementById('aiSendBtn');
        this.badge = document.getElementById('aiBadge');
    }
    
    setupEvents() {
        // 浮标按钮点击
        this.btn.addEventListener('click', () => this.toggleWindow());
        
        // 发送按钮
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        
        // 回车发送
        this.input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        // 最小化/关闭
        const minimizeBtn = document.getElementById('aiMinimizeBtn');
        const closeBtn = document.getElementById('aiCloseBtn');
        if (minimizeBtn) {
            minimizeBtn.addEventListener('click', () => this.minimize());
        }
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }
    }
    
    detectContext() {
        const path = window.location.pathname;
        if (path.includes('/strategy') || path.includes('backtest')) return 'backtest';
        if (path.includes('/trading') || path.includes('trader')) return 'trading';
        if (path.includes('/run') || path.includes('gostrategy')) return 'strategy_run';
        return 'home';
    }
    
    loadQuickActions() {
        const actions = this.getQuickActions();
        const container = document.getElementById('aiQuickActions');
        if (!container) return;
        
        container.innerHTML = actions.map(action => 
            `<button class="ai-quick-btn" data-action="${action.action}">${action.label}</button>`
        ).join('');
        
        container.querySelectorAll('.ai-quick-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const action = e.target.dataset.action;
                this.handleQuickAction(action);
            });
        });
    }
    
    getQuickActions() {
        const contextActions = {
            'backtest': [
                { label: '如何上传数据', action: 'help_upload' },
                { label: '策略开发指南', action: 'help_strategy' },
                { label: '回测参数说明', action: 'help_backtest_params' }
            ],
            'trading': [
                { label: '交易操作说明', action: 'help_trading' },
                { label: '账户管理', action: 'help_account' }
            ],
            'strategy_run': [
                { label: '策略运行说明', action: 'help_strategy_run' },
                { label: '监控指标', action: 'help_monitoring' }
            ],
            'home': [
                { label: '系统介绍', action: 'help_intro' },
                { label: '快速开始', action: 'help_quickstart' }
            ]
        };
        
        return contextActions[this.currentContext] || contextActions['home'];
    }
    
    showWelcomeMessage() {
        const welcomeMsg = this.getWelcomeMessage();
        this.addMessage(welcomeMsg, 'assistant');
    }
    
    getWelcomeMessage() {
        const contextMessages = {
            'backtest': '你好！我是 DeltaFStation AI 小助手。你现在在策略回测页面，我可以帮你：\n\n• 解答数据上传问题\n• 提供策略开发建议\n• 解释回测参数设置\n• 分析回测结果\n\n有什么问题随时问我！',
            'trading': '你好！我是 DeltaFStation AI 小助手。你现在在手动交易页面，我可以帮你：\n\n• 解释交易操作流程\n• 说明账户管理功能\n• 解答持仓相关问题\n• 提供交易建议\n\n有什么问题随时问我！',
            'strategy_run': '你好！我是 DeltaFStation AI 小助手。你现在在策略运行页面，我可以帮你：\n\n• 解释策略运行机制\n• 说明监控指标含义\n• 解答运行中的问题\n• 提供优化建议\n\n有什么问题随时问我！',
            'home': '你好！我是 DeltaFStation AI 小助手，可以帮你：\n\n• 解答系统使用问题\n• 提供策略开发建议\n• 分析回测结果\n• 排查错误问题\n\n有什么可以帮你的吗？'
        };
        
        return contextMessages[this.currentContext] || contextMessages['home'];
    }
    
    toggleWindow() {
        this.isOpen = !this.isOpen;
        if (this.isOpen) {
            this.window.classList.add('active');
            this.input.focus();
            this.hideBadge();
        } else {
            this.window.classList.remove('active');
        }
    }
    
    minimize() {
        this.isOpen = false;
        this.window.classList.remove('active');
    }
    
    close() {
        this.minimize();
    }
    
    async sendMessage() {
        const message = this.input.value.trim();
        if (!message) return;
        
        // 添加用户消息
        this.addMessage(message, 'user');
        this.input.value = '';
        this.sendBtn.disabled = true;
        
        // 显示加载
        const loadingId = this.showLoading();
        
        // 模拟AI回复延迟
        setTimeout(() => {
            const response = this.generateResponse(message);
            this.hideLoading(loadingId);
            this.addMessage(response.text, 'assistant', response.actions);
            this.sendBtn.disabled = false;
        }, 800 + Math.random() * 500); // 模拟网络延迟
    }
    
    generateResponse(message) {
        const msgLower = message.toLowerCase();
        
        // 关键词匹配规则
        const responses = {
            // 上传数据相关
            upload: {
                keywords: ['上传', '数据', 'csv', '文件', '导入'],
                response: `**上传数据有两种方式：**\n\n1. **上传 CSV 文件**\n   - 点击"上传数据"按钮\n   - 选择包含 Date, Open, High, Low, Close, Volume 列的 CSV 文件\n   - 系统会自动验证格式并保存\n\n2. **从 Yahoo Finance 下载**\n   - 输入股票代码（如 AAPL）\n   - 选择时间周期（1y, 6m 等）\n   - 点击下载即可自动获取数据\n\n需要我帮你具体操作吗？`
            },
            
            // 策略开发相关
            strategy: {
                keywords: ['策略', '开发', '编写', '代码', '如何写', '怎么开发'],
                response: `**开发量化策略的步骤：**\n\n1. **创建策略文件**\n   - 在 \`data/strategies/\` 目录下创建 \`.py\` 文件\n   - 继承 \`deltafq.BaseStrategy\` 类\n\n2. **实现策略逻辑**\n\`\`\`python\nfrom deltafq.strategy.base import BaseStrategy\n\nclass MyStrategy(BaseStrategy):\n    def on_bar(self, bar):\n        # 策略逻辑\n        if 条件:\n            self.buy()\n\`\`\`\n\n3. **运行回测验证**\n   - 选择策略和数据\n   - 设置参数后运行回测\n\n需要我提供一个完整的策略示例吗？`
            },
            
            // 回测参数相关
            backtest: {
                keywords: ['回测', '参数', '初始资金', '手续费', 'commission'],
                response: `**回测参数说明：**\n\n• **初始资金**：回测开始时的账户资金，默认 100,000\n• **手续费率**：每次交易的手续费比例，默认 0.1%（0.001）\n• **开始日期**：回测数据的起始日期\n• **结束日期**：回测数据的结束日期\n\n**建议设置：**\n- 初始资金根据实际需求设置\n- 手续费率建议设置为 0.1% - 0.3%\n- 日期范围建议至少包含 1 年数据\n\n还有其他问题吗？`
            },
            
            // 交易操作相关
            trading: {
                keywords: ['交易', '买卖', '买入', '卖出', '下单', '操作'],
                response: `**手动交易操作说明：**\n\n1. **创建账户**\n   - 设置初始资金和手续费率\n   - 点击"创建账户"开始交易\n\n2. **执行交易**\n   - 选择交易标的（股票代码）\n   - 输入交易数量\n   - 点击"买入"或"卖出"按钮\n\n3. **查看持仓**\n   - 在持仓列表中查看当前持仓\n   - 实时查看盈亏情况\n\n4. **交易记录**\n   - 查看历史交易记录\n   - 分析交易表现\n\n需要更详细的说明吗？`
            },
            
            // 账户管理相关
            account: {
                keywords: ['账户', '资金', '余额', '持仓', '资产'],
                response: `**账户管理功能：**\n\n• **账户总览**：查看总资产、可用资金、持仓市值\n• **持仓管理**：查看当前持仓、盈亏情况\n• **交易记录**：查看历史交易明细\n• **资产曲线**：可视化资产变化趋势\n\n**注意事项：**\n- 每次交易会扣除手续费\n- 持仓盈亏实时计算\n- 可以随时查看账户状态\n\n有什么具体问题吗？`
            },
            
            // 策略运行相关
            run: {
                keywords: ['运行', '启动', '执行策略', '自动交易'],
                response: `**策略运行说明：**\n\n1. **选择策略**\n   - 从策略列表中选择要运行的策略\n   - 确保策略文件在 \`data/strategies/\` 目录下\n\n2. **配置参数**\n   - 设置初始资金、手续费率等\n   - 选择交易标的（可选）\n\n3. **启动运行**\n   - 点击"启动策略"开始自动交易\n   - 系统会实时执行策略信号\n\n4. **监控运行**\n   - 查看实时资产曲线\n   - 监控交易日志\n   - 查看策略状态\n\n需要我解释某个具体步骤吗？`
            },
            
            // 监控相关
            monitor: {
                keywords: ['监控', '指标', '状态', '日志', '查看'],
                response: `**策略监控指标：**\n\n• **运行状态**：显示策略是否正在运行\n• **资产曲线**：实时显示账户资产变化\n• **交易日志**：记录所有交易信号和执行情况\n• **持仓信息**：当前持仓的详细信息\n• **绩效指标**：收益率、夏普比率等\n\n**监控建议：**\n- 定期查看资产曲线变化\n- 关注交易日志中的异常\n- 对比策略表现与预期\n\n还有其他问题吗？`
            },
            
            // 系统介绍
            intro: {
                keywords: ['介绍', '是什么', '功能', '系统'],
                response: `**DeltaFStation 简介：**\n\nDeltaFStation 是一个基于 Web 的量化交易系统，专注于策略回测、仿真交易与实时监控。\n\n**核心功能：**\n\n1. **策略回测**\n   - 历史数据回测\n   - 绩效指标分析\n   - 可视化结果展示\n\n2. **手动交易**\n   - 仿真账户管理\n   - 手动买卖操作\n   - 持仓跟踪\n\n3. **策略运行**\n   - 自动交易执行\n   - 实时监控\n   - 信号执行\n\n**技术栈：**\n- 后端：Flask, Pandas, deltafq\n- 前端：Bootstrap 5, Chart.js\n\n想了解哪个功能的具体使用方法？`
            },
            
            // 快速开始
            quickstart: {
                keywords: ['快速开始', '入门', '新手', '第一次', '怎么用'],
                response: `**快速开始指南：**\n\n**第一步：准备数据**\n1. 上传 CSV 数据文件，或\n2. 从 Yahoo Finance 下载数据\n\n**第二步：创建策略**\n1. 在 \`data/strategies/\` 目录创建策略文件\n2. 继承 \`BaseStrategy\` 类并实现策略逻辑\n\n**第三步：运行回测**\n1. 选择策略和数据\n2. 设置回测参数\n3. 查看回测结果\n\n**第四步：开始交易**\n1. 创建仿真账户\n2. 手动交易或启动策略自动交易\n3. 监控交易表现\n\n需要我详细解释某个步骤吗？`
            },
            
            // 错误排查
            error: {
                keywords: ['错误', '失败', '问题', '报错', '异常', '为什么'],
                response: `**常见问题排查：**\n\n**回测失败：**\n- 检查数据文件格式是否正确\n- 确认策略文件语法无误\n- 查看浏览器控制台错误信息\n\n**策略无法加载：**\n- 确认策略文件在正确目录\n- 检查策略类是否继承 BaseStrategy\n- 验证策略文件语法\n\n**交易执行失败：**\n- 检查账户资金是否充足\n- 确认交易参数设置正确\n- 查看交易日志了解详情\n\n**数据问题：**\n- 确认 CSV 包含必需列：Date, Open, High, Low, Close, Volume\n- 检查数据日期格式\n- 验证数据完整性\n\n具体遇到了什么问题？告诉我详细情况，我可以帮你分析。`
            }
        };
        
        // 匹配关键词
        for (const [key, rule] of Object.entries(responses)) {
            if (rule.keywords.some(kw => msgLower.includes(kw))) {
                return {
                    text: rule.response,
                    actions: []
                };
            }
        }
        
        // 默认回复
        const defaultResponses = [
            `我理解你的问题："${message}"\n\n根据当前页面（${this.getContextName()}），我可以帮你：\n\n• 解答系统使用问题\n• 提供策略开发建议\n• 分析回测结果\n• 排查错误问题\n\n请告诉我具体需要什么帮助？或者点击下方的快捷按钮快速开始。`,
            `关于"${message}"，我可以提供以下帮助：\n\n• 系统使用指南\n• 策略开发教程\n• 回测参数说明\n• 交易操作指导\n\n你可以尝试问：\n- "如何上传数据？"\n- "怎么开发策略？"\n- "回测参数怎么设置？"\n\n或者点击快捷按钮获取帮助。`,
            `这个问题我需要更多信息。你可以：\n\n1. 点击下方的快捷按钮获取相关帮助\n2. 尝试更具体的问题描述\n3. 告诉我你当前遇到的具体问题\n\n我会尽力帮你解决！`
        ];
        
        return {
            text: defaultResponses[Math.floor(Math.random() * defaultResponses.length)],
            actions: []
        };
    }
    
    getContextName() {
        const names = {
            'backtest': '策略回测页面',
            'trading': '手动交易页面',
            'strategy_run': '策略运行页面',
            'home': '主页'
        };
        return names[this.currentContext] || '当前页面';
    }
    
    addMessage(content, type, actions = null) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `ai-message ai-${type}-msg`;
        
        const avatar = document.createElement('div');
        avatar.className = 'ai-avatar';
        avatar.innerHTML = type === 'user' ? '<i class="fas fa-user"></i>' : '<i class="fas fa-robot"></i>';
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'ai-content';
        contentDiv.innerHTML = this.formatMessage(content);
        
        messageDiv.appendChild(avatar);
        messageDiv.appendChild(contentDiv);
        
        this.chatBody.appendChild(messageDiv);
        this.scrollToBottom();
        
        // 记录对话历史
        this.conversationHistory.push({ type, content });
    }
    
    formatMessage(text) {
        // Markdown 处理
        let html = text
            // 代码块
            .replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
                return `<pre><code>${this.escapeHtml(code.trim())}</code></pre>`;
            })
            // 行内代码
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            // 粗体
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            // 斜体
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            // 换行
            .replace(/\n/g, '<br>');
        
        return html;
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    showLoading() {
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'ai-message ai-assistant-msg';
        loadingDiv.id = 'ai-loading';
        
        const avatar = document.createElement('div');
        avatar.className = 'ai-avatar';
        avatar.innerHTML = '<i class="fas fa-robot"></i>';
        
        const content = document.createElement('div');
        content.className = 'ai-content';
        content.innerHTML = '<div class="ai-loading"><span></span><span></span><span></span></div>';
        
        loadingDiv.appendChild(avatar);
        loadingDiv.appendChild(content);
        this.chatBody.appendChild(loadingDiv);
        this.scrollToBottom();
        
        return 'ai-loading';
    }
    
    hideLoading(id) {
        const loading = document.getElementById(id);
        if (loading) loading.remove();
    }
    
    scrollToBottom() {
        this.chatBody.scrollTop = this.chatBody.scrollHeight;
    }
    
    handleQuickAction(action) {
        const actions = {
            'help_upload': '如何上传数据？',
            'help_strategy': '如何开发策略？',
            'help_backtest_params': '回测参数怎么设置？',
            'help_trading': '如何进行手动交易？',
            'help_account': '如何管理账户？',
            'help_strategy_run': '如何运行策略？',
            'help_monitoring': '如何监控策略？',
            'help_intro': 'DeltaFStation 是什么？',
            'help_quickstart': '如何快速开始？'
        };
        
        if (actions[action]) {
            this.input.value = actions[action];
            this.sendMessage();
        }
    }
    
    hideBadge() {
        if (this.badge) {
            this.badge.classList.add('hidden');
            this.badge.textContent = '0';
        }
    }
    
    showBadge(count) {
        if (this.badge) {
            this.badge.classList.remove('hidden');
            this.badge.textContent = count > 99 ? '99+' : count.toString();
        }
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    // 确保元素存在后再初始化
    if (document.getElementById('aiAssistantBtn')) {
        window.aiAssistant = new AIAssistant();
    }
});

