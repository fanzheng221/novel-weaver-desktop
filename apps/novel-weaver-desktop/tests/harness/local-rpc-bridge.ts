/**
 * 真实 local-core 桥件（WF5-01）：dev-only vite 插件。
 *
 * 浏览器 e2e 基座与生产 Tauri 走同一条信封：UI invoke("query_project") →
 * 本插件把 {cwd, request} 原样写入常驻的 `node local-core/cli.ts`，
 * 按行读回 {ok:true,data} / {ok:false,error}。错误文案逐字复刻
 * src-tauri/src/main.rs 的 query_project 行为，保证后续票断言在人话
 * 错误上与真实桌面行为一致。业务 mock 禁止：任何响应都来自真实核心进程。
 */
import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";

import type { Plugin } from "vite";

const CORE_REQUEST_TIMEOUT_MS = 60_000;
const SHIM_PATH = "/__nw/shim.js";
const RPC_PATH = "/__nw/local-rpc";
const CONFIG_PATH = "/__nw/session-config";
const HEALTH_PATH = "/__nw/health";

/** main.rs 失败文案（无法启动/无效响应）在此 1:1 维护；人话错误走核心 /error/message。 */
export const BRIDGE_FAULTS = {
	/** 模拟本地核心进程整体不可用（spawn 失败等价物）。 */
	rpc_down: "无法启动 Novel Weaver 本地核心：模拟故障（e2e 注入 rpc_down）",
	/** 模拟陈旧核心：返回 Zod issues JSON 形态，触发 src/rpc.ts staleCore 判定。 */
	stale_core:
		'[{"code":"invalid_type","path":["request"],"message":"Invalid input"}]',
} as const;

export type BridgeFault = keyof typeof BRIDGE_FAULTS;

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (reason: BridgeRejection) => void;
	timer: NodeJS.Timeout;
}

/** 与 Tauri reject 字符串对齐：reject(message)。diagnostics 仅用于桥件日志。 */
class BridgeRejection extends Error {
	constructor(
		message: string,
		readonly diagnostics: string,
	) {
		super(message);
		this.name = "BridgeRejection";
	}
}

interface SessionConfig {
	/** default_project_path 返回值；空串表示“未检测到项目”（书架保持空）。 */
	defaultCwd: string;
	/** plugin:dialog|open 的目录选择结果；null 表示用户取消。 */
	dialogPath: string | null;
	/** 故障注入场景；"none" 表示正常转发真实核心。 */
	fault: "none" | BridgeFault;
}

class LocalCoreProcess {
	private proc: ChildProcess | null = null;
	private pending: PendingRequest[] = [];
	private stderrTail = "";

	constructor(
		private readonly coreEntryPath: string,
		private readonly cwd: string,
	) {}

