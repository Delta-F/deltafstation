---
name: Agent Backtest Skill
overview: 在 backend/core/agent/skills/ 放置回测 SKILL；按关键词将 SKILL 注入 system prompt；新增 run_backtest_auto 工具（拉数、默认 BOLLStrategy、缺失策略则写入 data/strategies 后回测）。
todos:
  - id: add-skill-md
    content: 新增 backend/core/agent/skills/backtest/SKILL.md
    status: completed
  - id: skill-prompt-loader
    content: 新增 backend/core/agent/skill_prompt.py
    status: completed
  - id: inject-ai-api
    content: 修改 backend/api/ai_api.py 注入 skill
    status: completed
  - id: backtest-auto-tool
    content: 新增 backend/core/agent/tools/backtest_auto_tools.py
    status: completed
  - id: register-tool
    content: 在 tool_registry.py 注册 run_backtest_auto
    status: completed
  - id: dedupe-result-build
    content: backtest_tools 抽取 build_backtest_brief_and_persist 复用
    status: completed
isProject: false
---

# Agent 回测 Skill + 自动拉数与策略落盘

## 目标行为

- **触发词**：当用户消息命中一组中英文关键词（如：`回测`、`backtest`、`跑策略`、`测试策略`、`strategy test` 等，维护于 [backend/core/agent/skill_prompt.py](backend/core/agent/skill_prompt.py)）时，将回测 skill 的正文追加进 **system prompt**。
- **System 日期锚定**：[backend/api/ai_api.py](backend/api/ai_api.py) 在每条对话的 system 中注入服务器本地日 `Server date (local): YYYY-MM-DD`，并说明相对区间（如「近 N 年/月」）须以此日为 `end_date`、换算出 `start_date`，向工具传 `YYYY-MM-DD`，勿凭模型训练知识猜当前年份。
- **Skill 正文约定**：[SKILL.md](backend/core/agent/skills/backtest/SKILL.md) 写明行情走 **yfinance**、`symbol` 为 yfinance ticker；相对区间与上述 **Server date** 对齐。
- **Skill 加载**：`skill_prompt` 用 `pathlib` 定位 `skills/backtest/SKILL.md`，`load_backtest_skill_markdown` 带 `@lru_cache` 进程内只读盘一次。
- **默认策略**：用户未指定策略时，使用 **`BOLLStrategy`**（与 [data/strategies/boll_strategy.py](data/strategies/boll_strategy.py) 对齐）。
- **缺失策略（写入文件）**：若用户指定的 `strategy_id` 在 [backend/core/utils/strategy_loader.py](backend/core/utils/strategy_loader.py) 中 `load_strategy_class` 找不到，则在 [data/strategies/](data/strategies/) **新建一个 `.py` 文件**，写入继承 `BaseStrategy` 的最小策略类（参考 [data/strategies/a_every2bar_flip_strategy.py](data/strategies/a_every2bar_flip_strategy.py)），然后再次 `load_strategy_class` 并执行回测。

## 架构与数据流

```mermaid
flowchart TD
  userMsg[UserMessage] --> keywordHit{BacktestKeywords}
  keywordHit -->|yes| injectSkill[AppendSkillMarkdownToSystemPrompt]
  keywordHit -->|no| basePrompt[BaseSystemPromptOnly]
  injectSkill --> llm[LLM_tool_calls]
  basePrompt --> llm
  llm --> toolAuto[run_backtest_auto_handler]
  toolAuto --> dm[DataManager_fetch_data]
  dm --> rawCsv[data_raw_SYMBOL_csv]
  toolAuto --> tryLoad[load_strategy_class]
  tryLoad -->|found| bt[BacktestEngine_run_backtest_from_file]
  tryLoad -->|missing| writePy[WriteMinimalStrategyPy]
  writePy --> tryLoad2[load_strategy_class]
  tryLoad2 --> bt
  bt --> resultJson[SameShapeAs_run_backtest]
```

## 涉及文件

| 说明 | 路径 |
|------|------|
| Skill 文档 | [backend/core/agent/skills/backtest/SKILL.md](backend/core/agent/skills/backtest/SKILL.md) |
| 关键词与加载 | [backend/core/agent/skill_prompt.py](backend/core/agent/skill_prompt.py) |
| Prompt 注入 | [backend/api/ai_api.py](backend/api/ai_api.py) |
| 自动回测工具 | [backend/core/agent/tools/backtest_auto_tools.py](backend/core/agent/tools/backtest_auto_tools.py) |
| 结果落盘与摘要复用 | [backend/core/agent/tools/backtest_tools.py](backend/core/agent/tools/backtest_tools.py)（`build_backtest_brief_and_persist`） |
| 工具注册 | [backend/core/agent/tool_registry.py](backend/core/agent/tool_registry.py)（`run_backtest_auto`） |

## 工具 `run_backtest_auto` 要点

- **入参**：`symbol` 必填；`strategy_id` 可选（缺省 `BOLLStrategy`）；可选 `start_date`、`end_date`、`initial_capital`、`commission`、`slippage`、`trade_preview_count`。
- **流程**：`DataManager.fetch_data` → `load_strategy_class`；失败则写 `data/strategies/agent_generated_*.py` → 再 `load_strategy_class` → `BacktestEngine.run_backtest_from_file`。
- **返回**：与 `run_backtest` 成功结构一致；`summary_metrics` 含 `total_trades`、`avg_trades_per_day`（总成交笔数、日均笔数，分母为净值序列 bar 数）；`extra` 字段含是否默认策略、是否生成、生成文件名、拉数状态等。

## 验证方式

- 本地调用 `handle_run_backtest_auto({'symbol':'000001.SS'})`，不传 `strategy_id`，应默认 `BOLLStrategy`。
- 指定不存在类名，应生成 `data/strategies/agent_generated_*.py` 并完成回测。
- 用户消息含「回测」等关键词时，system prompt 应包含 `Project backtest skill:` 与 SKILL 正文。

## 风险与约束

- **写入 `data/strategies/`**：类名与文件名需安全化，避免覆盖与路径遍历。
- **Windows 控制台编码**：底层 `deltafq` 日志可能含 Unicode，与 JSON 返回无关时可忽略。
