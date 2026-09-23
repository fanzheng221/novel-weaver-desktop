import { useId } from "react";
import { Button, InlineNote, Panel } from "../../shared/ui/components";
import { HINTS } from "../../shared/ui/copy";
import { cx } from "../../shared/ui/cx";
import type { EntitySub } from "./lore-model";

/**
 * 设定条目表单（WF5-11）：人物卡与通用设定两种形态。
 * 内部编号收进「高级」——作者语言用名称，编号只在需要时展开。
 * 提交走提案流（待批准），错误保留输入并就近呈现。
 */

export const FIELD_LABEL =
	"text-[10.5px] tracking-[0.16em] text-ink-low font-semibold";
const AREA =
	"bg-shell border border-line rounded-sm text-ink-hi text-[12.5px] px-2 py-2 resize-y leading-[1.7] font-[inherit]";

/** 设定区可选类型：已知类型给作者语言，自定义走文本框。 */
export const LORE_TYPE_OPTIONS = [
	{ value: "location", label: "地点" },
	{ value: "faction", label: "势力" },
	{ value: "institution", label: "机构" },
	{ value: "item", label: "物品" },
	{ value: "creature", label: "生灵" },
	{ value: "term", label: "词条" },
] as const;

const KNOWN_LORE_TYPES = new Set<string>(
	LORE_TYPE_OPTIONS.map((option) => option.value),
);

export function isKnownLoreType(type: string): boolean {
	return KNOWN_LORE_TYPES.has(type);
}

export function Field({
	label,
	value,
	onChange,
	placeholder,
	area,
	id,
}: {
	label: string;
	value: string;
	onChange: (next: string) => void;
	placeholder?: string;
	area?: boolean;
	id?: string;
}) {
	const fieldId = useId();
	return (
		<div className="grid gap-1">
			<label className={FIELD_LABEL} htmlFor={id ?? fieldId}>
				{label}
			</label>
			{area ? (
				<textarea
					id={id ?? fieldId}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					placeholder={placeholder}
					className={cx(AREA, "min-h-13 h-16")}
				/>
			) : (
				<input
					id={id ?? fieldId}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					placeholder={placeholder}
					className={cx(AREA, "min-h-0")}
				/>
			)}
		</div>
	);
}

export interface EntityFormState {
	id: string;
	type: string;
	canonicalName: string;
	description: string;
	personality: string;
	appearance: string;
	abilities: string;
	notes: string;
	tags: string;
}

export function EntityForm({
	kind,
	form,
	onChange,
	onCancel,
	onSubmit,
	submitting,
	error,
	isRevision,
}: {
	kind: EntitySub;
	form: EntityFormState;
	onChange: (next: EntityFormState) => void;
	onCancel: () => void;
	onSubmit: () => void;
	submitting: boolean;
	error: string | null;
	isRevision: boolean;
}) {
	const baseId = useId();
	const customType = kind === "lore" && !isKnownLoreType(form.type);
	const set = (patch: Partial<EntityFormState>) =>
		onChange({ ...form, ...patch });

	return (
		<Panel
			title={
				isRevision
					? `修订 · ${form.canonicalName || form.id}`
					: kind === "characters"
						? "新建人物"
						: "新建设定"
			}
			action={<Button onClick={onCancel}>取消</Button>}
		>
			<div className="grid gap-3">
				{kind === "characters" ? (
					<>
						<div className="grid grid-cols-[1fr_1fr] gap-2">
							<Field
								label="本名"
								value={form.canonicalName}
								onChange={(next) => set({ canonicalName: next })}
								placeholder="如：林舟"
							/>
							<Field
								label="一句话定位"
								value={form.description}
								onChange={(next) => set({ description: next })}
								placeholder="如：漕帮少主，左手算账右手使刀"
							/>
						</div>
						<div className="grid grid-cols-[1fr_1fr] gap-2">
							<Field
								label="性格"
								value={form.personality}
								onChange={(next) => set({ personality: next })}
								placeholder="隐忍、记仇、护短"
							/>
							<Field
								label="外貌"
								value={form.appearance}
								onChange={(next) => set({ appearance: next })}
								placeholder="瘦高，左眉一道旧疤"
							/>
						</div>
						<Field
							label="能力"
							value={form.abilities}
							onChange={(next) => set({ abilities: next })}
							placeholder="《漕运心法》第三层；水性好"
							area
						/>
						<Field
							label="自由备注"
							value={form.notes}
							onChange={(next) => set({ notes: next })}
							placeholder="口癖、忌讳、和谁有过节……想到什么写什么"
							area
						/>
					</>
				) : (
					<>
						<div className="grid grid-cols-[1fr_1fr] gap-2">
							<Field
								label="名称"
								value={form.canonicalName}
								onChange={(next) => set({ canonicalName: next })}
							/>
							<div className="grid gap-1">
								<label className={FIELD_LABEL} htmlFor={`${baseId}-type`}>
									类型
								</label>
								<select
									id={`${baseId}-type`}
									value={customType ? "__custom" : form.type}
									onChange={(event) =>
										set({
											type:
												event.target.value === "__custom"
													? ""
													: event.target.value,
										})
									}
									className="h-9 rounded-sm border border-line bg-shell text-ink-hi text-[12.5px] px-2 font-[inherit]"
								>
									{LORE_TYPE_OPTIONS.map((option) => (
										<option key={option.value} value={option.value}>
											{option.label}
										</option>
									))}
									<option value="__custom">自定义…</option>
								</select>
							</div>
						</div>
						{customType ? (
							<Field
								label="自定义类型（英文或拼音，如 sect）"
								value={form.type}
								onChange={(next) => set({ type: next })}
							/>
						) : null}
						<Field
							label="描述"
							value={form.description}
							onChange={(next) => set({ description: next })}
							area
						/>
						<Field
							label="自由备注"
							value={form.notes}
							onChange={(next) => set({ notes: next })}
							area
						/>
					</>
				)}
				<Field
					label="标签（逗号分隔，供生成时批量引用）"
					value={form.tags}
					onChange={(next) => set({ tags: next })}
					placeholder={kind === "characters" ? "主角, 漕帮" : "北境, 信物"}
				/>
				{error ? <InlineNote tone="danger">{error}</InlineNote> : null}
				<details>
					<summary className="cursor-pointer text-[10.5px] text-ink-low">
						高级 · 内部编号
					</summary>
					<div className="mt-2">
						<Field
							label="内部编号（一般不用改）"
							value={form.id}
							onChange={(next) => set({ id: next })}
						/>
					</div>
				</details>
				<div className="flex gap-2 items-center">
					<Button variant="primary" disabled={submitting} onClick={onSubmit}>
						{submitting ? "提交中…" : "提交提案（待批准）"}
					</Button>
					<span className="text-[10.5px] text-ink-low">
						{HINTS.loreEditNote}
					</span>
				</div>
			</div>
		</Panel>
	);
}
