import { EvidenceSearch } from "./evidence-search";
import type { SemanticExtensionStatus } from "novel-weaver-core/src/domain/semantic-extension.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { authorErrorMessage, queryProject } from "../../shared/api/rpc";
import { Button, InlineNote, Panel } from "../../shared/ui/components";

export function SemanticExtensionPanel({
	cwd = ".",
	firstRun = false,
}: {
	cwd?: string;
	firstRun?: boolean;
}) {
	const [status, setStatus] = useState<SemanticExtensionStatus | null>(null);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState("");
	const [notice, setNotice] = useState("");
	const mounted = useRef(true);
	const refresh = useCallback(async () => {
		const result = await queryProject<SemanticExtensionStatus>(
			cwd,
			"semantic_extension_status",
			{},
		);
		if (!result?.capabilities)
			throw new Error("本地核心尚不支持语义检索扩展，请更新应用。");
		if (mounted.current) setStatus(result);
	}, [cwd]);
	useEffect(() => {
		mounted.current = true;
		void refresh().catch((detail) => {
			if (mounted.current) setError(authorErrorMessage(detail));
		});
		return () => {
			mounted.current = false;
		};
	}, [refresh]);
	const installing =
		busy === "semantic_extension_install" ||
		(!!status?.operation &&
			["runtime", "model", "verifying"].includes(status.operation.stage));
	useEffect(() => {
		if (!installing) return;
		let pending = false;
		const timer = setInterval(() => {
			if (pending) return;
			pending = true;
			void refresh()
				.catch((detail) => {
					if (mounted.current) setError(authorErrorMessage(detail));
				})
				.finally(() => {
					pending = false;
				});
		}, 1000);
		return () => clearInterval(timer);
	}, [installing, refresh]);
	const act = async (method: string, params: unknown = {}) => {
		setBusy(method);
		setError("");
		setNotice("");
		try {
			await queryProject(cwd, method, params);
			if (method === "rebuild_semantic_index" && mounted.current)
				setNotice("本书语义索引已更新。");
			await refresh();
		} catch (detail) {
			if (mounted.current) setError(authorErrorMessage(detail));
			try {
				await refresh();
			} catch (refreshError) {
				if (mounted.current) setError(authorErrorMessage(refreshError));
			}
		} finally {
			if (mounted.current) setBusy("");
		}
	};
	// The optional first-run offer never blocks opening or creating a book.
	if (firstRun && (!status || status.dismissed) && !installing) return null;
	const operation = status?.operation;
	const canInstall = status?.capabilities.supported === true;
	return (
		<Panel title="语义检索（可选扩展）">
			<div className="grid gap-3 text-[13px] leading-6 min-w-0">
				<p className="m-0 text-ink-mid">
					基础检索无需下载模型。启用语义检索后，可以找回意思相近、用词不同的正文片段；关闭后继续使用关键词检索。
				</p>
				{!firstRun ? <div className="grid gap-2 text-ink-mid">
					<p className="m-0">使用顺序：安装并启用 → 批准至少一场正文 → 更新本书语义索引 → 在下方检索情节。正文确认或修订后，再次更新索引。</p>
					<p className="m-0">Embedding 把正文转成可比较的语义特征，用于找回相近情节。它不生成正文、不自动修改设定，也不会把检索结果自动加入写作助手；生成仍使用你选择的场景计划与上下文。</p>
				</div> : null}
				<output className="m-0 text-ink-hi">
					{status?.message ?? "正在检查扩展状态…"}
				</output>
				{status ? (
					<>
						<p className="m-0 text-ink-mid">
							本机内存 {status.capabilities.totalMemoryGiB.toFixed(1)} GiB ·
							估计可用 {status.capabilities.availableMemoryGiB.toFixed(1)} GiB ·
							磁盘可用 {status.capabilities.freeDiskGiB.toFixed(1)} GiB
						</p>
						{status.capabilities.blockers.length > 0 ? (
							<InlineNote tone="danger">
								{status.capabilities.blockers.join(" ")}
							</InlineNote>
						) : null}
						{status.capabilities.warnings.map((warning) => (
							<p key={warning} className="m-0 text-ink-mid">
								{warning}
							</p>
						))}
						{installing && operation ? (
							<div aria-live="polite" className="grid gap-1">
								<span>{operation.message}</span>
								<progress
									aria-label="扩展安装进度"
									className="w-full"
									max={operation.total || 1}
									value={operation.total > 0 ? operation.completed : undefined}
								/>
								{operation.total > 0 ? (
									<span>
										{Math.min(
											100,
											Math.round((operation.completed / operation.total) * 100),
										)}
										%
									</span>
								) : null}
							</div>
						) : null}
						{!installing && operation?.stage === "error" ? (
							<InlineNote tone="danger">{operation.message}</InlineNote>
						) : null}
						<div className="flex gap-2 flex-wrap">
							{!status.installed ? (
								<Button
									variant="primary"
									disabled={!canInstall || !!busy || installing}
									onClick={() => void act("semantic_extension_install")}
								>
									{installing ? "正在安装…" : "安装并启用语义检索"}
								</Button>
							) : null}
							{status.installed && !status.enabled ? (
								<Button
									variant="primary"
									disabled={!!busy || installing}
									onClick={() =>
										void act("semantic_extension_set_enabled", {
											enabled: true,
										})
									}
								>
									启用语义检索
								</Button>
							) : null}
							{status.enabled ||
							installing ||
							busy === "rebuild_semantic_index" ||
							busy === "semantic_extension_set_enabled" ||
							busy === "semantic_extension_existing" ? (
								<Button
									onClick={() =>
										void act("semantic_extension_set_enabled", {
											enabled: false,
										})
									}
								>
									{installing ? "取消安装" : "关闭语义检索"}
								</Button>
							) : null}
							{!firstRun && status.enabled ? (
								<Button
									disabled={!!busy || installing}
									onClick={() => void act("rebuild_semantic_index")}
								>
									{busy === "rebuild_semantic_index"
										? "正在更新索引…"
										: "更新本书语义索引"}
								</Button>
							) : null}
							<Button
								disabled={!!busy || installing}
								onClick={() => {
									setError("");
									void refresh().catch((detail) =>
										setError(authorErrorMessage(detail)),
									);
								}}
							>
								重新检查
							</Button>
							{firstRun && !installing ? (
								<Button
									disabled={!!busy}
									onClick={() =>
										void act("semantic_extension_set_enabled", {
											enabled: false,
										})
									}
								>
									暂不安装
								</Button>
							) : null}
						</div>
						{!status.enabled && !installing ? (
							<details>
								<summary className="cursor-pointer text-ink-mid">
									已安装 Ollama？
								</summary>
								<p className="text-ink-mid">
									可连接已有的本机 Ollama
									和检索模型。先通过实际推理检查，再启用；无需重复下载。
								</p>
								<Button
									disabled={!!busy}
									onClick={() => void act("semantic_extension_existing")}
								>
									检查并使用已有 Ollama
								</Button>
							</details>
						) : null}
						<p className="m-0 text-ink-mid">
							安装将下载 Ollama 运行时和 Qwen3 Embedding 0.6B
							模型，需要联网和至少 4 GiB
							可用磁盘。关闭会取消当前任务并保留已下载文件和索引，可随时重新启用。
						</p>
					</>
				) : null}
				{busy && !installing ? (
					<output className="m-0">正在处理，请稍候…</output>
				) : null}
				{error ? <InlineNote tone="danger">{error}</InlineNote> : null}
				{notice ? <output className="m-0 text-ok">{notice}</output> : null}
				{!firstRun ? <EvidenceSearch key={cwd} cwd={cwd} /> : null}
			</div>
		</Panel>
	);
}
