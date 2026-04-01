from __future__ import annotations

import os
from typing import Final

BACKTEST_KEYWORDS: Final[tuple[str, ...]] = (
    "回测",
    "跑策略",
    "测试策略",
    "策略测试",
    "backtest",
    "strategy test",
    "run strategy",
    "test strategy",
)

_BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
_BACKTEST_SKILL_FILE = os.path.join(
    _BASE_DIR,
    "backend",
    "core",
    "agent",
    "skills",
    "backtest",
    "SKILL.md",
)


def should_inject_backtest_skill(message: str) -> bool:
    text = (message or "").strip().lower()
    if not text:
        return False
    return any(keyword in text for keyword in BACKTEST_KEYWORDS)


def load_backtest_skill_markdown() -> str:
    if not os.path.exists(_BACKTEST_SKILL_FILE):
        return ""
    try:
        with open(_BACKTEST_SKILL_FILE, "r", encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


__all__ = [
    "BACKTEST_KEYWORDS",
    "should_inject_backtest_skill",
    "load_backtest_skill_markdown",
]

