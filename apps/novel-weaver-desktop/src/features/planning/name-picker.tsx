import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { cx } from "../../shared/ui/cx";

/**
 * WF5-10 名称选择器：作者用名称/标题选择人物、规则、伏笔和依赖；
 * UUID 只出现在已选芯片 title、折叠「直接输入 ID」与高级详情。
 */

export interface NameOption {
	id: string;
	name: string;
	hint?: string;
}

export function filterNameOptions(
	options: NameOption[],
	query: string,
): NameOption[] {
	const q = query.trim().toLowerCase();
	if (!q) return options;
	return options.filter(
		(option) =>
			option.name.toLowerCase().includes(q) ||
			option.id.toLowerCase().includes(q),
	);
}

export function NamePicker({
	label,
	options,
	selectedIds,
	onChange,
	emptyHint,
	manualFallback = true,
}: {
	label: string;
	options: NameOption[];
	selectedIds: string[];
	onChange(next: string[]): void;
	emptyHint?: string;
	/** 折叠「直接输入 ID」：名称库里没有的仍然可手填（不装懂）。 */
	manualFallback?: boolean;
}) {
	const [query, setQuery] = useState("");
	const [manual, setManual] = useState("");
	const filtered = useMemo(
		() => filterNameOptions(options, query),
		[options, query],
	);
	const nameOf = (id: string) =>
		options.find((option) => option.id === id)?.name ?? "名称未找到（请核对引用）";

	const toggle = (id: string, on: boolean) => {
		if (on) onChange([...selectedIds, id]);
		else onChange(selectedIds.filter((item) => item !== id));
	};

	const addManual = () => {
		const ids = manual
			.split(/\n|,/)
			.map((part) => part.trim())
			.filter((id) => id && !selectedIds.includes(id));
		if (ids.length > 0) onChange([...selectedIds, ...ids]);
		setManual("");
	};

	return (
		<div className="grid gap-1">
			<span className="eyebrow">{label}</span>
			{selectedIds.length > 0 ? (
				<div className="flex flex-wrap gap-1">
					{selectedIds.map((id) => (
						<span
							key={id}
							title={id}
							className="inline-flex items-center gap-1 bg-accent-soft text-accent-text rounded-full px-2 py-0.5 text-[11.5px]"
						>
							{nameOf(id)}
							<button
								type="button"
								aria-label={`移除 ${nameOf(id)}`}
								className="ui-plain grid size-7 place-items-center rounded-full cursor-pointer"
								onClick={() => toggle(id, false)}
							>
								<X size={14} aria-hidden="true" />
							</button>
						</span>
					))}
				</div>
			) : null}
			{options.length > 0 ? (
				<>
					<input
						type="search"
						aria-label={`搜索${label}`}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder={`搜索${label}…`}
						className="bg-shell border border-line rounded-sm text-ink-hi text-[12.5px] px-2 py-1"
					/>
					<ul
						role="listbox"
						aria-multiselectable="true"
						aria-label={label}
						className="grid gap-0.5 max-h-33 overflow-y-auto border border-line rounded-sm p-1 m-0 list-none"
					>
						{filtered.map((option) => {
							const selected = selectedIds.includes(option.id);
							return (
								<li key={option.id}>
									<button
										type="button"
										role="option"
										aria-selected={selected}
										onClick={() => toggle(option.id, !selected)}
										className={cx(
											"ui-plain cursor-pointer w-full flex items-center gap-1.5 min-h-6.5 px-1.5 rounded-sm text-left text-[12px] font-[inherit]",
											selected
												? "text-accent-text bg-accent-soft font-semibold"
												: "text-ink-mid",
										)}
									>
										<span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
											{option.name}
										</span>
										{option.hint ? (
											<span className="ml-auto text-[10px] text-ink-low flex-none">
												{option.hint}
											</span>
										) : null}
									</button>
								</li>
							);
						})}
						{filtered.length === 0 ? (
							<li className="text-[11.5px] text-ink-low px-1.5 py-1">
								没有匹配的{label}。
							</li>
						) : null}
					</ul>
				</>
			) : emptyHint ? (
				<p className="m-0 text-[11.5px] text-ink-low">{emptyHint}</p>
			) : null}
			{manualFallback ? (
				<details>
					<summary className="cursor-pointer text-[10.5px] text-ink-low">
						高级 · 直接输入 ID
					</summary>
					<div className="flex gap-1 pt-1">
						<input
							value={manual}
							onChange={(event) => setManual(event.target.value)}
							placeholder={"ID（每行/逗号一个）"}
							className="flex-1 min-w-0 bg-shell border border-line rounded-sm text-ink-hi text-[11.5px] px-2 py-1"
						/>
						<button
							type="button"
							className="ui-plain cursor-pointer border border-line rounded-sm px-2 text-[11.5px] text-ink-mid font-[inherit]"
							onClick={addManual}
						>
							添加
						</button>
					</div>
				</details>
			) : null}
		</div>
	);
}
