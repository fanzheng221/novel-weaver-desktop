import { EMPTY } from "../../shared/ui/copy";
import { EntityWorkspace } from "./entity-workspace";

/**
 * 人物子区（WF5-11 用例 3）：人物卡、弧光、认知边界、参与场景与关系入口。
 * 列表·详情·表单脚手架与设定区共享，人物专属字段与插槽在这里注入。
 */
export function CharactersWorkspace({ cwd }: { cwd: string }) {
	return (
		<EntityWorkspace
			cwd={cwd}
			kind="characters"
			title="人物"
			hint="立得住的人物从这里长出来：性格、外貌、能力各给一笔，生成时会带着他们上场。"
			empty={EMPTY.loreCharacters}
		/>
	);
}
