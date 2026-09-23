import { MotionConfig } from "motion/react";
import { createRoot } from "react-dom/client";

import { ArtifactProposalForm } from "../features/planning/outline/artifact-proposal-form";
// fixture 必须导入产品 base.css 而不是自造样式（ui-testing.md 约定）。
import "../shared/ui/base.css";

/**
 * WF5-02 用例 2（补充层）：运行时缺失项目路径时，
 * 新建提案表单必须禁用并解释去哪重新选择项目。
 * 真实 RPC 行为由 tests/e2e 覆盖；此处只固化禁用与文案。
 */
function ProposalFormNoCwdFixture() {
	return (
		<main className="min-h-dvh bg-shell p-6">
			<section aria-label="无项目路径的提案表单">
				<ArtifactProposalForm cwd="" />
			</section>
		</main>
	);
}

const root = document.getElementById("fixture-root");
if (root) {
	createRoot(root).render(
		<MotionConfig reducedMotion="user">
			<ProposalFormNoCwdFixture />
		</MotionConfig>,
	);
}
