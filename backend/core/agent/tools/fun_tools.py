from __future__ import annotations

import random
from datetime import date
from typing import Any, Dict, List

_FUN_STATION_LINES: List[str] = [
    "亏钱不伤包，只伤自尊。",
    "曲线太丝滑？先疑过拟合，再疑显示器。",
    "策略躺文件夹里，不会自己下单。",
    "滑点填真，曲线变丑＝诚实。",
    "仿真日志当排错读物行，别当睡前故事。",
    "纸面收益×勇气≠实盘；这儿勇气都省了。",
    "回测像开挂？多半是未来函数在偷笑。",
]

_LOT_LUCK: tuple[str, ...] = ("上上签", "上签", "中签", "下签", "下下签")

_LUCK_GLOSS: Dict[str, str] = {
    "上上签": "顺风顺水，别犹豫，照直走就行。",
    "上签": "小心一点就能赢，别贪快、稳住就好。",
    "中签": "先试探再加速，别一次梭哈。",
    "下签": "先止损再反攻，今天别和趋势硬碰硬。",
    "下下签": "保持低姿态，少出手就是最好的策略。",
}


def handle_fun_station_tip(args: Dict[str, Any]) -> str:
    """今日一签工具 handler。

    入参：
    - 可忽略（当前不使用 `seed`：每次随机抽取）

    返回：
    - 多行文本：日期 / 卦象 / `签文：...` / `解读：...`
    """
    i_line = random.randrange(len(_FUN_STATION_LINES))
    luck = random.choice(list(_LOT_LUCK))
    date_line = f"日期：{date.today().isoformat()}"

    gua = f"卦象：{luck}"
    tip = _FUN_STATION_LINES[i_line]
    gloss = _LUCK_GLOSS.get(luck, "今天按自己的节奏来就好。")
    return f"{date_line}\n{gua}\n签文：{tip}\n解读：{gloss}"

