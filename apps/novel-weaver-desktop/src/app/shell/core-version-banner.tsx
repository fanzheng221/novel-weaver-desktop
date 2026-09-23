import { useEffect, useState } from "react";
import {
	CoreRpcError,
	defaultProjectPath,
	EXPECTED_LOCAL_RPC_VERSION,
	fetchCoreVersion,
} from "../../shared/api/rpc";

/**
 * 核心版本握手横幅（WF3-02）：启动时零副作用探测协议版本，
 * 不匹配即全局提示，避免用户在各功能里撞上失败才知道核心过旧。
 */
export function CoreVersionBanner() {
	const [stale, setStale] = useState(false);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const cwd = await defaultProjectPath();
				const info = await fetchCoreVersion(cwd);
				if (!cancelled) setStale(info.rpcVersion < EXPECTED_LOCAL_RPC_VERSION);
			} catch (error) {
				if (!cancelled && error instanceof CoreRpcError)
					setStale(error.staleCore);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	if (!stale) return null;
	return (
		<div
			role="alert"
			className="flex items-center gap-2 py-1 px-4 bg-accent-soft border-b border-line text-accent-text text-[12px] font-semibold"
		>
			<span>
				本地核心版本过旧——部分功能不可用。请重新打包或更新应用后重启。
			</span>
		</div>
	);
}
