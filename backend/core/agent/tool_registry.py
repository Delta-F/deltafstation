"""
Agent 工具注册：
提供 OpenAI function schema + 本地实现（TOOLS_MAP）

新增工具：
1. 在本文件增加 handler
2. 在 AGENT_TOOLS 增加一项
3. 在 TOOLS_MAP 注册同名 key
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List

from backend.core.agent.tools.backtest_tools import handle_run_backtest
from backend.core.agent.tools.fun_tools import handle_fun_station_tip

ToolHandler = Callable[[Dict[str, Any]], str]

_FUN_STATION_TIP = "get_fun_station_tip"
_RUN_BACKTEST = "run_backtest"


TOOL_DEFINITIONS: List[Dict[str, Any]] = [
    {
        "name": _FUN_STATION_TIP,
        "handler": handle_fun_station_tip,
        "description": "抽签工具（今日一签/抽签/卦签）。每次都会随机抽签。工具返回：日期、卦象档位、签文原文与一行简短趣味解读（解读：...）。",
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": _RUN_BACKTEST,
        "handler": handle_run_backtest,
        "description": (
            "执行策略回测。优先在用户明确提出回测时调用。"
            "必填参数 strategy_id 和 data_file 支持模糊匹配："
            "strategy_id 按关键词匹配且忽略大小写；data_file 优先按投资标的代码匹配。"
            "若匹配结果不唯一，返回候选列表并要求进一步确认。"
            "成功时返回结构化模板：resolved/date_range、summary_metrics、trade_preview。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "strategy_id": {"type": "string", "description": "策略 ID 或关键词，例如 boll、every2bar"},
                "data_file": {"type": "string", "description": "数据文件名或标的代码，例如 000001.SS、000001.SS.csv"},
                "start_date": {"type": "string", "description": "可选，起始日期，建议 YYYY-MM-DD"},
                "end_date": {"type": "string", "description": "可选，结束日期，建议 YYYY-MM-DD"},
                "symbol": {"type": "string", "description": "可选，交易标的覆盖值"},
                "initial_capital": {"type": "number", "description": "可选，初始资金，默认 100000"},
                "commission": {"type": "number", "description": "可选，手续费率，默认 0.001"},
                "slippage": {"type": "number", "description": "可选，滑点率，默认 0.0005"},
                "trade_preview_count": {"type": "integer", "description": "可选，交易记录预览条数，默认 10，建议 1~50"},
            },
            "required": ["strategy_id", "data_file"],
        },
    },
]


AGENT_TOOLS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": tool["name"],
            "description": tool["description"],
            "parameters": tool["parameters"],
        },
    }
    for tool in TOOL_DEFINITIONS
]


TOOLS_MAP: Dict[str, ToolHandler] = {tool["name"]: tool["handler"] for tool in TOOL_DEFINITIONS}


__all__ = [
    "AGENT_TOOLS",
    "TOOLS_MAP",
    "TOOL_DEFINITIONS",
    "ToolHandler",
    "handle_run_backtest",
    "handle_fun_station_tip",
]

