import { invoke } from "@tauri-apps/api/core";

export interface QueryEnvelope<T> {
	ok: true;
	data: T;
}

export interface CoreVersionInfo {
	rpcVersion: number;
	methodCount: number;
}

/** 界面所依赖的本地 RPC 协议版本；核心实测低于此值即视为过旧（WF3-02）。 */
export const EXPECTED_LOCAL_RPC_VERSION = 16;

/**
 * 本地核心错误的统一出口：message 永远是人话，原始细节保留在 rawDetail（WF5-19）。
 * 视图展示错误一律经 authorErrorMessage 取 message；rawDetail 只进可展开详情。
 */
export class CoreRpcError extends Error {
	readonly staleCore: boolean;
	readonly rawDetail: string;

	constructor(
		message: string,
		options: { staleCore?: boolean; rawDetail?: string } = {},
	) {
		super(message);
		this.name = "CoreRpcError";
		this.staleCore = options.staleCore ?? false;
		this.rawDetail = options.rawDetail ?? "";
	}

	/** 兜底：即使视图漏改仍写 String(error)，也不会把类名前缀灌给作者。 */
	override toString(): string {
		return this.message;
	}
}

/** 作者可见错误文案的唯一出口：Error 取 message，其余形态安全转字符串。 */
export function authorErrorMessage(detail: unknown): string {
	if (detail instanceof Error) return detail.message;
	if (typeof detail === "string") return detail;
	if (typeof detail === "object" && detail !== null) {
		const message = (detail as { message?: unknown }).message;
		if (typeof message === "string" && message.trim() !== "") return message;
	}
	return String(detail);
}

const STALE_CORE_MARKERS = [
	'"code":"invalid_union"',
	'"code":"unrecognized_keys"',
	'"code":"invalid_type"',
	"Invalid option: expected one of",
];

function looksLikeStaleCore(message: string): boolean {
	if (STALE_CORE_MARKERS.some((marker) => message.includes(marker)))
		return true;
	// 陈旧核心把 ZodError 的 issues JSON 原样塞进 message：以 zod 转储形态出现。
	return /^\s*\[\s*\{"/.test(message) && /"(code|path)"\s*:/.test(message);
}

function truncate(text: string, max = 300): string {
	const clean = text.replace(/\s+/g, " ").trim();
	return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

function toCoreRpcError(raw: unknown, method: string): CoreRpcError {
	const message = raw instanceof Error ? raw.message : String(raw);
	if (/Artifact proposal is stale|Artifact source version is stale/.test(message)) {
		return new CoreRpcError("正式规划已更新，这份提案基于旧版本。请在待审提案中核对最新内容并重新提交，再确认纳入。", { rawDetail: message });
	}
	if (looksLikeStaleCore(message)) {
		return new CoreRpcError(
			`本地核心版本过旧，无法执行「${method}」。请重新打包或更新应用后重试。`,
			{ staleCore: true, rawDetail: message },
		);
	}
	return new CoreRpcError(truncate(message), { rawDetail: message });
}

/** 桌面端统一 RPC 入口：经 Tauri 命令唤起本地核心（ADR-0072/0073）。 */
export async function queryProject<T>(
	cwd: string,
	method: string,
	params: unknown,
): Promise<T> {
	try {
		const response = await invoke<QueryEnvelope<T>>("query_project", {
			cwd,
			request: { method, params },
		});
		return response.data;
	} catch (raw) {
		throw toCoreRpcError(raw, method);
	}
}

export function defaultProjectPath(): Promise<string> {
	return invoke<string>("default_project_path");
}

/** 启动握手：探测本地核心协议版本（WF3-02）。 */
export function fetchCoreVersion(cwd: string): Promise<CoreVersionInfo> {
	return queryProject<CoreVersionInfo>(cwd, "core_version", {});
}
