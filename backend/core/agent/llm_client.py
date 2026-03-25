"""
LLM Client (OpenAI-compatible)

提供两类调用：
- `stream_chat()`：流式输出 delta（用于“纯对话”）
- `chat_completion()`：非流式输出（支持携带 `tools` 做 function calling）
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from openai import OpenAI
from openai.types.chat import ChatCompletion


class LLMClient:
    """OpenAI 兼容客户端封装，可配置 provider/base_url/model。"""

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = "",
        model: str = "",
    ) -> None:
        """初始化客户端：保存配置并延迟创建 OpenAI SDK 实例。"""
        self.model = (model or "").strip()
        self.api_key = (api_key or "").strip() or None
        self.base_url = (base_url or "").strip()
        self._client: Optional[OpenAI] = None

    def stream_chat(
        self,
        messages: List[Dict[str, Any]],
        *,
        temperature: float = 0.2,
    ):
        """流式对话，逐段 yield 文本 delta。"""
        client = self._get_client()
        stream = client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=temperature,
            stream=True,
        )
        for event in stream:
            text = getattr(event.choices[0].delta, "content", None)
            if text:
                yield text

    def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        *,
        temperature: float = 0.2,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[str] = "auto",
    ) -> ChatCompletion:
        """非流式对话。

        当传入 `tools` 时，模型可能触发 function calling（tool_calls）。
        """
        client = self._get_client()
        kwargs: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
        }
        if tools is not None:
            kwargs["tools"] = tools
            if tool_choice is not None:
                kwargs["tool_choice"] = tool_choice
        return client.chat.completions.create(**kwargs)

    def _get_client(self) -> OpenAI:
        """懒加载创建 OpenAI 客户端。"""
        if self._client is not None:
            return self._client
        if not self.api_key:
            raise RuntimeError("请配置 LLM_API_KEY（config 或环境变量）")
        self._client = OpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
            timeout=60.0,
            max_retries=2,
        )
        return self._client

