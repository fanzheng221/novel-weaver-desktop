/**
 * 正文面共享工具（WF2-09）：段落锚点、字数统计、行级来源差异。
 * WF2-14 内联波浪线与备注将复用同一套段落切分，保证锚点语义一致。
 */

export interface ParagraphAnchor {
	/** 版本内稳定序号：p0, p1, …（对冻结内容稳定；草稿编辑后按当前文本重排）。 */
	anchor: string;
	text: string;
}

/** 按空行切段；单换行视为同段软换行。空段剔除。 */
export function splitParagraphs(markdown: string): ParagraphAnchor[] {
	return markdown
		.split(/\n\s*\n/)
		.map((block) => block.replace(/\n/g, "").trim())
		.filter(Boolean)
		.map((text, index) => ({ anchor: `p${index}`, text }));
}

/** 网文字数口径：去空白后的字符数（含标点）。 */
export function countWords(text: string): number {
	return text.replace(/\s/g, "").length;
}

/** 把发现映射到段落锚点：证据文本优先，消息中的「第 N 段」兜底。 */
export function anchorOf(
	evidence: string[],
	message: string,
	markdown: string,
): string | null {
	const paragraphs = splitParagraphs(markdown);
	for (const piece of evidence) {
		// 证据若被来源截断（末尾省略号），剥除后再反查，避免锚点失配。
		const head = piece
			.replace(/[「」]/g, "")
			.replace(/…+$/u, "")
			.slice(0, 20);
		if (!head) continue;
		const index = paragraphs.findIndex((paragraph) =>
			paragraph.text.includes(head),
		);
		if (index >= 0) return paragraphs[index].anchor;
	}
	const mentioned = message.match(/第 (\d+) 段/g);
	if (mentioned && mentioned.length > 0) {
		const last = mentioned[mentioned.length - 1];
		const num = Number(last.replace(/\D/g, ""));
		const target = paragraphs[num - 1];
		if (target) return target.anchor;
	}
	return null;
}

export type DiffPart = { kind: "same" | "add" | "del"; text: string };

/** 以行为单位的简单双向差异（新增绿/删除红），足够手改来源对比。 */
export function lineDiff(oldText: string, newText: string): DiffPart[] {
	const oldLines = oldText.split("\n");
	const newLines = newText.split("\n");
	const result: DiffPart[] = [];
	let i = 0;
	let j = 0;
	while (i < oldLines.length || j < newLines.length) {
		if (
			i < oldLines.length &&
			j < newLines.length &&
			oldLines[i] === newLines[j]
		) {
			result.push({ kind: "same", text: oldLines[i] });
			i += 1;
			j += 1;
			continue;
		}
		const oldRemain = oldLines.slice(i);
		const newRemain = newLines.slice(j);
		if (
			newRemain.length > oldRemain.length &&
			newRemain.join("").includes(oldRemain.join(""))
		) {
			for (const line of newRemain) result.push({ kind: "add", text: line });
			break;
		}
		if (
			oldRemain.length > newRemain.length &&
			oldRemain.join("").includes(newRemain.join(""))
		) {
			for (const line of oldRemain) result.push({ kind: "del", text: line });
			break;
		}
		if (i < oldLines.length) result.push({ kind: "del", text: oldLines[i] });
		if (j < newLines.length) result.push({ kind: "add", text: newLines[j] });
		i += 1;
		j += 1;
	}
	return result;
}
