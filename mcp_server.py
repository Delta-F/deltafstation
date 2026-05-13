"""
DeltaFStation MCP（stdio）：透出 ``backend.core.agent.tool_registry.TOOLS_MAP``，
与 ``tool_runner`` 里 OpenAI 函数调用的入参/出参一致。

客户端 JSON（command/args/cwd/env.PYTHONPATH）见 ``docs/mcp-client-config.md``；
密钥用环境变量，勿写入 MCP 配置。

stdio 下 stdout 只能走 JSON-RPC；本模块把日志与 stdout Handler 迁到 stderr，
在导入与每次工具调用前都会再刷新。

回测/写策略会写 ``data/strategies``、``data/results``，仅可信环境使用；
``cwd`` 须为仓库根，``data/`` 路径才与主应用一致。
"""

from __future__ import annotations

import logging
import os
import sys
from typing import Any, Callable, Dict, Optional

# 未显式配置时避免 loguru 默认打 stdout，破坏 JSON-RPC
os.environ.setdefault("LOGURU_LEVEL", os.environ.get("DELTAFSTATION_LOGURU_LEVEL", "WARNING"))


def build_app() -> FastMCP:
    """构建 FastMCP 实例并注册与 TOOLS_MAP 对齐的工具。"""
    _ensure_runtime_path()
    _prepare_stdio_safe_io()

    from backend.core.agent.tool_registry import TOOLS_MAP

    _patch_deltafq_logger_to_stderr()
    _prepare_stdio_safe_io()

    mcp = FastMCP("DeltaFStation")
    # 压低 MCP 框架日志，减少 stderr 噪音
    logging.getLogger("mcp.server.lowlevel.server").setLevel(logging.WARNING)

    @mcp.tool()
    async def get_fun_station_tip() -> str:
        """抽签工具（今日一签/抽签/卦签）。每次都会随机抽签。工具返回：日期、卦象档位、签文原文与一行简短趣味解读（解读：...）。"""
        return _invoke_tool(TOOLS_MAP, "get_fun_station_tip", {})

    @mcp.tool()
    async def run_backtest(
        strategy_id: str,
        data_file: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        symbol: Optional[str] = None,
        initial_capital: Optional[float] = None,
        commission: Optional[float] = None,
        slippage: Optional[float] = None,
        trade_preview_count: Optional[int] = None,
    ) -> str:
        """执行策略回测。必填 strategy_id、data_file（支持模糊匹配）。成功时返回 resolved、summary_metrics、trade_preview 等结构化字段。"""
        payload = _args(
            strategy_id=strategy_id,
            data_file=data_file,
            start_date=start_date,
            end_date=end_date,
            symbol=symbol,
            initial_capital=initial_capital,
            commission=commission,
            slippage=slippage,
            trade_preview_count=trade_preview_count,
        )
        return _invoke_tool(TOOLS_MAP, "run_backtest", payload)

    @mcp.tool()
    async def ensure_strategy(
        class_name: str,
        source_code: str,
        file_basename: Optional[str] = None,
        overwrite: Optional[bool] = None,
    ) -> str:
        """将完整 Python 策略源码写入 data/strategies 并校验可加载。新策略须先成功调用本工具再使用 run_backtest_auto。"""
        payload = _args(
            class_name=class_name,
            source_code=source_code,
            file_basename=file_basename,
            overwrite=overwrite,
        )
        return _invoke_tool(TOOLS_MAP, "ensure_strategy", payload)

    @mcp.tool()
    async def run_backtest_auto(
        symbol: str,
        strategy_id: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        initial_capital: Optional[float] = None,
        commission: Optional[float] = None,
        slippage: Optional[float] = None,
        trade_preview_count: Optional[int] = None,
    ) -> str:
        """自动回测：仅需 symbol；行情默认经 yfinance。strategy_id 可选，缺省为 BOLLStrategy（须已存在于 data/strategies）。"""
        payload = _args(
            symbol=symbol,
            strategy_id=strategy_id,
            start_date=start_date,
            end_date=end_date,
            initial_capital=initial_capital,
            commission=commission,
            slippage=slippage,
            trade_preview_count=trade_preview_count,
        )
        return _invoke_tool(TOOLS_MAP, "run_backtest_auto", payload)

    return mcp


def main() -> None:
    """stdio 传输入口。"""
    build_app().run(transport="stdio")


