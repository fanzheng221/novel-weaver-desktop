import { useId, useState } from "react";
import { queryProject } from "../../../shared/api/rpc";
import { Button, InlineNote } from "../../../shared/ui/components";
import { HINTS } from "../../../shared/ui/copy";
import { describeRpcError } from "../../../shared/ui/states";
import {
	objectiveTypePool,
	type RelationGraph,
	type RelationObjectiveEdge,
} from "./relations-model";

/**
 * 关系修订提案（WF5-13）：所有关系修改仍走提案→批准的连续确认关口，
 * 不允许前端直改 SQLite。从选中边进入时预填原事实（含私密与知情者）。
 */

export interface RelationFormState {
	id: string;
	sourceId: string;
	targetId: string;
	relationshipType: string;
	validFrom: string;
	validTo: string;
	visibility: "public" | "private";
	knownBy: string[];
}

export function relationFormFromEdge(
	edge: RelationObjectiveEdge,
): RelationFormState {
	return {
		id: edge.id,
		sourceId: edge.sourceId,
		targetId: edge.targetId,
		relationshipType: edge.relationshipType,
		validFrom: String(edge.validFrom),
		validTo: edge.validTo !== undefined ? String(edge.validTo) : "",
		visibility: edge.visibility,
		knownBy: [...edge.knownBy],
	};
}

const FIELD_LABEL =
	"grid gap-1 text-[10.5px] tracking-[0.16em] text-ink-low font-semibold";
const FIELD_INPUT =
	"h-9 rounded-sm border border-line bg-shell text-ink-hi text-[12.5px] px-2 font-[inherit]";