	async request(payload: unknown): Promise<unknown> {
		const proc = this.ensureProcess();
		const method = (payload as { request?: { method?: string } })?.request?.method;
		const timeoutMs =
			method === "semantic_extension_install" || method === "rebuild_semantic_index"
				? 31 * 60_000
				: CORE_REQUEST_TIMEOUT_MS;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(
					new BridgeRejection(
						"本地核心响应超时，请重试。",
						`request timed out after ${timeoutMs}ms`,
					),
				);
			}, timeoutMs);
			this.pending.push({ resolve, reject, timer });
			proc.stdin!.write(`${JSON.stringify(payload)}\n`, (error) => {
				if (error) this.failPending(`写入本地核心失败：${error.message}`);
			});
		});
	}

	/** Long extension operations need an independent process so status/cancel can pass. */
	async requestIsolated(payload: unknown): Promise<unknown> {
		const isolated = new LocalCoreProcess(this.coreEntryPath, this.cwd);
		try {
			return await isolated.request(payload);
		} finally {
			isolated.dispose();
		}
	}

	dispose(): void {
		if (this.proc) {
			this.proc.kill();
			this.proc = null;
		}
		for (const entry of this.pending.splice(0)) {
			clearTimeout(entry.timer);
			entry.reject(new BridgeRejection("本地核心请求失败", "bridge disposed"));
		}
	}

	private ensureProcess(): ChildProcess {
		if (this.proc && this.proc.exitCode === null && !this.proc.killed) {
			return this.proc;
		}
		const proc = spawn(process.execPath, [this.coreEntryPath], {
			cwd: this.cwd,
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.proc = proc;
		this.stderrTail = "";
		proc.stdout!.setEncoding("utf8");
		const lines = createInterface({ input: proc.stdout!, crlfDelay: Infinity });
		lines.on("line", (line) => this.onResponse(line));
		proc.stderr!.setEncoding("utf8");
		proc.stderr!.on("data", (chunk: string) => {
			this.stderrTail = `${this.stderrTail}${chunk}`.slice(-2000);
		});
		proc.on("exit", (code, signal) => {
			if (this.proc !== proc) return;
			this.proc = null;
			const reason = `无法启动 Novel Weaver 本地核心：进程退出 code=${code ?? "null"} signal=${signal ?? "null"}`;
			console.error(
				`[nw-bridge] ${reason}；核心诊断：${this.stderrTail.trim() || "(无)"}`,
			);
			this.failPending(reason);
		});
		return proc;
	}

	private onResponse(line: string): void {
		const trimmed = line.trim();
		if (!trimmed) return;
		const entry = this.pending.shift();
		if (!entry) return;
		clearTimeout(entry.timer);
		let response: {
			ok?: boolean;
			data?: unknown;
			error?: { message?: string };
		};
		try {
			response = JSON.parse(trimmed);
		} catch (error) {
			entry.reject(
				new BridgeRejection(
					"本地核心返回了无效响应",
					`${error instanceof Error ? error.message : String(error)}; raw=${trimmed.slice(0, 300)}`,
				),
			);
			return;
		}
		if (response.ok === true) {
			entry.resolve(response.data);
			return;
		}
		entry.reject(
			new BridgeRejection(
				response.error?.message ?? "本地核心请求失败",
				this.stderrTail.trim(),
			),
		);
	}

	private failPending(reason: string): void {
		for (const entry of this.pending.splice(0)) {
			clearTimeout(entry.timer);
			entry.reject(new BridgeRejection(reason, this.stderrTail.trim()));
		}
	}
}

function readJsonBody(
	req: import("node:http").IncomingMessage,
): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch (error) {
				reject(error);
			}
		});
		req.on("error", reject);
	});
}

function sendJson(
	res: import("node:http").ServerResponse,
	status: number,
	body: unknown,
): void {
	res.statusCode = status;
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.end(JSON.stringify(body));
}

