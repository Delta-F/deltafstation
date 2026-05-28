"""
策略引擎核心类（基于 deltafq LiveEngine）

StrategyEngine 类方法说明：
  start            启动指定账户的策略引擎，可选从 state 恢复资金/持仓/订单等。
  stop             停止指定账户的策略引擎，并返回当前资金/持仓/订单快照。
  is_running       判断指定 account_id 上是否有策略在运行。
  is_any_running   是否有任意账户在跑策略（用于 broker 会话互斥）。
  get_running_ids  返回当前所有正在运行策略的 account_id 列表。
  get_state        获取当前策略运行中的底层引擎快照（不停止）。
  get_run_info     获取策略 id、标的、信号周期及最近一次信号信息。
  get_run_metrics  获取当前运行策略的绩效指标（与 BacktestEngine API 对齐）。
  get_chart_data   获取当前运行策略的 K 线和信号图表数据。
"""
from typing import List, Optional, Any, Dict
import math
import threading

from deltafq.live import LiveEngine

try:
    import numpy as np
except ImportError:
    np = None

from backend.core.utils.strategy_loader import load_strategy_class
from backend.core.utils.engine_snapshot import build_state_from_engine, restore_engine_from_state
from backend.core.utils.broker_snapshot import build_state_from_trade_gateway


def _get_engine(run: Optional[dict]):
    """从 run 中提取底层 paper ExecutionEngine，失败返回 None。"""
    if not run:
        return None
    gw = getattr(run.get("engine"), "_trade_gw", None)
    return getattr(gw, "_engine", None) if gw else None


def _is_broker_run(run: Optional[dict]) -> bool:
    return (run or {}).get("account_type") == "broker"


def _to_json_serializable(obj: Any) -> Any:
    """将 metrics 中常见的 numpy/pandas 等对象递归转换为 JSON 可序列化形式。"""
    if obj is None:
        return None
    if isinstance(obj, dict):
        return {k: _to_json_serializable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_to_json_serializable(x) for x in obj]
    if np is not None and hasattr(obj, "item"):  # numpy scalar
        try:
            x = obj.item()
            if isinstance(x, (int, float)) and (math.isnan(x) or math.isinf(x)):
                return None
            if isinstance(x, bool):
                return x
            if isinstance(x, int):
                return int(x)
            if isinstance(x, float):
                return float(x)
            return x
        except (ValueError, AttributeError, TypeError):
            pass
    if hasattr(obj, "strftime"):  # datetime-like
        return str(obj)
    if isinstance(obj, (int, float, str, bool)):
        if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
            return None
        return obj
    return obj


