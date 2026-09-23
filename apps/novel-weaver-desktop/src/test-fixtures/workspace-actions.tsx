import { createRoot } from "react-dom/client";
import { useMemo, useState } from "react";

// fixture 必须导入产品 base.css 而不是自造样式（ui-testing.md 约定）。
import "../shared/ui/base.css";

import { presentContext, type PresentContextInput } from "../features/writing/assistant/presenter";
import {
        actionsForRoute,
        composeWorkspaceQuestion,
        workspaceSurfaceOf,
} from "../features/writing/assistant/workspace-actions";
import type {
        ContextPackageView,
        RelationshipGraphView,
} from "../features/writing/assistant/gateway";

/**
 * WF5-17（补充层，fixture 直打生产纯函数）：
 *   · workspaceSurfaceOf/actionsForRoute 路由 → 扩展面与动作集；
 *   · composeWorkspaceQuestion 问题骨架＋作者补充拼接与截断；
 *   · presentContext 的规划上下文行（core v8 plan selections）与撤回。
 */

const PKG: ContextPackageView = {
        contextId: "ctx-fixture",
        truncated: false,
        renderedCharacters: 2400,
        budgetCharacters: 40_000,
        hardRuleCount: 2,
        selections: [
                { sourceType: "plan", sourceId: "OUT-1", reason: "规划动作声明" },
                { sourceType: "plan", sourceId: "CH-1", reason: "规划动作声明" },
                {
                        sourceType: "canonical_scene",
                        sourceId: "SC-1",
                        reason: "故事前沿",
                },
                { sourceType: "knowledge", sourceId: "K-1", reason: "视点可知" },
        ],
};

const GRAPH: RelationshipGraphView = { characters: [], attitudeEdges: [] };

function SubjectProbe() {
        const [input, setInput] = useState<PresentContextInput>({
                pkg: PKG,
                graph: GRAPH,
                scene: null,
                includedEntityIds: new Set(),
                excludeEvidence: false,
                excludeKnowledge: false,
                excludeOutline: false,
                excludeStyle: false,
                includePlan: true,
                instruction: "",
        });
        const summary = useMemo(() => presentContext(input), [input]);
        const toggle = (key: "excludeOutline", on: boolean) =>
                setInput((prev) => ({ ...prev, [key]: !on }));
        return (
                <div>
                        <ul data-testid="context-lines">
                                {summary.lines.map((line) => (
                                        <li key={line.key} data-testid={`line-${line.key}`}>
                                                <span data-testid={`included-${line.key}`}>
                                                        {String(line.included)}
                                                </span>
                                                <span data-testid={`label-${line.key}`}>
                                                        {line.label}
                                                </span>
                                                <input
                                                        type="checkbox"
                                                        aria-label={`切换 ${line.label}`}
                                                        checked={line.included}
                                                        disabled={line.locked || line.editable}
                                                        onChange={(event) => {
                                                                if (line.category === "outline") {
                                                                        toggle(
                                                                                "excludeOutline",
                                                                                event.target.checked,
                                                                        );
                                                                }
                                                        }}
                                                />
                                        </li>
                                ))}
                        </ul>
                </div>
        );
}

function ActionsProbe() {
        const routes: Array<string> = [
                "planning/tree",
                "world/rules",
                "world/characters",
                "world/relations",
                "review",
                "writing",
                "publish/flow",
        ];
        return (
                <div>
                        {routes.map((route) => {
                                const surface = workspaceSurfaceOf(route as never);
                                const actions = actionsForRoute(route as never);
                                return (
                                        <div key={route} data-testid={`route-${route}`}>
                                                <span data-testid={`surface-${route}`}>
                                                        {surface ?? "none"}
                                                </span>
                                                <span data-testid={`count-${route}`}>
                                                        {actions.length}
                                                </span>
                                                <span data-testid={`ids-${route}`}>
                                                        {actions.map((a) => a.id).join(",")}
                                                </span>
                                                {actions.map((a) => (
                                                        <span key={a.id} data-testid={`copy-${a.id}`}>
                                                                {a.copy}
                                                        </span>
                                                ))}
                                        </div>
                                );
                        })}
                        <span data-testid="question-plain">
                                {composeWorkspaceQuestion(
                                        actionsForRoute("planning/tree")[0]!,
                                        {
                                                kind: "plan",
                                                label: "示例小说总纲",
                                                planArtifactIds: ["OUT-1"],
                                                key: "plan:OUT-1",
                                        },
                                        "",
                                )}
                        </span>
                        <span data-testid="question-instruction">
                                {composeWorkspaceQuestion(
                                        actionsForRoute("planning/tree")[0]!,
                                        null,
                                        "期望二十章",
                                )}
                        </span>
                        <span data-testid="question-truncated">
                                {composeWorkspaceQuestion(
                                        actionsForRoute("planning/tree")[0]!,
                                        null,
                                        "长".repeat(5000),
                                ).length}
                        </span>
                </div>
        );
}

function App() {
        return (
                <div>
                        <SubjectProbe />
                        <ActionsProbe />
                </div>
        );
}

createRoot(document.getElementById("fixture-root")!).render(<App />);
