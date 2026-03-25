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

from backend.core.agent.tools.fun_tools import handle_fun_station_tip

ToolHandler = Callable[[Dict[str, Any]], str]

_FUN_STATION_TIP = "get_fun_station_tip"


AGENT_TOOLS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": _FUN_STATION_TIP,
            "description": "抽签工具（今日一签/抽签/卦签）。每次都会随机抽签。工具返回：日期、卦象档位、签文原文与一行简短趣味解读（解读：...）。",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
]


TOOLS_MAP: Dict[str, ToolHandler] = {
    _FUN_STATION_TIP: handle_fun_station_tip,
}


__all__ = [
    "AGENT_TOOLS",
    "TOOLS_MAP",
    "ToolHandler",
    "handle_fun_station_tip",
]

