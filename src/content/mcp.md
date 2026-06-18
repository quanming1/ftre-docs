# MCP 服务器

ftre 支持 MCP（Model Context Protocol），让 Agent 能调用外部工具服务器扩展能力。

## 快速开始

在 `config.json` 中新增 `"mcp"` 字段，Gateway 启动后自动连接。

## 支持的类型

### local（本地 stdio）

通过启动本地进程连接 MCP 服务器，适合 Chrome 扩展、浏览器自动化等本地工具。

```json
{
  "mcp": {
    "my-server": {
      "type": "local",
      "command": ["npx", "-y", "@scope/mcp-server@latest"],
      "environment": {},
      "disabled": false,
      "timeout": 60000
    }
  }
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `type` | ✅ | `"local"` |
| `command` | ✅ | 启动命令，首位可执行文件，后续为参数 |
| `environment` |  | 环境变量 dict |
| `disabled` |  | `true` 时跳过连接 |
| `timeout` |  | 毫秒，默认 30000 |

### remote（远程 HTTP）

通过 HTTP 连接远程 MCP 服务器。

```json
{
  "mcp": {
    "remote-server": {
      "type": "remote",
      "url": "https://mcp.example.com",
      "headers": {
        "Authorization": "Bearer <token>"
      },
      "disabled": false,
      "timeout": 30000
    }
  }
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `type` | ✅ | `"remote"` |
| `url` | ✅ | HTTP endpoint |
| `headers` |  | 请求头 dict |
| `disabled` |  | `true` 时跳过连接 |
| `timeout` |  | 毫秒，默认 30000 |

## 工具调用

MCP 工具自动注册到 Agent，命名格式 `mcp__{server}__{tool}`。例如 Playwright 服务器的导航工具：

```
mcp__playwright__browser_navigate
```

Agent 在系统提示词中会收到所有可用 MCP 工具的说明，无需手动配置。

## 管理接口

### 前端设置入口

当前桌面端有两个 MCP 入口：

- **标题栏 🔌 按钮**：弹出 `McpPopover`，可查看服务器状态、快速启/禁用，并跳转到设置页
- **全局设置对话框的 MCP section**：`SettingsDialog` 已支持 `section: "mcp"`，并渲染 `McpSettings`

> 注意：旧的 `SettingsPanel` 首页当前只内置了 `agents / models / gateway` 三个入口；MCP 不在这个首页列表里，但并不影响通过标题栏或 `ftre:open-settings` 事件直接进入 MCP 设置。`settings-events.ts` 里的 `SettingsSection` 联合类型也已包含 `"mcp"`。

`McpSettings` 提供完整管理：

- **查看**：卡片列表显示所有服务器及连接状态
- **添加**：填写 type、command/url 等字段创建新服务器
- **编辑**：点击卡片展开详情修改配置
- **删除**：确认后移除服务器并断开连接
- **开关**：启/禁用服务器（不删除配置）

### 标题栏快捷面板

点击标题栏 🔌 按钮弹出 MCP 面板：

- 显示所有已配置服务器及其状态（🟢 已连接 / 🔴 离线）
- iOS 风格 toggle 快速开/关服务器
- 一键跳转设置页做详细配置

### API 端点

所有操作通过 REST API 热生效，无需重启 Gateway：

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET` | `/api/mcp` | 列出所有服务器及状态 |
| `POST` | `/api/mcp` | 创建服务器并立即连接 |
| `PATCH` | `/api/mcp/{name}` | 更新配置并增量重连 |
| `DELETE` | `/api/mcp/{name}` | 删除并断开连接 |

## 热重载

配置变更后自动增量重连，只重连变更的服务器：

- **添加**：新服务器立即可用
- **更新**：断开旧连接 → 新配置重新连接
- **删除**：断开连接 → 注销工具
- **启/禁用**：等同于添加/删除

除了通过 API 立即触发热重载外，Gateway 还会每 3 秒轮询一次 `config.json` 的 `mcp` 段变化，作为文件级兜底 watcher。

## 推荐的 MCP 服务器

| 服务器 | 类型 | 说明 |
|--------|------|------|
| `@playwright/mcp` | local | 浏览器自动化，导航/截图/表单/点击 |
| `@browsermcp/mcp` | local | Chrome 扩展控制的浏览器工具 |
| `design-mode-mcp` | local | 页面 UI 样式编辑（hover 高亮、注释、截图） |

## 配置示例（完整）

```json
{
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["npx", "@playwright/mcp@latest"],
      "environment": {},
      "disabled": false,
      "timeout": 60000
    },
    "design-mode": {
      "type": "local",
      "command": ["npx", "-y", "design-mode-mcp"],
      "environment": { "CDP_PORT": "9222" },
      "disabled": false,
      "timeout": 60000
    },
    "browsermcp": {
      "type": "local",
      "command": ["npx", "-y", "@browsermcp/mcp@latest"],
      "environment": {},
      "disabled": true,
      "timeout": 60000
    }
  }
}
```