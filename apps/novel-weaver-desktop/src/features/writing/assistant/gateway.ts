import type {
	ProviderAdapter,
	ProviderRequestOptions,
} from "novel-weaver-core/src/domain/provider-config.ts";
import { invoke } from "@tauri-apps/api/core";

import { queryProject } from "../../../shared/api/rpc";

/**
 * 上下文 AI 助手（WF5-07）的领域视图：只保留作者界面需要的字段，
 * 原始大文本（renderedText 等）不进 UI 状态。字段与 core 的
 * ContextPackage / RelationshipGraph JSON 形状对齐。
 */

export interface ContextSelectionView {
	sourceType: string;
	sourceId: string;
	reason: string;
}

export interface ContextPackageView {
	contextId: string;
	truncated: boolean;
	/** 装配文本字符数（预算占比展示用）。 */
	renderedCharacters: number;
	/** 装配文本上限（默认 40_000，与 core 一致）。 */
	budgetCharacters: number;
	selections: ContextSelectionView[];
	hardRuleCount: number;
}

export interface AssistantCharacter {
	id: string;
	label: string;
	description: string;
}

export interface AssistantAttitude {
	id: string;
	sourceId: string;
	targetId: string;
	dimension: string;
}

export interface RelationshipGraphView {
	characters: AssistantCharacter[];
	attitudeEdges: AssistantAttitude[];
}

export interface AssembleContextParams {
	continuityId: string;
	storyOrder: number;
	viewpointCharacterId?: string;
	relatedEntityIds: string[];
	excludeSourceIds: string[];
	/** 规划上下文（WF5-17）：跨工作区动作声明的总纲/章节计划（core v8）。 */
	planArtifactIds?: string[];
}

export interface ModelCallParams {
	adapter?: ProviderAdapter;
	requestOptions?: ProviderRequestOptions;
	providerId: string;
	baseURL: string;
	modelId: string;
}

export interface GenerateCandidateParams extends ModelCallParams {
	contextId: string;
	title: string;
	authorInstruction: string;
	narrativeMode: "third_person_limited";
	viewpointCharacterId?: string;
	storyOrder: number;
}

export interface DiscussParams extends ModelCallParams {
	contextId: string;
	question: string;
}

export interface InspectParams extends ModelCallParams {
	contextId: string;
	proseMarkdown: string;
	focus?: string;
}

export interface TextRunResult {
	markdown: string;
	usage: { promptTokens: number; completionTokens: number };
}

export interface AdoptCandidateParams {
	title: string;
	markdown: string;
	viewpointCharacterId?: string;
	storyOrder: number;
	authorInstruction: string;
}

export interface SendForReviewParams {
	proposalId: string;
}

/**
 * 助手唯一出口：UI 永远经它触达核心，不自行拼 RPC。
 * 测试注入替身即可，无需模拟传输层。
 */
export interface AssistantGateway {
	assemble(
		cwd: string,
		params: AssembleContextParams,
	): Promise<{ pkg: ContextPackageView; graph: RelationshipGraphView }>;
	generateCandidate(
		cwd: string,
		params: GenerateCandidateParams,
	): Promise<TextRunResult>;
	discuss(cwd: string, params: DiscussParams): Promise<TextRunResult>;
	inspect(cwd: string, params: InspectParams): Promise<TextRunResult>;
	adoptCandidate(
		cwd: string,
		params: AdoptCandidateParams,
	): Promise<{ sceneId: string; proposalId: string; sceneVersionId: string }>;
	sendForReview(
		cwd: string,
		params: SendForReviewParams,
	): Promise<{ reviewId: string; findings: Array<{ code: string }> }>;
}

