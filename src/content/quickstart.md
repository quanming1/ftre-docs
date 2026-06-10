# 快速开始

## 启动后端

```bash
cd E:\ftre-agent-core
py -m pip install -e .

cd E:\ftre
py -m pip install -e .
ftre gateway
```

Gateway 启动后默认监听：
- WebSocket：`ws://127.0.0.1:19470/`
- HTTP API：`http://127.0.0.1:19470/api/`

如需修改 Gateway 监听地址，设置 `~/.ftre/config.json` 的 `servers.gateway.host` / `servers.gateway.port`。

## 启动客户端

```bash
cd E:\binn\ftre-desktop
pnpm install
pnpm dev
```

当前桌面前端开发服务由 `packages/renderer/vite.config.ts` 配置，监听 `127.0.0.1:50000`；Electron 开发启动脚本会等待该地址可用后打开客户端。

## 配置文件

`~/.ftre/config.json`：

```json
{
  "agents": {
    "defaults": {
      "provider": "openai",
      "model": "gpt-4o",
      "workspace": "E:\\binn"
    }
  },
  "providers": {
    "openai": {
      "api_key": "sk-xxx",
      "api_base": "https://api.openai.com/v1",
      "api_protocol": "openai",
      "models": [
        {
          "id": "gpt-4o",
          "name": "GPT-4o",
          "context_window": 128000,
          "max_output": 16384,
          "vision": true
        }
      ]
    }
  }
}
```
