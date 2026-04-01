"""回测 Agent skill：关键词命中时注入系统提示，并从磁盘加载 SKILL.md（首读缓存）。"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
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

_SKILL_PATH = Path(__file__).resolve().parent / "skills" / "backtest" / "SKILL.md"


def should_inject_backtest_skill(message: str) -> bool:
    """用户消息是否包含回测相关关键词（用于决定是否拼接回测 skill 提示）。"""
    text = (message or "").strip().lower()
    if not text:
        return False
    return any(keyword in text for keyword in BACKTEST_KEYWORDS)


@lru_cache(maxsize=1)
def load_backtest_skill_markdown() -> str:
    """返回回测 SKILL.md 正文；文件不存在或读取失败时返回空字符串（进程内只读盘一次）。"""
    if not _SKILL_PATH.is_file():
        return ""
    try:
        return _SKILL_PATH.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


__all__ = [
    "BACKTEST_KEYWORDS",
    "should_inject_backtest_skill",
    "load_backtest_skill_markdown",
]
