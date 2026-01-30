import threading
from typing import Dict
from datetime import timedelta
import yfinance as yf
from deltafq.live.gateway_registry import create_data_gateway

class LiveDataManager:
    def __init__(self):
        self.gateway = None
        self.latest_ticks: Dict[str, dict] = {}
        self.history_ticks: Dict[str, list] = {} # 存储当日历史数据 (yf_warmup)
        self.subscribed_symbols = set()
        self._lock = threading.Lock()
        self.is_running = False
        
        if create_data_gateway:
            try:
                # 使用 5.0s 的轮询间隔
                self.gateway = create_data_gateway("yfinance", interval=5.0)
                self.gateway.set_tick_handler(self._on_tick)
                print("[LiveDataManager] YFinance gateway initialized.")
            except Exception as e:
                print(f"[LiveDataManager] Error initializing gateway: {e}")

    def _on_tick(self, tick):
        with self._lock:
            # 极简时区处理：归一化 minute 字段供前端分时图对齐
            s = tick.symbol.upper()
            if s.endswith(('.SS', '.SZ')):
                offset = 8
            elif s.endswith('-USD') or 'BTC' in s or 'ETH' in s:
                offset = 0  # 加密货币回归使用 UTC 时间
            else:
                offset = -5
            
            ts_local = tick.timestamp + timedelta(hours=offset)
            current_min = ts_local.strftime('%H:%M')

            tick_data = {
                "symbol": tick.symbol,
                "price": tick.price,
                "volume": tick.volume,
                "timestamp": tick.timestamp.isoformat(),
                "minute": current_min,
                "prev_close": getattr(tick, 'pre_close', None)
            }
            
            # 维护当日历史数据列表
            if tick.symbol not in self.history_ticks:
                self.history_ticks[tick.symbol] = []
            
            # 使用交易所分钟进行去重
            history = self.history_ticks[tick.symbol]
            if history and history[-1].get('minute') == current_min:
                history[-1] = tick_data
            else:
                history.append(tick_data)
                if len(history) > 1500:
                    history.pop(0)
            
            # 实时数据始终保持最新
            if getattr(tick, 'source', None) != "yf_warmup":
                self.latest_ticks[tick.symbol] = tick_data

    def start(self):
        if not self.gateway:
            print("[LiveDataManager] Cannot start: Gateway not initialized.")
            return
            
        print("[LiveDataManager] Connecting to YFinance...")
        if self.gateway.connect():
            self.gateway.start()
            self.is_running = True
            print(f"[LiveDataManager] Connected. Ready for dynamic subscriptions.")
        else:
            print("[LiveDataManager] Failed to connect to YFinance gateway.")

    def stop(self):
        if self.gateway and self.is_running:
            self.gateway.stop()
            self.is_running = False
            self.subscribed_symbols.clear()
            print("[LiveDataManager] Gateway stopped.")

    def subscribe(self, symbols: list):
        if self.gateway and self.is_running:
            new_symbols = [s for s in symbols if s not in self.subscribed_symbols]
            if new_symbols:
                print(f"[LiveDataManager] Subscribing to: {new_symbols}")
                self.gateway.subscribe(new_symbols)
                with self._lock:
                    for s in new_symbols:
                        self.subscribed_symbols.add(s)
        else:
            print(f"[LiveDataManager] Cannot subscribe: Gateway not running.")

    def get_quote(self, symbol: str, include_history: bool = False):
        # 如果未订阅，则自动触发订阅
        if symbol not in self.subscribed_symbols:
            self.subscribe([symbol])
            
        with self._lock:
            data = self.latest_ticks.get(symbol, {}).copy()
            
            # 如果没有实时 tick，尝试从历史中取最后一条
            if not data and symbol in self.history_ticks and self.history_ticks[symbol]:
                data = self.history_ticks[symbol][-1].copy()
            
            # 如果前端要求历史数据，附带上
            if include_history and symbol in self.history_ticks:
                data['history'] = self.history_ticks[symbol]
            
            return data if data else None

# 全局单例
live_data_manager = LiveDataManager()
