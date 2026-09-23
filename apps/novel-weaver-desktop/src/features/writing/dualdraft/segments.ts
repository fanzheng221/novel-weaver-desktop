import { splitParagraphs } from "../prose";

/**
 * 双稿局部采用的句段纯函数层（WF5-09，交互模型＝WF5-08 裁决的「按句段勾选」）。
 * 候选与正文先做段级对齐，再在差异段内做句级对齐，只产出与正文有差异的
 * 句段卡：替换第 N 段 / 接在第 N 段末尾 / 新增一段（第 N 段之后）。
 * 候选整段删除且无新段配对时不出卡（徽标只有三种；全文采用走「作为新草稿」）。
 */

export type SegmentOp = "replace" | "append" | "insert-after";

export interface DualSegment {
	id: string;
	/** 采用后写入的句段文本（replace/insert-after 为整段文本；append 为新增句）。 */
	text: string;
	op: SegmentOp;
	/** 动作目标段号（1-based，基于我的正文段序；insert-after 的 0 表示插在最前）。 */
	para: number;
	/** 作者可读动作徽标，同步进 aria-label。 */
	opLabel: string;
}

export interface MergedParagraph {
	parts: Array<{ text: string; ins: boolean }>;
}

/** 中文句级切分：句末标点（含收尾引号）为一刀，残段兜底。 */
export function splitSentences(paragraph: string): string[] {
	const matched = paragraph.match(
		/[^。！？；…]*[。！？；…]+[”’」』）]*|[^。！？；…]+/g,
	);
	if (!matched) return [];
	return matched.map((piece) => piece.trim()).filter(Boolean);
}

/** 经典 LCS：返回配对下标（旧序 → 新序）。 */
function lcsPairs<T>(
	oldItems: T[],
	newItems: T[],
	equal: (a: T, b: T) => boolean,
): Array<[number, number]> {
	const rows = oldItems.length;
	const cols = newItems.length;
	const table: number[][] = Array.from({ length: rows + 1 }, () =>
		new Array<number>(cols + 1).fill(0),
	);
	for (let i = rows - 1; i >= 0; i -= 1) {
		for (let j = cols - 1; j >= 0; j -= 1) {
			table[i]![j] = equal(oldItems[i]!, newItems[j]!)
				? (table[i + 1]![j + 1]! ?? 0) + 1
				: Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
		}
	}
	const pairs: Array<[number, number]> = [];
	let i = 0;
	let j = 0;
	while (i < rows && j < cols) {
		if (equal(oldItems[i]!, newItems[j]!)) {
			pairs.push([i, j]);
			i += 1;
			j += 1;
		} else if ((table[i + 1]![j] ?? 0) >= (table[i]![j + 1] ?? 0)) {
			i += 1;
		} else {
			j += 1;
		}
	}
	return pairs;
}

function opLabelOf(op: SegmentOp, para: number): string {
	if (op === "replace") return `替换第 ${para} 段`;
	if (op === "append") return `接在第 ${para} 段末尾`;
	return para === 0
		? "新增一段 · 第 1 段之前"
		: `新增一段（第 ${para} 段之后）`;
}

/**
 * 差异句段提取：仅列与正文有差异的句段，文档序输出。
 * 空正文（待写场景）时全部句段都是「新增一段」。
 */
export function extractSegments(
	base: string,
	candidate: string,
): DualSegment[] {
	const baseParas = splitParagraphs(base);
	const candParas = splitParagraphs(candidate);
	const segments: DualSegment[] = [];
	let segIndex = 0;
	const nextId = () => `seg-${segIndex++}`;

	// 段级 LCS + 未配对间隙的顺序配对：del+ins → replace，余 ins → insert-after，
	// 余 del → 候选删除段（不出卡）。
	const pairs = lcsPairs(baseParas, candParas, (a, b) => a.text === b.text);
	let cursorBase = 0;
	let cursorCand = 0;
	let lastMatchedBase = -1;
	for (const [matchedBase, matchedCand] of pairs) {
		const dels: number[] = [];
		while (cursorBase < matchedBase) dels.push(cursorBase++);
		const inss: number[] = [];
		while (cursorCand < matchedCand) inss.push(cursorCand++);
		const paired = Math.min(dels.length, inss.length);
		for (let k = 0; k < paired; k += 1) {
			pushDiffPair(segments, nextId, baseParas, dels[k]!, candParas, inss[k]!);
		}
		// 余量 ins 的锚点：有配对时跟随最后一个被替换的正文段，否则上一匹配段之后。
		const insAnchor = paired > 0 ? dels[paired - 1]! + 1 : lastMatchedBase + 1;
		for (let k = paired; k < inss.length; k += 1) {
			segments.push({
				id: nextId(),
				text: candParas[inss[k]!]!.text,
				op: "insert-after",
				para: insAnchor,
				opLabel: opLabelOf("insert-after", insAnchor),
			});
		}
		lastMatchedBase = matchedBase;
		cursorBase = matchedBase + 1;
		cursorCand = matchedCand + 1;
	}
	// 尾部间隙
	const tailDels: number[] = [];
	while (cursorBase < baseParas.length) tailDels.push(cursorBase++);
	const tailInss: number[] = [];
	while (cursorCand < candParas.length) tailInss.push(cursorCand++);
	const tailPaired = Math.min(tailDels.length, tailInss.length);
	for (let k = 0; k < tailPaired; k += 1) {
		pushDiffPair(
			segments,
			nextId,
			baseParas,
			tailDels[k]!,
			candParas,
			tailInss[k]!,
		);
	}
	const tailAnchor =
		tailPaired > 0 ? tailDels[tailPaired - 1]! + 1 : lastMatchedBase + 1;
	for (let k = tailPaired; k < tailInss.length; k += 1) {
		segments.push({
			id: nextId(),
			text: candParas[tailInss[k]!]!.text,
			op: "insert-after",
			para: tailAnchor,
			opLabel: opLabelOf("insert-after", tailAnchor),
		});
	}
	return segments;
}