def _invoke_tool(
    tools_map: Dict[str, Callable[[Dict[str, Any]], str]],
    name: str,
    payload: Dict[str, Any],
) -> str:
    """每次调用前刷新 stdio 安全设置，再派发 TOOLS_MAP 处理器。"""
    _prepare_stdio_safe_io()
    return tools_map[name](payload)


def _args(**kwargs: Any) -> Dict[str, Any]:
    """去掉值为 None 的项，得到工具参数字典。"""
    return {k: v for k, v in kwargs.items() if v is not None}


def _repo_root() -> str:
    """返回本文件所在目录（仓库根）。"""
    return os.path.dirname(os.path.abspath(__file__))


def _ensure_runtime_path() -> None:
    """切换到仓库根，并保证 ``sys.path`` 含该目录。"""
    root = _repo_root()
    os.chdir(root)
    if root not in sys.path:
        sys.path.insert(0, root)


def _patch_deltafq_logger_to_stderr() -> None:
    """deltafq 默认把 Handler 绑在 stdout；改为 stderr，避免 JSON-RPC 解析失败。"""
    try:
        from deltafq.core import logger as dq_logger_mod
    except ImportError:
        return
    if getattr(dq_logger_mod.Logger.__init__, "_deltafstation_mcp_patched", False):
        return

    def _patched_init(self, name: str = "deltafq", level: str = "INFO") -> None:
        self.logger = logging.getLogger(name)
        self.logger.setLevel(getattr(logging, level.upper()))
        if not self.logger.handlers:
            handler = logging.StreamHandler(sys.stderr)
            handler.setFormatter(
                logging.Formatter(
                    "[%(asctime)s] %(levelname)-7s %(name)-20s >>> %(message)s",
                    datefmt="%H:%M:%S",
                )
            )
            self.logger.addHandler(handler)

    # 幂等：避免重复替换 __init__
    _patched_init._deltafstation_mcp_patched = True  # type: ignore[attr-defined]
    dq_logger_mod.Logger.__init__ = _patched_init  # type: ignore[method-assign]


def _redirect_stdout_streamhandlers_to_stderr() -> None:
    """将所有仍指向 ``sys.stdout`` 的 ``logging.StreamHandler`` 改绑到 ``stderr``。"""
    loggers: list[logging.Logger] = [logging.getLogger()]
    for lg in logging.root.manager.loggerDict.values():
        if isinstance(lg, logging.Logger):
            loggers.append(lg)
    for log in loggers:
        for h in list(log.handlers):
            if not isinstance(h, logging.StreamHandler):
                continue
            if getattr(h, "stream", None) is not sys.stdout:
                continue
            fmt = h.formatter
            log.removeHandler(h)
            nh = logging.StreamHandler(sys.stderr)
            if fmt is not None:
                nh.setFormatter(fmt)
            log.addHandler(nh)


def _repoint_loguru_to_stderr() -> None:
    """将 loguru 输出定向到 stderr；未安装则忽略。"""
    try:
        # 可选依赖，类型存根可能不全
        from loguru import logger  # type: ignore[import-untyped]

        logger.remove()
        logger.add(
            sys.stderr,
            level=os.environ.get("DELTAFSTATION_LOGURU_LEVEL", "WARNING"),
            enqueue=True,
        )
    except ImportError:
        pass


def _prepare_stdio_safe_io() -> None:
    """统一刷新：stdlib stdout Handler → stderr，并重绑 loguru。"""
    _redirect_stdout_streamhandlers_to_stderr()
    _repoint_loguru_to_stderr()


def _configure_stdio_safe_logging() -> None:
    """stdlib 日志默认走 stderr，并压低 urllib3/httpx/mcp 等库的日志级别。"""
    level = getattr(
        logging,
        os.environ.get("DELTAFSTATION_LOG_LEVEL", "WARNING").upper(),
        logging.WARNING,
    )
    logging.basicConfig(
        level=level,
        format="%(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
        force=True,
    )
    for name in ("urllib3", "httpx", "httpcore", "asyncio", "mcp", "mcp.server", "mcp.server.lowlevel"):
        logging.getLogger(name).setLevel(logging.WARNING)


_configure_stdio_safe_logging()

# 须在 basicConfig 之后导入，降低第三方在 import 阶段污染 stdout 的风险
from mcp.server.fastmcp import FastMCP  # noqa: E402

_repoint_loguru_to_stderr()

if __name__ == "__main__":
    main()  # 脚本入口：stdio MCP
