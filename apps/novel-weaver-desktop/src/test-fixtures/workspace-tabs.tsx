import { MotionConfig } from "motion/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";

import { WorkspaceTabs } from "../app/shell/workspace-tabs";
import { AREAS } from "../shared/workspace/routes";
// `base.css` imports the product token sheet and Tailwind utilities. Fixtures must
// import this production entry rather than reproduce styles with test-only CSS.
import "../shared/ui/base.css";

const planning = AREAS.find((area) => area.key === "planning");

function WorkspaceTabsFixture() {
	if (!planning) throw new Error("Planning area definition is missing.");
	const [activeSub, setActiveSub] = useState("foreshadow");
	return (
		<main className="min-h-dvh bg-shell">
			<div className="bg-rail border-b border-line px-3 py-2">
				<p className="eyebrow m-0" data-testid="workspace-tabs-status">
					当前子区：{activeSub}
				</p>
			</div>
			<WorkspaceTabs
				area={planning}
				activeSub={activeSub}
				onSelect={setActiveSub}
			/>
		</main>
	);
}

const root = document.getElementById("fixture-root");
if (!root) throw new Error("Fixture mount point is missing.");

createRoot(root).render(
	<MotionConfig reducedMotion="always">
		<WorkspaceTabsFixture />
	</MotionConfig>,
);