export const rpcAssistantGateway: AssistantGateway = {
	async assemble(cwd, params) {
		const [pkg, graph] = await Promise.all([
			queryProject<{
				contextId: string;
				truncated: boolean;
				renderedText: string;
				hardRules: unknown[];
				selections: ContextSelectionView[];
			}>(cwd, "build_context_package", params),
			queryProject<{
				nodes: Array<{
					id: string;
					label: string;
					type: string;
					description: string;
				}>;
				attitudeEdges: Array<{
					id: string;
					sourceId: string;
					targetId: string;
					dimension: string;
				}>;
			}>(cwd, "relationship_query", {
				continuityId: params.continuityId,
				storyOrder: params.storyOrder,
				knowledgeMode: "author",
			}),
		]);
		return {
			pkg: {
				contextId: pkg.contextId,
				truncated: pkg.truncated,
				renderedCharacters: pkg.renderedText.length,
				budgetCharacters: 40_000,
				selections: pkg.selections,
				hardRuleCount: Array.isArray(pkg.hardRules) ? pkg.hardRules.length : 0,
			},
			graph: {
				characters: (graph.nodes ?? [])
					.filter((node) => node.type === "character" || node.type === "角色")
					.map((node) => ({
						id: node.id,
						label: node.label,
						description: node.description,
					})),
				attitudeEdges: graph.attitudeEdges ?? [],
			},
		};
	},
	generateCandidate(cwd, params) {
		return queryProject<TextRunResult>(cwd, "generate_scene_draft", params);
	},
	discuss(cwd, params) {
		return queryProject<TextRunResult>(cwd, "discuss_with_context", {
			contextId: params.contextId,
			question: params.question,
			providerId: params.providerId,
			adapter: params.adapter,
			requestOptions: params.requestOptions,
			baseURL: params.baseURL,
			modelId: params.modelId,
		});
	},
	inspect(cwd, params) {
		return queryProject<TextRunResult>(cwd, "inspect_prose", {
			contextId: params.contextId,
			proseMarkdown: params.proseMarkdown,
			focus: params.focus,
			providerId: params.providerId,
			adapter: params.adapter,
			requestOptions: params.requestOptions,
			baseURL: params.baseURL,
			modelId: params.modelId,
		});
	},
	async adoptCandidate(cwd, params) {
		return queryProject<{
			sceneId: string;
			proposalId: string;
			sceneVersionId: string;
		}>(cwd, "create_scene_candidate", {
			title: params.title,
			markdown: params.markdown,
			narrativeMode: "third_person_limited",
			viewpointCharacterId: params.viewpointCharacterId,
			continuityId: "main",
			storyOrder: params.storyOrder,
			purposes: ["推进主线"],
			authorInstruction: params.authorInstruction,
		});
	},
	async sendForReview(cwd, params) {
		const preview = await queryProject<{ subjectId: string }>(
			cwd,
			"get_proposal",
			{
				proposalId: params.proposalId,
			},
		);
		return queryProject<{
			reviewId: string;
			findings: Array<{ code: string }>;
		}>(cwd, "record_scene_review", {
			proposalId: params.proposalId,
			candidateVersionId: preview.subjectId,
			findings: [],
		});
	},
};

/** BYOK 服务商配置（localStorage 与既有模型接入页共享）。 */
export interface ByokProvider {
	id: string;
	name: string;
	adapter?: ProviderAdapter;
	requestOptions?: ProviderRequestOptions;
	modelId: string;
	baseURL: string;
}

export function loadByokConfig(): {
	providers: ByokProvider[];
	slotProvider: string;
} {
	try {
		const providers = JSON.parse(
			localStorage.getItem("nw-byok-providers") ?? "[]",
		) as ByokProvider[];
		const slots = JSON.parse(
			localStorage.getItem("nw-byok-slots") ?? "{}",
		) as Record<string, string>;
		return { providers, slotProvider: slots.generation ?? "" };
	} catch {
		return { providers: [], slotProvider: "" };
	}
}

export function activeProviderOf(config: {
	providers: ByokProvider[];
	slotProvider: string;
}): ByokProvider | undefined {
	return (
		config.providers.find((provider) => provider.id === config.slotProvider) ??
		config.providers[0]
	);
}

/** 钥匙串尾号探测：有 Key 返回尾四位，否则 null（引导内联贴 Key）。 */
export function readKeyTail(providerId: string): Promise<string | null> {
	return invoke<string | null>("byok_key_tail", { providerId }).catch(
		() => null,
	);
}

export function saveProviderKey(
	providerId: string,
	key: string,
): Promise<void> {
	return invoke("byok_save_key", { providerId, key });
}

export function probeProvider(provider: ByokProvider): Promise<{
	ok: boolean;
	status: number;
	hint: string;
}> {
	return invoke("byok_probe_config", {
		config: {
			providerId: provider.id,
			adapter: provider.adapter ?? "openai_chat",
			baseUrl: provider.baseURL,
			modelId: provider.modelId,
			apiKey: null,
			requestOptions: provider.requestOptions,
		},
	});
}
