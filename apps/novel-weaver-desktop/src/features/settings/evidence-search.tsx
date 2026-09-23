import type { EvidenceSearchResult } from "novel-weaver-core/src/domain/retrieval.ts";
import { useState } from "react";
import { authorErrorMessage, queryProject } from "../../shared/api/rpc";
import { Button, InlineNote, TextField } from "../../shared/ui/components";

const DEGRADATION: Record<string, string> = {
  semantic_disabled: "语义检索尚未启用，本次使用关键词检索。",
  semantic_index_missing: "本书尚未建立语义索引，本次使用关键词检索；请先更新本书语义索引。",
  semantic_index_stale:
    "正式正文已有更新，语义索引尚未同步，本次使用关键词检索；请更新本书语义索引。",
  semantic_index_error: "语义检索暂不可用，本次已切换为关键词检索；可重新检查扩展并更新索引。",
};

/** Author-side evidence lookup; never changes facts or silently feeds a generation. */
export function EvidenceSearch({ cwd }: { cwd: string }) {
  const [query, setQuery] = useState("");
  const [before, setBefore] = useState("");
  const [result, setResult] = useState<EvidenceSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const search = async () => {
    if (busy) return;
    if (!query.trim()) {
      setError("请输入想找的情节、物品或一句描述。");
      return;
    }
    const beforeStoryOrder = before.trim() ? Number(before) : Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(beforeStoryOrder)) {
      setError("故事序请填写整数，留空检索全部已确认正文。");
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(
        await queryProject<EvidenceSearchResult>(cwd, "search_evidence", {
          query: query.trim(),
          continuityId: "main",
          beforeStoryOrder,
          limit: 10,
        }),
      );
    } catch (raw) {
      setError(authorErrorMessage(raw));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      aria-label="检索本书正文"
      className="grid gap-2 border border-line rounded-sm p-3 min-w-0"
    >
      <h3 className="m-0 text-[14px]">试一试 · 检索本书正文</h3>
      <p className="m-0 text-[12px] text-ink-mid">
        检索范围为本书主连续体的已确认正文。可找情节证据、回顾人物经历或查找伏笔线索；候选稿、未批准设定不在此范围内。
      </p>
      <TextField
        label="想找什么"
        value={query}
        onChange={setQuery}
        placeholder="例如：有人把钥匙交给主角的那一幕"
      />
      <TextField
        label="只查此故事序之前（可空）"
        value={before}
        onChange={setBefore}
        hint="按故事时间限制检索，避免查到后续剧情；留空包含全部已确认正文。"
      />
      <div>
        <Button variant="primary" busy={busy} onClick={() => void search()}>
          检索正文
        </Button>
      </div>
      {error ? <InlineNote>{error}</InlineNote> : null}
      {result ? (
        <div className="grid gap-2" aria-live="polite">
          <p className="m-0 text-[12px] text-accent-text">
            本次使用：{result.engine === "zvec" ? "语义检索" : "关键词检索"} · 找到{" "}
            {result.items.length} 条
          </p>
          {result.degradedReason ? (
            <p className="m-0 text-[12px] text-ink-mid">{DEGRADATION[result.degradedReason]}</p>
          ) : null}
          {result.items.length === 0 ? (
            <p className="m-0 text-[12px]">
              没有找到相关正文。确认本书已有正式场景，或换用正文中出现过的关键词。
            </p>
          ) : (
            result.items.map((item) => (
              <article key={item.versionId} className="grid gap-1 rounded-sm bg-shell p-2">
                <h4 className="m-0 text-[13px]">{item.title}</h4>
                <p className="m-0 text-[11px] text-ink-low">
                  已确认正文 · 故事序 {item.storyOrder}
                </p>
                <p className="m-0 text-[12px] whitespace-pre-wrap wrap-break-word max-h-48 overflow-y-auto">
                  {item.markdown}
                </p>
                <details>
                  <summary className="cursor-pointer text-[11px] text-ink-low">
                    高级 · 来源编号
                  </summary>
                  <p className="text-[11px] break-all">
                    场景：{item.sceneId}
                    <br />
                    版本：{item.versionId}
                  </p>
                </details>
              </article>
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}