export function novelWeaverLocalRpcBridge(): Plugin {
	// vite.config 以打包形式加载：桌面根目录必须取 configResolved 的 root，
	// 而不是 import.meta（打包后不可靠，WF5-01 实测）。
	let core: LocalCoreProcess | null = null;
	const requireCore = (): LocalCoreProcess => {
		if (!core) throw new Error("桥件尚未解析桌面根目录");
		return core;
	};
	const config: SessionConfig = {
		defaultCwd: "",
		dialogPath: null,
		fault: "none",
	};

	return {
		name: "novel-weaver-local-rpc-bridge",
		apply: "serve",
		configResolved(resolved) {
			const desktopRoot = resolved.root;
			core = new LocalCoreProcess(
				path.join(desktopRoot, "local-core", "cli.ts"),
				desktopRoot,
			);
		},
		transformIndexHtml(html) {
			// 先于一切模块执行；已处于 Tauri 运行态时 shim 自行 no-op。
			return {
				html,
				tags: [
					{
						tag: "script",
						attrs: { src: SHIM_PATH },
						injectTo: "head-prepend",
					},
				],
			};
		},
		configureServer(server) {
			server.middlewares.use(SHIM_PATH, (_req, res) => {
				res.setHeader("content-type", "text/javascript; charset=utf-8");
				res.end(buildShimSource());
			});
			server.middlewares.use(CONFIG_PATH, (req, res) => {
				if (req.method === "POST") {
					void readJsonBody(req).then((body) => {
						const patch = body as Partial<SessionConfig>;
						if (typeof patch.defaultCwd === "string")
							config.defaultCwd = patch.defaultCwd;
						config.dialogPath =
							patch.dialogPath === null || typeof patch.dialogPath === "string"
								? (patch.dialogPath ?? null)
								: config.dialogPath;
						if (
							patch.fault === "none" ||
							patch.fault === "rpc_down" ||
							patch.fault === "stale_core"
						) {
							config.fault = patch.fault;
						}
						sendJson(res, 200, config);
					});
					return;
				}
				sendJson(res, 200, config);
			});
			server.middlewares.use(HEALTH_PATH, (_req, res) => {
				sendJson(res, 200, { ok: true });
			});
			server.middlewares.use(RPC_PATH, (req, res) => {
				void (async () => {
					let payload: unknown;
					try {
						payload = await readJsonBody(req);
					} catch (error) {
						sendJson(res, 400, {
							message: `桥件收到无法解析的请求：${error instanceof Error ? error.message : String(error)}`,
						});
						return;
					}
					const method =
						typeof payload === "object" &&
						payload !== null &&
						typeof (payload as { request?: { method?: unknown } }).request ===
							"object"
							? String(
									(payload as { request: { method?: unknown } }).request
										.method ?? "",
								)
							: "";
					console.log(
						`[nw-bridge] ${method} cwd=${
							typeof payload === "object" && payload !== null
								? String((payload as { cwd?: unknown }).cwd ?? "")
								: ""
						}`,
					);
					if (config.fault !== "none") {
						// 故障注入只发生在传输层：错误形态与真实核心失败一致。
						sendJson(res, 200, { message: BRIDGE_FAULTS[config.fault] });
						return;
					}
					try {
						const envelope = await (method.startsWith("semantic_extension_") || method === "rebuild_semantic_index"
							? requireCore().requestIsolated(payload) : requireCore().request(payload));
						sendJson(res, 200, { ok: true, data: envelope });
					} catch (error) {
						const rejection =
							error instanceof BridgeRejection
								? error
								: new BridgeRejection(String(error), "");
						if (rejection.diagnostics) {
							console.error(
								`[nw-bridge] 核心诊断输出：${rejection.diagnostics}`,
							);
						}
						sendJson(res, 200, { message: rejection.message });
					}
				})();
			});
			server.httpServer?.once("close", () => core?.dispose());
		},
		closeBundle() {
			core?.dispose();
		},
	};
}

/** 浏览器端 Tauri invoke 垫片源码。Tauri 运行态下原样存在，垫片静默退出。 */
function buildShimSource(): string {
	return `;(function () {
  if (window.__TAURI_INTERNALS__) return;
  var log = (window.__NW_RPC_LOG__ = []);
  function jget(url) { return fetch(url).then(function (r) { return r.json(); }); }
  function postRpc(body) {
    return fetch(${JSON.stringify(RPC_PATH)}, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json(); }).then(function (payload) {
      if (payload.ok === true) return payload;
      // Tauri 对 Err(String) 的语义是 reject 同一个字符串；
      // 垫片必须 1:1 复刻，否则人话错误会退化成 [object Object]。
      throw typeof payload.message === 'string' ? payload.message : new Error('本地核心请求失败');
    });
  }
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    plugins: {},
    transformCallback: function (cb) { return cb; },
    invoke: function (cmd, args) {
      log.push({ cmd: cmd, args: args, at: Date.now() });
      switch (cmd) {
        case 'query_project':
          return postRpc(args);
        case 'default_project_path':
          return jget(${JSON.stringify(CONFIG_PATH)}).then(function (c) {
            if (!c.defaultCwd) throw '未检测到项目目录';
            return c.defaultCwd;
          });
        case 'plugin:dialog|open':
          return jget(${JSON.stringify(CONFIG_PATH)}).then(function (c) {
            return c.dialogPath;
          });
        case 'byok_key_tail':
          // e2e 垫片（WF5-09）：钥匙串语义由真实桌面承载；这里恒有 Key，
          // 让 BYOK 门禁放行，补全内容由 NW_COMPLETION_FIXTURE 提供。
          return Promise.resolve('sk-e2e');
        case 'byok_save_key':
          return Promise.resolve(null);
        case 'byok_probe_config':
        case 'byok_probe':
          return Promise.resolve({ ok: true, status: 200, hint: '连通正常（e2e 垫片）' });
        default:
          return Promise.reject('浏览器基座未模拟命令：' + cmd);
      }
    },
  };
})();
`;
}
