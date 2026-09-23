import { useCallback, useState } from "react";
import { AppShell } from "./app-shell";
import { CoreVersionBanner } from "./core-version-banner";
import { Launcher } from "./launcher";
import type { ResumeTarget } from "./resume";

/** 打开一本书的会话：目录 + 可选续写目标（WF5-05，启动页决定落点）。 */
export interface OpenBookSession {
	cwd: string;
	target: ResumeTarget | null;
}

/** 应用根（WF2-02）：启动页 ↔ 工作区两态切换；按 cwd 重挂工作区复位页面状态。 */
export function AppRoot() {
	const [session, setSession] = useState<OpenBookSession | null>(null);
	const openProject = useCallback(
		(cwd: string, target: ResumeTarget | null = null) =>
			setSession({ cwd, target }),
		[],
	);
	const goHome = useCallback(() => setSession(null), []);

	return (
		<>
			<CoreVersionBanner />
			{session === null ? (
				<Launcher onOpen={openProject} />
			) : (
				<AppShell
					key={session.cwd}
					cwd={session.cwd}
					initialTarget={session.target}
					onHome={goHome}
				/>
			)}
		</>
	);
}
