import { EMPTY } from "../../shared/ui/copy";
import { EntityWorkspace } from "./entity-workspace";

/**
 * 设定子区（WF5-11 用例 3）：地点、势力、机构、物品、生灵、词条与自定义实体。
 * 与人物子区共享列表·详情·表单脚手架；类型选择给作者语言，自定义类型兜底。
 */
export function LoreWorkspace({ cwd }: { cwd: string }) {
	return (
		<EntityWorkspace
			cwd={cwd}
			kind="lore"
			title="设定"
			hint="地点、势力、信物、词条——世界的柱子立在这里，批准提案后正式生效。"
			empty={EMPTY.loreWorld}
		/>
	);
}
