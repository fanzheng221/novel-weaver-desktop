import type { AssistantIntent } from "./machine";

/** 三类作者意图（WF5-07）的界面文案：副作用边界先说清楚。 */
export const INTENT_CONFIG: Record<
	AssistantIntent,
	{
		label: string;
		copy: string;
		placeholder: string;
		primary: string;
		idleStatus: string;
	}
> = {
	generate: {
		label: "生成候选",
		copy: "生成一个独立候选，不会直接改动你的正文；完成后对比，再决定采用或放弃。",
		placeholder: "例如：强化父子之间克制的冲突，不要提前解释军报。",
		primary: "生成场景候选",
		idleStatus: "候选会保存为独立草稿，确认前不会进入正式内容。",
	},
	discuss: {
		label: "讨论推演",
		copy: "与 AI 推演剧情、人物动机或写法，只给分析和选项，不创建候选。",
		placeholder: "例如：角色乙为什么坚持不叫停？请从人物弧光与父子关系分析。",
		primary: "开始讨论",
		idleStatus: "讨论不会创建候选，也不会修改任何项目内容。",
	},
	inspect: {
		label: "检查正文",
		copy: "检查当前正文与规则、人物认知和前文是否一致，并解释证据；建议由你决定是否进入修订。",
		placeholder: "可以补充本次想重点检查的问题；留空则执行完整检查。",
		primary: "检查正文",
		idleStatus: "问题只会作为建议显示，由你决定是否进入修订。",
	},
};

/** 快捷指令：第一个是真实动作（光标续写），其余只填入指令框。 */
export const QUICK_PROMPTS: Array<{ label: string; prompt?: string }> = [
	{ label: "从光标续写" },
	{ label: "强化张力", prompt: "强化对话与动作的张力，但保持克制。" },
	{ label: "三个走向", prompt: "给出三个不同的情节走向，先不要写正文。" },
];

/** 文风基调（WF2-11 预设沿用）：映射为作者可见的指令后缀。 */
export const STYLE_PRESETS = [
	{ key: "none", label: "不指定", suffix: "" },
	{ key: "hot", label: "热血", suffix: "文风基调：热血昂扬，节奏推进果断。" },
	{ key: "calm", label: "沉稳", suffix: "文风基调：沉稳克制，重细节与留白。" },
	{ key: "light", label: "轻快", suffix: "文风基调：轻快幽默，对话灵动。" },
	{ key: "cold", label: "冷峻", suffix: "文风基调：冷峻凌厉，句子短促有力。" },
] as const;

export function densitySuffix(density: number): string {
	if (density >= 80)
		return "爽点密度：高——每个场景至少一次小兑现或反转，钩子密集。";
	if (density <= 20)
		return "爽点密度：低——以铺垫蓄力为主，仅在关键节点给出兑现。";
	return "爽点密度：中——蓄力与兑现交替，保持追读张力。";
}

/** 简易行级差异（WF2-16 沿用）：以行为单位做双向标记。 */
export function lineDiff(
	oldText: string,
	newText: string,
): Array<{ kind: "same" | "add" | "del"; text: string }> {
	const oldLines = oldText.split("\n");
	const newLines = newText.split("\n");
	const result: Array<{ kind: "same" | "add" | "del"; text: string }> = [];
	let i = 0;
	let j = 0;
	while (i < oldLines.length || j < newLines.length) {
		if (
			i < oldLines.length &&
			j < newLines.length &&
			oldLines[i] === newLines[j]
		) {
			result.push({ kind: "same", text: oldLines[i] ?? "" });
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
		if (i < oldLines.length)
			result.push({ kind: "del", text: oldLines[i] ?? "" });
		if (j < newLines.length)
			result.push({ kind: "add", text: newLines[j] ?? "" });
		i += 1;
		j += 1;
	}
	return result;
}