class StrategyEngine:
    """基于 deltafq LiveEngine 的策略运行管理器。"""
    _runs: dict = {}

    @classmethod
    def start(
        cls,
        account_id: str,
        strategy_id: str,
        symbol: str,
        initial_capital: float,
        commission: float = 0.001,
        signal_interval: str = "1d",
        lookback_bars: int = 100,
        interval: float = 10.0,
        order_amount: Optional[float] = None,
        order_quantity: Optional[int] = None,
        state: Optional[dict] = None,
        account_type: str = "local_paper",
        qmt_path: Optional[str] = None,
        broker_account: Optional[str] = None,
    ) -> None:
        """启动指定账户的策略引擎；broker 走 miniQMT 双网关，paper 走 yfinance + paper。"""
        if account_id in cls._runs:
            cls.stop(account_id)

        at = (account_type or "local_paper").strip().lower()
        is_broker = at == "broker"

        if is_broker:
            from backend.core.broker_engine import BrokerEngine

            if BrokerEngine.is_connected():
                BrokerEngine.disconnect()
            qmt_path = (qmt_path or "").strip()
            broker_account = (broker_account or "").strip()
            if not qmt_path or not broker_account:
                raise ValueError("broker account requires qmt_path and broker_account")
            interval = float(interval) if interval else 5.0

        strat = load_strategy_class(strategy_id)(name=strategy_id)
        if is_broker:
            if order_quantity is not None:
                strat.order_quantity = order_quantity
        elif order_amount is not None:
            strat.order_amount = order_amount

        if is_broker:
            engine = LiveEngine(
                symbol=symbol,
                interval=interval,
                lookback_bars=lookback_bars,
                signal_interval=signal_interval,
                data_gateway_name="miniqmt",
                trade_gateway_name="miniqmt",
            )
            engine.set_data_gateway("miniqmt", interval=interval, mode="poll")
            engine.set_trade_gateway(
                "miniqmt",
                userdata_mini_path=qmt_path,
                account_id=broker_account,
                strategy_name=strategy_id,
                lot_size=100,
            )
        else:
            engine = LiveEngine(
                symbol=symbol,
                interval=interval,
                lookback_bars=lookback_bars,
                signal_interval=signal_interval,
                data_gateway_name="yfinance",
                trade_gateway_name="paper",
            )
            engine.set_data_gateway("yfinance", interval=interval)
            engine.set_trade_gateway("paper", initial_capital=initial_capital, commission=commission)
            if getattr(engine, "_ensure_gateways", None):
                engine._ensure_gateways()
            if state:
                eng = _get_engine({"engine": engine})
                if eng:
                    restore_engine_from_state(eng, state)

        engine.add_strategy(strat)
        t = threading.Thread(target=lambda: engine.run_live(), daemon=True)
        t.start()
        cls._runs[account_id] = {
            "engine": engine,
            "strategy_id": strategy_id,
            "symbol": symbol,
            "signal_interval": signal_interval,
            "thread": t,
            "account_type": at,
            "qmt_path": qmt_path if is_broker else None,
            "broker_account": broker_account if is_broker else None,
            "order_amount": order_amount if not is_broker else None,
            "order_quantity": order_quantity if is_broker else None,
        }

    @classmethod
    def stop(cls, account_id: str) -> Optional[dict]:
        """停止指定账户的策略引擎，并返回当前资金/持仓/订单快照（broker 可能为 None）。"""
        run = cls._runs.pop(account_id, None)
        if not run:
            return None
        state = None
        if _is_broker_run(run):
            try:
                gw = getattr(run.get("engine"), "_trade_gw", None)
                state = build_state_from_trade_gateway(gw)
            except Exception:
                state = None
        else:
            eng = _get_engine(run)
            try:
                state = build_state_from_engine(eng) if eng else None
            except Exception:
                state = None
        try:
            run["engine"].stop()
        except Exception:
            pass
        return state

    @classmethod
    def is_running(cls, account_id: str) -> bool:
        """判断指定 account_id 上是否有策略在运行。"""
        return account_id in cls._runs

    @classmethod
    def is_any_running(cls) -> bool:
        """是否有任意账户正在运行策略。"""
        return bool(cls._runs)

    @classmethod
    def is_broker_strategy_running(cls) -> bool:
        """是否有 broker 模式的策略在运行。"""
        return any(_is_broker_run(r) for r in cls._runs.values())

    @classmethod
    def get_state(cls, account_id: str) -> Optional[dict]:
        """获取当前策略运行中的底层引擎快照（不停止）。"""
        run = cls._runs.get(account_id)
        if not run:
            return None
        if _is_broker_run(run):
            try:
                gw = getattr(run.get("engine"), "_trade_gw", None)
                return build_state_from_trade_gateway(gw)
            except Exception:
                return None
        eng = _get_engine(run)
        if not eng:
            return None
        try:
            return build_state_from_engine(eng)
        except Exception:
            return None

    @classmethod
    def get_run_info(cls, account_id: str) -> Optional[dict]:
        """获取策略 id、标的、信号周期及最近一次信号信息。"""
        run = cls._runs.get(account_id)
        if not run:
            return None
        info = {
            "strategy_id": run["strategy_id"],
            "symbol": run["symbol"],
            "signal_interval": run.get("signal_interval", "1d"),
            "account_type": run.get("account_type", "local_paper"),
        }
        if run.get("order_amount") is not None:
            info["order_amount"] = run["order_amount"]
        if run.get("order_quantity") is not None:
            info["order_quantity"] = run["order_quantity"]
        eng = run["engine"]
        if hasattr(eng, "_last_signal"):
            sig = eng._last_signal
            info["last_signal"] = sig
            info["last_signal_label"] = "买入" if sig == 1 else ("卖出" if sig == -1 else "观望")
        return info

    @classmethod
    def get_run_metrics(cls, account_id: str) -> Optional[Dict[str, Any]]:
        """获取当前运行策略的绩效指标（与 BacktestEngine API 对齐），无数据或异常时返回 None。"""
        run = cls._runs.get(account_id)
        if not run:
            return None
        engine = run["engine"]
        if not hasattr(engine, "calculate_metrics"):
            return None
        try:
            result = engine.calculate_metrics()
            if result is None:
                return None
            if isinstance(result, (list, tuple)) and len(result) >= 2:
                metrics = result[1]
            elif isinstance(result, dict):
                metrics = result
            else:
                return None
            if not isinstance(metrics, dict):
                return None
            return _to_json_serializable(metrics)
        except Exception:
            return None

    @classmethod
    def get_chart_data(cls, account_id: str) -> Optional[dict]:
        """获取当前运行策略的 K 线和信号图表数据。"""
        run = cls._runs.get(account_id)
        if not run:
            return None
        engine = run["engine"]
        if not hasattr(engine, "get_chart_data"):
            return None
        try:
            return engine.get_chart_data()
        except Exception:
            return None

    @classmethod
    def get_running_ids(cls) -> List[str]:
        """返回当前所有正在运行策略的 account_id 列表。"""
        return list(cls._runs.keys())

    @classmethod
    def get_broker_snapshot_payload(cls) -> Optional[Dict[str, Any]]:
        """broker 策略运行中时返回柜台快照（供 /api/broker/snapshot 代理）。"""
        from backend.core.utils.broker_snapshot import collect_broker_snapshot

        for account_id, run in cls._runs.items():
            if not _is_broker_run(run):
                continue
            engine = run.get("engine")
            gw = getattr(engine, "_trade_gw", None) if engine else None
            if gw is None:
                continue
            try:
                data = collect_broker_snapshot(gw)
                data["account_id"] = run.get("broker_account")
                data["qmt_path"] = run.get("qmt_path")
                sid = run.get("strategy_id") or ""
                for o in data.get("orders") or []:
                    if sid and not (o.get("strategy_id") or "").strip():
                        o["strategy_id"] = sid
                for t in data.get("trades") or []:
                    if sid and not (t.get("strategy_id") or "").strip():
                        t["strategy_id"] = sid
                return data
            except Exception:
                return None
        return None
