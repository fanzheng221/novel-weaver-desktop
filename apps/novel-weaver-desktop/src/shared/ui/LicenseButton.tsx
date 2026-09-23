import { useRef, useState } from "react";
import { Button } from "./components";

export function LicenseButton() {
	const dialog = useRef<HTMLDialogElement>(null);
	const [opened, setOpened] = useState(false);
	return (
		<>
			<Button
				onClick={() => {
					setOpened(true);
					dialog.current?.showModal();
				}}
				aria-haspopup="dialog"
			>
				许可证
			</Button>
			<dialog
				ref={dialog}
				aria-labelledby="license-dialog-title"
				className="w-[min(960px,92vw)] h-[85vh] max-h-[85vh] rounded-lg border border-line bg-panel p-0 text-ink-hi backdrop:bg-black/40"
			>
				<div className="flex h-full flex-col">
					<div className="flex items-center justify-between border-b border-line p-3">
						<h2 id="license-dialog-title" className="m-0 text-base font-semibold">许可证与第三方声明</h2>
						<Button onClick={() => dialog.current?.close()}>关闭</Button>
					</div>
					{opened && import.meta.env.PROD ? (
						<iframe src="./legal/index.html" title="项目许可与第三方许可全文" sandbox="" className="min-h-0 flex-1 w-full border-0" />
					) : (
						<p className="p-4">Copyright 2026 哈迪工作室。外层采用 Apache-2.0；核心供个人与企业免费使用。完整第三方声明随正式构建的安装包提供。</p>
					)}
				</div>
			</dialog>
		</>
	);
}
