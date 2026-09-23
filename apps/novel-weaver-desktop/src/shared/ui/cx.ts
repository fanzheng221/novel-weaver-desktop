/**
 * 条件 className 组合器（WF3-07）：falsy 丢弃、真值空格拼接；
 * 元素可为字符串或数组（数组保留展开）。迁移约定：
 * 分支必须传「完整字面量类串」，禁止字符串拼接构造类名——
 * Tailwind 源扫描认不出运行时拼出来的片段。
 */
type ClassPart = string | false | null | undefined | readonly ClassPart[];

export function cx(...parts: ClassPart[]): string {
	return parts.flat().filter(Boolean).join(" ");
}
