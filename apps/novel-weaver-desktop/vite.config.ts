import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// WF5-01：dev-only 桥件。`tauri dev` 下 __TAURI_INTERNALS__ 已存在，垫片 no-op；
// 仅浏览器（Playwright 基座）经 /__nw/* 走真实 local-core 进程。
import { novelWeaverLocalRpcBridge } from "./tests/harness/local-rpc-bridge";

export default defineConfig({
	plugins: [react(), tailwindcss(), novelWeaverLocalRpcBridge()],
	clearScreen: false,
	server: {
		port: 1420,
		strictPort: true,
	},
});
