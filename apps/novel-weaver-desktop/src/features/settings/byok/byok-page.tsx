import {
	ProviderConnectionSchema,
	resolveProviderEndpoint,
	type ProviderAdapter,
	type ProviderRequestOptions,
} from "novel-weaver-core/src/domain/provider-config.ts";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

import { authorErrorMessage } from "../../../shared/api/rpc";

import {
	Button,
	Chip,
	InlineNote,
	PAGE,
	Panel,
	TextField,
} from "../../../shared/ui/components";
import { cx } from "../../../shared/ui/cx";
import { SemanticExtensionPanel } from "../SemanticExtensionPanel";
import { UsagePanel } from "./usage-panel";

interface Provider {
	id: string;
	name: string;
	adapter: ProviderAdapter;
	requestOptions?: ProviderRequestOptions;
	baseURL: string;
	modelId: string;
}

type SlotKey = "generation" | "review" | "embedding";
const SLOT_LABEL: Record<SlotKey, string> = {
	generation: "正文生成",
	review: "QC 审校",
	embedding: "嵌入（检索）",
};

const PROVIDER_TEMPLATES: Array<Omit<Provider, "id">> = [
	{
		name: "DeepSeek",
		adapter: "openai_chat",
		baseURL: "https://api.deepseek.com/v1",
		modelId: "deepseek-v4-flash",
		requestOptions: { temperature: null },
	},
	{
		name: "通义千问",
		adapter: "openai_chat",
		baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
		modelId: "qwen-plus",
		requestOptions: { temperature: null, enableThinking: false },
	},
	{
		name: "Kimi",
		adapter: "openai_chat",
		baseURL: "https://api.moonshot.cn/v1",
		modelId: "",
		requestOptions: { temperature: null },
	},
	{
		name: "智谱 GLM",
		adapter: "openai_chat",
		baseURL: "https://open.bigmodel.cn/api/paas/v4",
		modelId: "",
		requestOptions: { temperature: null },
	},
	{
		name: "火山方舟 / 豆包",
		adapter: "openai_chat",
		baseURL: "https://ark.cn-beijing.volces.com/api/v3",
		modelId: "",
		requestOptions: { temperature: null },
	},
	{
		name: "硅基流动",
		adapter: "openai_chat",
		baseURL: "https://api.siliconflow.cn/v1",
		modelId: "",
		requestOptions: { temperature: null },
	},
	{
		name: "OpenAI",
		adapter: "openai_chat",
		baseURL: "https://api.openai.com/v1",
		modelId: "",
		requestOptions: {
			temperature: null,
			tokenParameter: "max_completion_tokens",
		},
	},
	{
		name: "自定义 / 中转站",
		adapter: "openai_chat",
		baseURL: "",
		modelId: "",
		requestOptions: { temperature: null },
	},
	{
		name: "Ollama 本地",
		adapter: "openai_chat",
		baseURL: "http://127.0.0.1:11434/v1",
		requestOptions: { authMode: "none" },
		modelId: "",
	},
	{
		name: "Anthropic",
		adapter: "anthropic_messages",
		baseURL: "https://api.anthropic.com",
		modelId: "",
	},
];

const STORAGE_PROVIDERS = "nw-byok-providers";
const STORAGE_SLOTS = "nw-byok-slots";

function loadJson<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : fallback;
	} catch {
		return fallback;
	}
}

interface ProbeResult {
	ok: boolean;
	status: number;
	hint: string;
	detail?: string;
}

