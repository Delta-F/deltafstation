"""
实时行情管理器。

LiveDataManager 方法说明：

公开方法：
  start            启动当前数据网关。
  stop             停止网关并清空订阅集合。
  get_data_source  返回当前数据源标识。
  set_data_source  切换数据源并迁移原订阅标的，返回 (成功标记, 信息)。
  subscribe        按需订阅标的，网关失败时回滚本地订阅标记。
  get_quote        获取最新报价，并按需补充历史与缓存字段。

私有方法：
  _on_tick             处理单条 tick，写入实时或预热缓冲。
  _minute_context      计算 tick 的基准时间与 minute 字符串。
  _time_offset         按市场/来源返回 minute 展示时区偏移。
  _create_gateway      按 source 创建网关并绑定 tick 回调。
  _clear_runtime_state 清空订阅、tick、OHLC 与 depth 缓存状态。
  _apply_cached        将命中的缓存字段写回响应数据。
  _update_ohlc_cache   刷新/复用 OHLC 缓存（TTL）。
  _update_depth_cache  刷新/复用五档缓存（TTL）。
  _parse_depth_rows    将五档原始行标准化为 [price, volume]。
"""

import logging
import threading
import time
from datetime import datetime, timedelta
from typing import Dict, Tuple

from deltafq.live.event_engine import EVENT_TICK, EventEngine
from deltafq.live.gateway_registry import create_data_gateway

logger = logging.getLogger(__name__)