/** 一对「我的第 i 段 / 候选第 j 段」：句级对齐后判 append 或 replace；一致不出卡。 */
function pushDiffPair(
	out: DualSegment[],
	nextId: () => string,
	baseParas: Array<{ text: string }>,
	baseIndex: number,
	candParas: Array<{ text: string }>,
	candIndex: number,
): void {
	const baseText = baseParas[baseIndex]!.text;
	const candText = candParas[candIndex]!.text;
	const baseSentences = splitSentences(baseText);
	const candSentences = splitSentences(candText);
	const sentencePairs = lcsPairs(
		baseSentences,
		candSentences,
		(a, b) => a === b,
	);
	if (
		sentencePairs.length === baseSentences.length &&
		sentencePairs.length === candSentences.length
	) {
		return; // 段文本仅空白差异：视作一致
	}
	const para = baseIndex + 1;
	const keptBase = new Set(sentencePairs.map(([i]) => i));
	const baseFullyKept =
		baseSentences.length > 0 && keptBase.size === baseSentences.length;
	if (baseFullyKept) {
		// 候选在正文该段基础上续写：只把新增句作为一张卡。
		const keptCand = new Set(sentencePairs.map(([, j]) => j));
		const additions = candSentences.filter((_, j) => !keptCand.has(j)).join("");
		if (!additions) return;
		out.push({
			id: nextId(),
			text: additions,
			op: "append",
			para,
			opLabel: opLabelOf("append", para),
		});
		return;
	}
	out.push({
		id: nextId(),
		text: candText,
		op: "replace",
		para,
		opLabel: opLabelOf("replace", para),
	});
}

export interface ApplyResult {
	/** 预览段序：ins 标记随勾选实时变化。 */
	paragraphs: MergedParagraph[];
	/** 确认后开草稿的正文（段落间空行连接）。 */
	markdown: string;
	adoptedCount: number;
}

/**
 * 按勾选应用句段：replace/append 原位修改；insert-after 按段号降序整块插入
 * （同段号按生成顺序保持先后）。零勾选时预览与我的正文一致。
 */
export function applySegments(
	base: string,
	segments: DualSegment[],
	checked: ReadonlySet<string>,
): ApplyResult {
	const paragraphs: MergedParagraph[] = splitParagraphs(base).map((para) => ({
		parts: [{ text: para.text, ins: false }],
	}));
	const chosen = segments.filter((seg) => checked.has(seg.id));
	for (const seg of chosen) {
		if (seg.op === "replace") {
			paragraphs[seg.para - 1] = { parts: [{ text: seg.text, ins: true }] };
		} else if (seg.op === "append") {
			paragraphs[seg.para - 1]?.parts.push({ text: seg.text, ins: true });
		}
	}
	const inserts = chosen.filter((seg) => seg.op === "insert-after");
	// 按目标段号分组（保持文档序），段号降序整块插入，免索引位移。
	const insertsByPara = new Map<number, DualSegment[]>();
	for (const seg of inserts) {
		const group = insertsByPara.get(seg.para) ?? [];
		group.push(seg);
		insertsByPara.set(seg.para, group);
	}
	for (const [para, group] of [...insertsByPara.entries()].sort(
		(a, b) => b[0] - a[0],
	)) {
		const block = group.map((seg) => ({
			parts: [{ text: seg.text, ins: true }],
		}));
		paragraphs.splice(para, 0, ...block);
	}
	return {
		paragraphs,
		markdown: paragraphs
			.map((para) => para.parts.map((part) => part.text).join(""))
			.join("\n\n"),
		adoptedCount: chosen.length,
	};
}
