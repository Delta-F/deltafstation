"""
AI Chat API

流式对话接口，支持任意 OpenAI 兼容 LLM（通过 config 配置 base_url + api_key）。

路由:
  POST /api/ai/chat/stream

请求体:
  message   str  必填，用户输入
  context   str  可选，页面上下文 home|backtest|trading|strategy_run
  history  list  可选，近期对话 [{role, content}]，最多保留 20 条

响应 (SSE):
  data: {"delta": "..."}  逐 token
  data: [DONE]            结束
  data: {"error": "..."}  异常
"""

from __future__ import annotations

import json

from flask import (
    Blueprint, Response, current_app, jsonify, request, stream_with_context,
)

from backend.core.llm.llm_client import LLMClient

ai_bp = Blueprint("ai", __name__)


@ai_bp.route("/chat/stream", methods=["POST"])
def chat_stream():
    """流式对话：SSE 逐 token 推送，直至 [DONE]。"""
    payload = request.get_json() or {}
    message = (payload.get("message") or "").strip()
    if not message:
        return jsonify({"error": "message is required"}), 400

    context = payload.get("context") or "home"
    history = _normalize_history(payload.get("history"), max_items=20)
    client = _client_from_app()
    messages = _build_messages(context=context, client=client, history=history, message=message)

    def generate():
        try:
            for token in client.stream_chat(messages):
                yield f"data: {json.dumps({'delta': token}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"

    return Response(stream_with_context(generate()), mimetype="text/event-stream")


def _client_from_app() -> LLMClient:
    """从 Flask config 创建 LLM 客户端（LLM_API_KEY, LLM_BASE_URL, LLM_MODEL）。"""
    api_key = (current_app.config.get("LLM_API_KEY") or "").strip() or None
    base_url = (current_app.config.get("LLM_BASE_URL") or "https://api.deepseek.com/v1").strip()
    model = (current_app.config.get("LLM_MODEL") or "deepseek-chat").strip()
    return LLMClient(api_key=api_key, base_url=base_url, model=model)


def _normalize_history(history: object, max_items: int = 20) -> list:
    """校验并截断 history，仅保留最近 max_items 条有效的 user/assistant 消息。"""
    if not isinstance(history, list):
        return []
    result = []
    for item in history[-max_items:]:
        if isinstance(item, dict):
            role = (item.get("role") or "").strip()
            content = item.get("content")
            if role in ("user", "assistant", "system") and isinstance(content, str) and content.strip():
                result.append({"role": role, "content": content})
    return result


def _build_messages(*, context: str, client: LLMClient, history: list, message: str) -> list:
    """构建 messages：system prompt + history + 当前 user message。"""
    return [
        {"role": "system", "content": _system_prompt_with_model(context, model=client.model)},
        *history,
        {"role": "user", "content": message},
    ]


def _system_prompt_with_model(context: str, *, model: str) -> str:
    """system prompt 基础内容 + 模型名。"""
    return _system_prompt(context) + f"Model name: {model}\n"


def _system_prompt(context: str) -> str:
    """根据 context 生成 system prompt 基础内容（身份、约束）。"""
    ctx = (context or "home").strip().lower()
    ctx_name = {
        "backtest": "策略回测页面",
        "trading": "手动交易页面",
        "strategy_run": "策略运行页面",
        "home": "主页",
    }.get(ctx, "当前页面")

    return (
        f"You are DeltaFStation AI assistant. Context: {ctx_name}.\n"
        "- Use only DeltaFStation concepts and this project's APIs.\n"
        "- Be concise. Refuse real-money trades; simulation only.\n"
        "- If uncertain, ask. Answer model name truthfully when asked.\n"
    )
