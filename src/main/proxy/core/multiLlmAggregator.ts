/**
 * Core Gateway Module - Multi-LLM Aggregator
 *
 * Implements the five aggregation strategies:
 *   - parallel: fire all, merge all answers sequentially (each labeled)
 *   - race: first successful response wins, cancel the rest
 *   - vote: multiple answers, pick the most common one (majority)
 *   - merge: synthesize all answers into one coherent response via a judge
 *   - best: judge model picks the best answer
 *
 * Each aggregator receives the full set of ProviderResults and returns the
 * final aggregated text. All pure functions for testability.
 */

import type {
  AggregationMode,
  ProviderResult,
  MultiLlmResult,
} from './multiLlm.ts'
import { MultiLlmError } from './multiLlm.ts'

/** Normalize text for voting comparison (trim, lowercase, collapse whitespace). */
function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Race: the first successful response wins.
 */
export function aggregateRace(results: ProviderResult[]): MultiLlmResult {
  const successful = results.filter(r => r.success && r.text)

  if (successful.length === 0) {
    throw MultiLlmError.allFailed()
  }

  const winner = successful.reduce((a, b) => (a.latencyMs <= b.latencyMs ? a : b))
  return {
    text: winner.text,
    results: results.map(r => ({ ...r, isWinner: r.providerId === winner.providerId })),
    contributors: [winner.providerId],
    totalLatencyMs: winner.latencyMs,
    aggregation: 'race',
  }
}

/**
 * Parallel: all successful answers, concatenated with provider labels.
 */
export function aggregateParallel(results: ProviderResult[]): MultiLlmResult {
  const successful = results.filter(r => r.success && r.text)
  if (successful.length === 0) {
    throw MultiLlmError.allFailed()
  }

  const text = successful
    .map(r => `[${r.providerId}]\n${r.text}`)
    .join('\n\n---\n\n')

  const maxLatency = Math.max(...results.map(r => r.latencyMs))
  return {
    text,
    results,
    contributors: successful.map(r => r.providerId),
    totalLatencyMs: maxLatency,
    aggregation: 'parallel',
  }
}

/**
 * Vote: pick the most common answer (by normalized text).
 */
export function aggregateVote(results: ProviderResult[], minVotes = 1): MultiLlmResult {
  const successful = results.filter(r => r.success && r.text)
  if (successful.length === 0) {
    throw MultiLlmError.allFailed()
  }

  const counts = new Map<string, { text: string; providerId: string; count: number }>()
  for (const r of successful) {
    const key = normalize(r.text)
    const existing = counts.get(key)
    if (existing) {
      existing.count++
    } else {
      counts.set(key, { text: r.text, providerId: r.providerId, count: 1 })
    }
  }

  const sorted = [...counts.values()].sort((a, b) => b.count - a.count)
  const winner = sorted[0]

  if (winner.count < minVotes) {
    // No consensus — fall back to the first successful response.
    const first = successful[0]
    return {
      text: first.text,
      results,
      contributors: [first.providerId],
      totalLatencyMs: Math.max(...results.map(r => r.latencyMs)),
      aggregation: 'vote',
    }
  }

  return {
    text: winner.text,
    results,
    contributors: successful
      .filter(r => normalize(r.text) === normalize(winner.text))
      .map(r => r.providerId),
    totalLatencyMs: Math.max(...results.map(r => r.latencyMs)),
    aggregation: 'vote',
  }
}

/**
 * Merge: combine all answers into one coherent response via a judge.
 * The merge prompt is built here; the judge call is performed by the caller.
 */
export function buildMergePrompt(results: ProviderResult[]): string {
  const successful = results.filter(r => r.success && r.text)
  if (successful.length === 0) {
    throw MultiLlmError.allFailed()
  }

  const sections = successful
    .map(r => `### Answer from ${r.providerId}\n${r.text}`)
    .join('\n\n')

  return `You are a synthesis engine. Below are answers from multiple AI models to the same question. Merge them into a single, coherent, complete answer that preserves the best information from each. Do not mention the individual models.\n\n${sections}`
}

/**
 * Best: pick the best answer via a judge. The judge prompt is built here.
 */
export function buildBestPrompt(results: ProviderResult[]): string {
  const successful = results.filter(r => r.success && r.text)
  if (successful.length === 0) {
    throw MultiLlmError.allFailed()
  }

  const options = successful
    .map((r, i) => `Option ${i + 1} (${r.providerId}):\n${r.text}`)
    .join('\n\n---\n\n')

  return `You are a judge. Below are ${successful.length} answers to the same question. Pick the BEST answer by accuracy, completeness, and clarity. Respond with ONLY the text of the best answer, no commentary.\n\n${options}`
}

/**
 * Build the final result after a judge (merge/best) returns its synthesis.
 */
export function buildJudgeResult(
  results: ProviderResult[],
  judgeText: string,
  aggregation: 'merge' | 'best',
  judgeProviderId: string
): MultiLlmResult {
  return {
    text: judgeText,
    results,
    contributors: [judgeProviderId],
    totalLatencyMs: Math.max(...results.map(r => r.latencyMs)),
    aggregation,
  }
}

/**
 * Dispatch to the appropriate aggregator. Merge/best modes return a prompt
 * that the caller must send to a judge model; the caller then calls
 * buildJudgeResult with the judge's response.
 */
export type AggregatorOutcome =
  | { kind: 'direct'; result: MultiLlmResult }
  | { kind: 'judge'; prompt: string; judgeMode: 'merge' | 'best'; results: ProviderResult[] }

export function aggregate(
  mode: AggregationMode,
  results: ProviderResult[],
  options: { minVotes?: number; judgeProviderId?: string } = {}
): AggregatorOutcome {
  if (mode === 'race') {
    return { kind: 'direct', result: aggregateRace(results) }
  }
  if (mode === 'parallel') {
    return { kind: 'direct', result: aggregateParallel(results) }
  }
  if (mode === 'vote') {
    return { kind: 'direct', result: aggregateVote(results, options.minVotes ?? 1) }
  }
  if (mode === 'merge') {
    return { kind: 'judge', prompt: buildMergePrompt(results), judgeMode: 'merge', results }
  }
  if (mode === 'best') {
    return { kind: 'judge', prompt: buildBestPrompt(results), judgeMode: 'best', results }
  }
  throw MultiLlmError.noAggregationTarget()
}
