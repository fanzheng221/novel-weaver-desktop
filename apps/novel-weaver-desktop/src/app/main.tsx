import { MotionConfig } from "motion/react";
import { createRoot } from "react-dom/client";

import { AppRoot } from "./shell/app-root";
import { initialTheme, setTheme } from "../shared/ui/components";
// 霞鹜文楷本地分发（WF3-01）：随构建打包、离线可用，unicode-range 子集按需加载。
import "lxgw-wenkai-webfont/lxgwwenkai-regular.css";
import "lxgw-wenkai-webfont/lxgwwenkai-bold.css";
import "../shared/ui/base.css";

setTheme(initialTheme());

const app = document.getElementById("app");
if (!app) throw new Error("Application mount point is missing.");

createRoot(app).render(
	/* reducedMotion="user"（WF3-06⑦）：系统减少动态时，库驱动的 transform/opacity
	   动画一律直达终态；CSS 侧由 base.css 全局闸门双保险。 */
	<MotionConfig reducedMotion="user">
		<AppRoot />
	</MotionConfig>,
);

/** React 挂载后淡出首屏 splash；reduced-motion 直接呈现终态。 */
function dismissSplash(): void {
	const splash = document.getElementById("splash");
	if (!splash) return;
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
		splash.remove();
		return;
	}
	splash.classList.add("nw-splash--hide");
	splash.addEventListener("transitionend", () => splash.remove(), {
		once: true,
	});
	window.setTimeout(() => splash.remove(), 400);
}

dismissSplash();
