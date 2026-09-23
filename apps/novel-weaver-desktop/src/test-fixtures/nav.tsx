import { BookOpen, FileText } from "lucide-react";
import { MotionConfig } from "motion/react";
import { createRoot } from "react-dom/client";

import { NavItem } from "../shared/ui/components";
// `base.css` imports the product token sheet and Tailwind utilities. Fixtures must
// import this production entry rather than reproduce styles with test-only CSS.
import "../shared/ui/base.css";

function DarkNavigationFixture() {
	return (
		<main className="min-h-dvh bg-shell p-6">
			<aside
				data-testid="dark-navigation"
				className="w-51 rounded-md bg-rail p-3"
			>
				<p className="eyebrow m-0 mb-2">测试导航</p>
				<nav aria-label="测试导航" className="grid gap-1">
					<NavItem icon={<BookOpen size={16} />} label="普通导航" />
					<NavItem
						icon={<FileText size={16} />}
						label="当前章节"
						active
						navIndicatorKey="fixture-navigation"
					/>
				</nav>
			</aside>
		</main>
	);
}

const root = document.getElementById("fixture-root");
if (!root) throw new Error("Fixture mount point is missing.");

createRoot(root).render(
	<MotionConfig reducedMotion="always">
		<DarkNavigationFixture />
	</MotionConfig>,
);
