# 插件概述

ftre 的插件系统允许你在不修改核心代码的前提下，扩展 Agent 的能力。

## 插件是什么

插件是一个 Python 类，继承 `Plugin` 基类，放在 `~/.ftre/plugins/` 目录下。Gateway 启动时自动扫描并加载。

一个插件可以：

- **注册 Tool** — 给 Agent 添加新的工具
- **注册 Channel** — 添加新的输入/输出通道
- **注册 Hook** — 在 Agent 生命周期中插入自定义逻辑
- **读取配置** — 从 `~/.ftre/config.json` 获取插件专属配置

## 运行位置

```
~/.ftre/
├── config.json          ← 在这里配置插件
└── plugins/
    └── my_plugin.py     ← 在这里写插件代码
```

## 配置方式

在 `~/.ftre/config.json` 中添加 `plugins` 数组：

```json
{
  "plugins": [
    {
      "name": "my_plugin",
      "config": {
        "api_key": "xxx",
        "timeout": 30
      }
    }
  ]
}
```

- `name` — 必须与插件的 `name` 属性匹配
- `config` — 任意 JSON 对象，插件通过 `self.api.config` 读取

## 最简单的插件

```python
# ~/.ftre/plugins/hello_plugin.py
from ftre.plugin import Plugin

class HelloPlugin(Plugin):
    name = "hello"
    version = "1.0.0"

    def setup(self):
        print(f"[hello] 插件已加载，config={self.api.config}")

    def teardown(self):
        print("[hello] 插件已卸载")
```

## 禁止事项

- 文件名不要以 `_` 开头（会被跳过）
- `setup()` 方法必须实现（否则抛 NotImplementedError）
- hook 函数抛异常会被捕获跳过，不会拖垮主流程