export function ByokPage({ cwd }: { cwd: string }) {
	const [providers, setProviders] = useState<Provider[]>([]);
	const [slots, setSlots] = useState<Record<SlotKey, string>>({
		generation: "",
		review: "",
		embedding: "",
	});
	const [tails, setTails] = useState<Record<string, string>>({});
	const [draft, setDraft] = useState<Provider>({
		...PROVIDER_TEMPLATES[0],
		id: "",
	});
	const [keyDraft, setKeyDraft] = useState("");
	const [saving, setSaving] = useState(false);
	const [testing, setTesting] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const updateOptions = (patch: Partial<ProviderRequestOptions>) =>
		setDraft((current) => ({
			...current,
			requestOptions: { ...current.requestOptions, ...patch },
		}));
	const endpointPreview = (() => {
		try {
			return resolveProviderEndpoint(draft.baseURL, draft.adapter);
		} catch {
			return "";
		}
	})();
	const [editing, setEditing] = useState<string | null>(null);
	const [probe, setProbe] = useState<{
		id: string;
		result: ProbeResult;
	} | null>(null);
	/** 错误就近呈现（WF3-10 ⑥）：form=表单内、provider id=该行下方、page=页级兜底。 */
	const [error, setError] = useState<{
		message: string;
		zone: "form" | "page" | (string & {});
	} | null>(null);

	useEffect(() => {
		setProviders(loadJson<Provider[]>(STORAGE_PROVIDERS, []));
		setSlots(
			loadJson<Record<SlotKey, string>>(STORAGE_SLOTS, {
				generation: "",
				review: "",
				embedding: "",
			}),
		);
	}, []);

	const persistProviders = useCallback((next: Provider[]) => {
		localStorage.setItem(STORAGE_PROVIDERS, JSON.stringify(next));
		setProviders(next);
	}, []);

	const persistSlots = useCallback((next: Record<SlotKey, string>) => {
		try {
			localStorage.setItem(STORAGE_SLOTS, JSON.stringify(next));
			setSlots(next);
		} catch {
			setError({ message: "槽位保存失败，请检查本机存储空间。", zone: "page" });
		}
	}, []);

	const refreshTail = useCallback((id: string) => {
		void invoke<string | null>("byok_key_tail", { providerId: id })
			.then((tail) =>
				setTails((current) => ({
					...current,
					[id]: tail ? `已存入钥匙串（尾四位 ${tail}）` : "未设置 Key",
				})),
			)
			.catch((detail) =>
				setError({ message: authorErrorMessage(detail), zone: "page" }),
			);
	}, []);

	useEffect(() => {
		for (const provider of providers) {
			if (provider.requestOptions?.authMode !== "none")
				refreshTail(provider.id);
		}
	}, [providers, refreshTail]);

	const startEdit = (provider: Provider) => {
		setEditing(provider.id);
		setDraft(provider);
		setKeyDraft("");
		setError(null);
		setSaved(false);
		setProbe(null);
	};

	const saveProvider = async () => {
		if (saving) return;
		setSaving(true);
		setSaved(false);
		try {
			if (!draft.name.trim()) throw new Error("请填写服务商名称。");
			const config = ProviderConnectionSchema.safeParse(draft);
			if (!config.success)
				throw new Error(
					"请检查接口地址、模型 ID 和高级参数；地址须为 HTTP(S)，不含账号、查询参数或锚点。",
				);
			resolveProviderEndpoint(config.data.baseURL, config.data.adapter);
			const provider: Provider = {
				...config.data,
				name: draft.name.trim(),
				id: editing ?? (draft.id || `prov-${crypto.randomUUID()}`),
			};
			// Retain the final id when a keychain or storage write fails, so retry is safe.
			setDraft(provider);
			if (keyDraft.trim() && provider.requestOptions?.authMode !== "none") {
				await invoke("byok_save_key", {
					providerId: provider.id,
					key: keyDraft.trim(),
				});
				setKeyDraft("");
			}
			const next = editing
				? providers.map((item) => (item.id === editing ? provider : item))
				: [...providers, provider];
			persistProviders(next);
			setEditing(provider.id);
			if (provider.requestOptions?.authMode !== "none")
				refreshTail(provider.id);
			setError(null);
			setSaved(true);
		} catch (detail) {
			setError({ message: authorErrorMessage(detail), zone: "form" });
		} finally {
			setSaving(false);
		}
	};

	const removeProvider = async (provider: Provider) => {
		try {
			await invoke("byok_delete_key", { providerId: provider.id });
			persistProviders(providers.filter((item) => item.id !== provider.id));
			persistSlots(
				Object.fromEntries(
					Object.entries(slots).map(([slot, id]) => [
						slot,
						id === provider.id ? "" : id,
					]),
				) as Record<SlotKey, string>,
			);
			if (editing === provider.id) {
				setEditing(null);
				setDraft({ ...PROVIDER_TEMPLATES[0], id: "" });
			}
		} catch (detail) {
			setError({ message: authorErrorMessage(detail), zone: provider.id });
		}
	};

	const testProvider = async (
		provider: Provider,
		freshKey?: string,
		zone?: "form" | (string & {}),
	) => {
		if (testing !== null) return;
		setTesting(zone ?? provider.id);
		setProbe(null);
		try {
			const config = ProviderConnectionSchema.safeParse(provider);
			if (!config.success)
				throw new Error("请先填写有效的接口地址、模型 ID 和参数。");
			resolveProviderEndpoint(config.data.baseURL, config.data.adapter);
			const result = await invoke<ProbeResult>("byok_probe_config", {
				config: {
					providerId: provider.id,
					adapter: provider.adapter,
					baseUrl: provider.baseURL,
					modelId: provider.modelId,
					apiKey: freshKey ?? null,
					requestOptions: provider.requestOptions,
				},
			});
			setProbe({ id: zone ?? provider.id, result });
			setError(null);
		} catch (detail) {
			setError({
				message: authorErrorMessage(detail),
				zone: zone ?? provider.id,
			});
		} finally {
			setTesting(null);
		}
	};

	return (
		<main className={PAGE}>
			<header>
				<p className="eyebrow">NOVEL WEAVER / BYOK</p>
				<h1 className="font-wenkai text-[22px] mt-0.5 mb-0 mx-0">模型接入</h1>
				<p className="text-[12px] text-ink-low mt-1">
					API Key 存入系统钥匙串，界面只显示尾四位；非敏感的接入配置保存在本机。
				</p>
			</header>

			{error?.zone === "page" ? (
				<InlineNote tone="danger">{error.message}</InlineNote>
			) : null}

			<Panel title={`服务商 · ${providers.length}`}>
				{providers.length === 0 ? (
					<p className="text-[12px] text-ink-mid">
						从下方选择国内服务商、本地模型或中转站模板，再填写平台提供的模型
						ID。
					</p>
				) : (
					<div className="grid gap-2">
						{providers.map((provider) => (
							<div
								key={provider.id}
								className="border-t border-line pt-2 pb-2 px-0.5"
							>
								<div className="flex items-center gap-2 flex-wrap">
									<b className="text-[13px]">{provider.name}</b>
									<Chip>
										{
											{
												openai_chat: "Chat Completions",
												anthropic_messages: "Messages",
												openai_responses: "Responses",
											}[provider.adapter]
										}
									</Chip>
									<span className="num text-[11px] text-ink-low">
										{provider.modelId}
									</span>
									<span
										className={cx(
											"ml-auto text-[11px]",
											tails[provider.id] ? "text-ok" : "text-ink-low",
										)}
									>
										{provider.requestOptions?.authMode === "none"
											? "无需 API Key"
											: (tails[provider.id] ?? "…")}
									</span>
								</div>
								<div className="num text-[10.5px] text-ink-low mt-1 mb-2 break-all">
									{provider.baseURL}
								</div>
								<div className="flex gap-1 flex-wrap">
									<Button
										variant="primary"
										busy={testing === provider.id}
										disabled={saving || testing !== null}
										onClick={() => void testProvider(provider)}
									>
										连通测试
									</Button>
									<Button
										disabled={saving || testing !== null}
										onClick={() => startEdit(provider)}
									>
										编辑
									</Button>
									<Button
										disabled={saving || testing !== null}
										onClick={() => void removeProvider(provider)}
									>
										移除
									</Button>
								</div>
								{probe?.id === provider.id ? (
									<p
										className={cx(
											"text-[11.5px] mt-2 mb-0",
											probe.result.ok ? "text-ok" : "text-danger font-semibold",
										)}
									>
										[{probe.result.status}] {probe.result.hint}
										{probe.result.detail ? ` · ${probe.result.detail}` : ""}
									</p>
								) : null}
								{error?.zone === provider.id ? (
									<div className="mt-2">
										<InlineNote tone="danger">{error.message}</InlineNote>
									</div>
								) : null}
							</div>
						))}
					</div>
				)}
			</Panel>

			<Panel title={editing ? "编辑服务商" : "新增服务商"}>
				<fieldset
					disabled={saving || testing !== null}
					onChange={() => {
						setSaved(false);
						setProbe(null);
					}}
					className="grid gap-2 border-0 p-0 m-0 min-w-0 wrap-break-word"
				>
					<div className="flex gap-1 flex-wrap">
						{PROVIDER_TEMPLATES.map((template) => (
							<Button
								key={template.name}
								onClick={() => {
									setEditing(null);
									setDraft({ ...template, id: "" });
									setProbe(null);
									setError(null);
									setSaved(false);
									setKeyDraft("");
								}}
							>
								{template.name} 模板
							</Button>
						))}
					</div>
					<TextField
						label="名称"
						value={draft.name}
						onChange={(name) => setDraft({ ...draft, name })}
					/>
					<label className="grid gap-1">
						<span className="eyebrow">接口协议</span>
						<select
							value={draft.adapter}
							onChange={(event) =>
								setDraft({
									...draft,
									adapter: event.target.value as Provider["adapter"],
								})
							}
							className="bg-shell border border-line rounded-sm text-ink-hi text-[12.5px] px-2 py-1"
						>
							<option value="openai_chat">
								OpenAI 兼容（chat/completions）
							</option>
							<option value="anthropic_messages">Anthropic Messages</option>
							<option value="openai_responses">OpenAI Responses</option>
						</select>
					</label>
					<TextField
						label="接口地址（Base URL 或完整端点）"
						hint={
							endpointPreview
								? `实际请求：${endpointPreview}`
								: "可填域名、带版本的路径或完整接口地址；保留中转站的路径前缀。"
						}
						value={draft.baseURL}
						onChange={(baseURL) => setDraft({ ...draft, baseURL })}
					/>
					<TextField
						label="默认模型 ID"
						hint="按平台控制台填写模型名或接入点 ID，可包含 /，不受服务商品牌限制。"
						value={draft.modelId}
						onChange={(modelId) => setDraft({ ...draft, modelId })}
					/>
					<label className="grid gap-1">
						<span className="eyebrow">
							API Key{editing ? "（留空保持不变）" : "（存入系统钥匙串）"}
						</span>
						<input
							type="password"
							autoComplete="new-password"
							value={keyDraft}
							onChange={(event) => setKeyDraft(event.target.value)}
							className="bg-shell border border-line rounded-sm text-ink-hi text-body px-2 py-1"
						/>
					</label>
					<details className="border-t border-line pt-2">
						<summary className="cursor-pointer text-[12.5px]">
							高级设置（中转站 / 推理模型）
						</summary>
						<div className="grid gap-2 mt-2">
							<label className="grid gap-1">
								<span className="eyebrow">鉴权方式</span>
								<select
									className="bg-shell border border-line rounded-sm px-2 py-1"
									value={draft.requestOptions?.authMode ?? "auto"}
									onChange={(event) =>
										updateOptions({
											authMode: event.target
												.value as ProviderRequestOptions["authMode"],
										})
									}
								>
									<option value="auto">按协议自动选择</option>
									<option value="bearer">Bearer Token</option>
									<option value="x-api-key">x-api-key</option>
									<option value="none">无需鉴权（如本地 Ollama）</option>
								</select>
							</label>
							{draft.adapter !== "anthropic_messages" ? (
								<label className="grid gap-1">
									<span className="eyebrow">思考模式（enable_thinking）</span>
									<select
										className="bg-shell border border-line rounded-sm px-2 py-1"
										value={
											draft.requestOptions?.enableThinking === undefined
												? "default"
												: String(draft.requestOptions.enableThinking)
										}
										onChange={(event) =>
											updateOptions({
												enableThinking:
													event.target.value === "default"
														? undefined
														: event.target.value === "true",
											})
										}
									>
										<option value="default">模型默认（不发送）</option>
										<option value="false">关闭（千问非流式兼容）</option>
										<option value="true">开启（模型须支持非流式思考）</option>
									</select>
									<span className="text-[11.5px] text-ink-low">
										仅适用于支持 enable_thinking
										的平台；其他平台请选择模型默认。
									</span>
								</label>
							) : null}
							<TextField
								label="最大输出 Token"
								value={String(draft.requestOptions?.maxTokens ?? 4096)}
								onChange={(value) =>
									updateOptions({ maxTokens: Number(value) })
								}
								hint="推理过程也可能占用输出预算，请按模型限制调整。"
							/>
							<TextField
								label="温度（留空使用模型默认）"
								value={
									draft.requestOptions?.temperature === null
										? ""
										: String(draft.requestOptions?.temperature ?? 0.85)
								}
								onChange={(value) =>
									updateOptions({
										temperature: value.trim() ? Number(value) : null,
									})
								}
								hint="部分推理模型不接受 temperature，留空即可不发送此参数。"
							/>
							{draft.adapter === "openai_chat" ? (
								<label className="grid gap-1">
									<span className="eyebrow">Token 参数名</span>
									<select
										className="bg-shell border border-line rounded-sm px-2 py-1"
										value={draft.requestOptions?.tokenParameter ?? "max_tokens"}
										onChange={(event) =>
											updateOptions({
												tokenParameter: event.target
													.value as ProviderRequestOptions["tokenParameter"],
											})
										}
									>
										<option value="max_tokens">max_tokens（通用）</option>
										<option value="max_completion_tokens">
											max_completion_tokens（部分推理模型）
										</option>
									</select>
								</label>
							) : null}
							<TextField
								label="请求超时（秒）"
								value={String(draft.requestOptions?.timeoutSeconds ?? 120)}
								onChange={(value) =>
									updateOptions({ timeoutSeconds: Number(value) })
								}
								hint="5–600 秒；连通测试会产生少量模型用量。"
							/>
						</div>
					</details>
					<div className="flex gap-1">
						<Button
							variant="primary"
							busy={saving}
							onClick={() => void saveProvider()}
						>
							{saving ? "保存中…" : editing ? "保存修改" : "添加服务商"}
						</Button>
						<Button
							busy={testing === "form"}
							onClick={() =>
								void testProvider(draft, keyDraft.trim() || undefined, "form")
							}
						>
							{testing === "form" ? "测试中…" : "测试当前配置"}
						</Button>
					</div>
					{saved ? (
						<p role="status" className="text-ok text-[12px] m-0">
							配置已保存
						</p>
					) : null}
					{probe?.id === "form" ? (
						<p
							role="status"
							className={cx(
								"text-[12px] m-0",
								probe.result.ok ? "text-ok" : "text-danger",
							)}
						>
							[{probe.result.status}] {probe.result.hint}
							{probe.result.detail ? ` · ${probe.result.detail}` : ""}
						</p>
					) : null}
					{error?.zone === "form" ? (
						<InlineNote tone="danger">{error.message}</InlineNote>
					) : null}
				</fieldset>
			</Panel>

			<SemanticExtensionPanel cwd={cwd} />
			<Panel title="任务槽位分配">
				<div className="grid gap-2">
					{(Object.keys(SLOT_LABEL) as SlotKey[]).filter((slot) => slot !== "embedding").map((slot) => (
						<label
							key={slot}
							className="grid grid-cols-[120px_1fr] gap-2 items-center"
						>
							<span className="eyebrow">{SLOT_LABEL[slot]}</span>
							<select
								aria-label={SLOT_LABEL[slot]}
								value={slots[slot]}
								onChange={(event) =>
									persistSlots({ ...slots, [slot]: event.target.value })
								}
								className="bg-shell border border-line rounded-sm text-ink-hi text-[12.5px] px-2 py-1"
							>
								<option value="">未分配</option>
								{providers.map((provider) => (
									<option key={provider.id} value={provider.id}>
										{provider.name} · {provider.modelId}
									</option>
								))}
							</select>
						</label>
					))}
					<p className="text-[10.5px] text-ink-low m-0">
						正文生成、讨论与正文检查使用写作助手当前选择的服务商和参数。审校槽位暂仅保存配置；检索由上方语义检索扩展设置控制。
					</p>
				</div>
			</Panel>

			<UsagePanel cwd={cwd} />
		</main>
	);
}
