/**
 * 最近项目路径注册表（WF2-02）：应用层 JSON 配置，一书一目录一库天然隔离。
 * 只登记路径与打开时间，不复制项目数据；移除条目不触碰书稿目录。
 */

const REGISTRY_KEY = "nw-project-registry";

export interface RegistryEntry {
	path: string;
	addedAt: number;
	lastOpenedAt: number;
}

interface RegistryFile {
	version: 1;
	projects: RegistryEntry[];
}

function read(): RegistryFile {
	try {
		const raw = localStorage.getItem(REGISTRY_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as RegistryFile;
			if (parsed.version === 1 && Array.isArray(parsed.projects)) {
				return parsed;
			}
		}
	} catch {
		/* 损坏即重建 */
	}
	return { version: 1, projects: [] };
}

function write(file: RegistryFile): void {
	try {
		localStorage.setItem(REGISTRY_KEY, JSON.stringify(file));
	} catch {
		/* 隐私模式降级为会话内 */
	}
}

export function getRegistry(): RegistryEntry[] {
	return read().projects;
}

/** 登记目录；已存在则原样保留（addedAt 不变）。返回最新列表。 */
export function addToRegistry(path: string): RegistryEntry[] {
	const file = read();
	if (!file.projects.some((entry) => entry.path === path)) {
		file.projects.push({ path, addedAt: Date.now(), lastOpenedAt: 0 });
		write(file);
	}
	return file.projects;
}

/** 打开项目：刷新最近打开时间。返回最新列表。 */
export function markOpened(path: string): RegistryEntry[] {
	const file = read();
	const entry = file.projects.find((item) => item.path === path);
	if (entry) {
		entry.lastOpenedAt = Date.now();
		write(file);
	}
	return file.projects;
}

/** 仅从注册表移除；书稿目录与其数据库不受影响。返回最新列表。 */
export function removeFromRegistry(path: string): RegistryEntry[] {
	const file = read();
	file.projects = file.projects.filter((entry) => entry.path !== path);
	write(file);
	return file.projects;
}
