# MCP 客户端配置（Cursor / Claude Desktop）

入口脚本为仓库根目录的 [mcp_server.py](../mcp_server.py)（stdio）。**不要把 API Key 写进 JSON**；需要时用系统/用户环境变量或 `.env`（本仓库 `.env` 已被 gitignore）。

占位符：

- `REPO`：本仓库根目录的绝对路径（Windows 示例：`C:\Users\you\...\deltafstation`）。
- `PY`：已安装本仓库依赖的解释器，建议用虚拟环境：`REPO\.venv\Scripts\python.exe`。

## 为何不把 `.cursor/mcp.json` 放进仓库

项目内放该文件容易让人误以为「克隆后开箱即用」或「团队必须统一这份配置」。解释器路径因人而异，更适合每人本地配置。若你仍想用项目级文件，可在本机创建 `.cursor/mcp.json`；仓库已通过 `.gitignore` 忽略该路径，避免误提交。

## Cursor（推荐：Settings → MCP）

在 **Settings → MCP** 里添加 stdio 服务器，字段与下面等价。用户级配置请把路径写成**绝对路径**（一般没有 `${workspaceFolder}`）。

```json
{
  "mcpServers": {
    "deltafstation": {
      "type": "stdio",
      "command": "PY",
      "args": ["REPO\\mcp_server.py"],
      "cwd": "REPO",
      "env": {
        "PYTHONPATH": "REPO"
      }
    }
  }
}
```

若你的 Cursor 版本在项目目录下支持 **`.cursor/mcp.json`**（且仅本机使用），可以用 `${workspaceFolder}` 占位仓库根：

```json
{
  "mcpServers": {
    "deltafstation": {
      "type": "stdio",
      "command": "python",
      "args": ["${workspaceFolder}/mcp_server.py"],
      "env": {
        "PYTHONPATH": "${workspaceFolder}"
      }
    }
  }
}
```

建议仍设置 `cwd` 为仓库根（若界面支持），与 [mcp_server.py](../mcp_server.py) 注释中的说明一致，保证 `data/` 相对路径正确。

## Claude Desktop

合并到 `%APPDATA%\Claude\claude_desktop_config.json` 的 `mcpServers`（字段名以当前 Claude Desktop 版本为准）：

```json
{
  "mcpServers": {
    "deltafstation": {
      "command": "PY",
      "args": ["REPO\\mcp_server.py"],
      "cwd": "REPO",
      "env": {
        "PYTHONPATH": "REPO"
      }
    }
  }
}
```

## 冒烟验证

1. 在仓库根安装依赖：`pip install -r requirements.txt`。
2. 终端：`PY mcp_server.py`（进程应阻塞等待 stdio，无立即 traceback）。
3. 在 Cursor / Claude 中启用该 MCP，触发一次工具调用（例如 `get_fun_station_tip`）。

更完整的实现背景见 [mcp-server-plan.md](mcp-server-plan.md)。
