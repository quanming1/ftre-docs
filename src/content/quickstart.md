# 快速开始

## 启动后端

```bash
cd E:\ftre
pip install -e .
ftre gateway
```

Gateway 启动后监听：
- WebSocket：`ws://127.0.0.1:18790/`
- HTTP API：`http://127.0.0.1:18790/api/`

## 启动客户端

```bash
cd E:\binn\ftre-desktop
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
  }
}
```
