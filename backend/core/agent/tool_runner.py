"""
Tool runner (multi-round function calling loop).

流程：
1. 让模型生成 `tool_calls`
2. 按 `TOOLS_MAP` 执行本地工具 handler
3. 把工具返回作为 `role=tool` 追加到 messages
4. 重复到模型输出纯文本
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from backend.core.agent.llm_client import LLMClient
from backend.core.agent.tool_registry import (
    AGENT_TOOLS,
    TOOLS_MAP,
    ToolHandler,
    handle_fun_station_tip,
)

DEFAULT_MAX_ROUNDS = 5


def _assistant_message_dict(msg: Any) -> Dict[str, Any]:
    """把 SDK assistant message 转成 messages 结构。"""
    out: Dict[str, Any] = {"role": "assistant", "content": msg.content}
    if msg.tool_calls:
        out["tool_calls"] = [
            {
                "id": tc.id,
                "type": "function",
                "function": {
                    "name": tc.function.name,
                    "arguments": tc.function.arguments or "",
                },
            }
            for tc in msg.tool_calls
        ]
    return out


def _run_tool(name: str, arguments_json: str, handlers: Dict[str, ToolHandler]) -> str:
    """执行一个工具 handler，并把结果序列化为字符串。"""
    if name not in handlers:
        return json.dumps({"error": f"unknown tool: {name}"}, ensure_ascii=False)
    try:
        args = json.loads(arguments_json or "{}")
    except json.JSONDecodeError as e:
        return json.dumps({"error": f"invalid JSON: {e}"}, ensure_ascii=False)
    if not isinstance(args, dict):
        return json.dumps({"error": "tool arguments must be a JSON object"}, ensure_ascii=False)
    try:
        return handlers[name](args)
    except Exception as e:  # noqa: BLE001
        return json.dumps({"error": str(e)}, ensure_ascii=False)


def run_chat_with_tools(
    client: LLMClient,
    messages: List[Dict[str, Any]],
    *,
    tools: List[Dict[str, Any]],
    tool_handlers: Dict[str, ToolHandler],
    max_rounds: int = DEFAULT_MAX_ROUNDS,
    temperature: float = 0.2,
    tool_choice: Optional[str] = "auto",
) -> str:
    """多轮工具调用，返回最终 assistant 文本。"""
    msgs = [dict(m) for m in messages]

    for _ in range(max_rounds):
        response = client.chat_completion(
            msgs,
            tools=tools,
            tool_choice=tool_choice,
            temperature=temperature,
        )
        msg = response.choices[0].message
        msgs.append(_assistant_message_dict(msg))

        if not msg.tool_calls:
            return (msg.content or "").strip()

        for tc in msg.tool_calls:
            out = _run_tool(tc.function.name, tc.function.arguments or "", tool_handlers)
            msgs.append({"role": "tool", "tool_call_id": tc.id, "content": out})

    return "错误：超过最大工具调用轮数"


__all__ = [
    "AGENT_TOOLS",
    "TOOLS_MAP",
    "ToolHandler",
    "handle_fun_station_tip",
    "run_chat_with_tools",
]

