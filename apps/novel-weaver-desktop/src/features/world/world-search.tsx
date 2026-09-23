import { EntityIcon, GlyphIcon } from "../../shared/ui/icons";
import { useMemo, useState } from "react";
import { LORE } from "../../shared/ui/copy";
import { cx } from "../../shared/ui/cx";
import { navigateTo } from "../../shared/ui/states";
import type { DesignOverview, RelationshipGraph, SearchHit } from "./lore-model";
import { clipSnippet, highlightParts, searchWorld } from "./lore-model";

const AVATAR =
	"grid place-items-center bg-accent-soft text-accent font-wenkai flex-none";

/** 命中跳转：按命中类型解析到对应子区路由（规则/人物/设定/关系）。 */
function routeOfHit(hit: SearchHit, overview: DesignOverview): string {
	if (hit.key.startsWith("rule-")) return "world/rules";
	if (hit.key.startsWith("rel-")) return "world/relations";
	const entityId = hit.key.slice("entity-".length);
	const type = overview.entities.find((entity) => entity.id === entityId)?.type;
	return type === "character" ? "world/characters" : "world/lore";
}

/**
 * 世界区常驻全文搜索（WF2-04 语义，WF5-11 迁入共享件）：
 * 跨规则/实体/关系本地过滤＋命中高亮；命中即跳对应子区。
 */
export function WorldSearch({
	overview,
	graph,
}: {
	overview: DesignOverview;
	graph: RelationshipGraph | null;
}) {
	const [query, setQuery] = useState("");
	const needle = query.trim().toLowerCase();
	const searching = needle.length > 0;
	const hits = useMemo(
		() => (searching ? searchWorld(needle, overview, graph) : null),
		[searching, needle, overview, graph],
	);

	return (
		<div className="grid gap-2">
			<input
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				placeholder={LORE.searchPlaceholder}
				aria-label="搜索世界设定"
				className="h-9 rounded-md border border-line bg-rail text-ink-hi text-[12.5px] px-3 font-[inherit]"
			/>
			{searching && hits !== null ? (
				hits.length === 0 ? (
					<p className="text-[12px] text-ink-low text-center py-6">
						{LORE.noResults}
					</p>
				) : (
					<div className="border border-line rounded-md bg-panel py-1 px-2 grid gap-0.5">
						{hits.map((hit) => (
							<button
								key={hit.key}
								type="button"
								onClick={() => navigateTo(routeOfHit(hit, overview))}
								className="ui-plain flex gap-2 items-baseline px-1 py-2 rounded-md cursor-pointer text-left font-[inherit]"
							>
								<span className={cx(AVATAR, "w-7 h-7 text-[14px] rounded-md")}>
									{hit.key.startsWith("entity-") ? <EntityIcon type={overview.entities.find((entity) => entity.id === hit.key.slice(7))?.type ?? "concept"} size={16} /> : <GlyphIcon glyph={hit.glyph} size={16} />}
								</span>
								<span className="min-w-0">
									<b className="text-[13px]">
										{highlightParts(hit.title, needle).map((part) =>
											part.hit ? (
												<mark
													key={part.start}
													className="bg-accent-soft text-accent-text rounded-[2px] px-0.5"
												>
													{part.text}
												</mark>
											) : (
												<span key={part.start}>{part.text}</span>
											),
										)}
									</b>
									{hit.sub ? (
										<span className="num ml-2 text-[10px] text-ink-low">
											{hit.sub}
										</span>
									) : null}
									{hit.text ? (
										<p className="text-[11.5px] leading-[1.7] text-ink-mid mt-0.5 mb-0">
											{highlightParts(
												clipSnippet(hit.text, needle),
												needle,
											).map((part) =>
												part.hit ? (
													<mark
														key={part.start}
														className="bg-accent-soft text-accent-text rounded-[2px] px-0.5"
													>
														{part.text}
													</mark>
												) : (
													<span key={part.start}>{part.text}</span>
												),
											)}
										</p>
									) : null}
								</span>
							</button>
						))}
					</div>
				)
			) : null}
		</div>
	);
}