class LiveDataManager:
    """管理实时 tick、历史预热数据与轻量行情缓存。"""

    OHLC_TTL = 60
    DEPTH_TTL = 3
    WARMUP_SOURCES = {"yf_warmup", "miniqmt_warmup"}
    REALTIME_MINIQMT_SOURCES = {"miniqmt", "miniqmt_push"}

    def __init__(self):
        self.event_engine = EventEngine()
        self.latest_ticks: Dict[str, dict] = {}
        self.history_ticks: Dict[str, list] = {}
        self.subscribed_symbols = set()
        self.ohlc_cache: Dict[str, dict] = {}
        self.ohlc_last_update: Dict[str, float] = {}
        self.depth_cache: Dict[str, dict] = {}
        self.depth_last_update: Dict[str, float] = {}
        self.data_source = "yfinance"
        self._gateway_params = {
            "yfinance": {"interval": 5},
            "miniqmt": {"interval": 5, "mode": "poll"},
        }
        self._lock = threading.Lock()
        self.gateway = None

        # 统一由事件引擎转发 tick，便于后续扩展多个事件消费者。
        self.event_engine.on(EVENT_TICK, self._on_tick)

        # 启动时尝试创建默认网关；失败时允许服务继续启动。
        try:
            self.gateway = self._create_gateway(self.data_source)
        except Exception as e:
            logger.error(f"Failed to create data gateway: {e}")
            self.gateway = None

    # ==================== Public APIs ====================
    def start(self):
        """启动当前网关。"""
        if self.gateway:
            self.gateway.connect()
            self.gateway.start()

    def stop(self):
        """停止当前网关并清空订阅集合。"""
        if self.gateway:
            self.gateway.stop()
        with self._lock:
            self.subscribed_symbols.clear()

    def get_data_source(self) -> str:
        """返回当前数据源。"""
        with self._lock:
            return self.data_source

    def set_data_source(self, source: str) -> Tuple[bool, str]:
        """切换数据源并迁移原订阅；返回 (成功标记, 信息)。"""
        source = (source or "").strip().lower()
        if source not in self._gateway_params:
            return False, f"Unsupported data source: {source}"

        # Step 1: 记录旧状态并清理运行态缓存。
        with self._lock:
            if source == self.data_source:
                return True, source
            old_gateway = self.gateway
            old_symbols = list(self.subscribed_symbols)
            self._clear_runtime_state()

        # Step 2: 构建并启动新网关，恢复原订阅。
        try:
            new_gateway = self._create_gateway(source)
            if not new_gateway.connect():
                with self._lock:
                    self.subscribed_symbols = set(old_symbols)
                return False, f"Failed to connect data source: {source}"
            new_gateway.start()
            new_gateway.subscribe(old_symbols)
        except Exception as e:
            logger.error(f"Failed to switch data source to {source}: {e}")
            with self._lock:
                self.subscribed_symbols = set(old_symbols)
            return False, str(e)

        # Step 3: 关闭旧网关并提交新网关。
        if old_gateway:
            try:
                old_gateway.stop()
            except Exception as e:
                logger.warning(f"Error stopping old gateway: {e}")

        with self._lock:
            self.gateway = new_gateway
            self.data_source = source
            self.subscribed_symbols = set(old_symbols)
        return True, source

    def subscribe(self, symbols: list):
        """按需订阅 symbols，失败时回滚本地订阅标记。"""
        if not self.gateway:
            return

        # Step 1: 只保留尚未订阅的 symbol，并先乐观写入集合。
        with self._lock:
            new_symbols = [s for s in symbols if s not in self.subscribed_symbols]
            if not new_symbols:
                return
            for s in new_symbols:
                self.subscribed_symbols.add(s)

        # Step 2: 锁外发起订阅，异常时回滚本地标记。
        try:
            self.gateway.subscribe(new_symbols)
        except Exception as e:
            logger.error(f"Gateway subscribe failed for {new_symbols}: {e}")
            with self._lock:
                for s in new_symbols:
                    self.subscribed_symbols.discard(s)

    def get_quote(self, symbol: str, include_history: bool = False):
        """获取最新报价，必要时附加历史与缓存字段。"""
        # Step 1: 先确保目标标的已订阅。
        self.subscribe([symbol])

        # Step 2: 读取最新 tick 快照（无数据直接返回）。
        with self._lock:
            data = self.latest_ticks.get(symbol, {}).copy()
            if not data:
                return None
            data["data_source"] = self.data_source
            if include_history and symbol in self.history_ticks:
                data["history"] = self.history_ticks[symbol]

        # Step 3: 补充缓存行情字段（OHLC + 五档）。
        self._update_ohlc_cache(symbol, data)
        self._update_depth_cache(symbol, data)
        return data

    # ==================== Tick Processing ====================
    def _on_tick(self, tick):
        """处理单条 tick：标准化 minute，并写入对应缓冲区。"""
        with self._lock:
            source = getattr(tick, "source", None)
            ts_base, minute = self._minute_context(tick)
            tick_data = {
                "symbol": tick.symbol,
                "price": tick.price,
                "volume": tick.volume,
                "timestamp": ts_base.isoformat(),
                "minute": minute,
            }
            if source in self.WARMUP_SOURCES:
                self.history_ticks.setdefault(tick.symbol, []).append(tick_data)
                return
            self.latest_ticks[tick.symbol] = tick_data

    def _minute_context(self, tick) -> Tuple[datetime, str]:
        """返回 (基准时间, 分钟字符串)。"""
        symbol = tick.symbol
        source = getattr(tick, "source", None)
        ts_base = tick.timestamp
        if source in self.REALTIME_MINIQMT_SOURCES:
            # 实时 miniqmt 可能返回停滞成交时刻，改用接收时刻驱动 minute。
            ts_base = datetime.now().replace(tzinfo=None)
            offset = 0
        else:
            offset = self._time_offset(symbol, source)
        minute = (ts_base + timedelta(hours=offset)).strftime("%H:%M")
        return ts_base, minute

    @staticmethod
    def _time_offset(symbol: str, source: str) -> int:
        """按市场/来源选择 minute 展示时区偏移。"""
        if source == "miniqmt_warmup" or symbol.endswith((".SS", ".SZ")):
            return 8
        if symbol.endswith("-USD") or "BTC" in symbol or "ETH" in symbol:
            return 0
        return -5

    # ==================== Cache & Gateway Helpers ====================
    def _create_gateway(self, source: str):
        """按 source 创建网关，并将 tick 转发到事件引擎。"""
        source = (source or "").strip().lower()
        if source not in self._gateway_params:
            raise ValueError(f"Unsupported data source: {source}")
        gateway = create_data_gateway(source, **self._gateway_params[source])
        gateway.set_tick_handler(lambda tick: self.event_engine.emit(EVENT_TICK, tick))
        return gateway

    def _clear_runtime_state(self):
        """清空订阅与缓存状态（用于切换数据源前）。"""
        self.subscribed_symbols.clear()
        self.latest_ticks.clear()
        self.history_ticks.clear()
        self.ohlc_cache.clear()
        self.ohlc_last_update.clear()
        self.depth_cache.clear()
        self.depth_last_update.clear()

    @staticmethod
    def _apply_cached(cache: Dict[str, dict], symbol: str, data: dict):
        """存在缓存则写入 data。"""
        cached = cache.get(symbol)
        if cached:
            data.update(cached)

    def _update_ohlc_cache(self, symbol: str, data: dict):
        """刷新/复用 OHLC 缓存（60 秒 TTL）。"""
        current_time = time.time()
        last_update = self.ohlc_last_update.get(symbol, 0)

        # Step 1: TTL 命中时直接复用缓存。
        if current_time - last_update <= self.OHLC_TTL:
            self._apply_cached(self.ohlc_cache, symbol, data)
            return

        # Step 2: TTL 过期时拉新，失败则回退旧值。
        ohlc = self.gateway.get_today_ohlc(symbol) if self.gateway else None
        if ohlc:
            self.ohlc_cache[symbol] = ohlc
            self.ohlc_last_update[symbol] = current_time
            data.update(ohlc)
            return
        self._apply_cached(self.ohlc_cache, symbol, data)

    def _update_depth_cache(self, symbol: str, data: dict):
        """刷新/复用五档缓存（3 秒 TTL）。"""
        if not self.gateway:
            return

        current_time = time.time()
        last_update = self.depth_last_update.get(symbol, 0)

        # Step 1: TTL 命中时直接复用缓存。
        if current_time - last_update <= self.DEPTH_TTL:
            self._apply_cached(self.depth_cache, symbol, data)
            return

        # Step 2: TTL 过期时拉新并标准化结构，异常时回退旧值。
        try:
            depths = self.gateway.get_depths(symbol, levels=5) or {}
            asks = self._parse_depth_rows(depths.get("asks") or [])
            bids = self._parse_depth_rows(depths.get("bids") or [])
            if asks or bids:
                self.depth_cache[symbol] = {"asks": asks, "bids": bids}
                self.depth_last_update[symbol] = current_time
                data.update(self.depth_cache[symbol])
                return
        except Exception as e:
            logger.warning(f"Error fetching depth for {symbol}: {e}")
        self._apply_cached(self.depth_cache, symbol, data)

    @staticmethod
    def _parse_depth_rows(rows: list) -> list:
        """将 depth 行标准化为 [price, volume] 列表。"""
        parsed = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            p, v = row.get("price"), row.get("volume")
            if p is None or v is None:
                continue
            parsed.append([float(p), int(v)])
        return parsed


live_data_manager = LiveDataManager()
