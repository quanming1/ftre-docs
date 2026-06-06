# 快速开始

## 启动后端

```bash
cd E:\ftre-agent-core
py -m pip install -e .

cd E:\ftre
py -m pip install -e .
ftre gateway
```

Gateway 启动后监听：
- WebSocket：`ws://127.0.0.1:18790/`
- HTTP API：`http://127.0.0.1:18790/api/`

## 启动客户端

```bash
cd E:\binn\ftre-desktop
pnpm install
pnpm dev
```

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
