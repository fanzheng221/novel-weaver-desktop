import { useState } from "react";
import { createRoot } from "react-dom/client";

// fixture 必须导入产品 base.css 而不是自造样式（ui-testing.md 约定）。
import "../shared/ui/base.css";

import {
	attributeText,
	type EntitySummary,
	entitiesWithTag,
	newEntityId,
	parseTags,
	type RelationshipGraph,
	readProfile,
	relationsOfCharacter,
	searchWorld,
	subOfEntity,
	tagPoolOf,
} from "../features/world/lore-model";

/**
 * WF5-11（补充层，fixture 直打生产纯函数）：世界区共享领域模型——
 *   · subOfEntity：人物/设定子区切分；
 *   · entitiesWithTag / tagPoolOf：标签筛选与标签池；
 *   · searchWorld：跨规则/实体/关系全文命中；
 *   · relationsOfCharacter：人物客观关系切片；
 *   · readProfile / parseTags / newEntityId / attributeText。
 */

const ENTITIES: EntitySummary[] = [
	{
		id: "CHAR-LIN",
		type: "character",
		canonicalName: "林舟",
		description: "漕帮少主。",
		attributes: { personality: "隐忍", tags: ["主角", "漕帮"] },
	},
	{
		id: "ENT-DOCK",
		type: "location",
		canonicalName: "北岸码头",
		description: "漕运枢纽。",
		attributes: { tags: ["漕帮"] },
	},
	{
		id: "ENT-TERM",
		type: "term",
		canonicalName: "漕运心法",
		description: "功法名。",
		attributes: {},
	},
];

const GRAPH: RelationshipGraph = {
	nodes: [
		{ id: "CHAR-LIN", label: "林舟", type: "character" },
		{ id: "CHAR-SU", label: "苏晚", type: "character" },
	],
	objectiveEdges: [
		{
			id: "REL-1",
			sourceId: "CHAR-LIN",
			targetId: "CHAR-SU",
			relationshipType: "ally_of",
		},
	],
};

const OVERVIEW = {
	hardRules: [
		{
			id: "RULE-DEATH",
			name: "人死不能复生",
			description: "死亡即终局。",
			examples: [],
		},
	],
	softRules: [
		{
			id: "RULE-TONE",
			name: "对白偏短句",
			description: "北境人物对白偏短句。",
			examples: [],
		},
	],
	entities: ENTITIES,
	entityCount: ENTITIES.length,
	relationshipCount: GRAPH.objectiveEdges.length,
	attitudeCount: 0,
};

function ModelFixture() {
	const [out, setOut] = useState<string[]>([]);

	const showSlicing = () => {
		setOut([
			`characters=${ENTITIES.filter(
				(entity) => subOfEntity(entity.type) === "characters",
			)
				.map((entity) => entity.id)
				.join(",")}`,
			`lore=${ENTITIES.filter((entity) => subOfEntity(entity.type) === "lore")
				.map((entity) => entity.id)
				.join(",")}`,
			`pool=${tagPoolOf(ENTITIES).join("|")}`,
			`tagged=${entitiesWithTag(ENTITIES, "漕帮")
				.map((entity) => entity.id)
				.join(",")}`,
			`taggedAll=${entitiesWithTag(ENTITIES, null).length}`,
		]);
	};

	const showSearch = (needle: string) => {
		setOut(
			searchWorld(needle, OVERVIEW, GRAPH).map(
				(hit) => `${hit.key}:${hit.title}`,
			),
		);
	};

	const showRelations = () => {
		setOut(
			relationsOfCharacter(GRAPH, "CHAR-LIN").map(
				(edge) => `${edge.sourceId}->${edge.targetId}:${edge.relationshipType}`,
			),
		);
	};

	const showProfile = () => {
		const profile = readProfile(ENTITIES[0]?.attributes ?? {});
		setOut([
			`personality=${profile.personality}`,
			`tags=${profile.tags.join("|")}`,
			`attrs=${attributeText(ENTITIES[1]?.attributes ?? {})}`,
			`parsed=${parseTags("主角， 漕帮,").join("|")}`,
			`uniqueId=${newEntityId("CHAR", new Set(["CHAR-A", "CHAR-B"])).startsWith("CHAR-")}`,
			`uniqueIdNoCollide=${newEntityId("CHAR", new Set(["CHAR-A", "CHAR-B"])) !== "CHAR-A"}`,
		]);
	};

	return (
		<div style={{ padding: 16, display: "grid", gap: 12 }}>
			<section style={{ display: "grid", gap: 6 }}>
				<h2>子区切分与标签</h2>
				<button onClick={showSlicing}>切片</button>
				<ol data-testid="slice-out">
					{out.map((line, index) => (
						<li key={index}>{line}</li>
					))}
				</ol>
			</section>

			<section style={{ display: "grid", gap: 6 }}>
				<h2>全文检索与关系切片</h2>
				<button onClick={() => showSearch("林舟")}>搜人物</button>
				<button onClick={() => showSearch("人死不能复生")}>搜硬规则</button>
				<button onClick={() => showSearch("盟友")}>搜关系</button>
				<button onClick={() => showSearch("不存在的词")}>搜不中</button>
				<button onClick={showRelations}>林舟的关系</button>
				<button onClick={showProfile}>档案与工具</button>
				<ol data-testid="search-out">
					{out.map((line, index) => (
						<li key={index}>{line}</li>
					))}
				</ol>
			</section>
		</div>
	);
}

export default ModelFixture;

const root = document.getElementById("fixture-root");
if (root) createRoot(root).render(<ModelFixture />);
