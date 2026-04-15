#!/bin/bash
# analyze-tokens.sh — 分析 .agent-runs/tokens.jsonl 中的 token 使用数据
# 依赖: jq (brew install jq)

set -e

FILE="${1:-.agent-runs/tokens.jsonl}"

if [ ! -f "$FILE" ]; then
  echo "❌ File not found: $FILE"
  echo "Usage: bash scripts/analyze-tokens.sh [path/to/tokens.jsonl]"
  exit 1
fi

TOTAL_RECORDS=$(wc -l < "$FILE" | tr -d ' ')
echo "📊 Token Usage Report ($TOTAL_RECORDS records from $FILE)"
echo "═══════════════════════════════════════════════"

echo ""
echo "📌 按 Source 汇总"
echo "───────────────────────────────────────────────"
cat "$FILE" | jq -s 'group_by(.source) | map({
  source: .[0].source,
  calls: length,
  promptTokens: ([.[].promptTokens] | add),
  completionTokens: ([.[].completionTokens] | add),
  totalTokens: ([.[].totalTokens] | add),
  avgLatencyMs: (([.[].latencyMs] | add) / length | round)
}) | sort_by(-.totalTokens)'

echo ""
echo "🤖 按 Model 对比"
echo "───────────────────────────────────────────────"
cat "$FILE" | jq -s 'group_by(.model) | map({
  model: .[0].model,
  calls: length,
  totalTokens: ([.[].totalTokens] | add),
  avgTokensPerCall: (([.[].totalTokens] | add) / length | round)
}) | sort_by(-.totalTokens)'

echo ""
echo "🔄 按 Phase 分布"
echo "───────────────────────────────────────────────"
cat "$FILE" | jq -s '[.[] | select(.phase != null)] | group_by(.phase) | map({
  phase: .[0].phase,
  calls: length,
  totalTokens: ([.[].totalTokens] | add),
  avgPromptTokens: (([.[].promptTokens] | add) / length | round)
}) | sort_by(-.totalTokens)'

echo ""
echo "📈 最近一次运行 (迭代详情)"
echo "───────────────────────────────────────────────"
LAST_RUN=$(tail -1 "$FILE" | jq -r '.runId')
cat "$FILE" | jq -s --arg run "$LAST_RUN" '[.[] | select(.runId == $run)] |
  map({
    iter: .iteration,
    phase: (.phase // "-"),
    prompt: .promptTokens,
    completion: .completionTokens,
    total: .totalTokens,
    latencyMs: .latencyMs,
    tools: ((.toolsCalled // []) | join(","))
  }) | sort_by(.iter)'

echo ""
echo "💰 最近一次运行 — 总计"
echo "───────────────────────────────────────────────"
cat "$FILE" | jq -s --arg run "$LAST_RUN" '[.[] | select(.runId == $run)] | {
  runId: .[0].runId,
  source: .[0].source,
  iterations: length,
  totalPrompt: ([.[].promptTokens] | add),
  totalCompletion: ([.[].completionTokens] | add),
  totalTokens: ([.[].totalTokens] | add),
  totalLatencyMs: ([.[].latencyMs] | add),
  avgTokensPerIter: (([.[].totalTokens] | add) / length | round)
}'
