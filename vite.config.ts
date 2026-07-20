import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/ftre-docs/',
  plugins: [react()],
  assetsInclude: ['**/*.md'],
  server: {
    host: '127.0.0.1',
    strictPort: true,
    // 端口不在此硬编码：由 scripts/dev.mjs 读取 ~/.ftre/config.json 的
    // servers.docs.port 后通过 `vite --port` 传入。
  },
})
