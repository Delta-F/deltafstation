"""
LLM 客户端

OpenAI 兼容 API 封装，支持 DeepSeek、OpenAI、通义、Azure 等。
参数由调用方从 config 传入，timeout/max_retries 由 SDK 内置处理。
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from openai import OpenAI


class LLMClient:
    """OpenAI 兼容 API 客户端，可配置任意 provider。"""

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = "",
        model: str = "",
    ) -> None:
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
