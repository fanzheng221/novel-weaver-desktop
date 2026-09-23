/**
 * 发现 code → 作者语言标签（WF6-09）：波浪线悬停、质量报告、收件箱等
 * 任何呈现通道一律输出作者语言，不得泄漏技术 ID。
 */

export const FLAVOR_LABEL: Record<string, string> = {
	AI_FLAVOR_SUMMARY_ENDING: "总结性收尾",
	AI_FLAVOR_TAUTOMY: "同义反复",
	AI_FLAVOR_PADDING: "空泛修饰堆砌",
	AI_FLAVOR_DENSITY: "AI味密度",
};

/** 本地确定性检查已知的非三征 code。 */
const LOCAL_CODE_LABEL: Record<string, string> = {
	...FLAVOR_LABEL,
	LOCAL_SIMILARITY_RISK: "文本相似",
};

export function isFlavorFinding(code: string): boolean {
	return code.startsWith("AI_FLAVOR_");
}

/** 模型审校的 code 自由产出无法穷举：未知 code 用「审校提示」兜底。 */
export function labelOfFinding(code: string): string {
	return LOCAL_CODE_LABEL[code] ?? "审校提示";
}
