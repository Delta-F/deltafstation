import threading
import time
import logging
from typing import Dict, Optional
from datetime import timedelta
from deltafq.live.event_engine import EventEngine, EVENT_TICK
from deltafq.live.gateway_registry import create_data_gateway

# 配置日志
logger = logging.getLogger(__name__)

class LiveDataManager:
    def __init__(self):
        self.event_engine = EventEngine()
        self.latest_ticks: Dict[str, dict] = {}
        self.history_ticks: Dict[str, list] = {}
        self.subscribed_symbols = set()
        self.ohlc_cache: Dict[str, dict] = {}
        self.ohlc_last_update: Dict[str, float] = {}
        self._lock = threading.Lock()
        
        # 初始化网关
        try:
            self.gateway = create_data_gateway("yfinance", interval=5)
            self.gateway.set_tick_handler(lambda tick: self.event_engine.emit(EVENT_TICK, tick))
            self.event_engine.on(EVENT_TICK, self._on_tick)
        except Exception as e:
            logger.error(f"Failed to create data gateway: {e}")
            self.gateway = None

    def _on_tick(self, tick):
        with self._lock:
            # 极简时区处理：归一化 minute 字段供前端分时图对齐
            s = tick.symbol
            if s.endswith(('.SS', '.SZ')):
                offset = 8
            elif s.endswith('-USD') or 'BTC' in s or 'ETH' in s:
                offset = 0  # 加密货币回归使用 UTC 时间
            else:
                offset = -5
            
            ts_local = tick.timestamp + timedelta(hours=offset)
            current_min = ts_local.strftime('%H:%M')
            source = getattr(tick, 'source', None)

            tick_data = {
                "symbol": tick.symbol,
                "price": tick.price,
                "volume": tick.volume,
                "timestamp": tick.timestamp.isoformat(),
                "minute": current_min
            }
            
            # 维护数据：区分历史预热与实时行情
            if source == "yf_warmup":
                if tick.symbol not in self.history_ticks:
                    self.history_ticks[tick.symbol] = []
                self.history_ticks[tick.symbol].append(tick_data)
            else:
                self.latest_ticks[tick.symbol] = tick_data
                # print(f"[Live] {tick.symbol} -> {tick.price},{tick.volume},{current_min}")

    def start(self):
        if self.gateway:
            self.gateway.connect()
            self.gateway.start()

    def stop(self):
        if self.gateway:
            self.gateway.stop()
        with self._lock:
            self.subscribed_symbols.clear()

    def subscribe(self, symbols: list):
        if not self.gateway:
            return

        with self._lock:
            new_symbols = [s for s in symbols if s not in self.subscribed_symbols]
            if not new_symbols:
                return
            # 乐观更新：先标记为已订阅，避免并发重复请求
            for s in new_symbols:
                self.subscribed_symbols.add(s)

        # 在锁外调用网关，避免阻塞
        try:
            self.gateway.subscribe(new_symbols)
        except Exception as e:
            logger.error(f"Gateway subscribe failed for {new_symbols}: {e}")
            with self._lock:
                for s in new_symbols:
                    self.subscribed_symbols.discard(s)

    def get_quote(self, symbol: str, include_history: bool = False):
        # 如果未订阅，则自动触发订阅
        self.subscribe([symbol])
            
        with self._lock:
            data = self.latest_ticks.get(symbol, {}).copy()
            if not data:
                return None
            if include_history and symbol in self.history_ticks:
                data['history'] = self.history_ticks[symbol]
        
        # 缓存 OHLC 数据，避免频繁请求 yfinance
        self._update_ohlc_cache(symbol, data)
        
        return data

    def _update_ohlc_cache(self, symbol: str, data: dict):
        current_time = time.time()
        last_update = self.ohlc_last_update.get(symbol, 0)
        
        # 缓存有效期 60 秒
        if current_time - last_update > 60:
            ohlc = _fetch_ohlc(symbol)
            if ohlc:
                self.ohlc_cache[symbol] = ohlc
                self.ohlc_last_update[symbol] = current_time
                data.update(ohlc)
            elif symbol in self.ohlc_cache:
                # 请求失败但有旧缓存，使用旧缓存
                data.update(self.ohlc_cache[symbol])
        elif symbol in self.ohlc_cache:
            data.update(self.ohlc_cache[symbol])


def _fetch_ohlc(symbol: str) -> Optional[Dict]:
    """独立请求今日 OHLC，不占用 gateway 的 Ticker 缓存。"""
    try:
        import yfinance as yf
        t = yf.Ticker(symbol)
        info = t.fast_info
        o = getattr(info, "open", None)
        h = getattr(info, "day_high", None)
        l = getattr(info, "day_low", None)
        if o is not None and h is not None and l is not None:
            return {"open": float(o), "high": float(h), "low": float(l)}
    except Exception as e:
        logger.warning(f"Error fetching OHLC for {symbol}: {e}")
    return None


# 全局单例
live_data_manager = LiveDataManager()
