#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

import { z } from "zod";

import { createNovelWeaver } from "novel-weaver-core/src/application/novel-weaver.ts";
import {
  LOCAL_RPC_VERSION,
  LocalRpcRequestSchema,
  NovelWeaverLocalRpc,
} from "novel-weaver-core/src/transport/local-rpc.ts";
import type { CompletionClient } from "novel-weaver-core/src/generation/provider-client.ts";

/**
 * e2e 脚本化补全（WF5-09）：NW_COMPLETION_FIXTURE 指向 JSON 数组
 * `[{ "contains": "标记串", "markdown": "候选全文" }]`。真实装配、真实
 * 落库、零业务 mock——只有模型调用这一层被替换：按 userPrompt 包含
 * `contains` 选条目；无匹配即报错（e2e 用例各自持有唯一标记串）。
 */
function loadFixtureCompletionClient(): CompletionClient | null {
  const fixturePath = process.env.NW_COMPLETION_FIXTURE;
  if (!fixturePath) return null;
  const entries = JSON.parse(readFileSync(fixturePath, "utf8")) as Array<{
    contains: string;
    markdown: string;
    promptTokens?: number;
    completionTokens?: number;
  }>;
  return {
    async complete(request) {
      const matched = entries.find((entry) =>
        request.userPrompt.includes(entry.contains),
      );
      if (!matched) {
        throw new Error(
          `补全 fixture 无匹配条目（NW_COMPLETION_FIXTURE）：userPrompt 前 120 字＝${request.userPrompt.slice(0, 120)}`,
        );
      }
      return {
        markdown: matched.markdown,
        usage: {
          promptTokens: matched.promptTokens ?? 120,
          completionTokens: matched.completionTokens ?? 80,
        },
      };
    },
  };
}

const DesktopCoreRequestSchema = z.object({
  cwd: z.string().trim().min(1),
  request: LocalRpcRequestSchema,
});

function respond(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function readMethod(raw: unknown): string {
  if (typeof raw !== "object" || raw === null) return "";
  const method = (raw as { method?: unknown }).method;
  return typeof method === "string" ? method : "";
}

async function handleLine(line: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    respond({ ok: false, error: { message: "本地核心收到无法解析的请求。" } });
    return;
  }

  // 版本握手零副作用：不初始化项目即可应答（WF3-02）。
  if (readMethod(parsed) === "core_version") {
    respond({
      ok: true,
      data: {
        rpcVersion: LOCAL_RPC_VERSION,
        methodCount: LocalRpcRequestSchema.options.length,
      },
    });
    return;
  }

  try {
    const { cwd, request } = DesktopCoreRequestSchema.parse(parsed);
    const completionClient = loadFixtureCompletionClient();
    const application = await createNovelWeaver(
      completionClient ? { cwd, completionClient } : { cwd },
    );
    try {
      const data = await new NovelWeaverLocalRpc(application).execute(request);
      respond({ ok: true, data });
    } finally {
      application.close();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issue = error.issues[0];
      const where = issue && issue.path.length > 0 ? `（字段 ${issue.path.join(".")}）` : "";
      respond({
        ok: false,
        error: {
          message: `请求被本地核心拒绝${where}：${issue?.message ?? "方法未知或参数不合法"}`,
          kind: "request_rejected",
          detail: JSON.stringify(error.issues).slice(0, 2000),
        },
      });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    respond({ ok: false, error: { message } });
  }
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

/** 打包为 CJS 后不允许顶层 await，入口收敛到 main()。 */
async function main(): Promise<void> {
  for await (const line of input) {
    await handleLine(line);
  }
}

void main();
