/**
 * Cost + Metrics Tracker
 * Tracks API call count, token usage, latency, and estimated cost per run.
 * Wraps callClaude to intercept and log usage.
 * 
 * Sonnet 4 pricing (as of 2025):
 *   Input:  $3.00 / 1M tokens
 *   Output: $15.00 / 1M tokens
 */

const PRICING = {
  'claude-sonnet-4-20250514': { inputPer1M: 3.0, outputPer1M: 15.0 },
  default:                    { inputPer1M: 3.0, outputPer1M: 15.0 },
};

export class MetricsTracker {
  constructor(runId) {
    this.runId = runId;
    this.calls = [];
    this.startTime = Date.now();
  }

  recordCall({ stage, model, inputTokens, outputTokens, latencyMs, success = true }) {
    const pricing = PRICING[model] || PRICING.default;
    const inputCost  = (inputTokens  / 1_000_000) * pricing.inputPer1M;
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
    this.calls.push({
      stage, model,
      inputTokens, outputTokens, totalTokens: inputTokens + outputTokens,
      inputCost, outputCost, totalCost: inputCost + outputCost,
      latencyMs, success,
      timestamp: new Date().toISOString(),
    });
  }

  summary() {
    const totalCalls   = this.calls.length;
    const totalTokens  = this.calls.reduce((s, c) => s + c.totalTokens, 0);
    const totalInput   = this.calls.reduce((s, c) => s + c.inputTokens, 0);
    const totalOutput  = this.calls.reduce((s, c) => s + c.outputTokens, 0);
    const totalCost    = this.calls.reduce((s, c) => s + c.totalCost, 0);
    const totalLatency = this.calls.reduce((s, c) => s + c.latencyMs, 0);
    const wallTime     = Date.now() - this.startTime;

    return {
      runId: this.runId,
      apiCalls: totalCalls,
      tokens: { input: totalInput, output: totalOutput, total: totalTokens },
      cost: {
        usd: parseFloat(totalCost.toFixed(6)),
        breakdown: this.calls.map(c => ({
          stage: c.stage,
          tokens: c.totalTokens,
          cost: `$${c.totalCost.toFixed(5)}`,
        })),
      },
      latency: {
        totalApiMs: totalLatency,
        wallMs: wallTime,
        avgPerCallMs: totalCalls > 0 ? Math.round(totalLatency / totalCalls) : 0,
      },
    };
  }

  // Quality vs cost tradeoff analysis
  tradeoffAnalysis(qualityScore) {
    const { cost, latency, apiCalls } = this.summary();
    const scorePercent = Math.round(qualityScore * 100);

    // Cost efficiency: quality score per dollar
    const efficiency = cost.usd > 0 ? (qualityScore / cost.usd).toFixed(0) : 'N/A';

    return {
      qualityScore: scorePercent + '%',
      totalCost: `$${cost.usd.toFixed(5)}`,
      apiCalls,
      wallTimeMs: latency.wallMs,
      costEfficiency: `${efficiency} quality points per $1`,
      recommendation: getRecommendation(qualityScore, cost.usd, latency.wallMs),
    };
  }
}

function getRecommendation(score, cost, ms) {
  if (score >= 0.85 && ms < 20000) return '✅ Optimal: high quality, fast, low cost';
  if (score >= 0.85 && ms >= 20000) return '⚠ Consider: quality good but slow — check for timeouts';
  if (score < 0.7 && cost > 0.10)   return '❌ Poor: low quality AND expensive — review prompts';
  if (score < 0.7)                  return '⚠ Quality below threshold — check repair engine';
  return '✅ Acceptable tradeoff';
}

/**
 * Singleton tracker per process — reset between runs.
 */
let _current = null;

export function startTracking(runId) {
  _current = new MetricsTracker(runId);
  return _current;
}

export function getTracker() {
  return _current;
}

export function recordCall(data) {
  _current?.recordCall(data);
}
