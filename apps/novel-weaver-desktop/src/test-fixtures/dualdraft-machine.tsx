import { useReducer, useState } from "react";
import { createRoot } from "react-dom/client";

// fixture 必须导入产品 base.css 而不是自造样式（ui-testing.md 约定）。
import "../shared/ui/base.css";

import {
	createInitialDualDraftState,
	type DualDraftSource,
	dualDraftReducer,
} from "../features/writing/dualdraft/machine";
import { applySegments, extractSegments } from "../features/writing/dualdraft/segments";

/**
 * WF5-09（补充层，fixture 直打生产 reducer/纯函数）：双稿裁决——
 *   · segments：段级+句级差异提取（replace/append/insert-after），一致段不出卡；
 *   · applySegments：勾选即采用、取消即撤回、零勾选与我的正文一致；
 *   · machine：comparing↔adopted、discarded 终态、零勾选守卫在视图层。
 */

const BASE = [
	"角色甲收势的时候，木剑在晨光里停了半息。汗顺着下颌落进青砖缝里。",
	"院角的更漏刚过卯正二刻，风从西北来。「手腕沉三分。」角色乙立在廊下。",
	"角色甲没有应声。他记得七岁那年也是这样一句话。",
].join("\n\n");

const CANDIDATE = [
	"角色甲收势的时候，木剑在晨光里停了半息。汗顺着下颌落进青砖缝里。",
	"院角的更漏刚过卯正二刻，风从西北来。「手腕沉三分。」角色乙立在廊下。那一瞬的停顿比训斥更短，也更重。",
	"角色甲重新握剑。他知道父亲看见了。",
	"院墙外，马蹄声碾过青石板。",
].join("\n\n");

const SOURCE: DualDraftSource = {
	candidateId: "draft-test",
	candidateTitle: "庭院练武·候选",
	sceneId: "SCN-TEST",
	sceneTitle: "庭院练武",
	storyOrder: 10,
	baseKind: "canonical",
	baseText: BASE,
	baselineVersionId: "SCV-3",
	candidateText: CANDIDATE,
};

function MachineFixture() {
	const [state, dispatch] = useReducer(
		dualDraftReducer,
		undefined,
		createInitialDualDraftState,
	);
	const [extracted, setExtracted] = useState<string[]>([]);
	const [merged, setMerged] = useState("");
	const [adoptedCount, setAdoptedCount] = useState(0);
	const session = state.session;

	const extract = (base: string, candidate: string) => {
		const segments = extractSegments(base, candidate);
		setExtracted(
			segments.map((seg) => `${seg.opLabel}｜${seg.text}｜目标段${seg.para}`),
		);
		return segments;
	};

	return (
		<div style={{ padding: 16, display: "grid", gap: 12 }}>
			<section style={{ display: "grid", gap: 6 }}>
				<h2>segments 纯函数</h2>
				<button onClick={() => extract(BASE, CANDIDATE)}>
					提取差异（混合）
				</button>
				<button onClick={() => extract("", "全新一段正文。\n\n第二段。")}>
					提取差异（空正文）
				</button>
				<button onClick={() => extract(BASE, BASE)}>
					提取差异（完全一致）
				</button>
				<ol data-testid="seg-list">
					{extracted.map((label, index) => (
						<li key={index} data-testid={`seg-${index}`}>
							{label}
						</li>
					))}
				</ol>
			</section>

			<section style={{ display: "grid", gap: 6 }}>
				<h2>applySegments 纯函数</h2>
				<button
					onClick={() => {
						const segments = extractSegments(BASE, CANDIDATE);
						const result = applySegments(
							BASE,
							segments,
							new Set(segments.slice(0, 2).map((seg) => seg.id)),
						);
						setMerged(result.markdown);
						setAdoptedCount(result.adoptedCount);
					}}
				>
					应用前两个句段
				</button>
				<button
					onClick={() => {
						setMerged(
							applySegments(BASE, extractSegments(BASE, CANDIDATE), new Set())
								.markdown,
						);
						setAdoptedCount(0);
					}}
				>
					零勾选应用
				</button>
				<p data-testid="merged-markdown">{merged}</p>
				<p data-testid="adopted-count">{String(adoptedCount)}</p>
			</section>

			<section style={{ display: "grid", gap: 6 }}>
				<h2>machine 状态机</h2>
				<button
					onClick={() =>
						dispatch({
							type: "sessionOpened",
							source: SOURCE,
							segments: extractSegments(BASE, CANDIDATE),
						})
					}
				>
					打开会话
				</button>
				<button
					disabled={!session || session.phase !== "comparing"}
					onClick={() => {
						const first = session?.segments[0];
						if (first)
							dispatch({
								type: "segmentToggled",
								segmentId: first.id,
								on: true,
							});
					}}
				>
					勾选首句段
				</button>
				<button onClick={() => dispatch({ type: "selectionCleared" })}>
					撤销选择
				</button>
				<button
					disabled={!session || session.phase !== "comparing"}
					onClick={() => {
						if (!session) return;
						const result = applySegments(
							session.source.baseText,
							session.segments,
							session.checked,
						);
						dispatch({
							type: "adoptionConfirmed",
							result: {
								mode: "partial",
								markdown: result.markdown,
								adoptedCount: result.adoptedCount,
								draftTitle: `${session.source.candidateTitle}·采用稿`,
							},
						});
					}}
				>
					确认局部采用
				</button>
				<button
					disabled={!session || session.phase !== "comparing"}
					onClick={() => {
						if (!session) return;
						dispatch({
							type: "adoptionConfirmed",
							result: {
								mode: "full",
								markdown: session.source.candidateText,
								adoptedCount: 0,
								draftTitle: session.source.candidateTitle,
							},
						});
					}}
				>
					作为新草稿
				</button>
				<button onClick={() => dispatch({ type: "adoptionUndone" })}>
					撤销本次采用
				</button>
				<button onClick={() => dispatch({ type: "sessionClosed" })}>
					放弃候选（关闭会话）
				</button>
				<p data-testid="phase">{session?.phase ?? "none"}</p>
				<p data-testid="checked-count">{String(session?.checked.size ?? 0)}</p>
				<p data-testid="segments-count">
					{String(session?.segments.length ?? 0)}
				</p>
				<p data-testid="result-mode">{session?.result?.mode ?? "—"}</p>
				<p data-testid="result-adopted">
					{String(session?.result?.adoptedCount ?? 0)}
				</p>
			</section>
		</div>
	);
}

export default MachineFixture;

const root = document.getElementById("fixture-root");
if (root) createRoot(root).render(<MachineFixture />);