export function RelationRevisionForm({
	cwd,
	graph,
	initial,
	onSubmitted,
	onCancelled,
}: {
	cwd: string;
	graph: RelationGraph;
	initial: RelationFormState;
	/** 提案创建成功：把提案标识交给工作区做就地批准（不跨工作区跑一趟）。 */
	onSubmitted: (result: { proposalId: string; revision: number }) => void;
	onCancelled: () => void;
}) {
	const formId = useId();
	const [form, setForm] = useState(initial);
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	const characters = graph.nodes.filter((node) => node.type === "character");
	const knownTypes = objectiveTypePool(graph);

	const submit = async () => {
		if (form.sourceId === form.targetId) {
			setError("关系的两端不能是同一个对象。");
			return;
		}
		if (!form.relationshipType.trim()) {
			setError("先写清这是什么关系，比如「盟友」。");
			return;
		}
		const validFrom = Number(form.validFrom);
		if (Number.isNaN(validFrom) || !Number.isInteger(validFrom)) {
			setError("「从第几章开始」需要一个整数章号。");
			return;
		}
		const validToRaw = form.validTo.trim();
		let validTo: number | undefined;
		if (validToRaw !== "") {
			const parsed = Number(validToRaw);
			if (Number.isNaN(parsed) || !Number.isInteger(parsed)) {
				setError("「到第几章」需要整数章号，或留空表示尚未结束。");
				return;
			}
			validTo = parsed;
		}
		setSubmitting(true);
		try {
			const created = await queryProject<{
				proposalId: string;
				revision: number;
			}>(cwd, "create_design_proposal", {
				objectiveRelationships: [
					{
						id: form.id,
						sourceEntityId: form.sourceId,
						targetEntityId: form.targetId,
						relationshipType: form.relationshipType.trim(),
						continuityId: graph.continuityId || "main",
						validFrom,
						...(validTo !== undefined ? { validTo } : {}),
						visibility: form.visibility,
						knownByCharacterIds: form.knownBy,
					},
				],
			});
			onSubmitted(created);
		} catch (raw) {
			setError(describeRpcError(raw).message);
		} finally {
			setSubmitting(false);
		}
	};

	const toggleKnownBy = (id: string) => {
		setForm((current) => ({
			...current,
			knownBy: current.knownBy.includes(id)
				? current.knownBy.filter((item) => item !== id)
				: [...current.knownBy, id],
		}));
	};

	return (
		<section
			aria-label="关系修订"
			className="flex-none border border-line rounded-md bg-panel p-3 grid gap-2"
		>
			<div className="flex items-center">
				<h2 className="m-0 text-[13.5px] font-semibold text-ink-hi">
					修订关系 · {graph.nodes.find((node) => node.id === form.sourceId)?.label ?? "来源人物"} → {graph.nodes.find((node) => node.id === form.targetId)?.label ?? "目标人物"}
				</h2>
				<span className="ml-auto">
					<Button size="compact" onClick={onCancelled}>
						取消
					</Button>
				</span>
			</div>
			<div className="grid grid-cols-2 gap-2">
				<label htmlFor={`${formId}-source`} className={FIELD_LABEL}>
					关系主体
					<select
						id={`${formId}-source`}
						value={form.sourceId}
						onChange={(event) =>
							setForm({ ...form, sourceId: event.target.value })
						}
						className={FIELD_INPUT}
					>
						{graph.nodes.map((node) => (
							<option key={node.id} value={node.id}>
								{node.label}
							</option>
						))}
					</select>
				</label>
				<label htmlFor={`${formId}-target`} className={FIELD_LABEL}>
					关系对象
					<select
						id={`${formId}-target`}
						value={form.targetId}
						onChange={(event) =>
							setForm({ ...form, targetId: event.target.value })
						}
						className={FIELD_INPUT}
					>
						{graph.nodes.map((node) => (
							<option key={node.id} value={node.id}>
								{node.label}
							</option>
						))}
					</select>
				</label>
			</div>
			<label htmlFor={`${formId}-type`} className={FIELD_LABEL}>
				这是什么关系
				<input
					id={`${formId}-type`}
					list={`${formId}-types`}
					value={form.relationshipType}
					onChange={(event) =>
						setForm({ ...form, relationshipType: event.target.value })
					}
					className={FIELD_INPUT}
				/>
				<datalist id={`${formId}-types`}>
					{knownTypes.map(({ type }) => (
						<option key={type} value={type} />
					))}
				</datalist>
			</label>
			<div className="grid grid-cols-2 gap-2">
				<label htmlFor={`${formId}-from`} className={FIELD_LABEL}>
					从第几章开始
					<input
						id={`${formId}-from`}
						type="number"
						value={form.validFrom}
						onChange={(event) =>
							setForm({ ...form, validFrom: event.target.value })
						}
						className={FIELD_INPUT}
					/>
				</label>
				<label htmlFor={`${formId}-to`} className={FIELD_LABEL}>
					到第几章（可空＝尚未结束）
					<input
						id={`${formId}-to`}
						type="number"
						value={form.validTo}
						onChange={(event) =>
							setForm({ ...form, validTo: event.target.value })
						}
						className={FIELD_INPUT}
					/>
				</label>
			</div>
			<label htmlFor={`${formId}-visibility`} className={FIELD_LABEL}>
				可见范围
				<select
					id={`${formId}-visibility`}
					value={form.visibility}
					onChange={(event) =>
						setForm({
							...form,
							visibility: event.target.value as "public" | "private",
						})
					}
					className={FIELD_INPUT}
				>
					<option value="public">公开 · 世界皆知</option>
					<option value="private">私密 · 仅知情者知晓</option>
				</select>
			</label>
			{form.visibility === "private" ? (
				<fieldset className="min-w-0 border-0 p-0 m-0 grid gap-1">
					<legend className={cxLegend}>知情者（人物）</legend>
					<div className="flex flex-wrap gap-1.5">
						{characters.length === 0 ? (
							<span className="text-[11.5px] text-ink-low">
								项目里还没有人物。
							</span>
						) : (
							characters.map((character) => {
								const pressed = form.knownBy.includes(character.id);
								return (
									<button
										key={character.id}
										type="button"
										aria-pressed={pressed}
										className={`ui-plain cursor-pointer text-[11.5px] border rounded-full px-2 py-0.5 ${
											pressed
												? "border-accent text-accent-text bg-accent-soft"
												: "border-line text-ink-mid"
										}`}
										onClick={() => toggleKnownBy(character.id)}
									>
										{character.label}
									</button>
								);
							})
						)}
					</div>
				</fieldset>
			) : null}
			{error ? <InlineNote tone="danger">{error}</InlineNote> : null}
			<div className="flex gap-2 items-center">
				<Button
					variant="primary"
					disabled={submitting}
					onClick={() => void submit()}
				>
					{submitting ? "提交中…" : "提交提案（待批准）"}
				</Button>
				<span className="text-[10.5px] text-ink-low">{HINTS.loreEditNote}</span>
			</div>
		</section>
	);
}

const cxLegend =
	"px-0 text-[10.5px] tracking-[0.16em] text-ink-low font-semibold";
