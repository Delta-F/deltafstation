import threading
from typing import Dict
from datetime import datetime

try:
    from deltafq.live.gateway_registry import create_data_gateway
    from deltafq.live.event_engine import EVENT_TICK
except ImportError:
    print("Warning: Could not import deltafq. Please ensure it is installed (pip install deltafq).")
    create_data_gateway = None

class LiveDataManager:
    def __init__(self):
        self.gateway = None
        self.latest_ticks: Dict[str, dict] = {}
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
            # 调试日志：记录收到的 Tick 数据
            # print(f"[LiveDataManager] Tick received: {tick.symbol} @ {tick.price}")
            
            self.latest_ticks[tick.symbol] = {
                "symbol": tick.symbol,
                "price": tick.price,
                "volume": tick.volume,
                "timestamp": tick.timestamp.isoformat(),
                "open": getattr(tick, 'open_price', None),
                "high": getattr(tick, 'high_price', None),
                "low": getattr(tick, 'low_price', None),
                "prev_close": getattr(tick, 'pre_close', None)
            }

    def start(self):
        if not self.gateway:
            print("[LiveDataManager] Cannot start: Gateway not initialized.")
            return
            
        print("[LiveDataManager] Connecting to YFinance...")
        if self.gateway.connect():
            self.gateway.start()
            self.is_running = True
            # 默认订阅一些股票代码
            default_symbols = ["000001.SS", "AAPL", "GOOGL", "BTC-USD"]
            self.gateway.subscribe(default_symbols)
            print(f"[LiveDataManager] Connected and subscribed to: {default_symbols}")
        else:
            print("[LiveDataManager] Failed to connect to YFinance gateway.")

    def stop(self):
        if self.gateway and self.is_running:
            self.gateway.stop()
            self.is_running = False
            print("[LiveDataManager] Gateway stopped.")

    def subscribe(self, symbols: list):
        if self.gateway and self.is_running:
            print(f"[LiveDataManager] Subscribing to: {symbols}")
            self.gateway.subscribe(symbols)
        else:
            print(f"[LiveDataManager] Cannot subscribe: Gateway not running.")

    def get_quote(self, symbol: str):
        with self._lock:
            quote = self.latest_ticks.get(symbol)
            # if not quote:
            #     print(f"[LiveDataManager] No cache for {symbol}")
            return quote

# 全局单例
live_data_manager = LiveDataManager()
