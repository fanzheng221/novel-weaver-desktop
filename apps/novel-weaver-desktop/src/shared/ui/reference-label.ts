/** Keep identifiers usable for tracing without asking authors to interpret them. */
export function referenceLabel(id: string, names: Map<string, string>): string {
  if (names.has(id)) return names.get(id) as string;
  if (id === "main") return "主连续体";
  return "名称未找到（请核对引用）";
}

export function formatAuthorValue(
  value: unknown,
  names: Map<string, string>,
  field = "",
  labels: Record<string, string> = {},
): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value))
    return value.map((item) => formatAuthorValue(item, names, field, labels)).join("、");
  if (typeof value === "object")
    return Object.entries(value)
      .map(([key, item]) => `${labels[key] ?? key}：${formatAuthorValue(item, names, key, labels)}`)
      .join("；");
  const text = String(value);
  if (/Ids?$/.test(field) || /^(ART|ARV|PRP|SCN|SCV|CHAR|ENT|LOC|RULE|FAC|REL|ATT|EDT)-/.test(text))
    return referenceLabel(text, names);
  return names.get(text) ?? text;
}
