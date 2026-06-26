// 文档站开发服务器启动脚本
//
// 端口以 ~/.ftre/config.json 的 servers.docs.port 为准，避免在 vite.config.ts
// 里硬编码。读不到配置时回退到 fallback 端口。
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const FALLBACK_PORT = 48652;
const CONFIG_PATH = join(process.env.USERPROFILE || homedir(), ".ftre", "config.json");

function resolvePort() {
    try {
        const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
        const port = cfg?.servers?.docs?.port;
        if (Number.isInteger(port)) return port;
    } catch {
        // 配置缺失/损坏时静默回退
    }
    return FALLBACK_PORT;
}

const port = resolvePort();
console.log(`[docs] 使用端口 ${port}（来源：${CONFIG_PATH} servers.docs.port，缺省 ${FALLBACK_PORT}）`);

// vite 的命令行 --port 会覆盖 vite.config.ts 中的默认值
const child = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["vite", "--port", String(port)],
    { stdio: "inherit", shell: false },
);

child.on("exit", (code) => process.exit(code ?? 0));
