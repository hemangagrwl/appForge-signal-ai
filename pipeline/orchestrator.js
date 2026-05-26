/**
 * AppForge Pipeline Orchestrator v2
 * 
 * Upgraded with:
 *   - AppSpec IR as single source of truth
 *   - Zod-validated schemas
 *   - Patch-based repair engine
 *   - Pipeline state tracking per stage
 *   - Clarification system for vague prompts
 *   - Runtime generator + simulator
 *   - Per-stage timeout protection
 */
import { startTracking }
from "../utils/metrics.js";
import { extractIntent } from './stage1_intent.js';
import { designSystem } from './stage2_system_design.js';
import { generateSchemas } from './stage3_schema_gen.js';
import { buildAppSpec } from '../types/appSpec.js';
import { applyPatches } from '../validation/patchRepair.js';
import { evaluateOutput } from '../evaluation/evaluator.js';
import { generateArtifacts } from '../runtime/generator.js';
import { simulate } from '../runtime/simulator.js';
import { analyzePromptConfidence, CONFIDENCE_THRESHOLD } from './clarification.js';
import { PipelineTracker } from './pipelineState.js';

export const MAX_REPAIR_ATTEMPTS = 3;
const STAGE_TIMEOUT_MS = 30000;

export async function runPipeline(userPrompt, options = {}) {
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const tracker = new PipelineTracker(runId);
  const metricsTracker = startTracking(runId);
  
  log(runId, '🚀 Pipeline v2 started');

  try {
    // ── Stage 0: Prompt Confidence + Clarification ──────────────────────
    tracker.start('clarification');
    log(runId, '🔍 Stage 0: Analyzing prompt confidence...');
    const clarification = await withTimeout(
      analyzePromptConfidence(userPrompt),
      STAGE_TIMEOUT_MS
    );
    
    if (clarification.needsClarification && !options.skipClarification) {
      tracker.success('clarification', { confidence: clarification.confidence });
      log(runId, `⚠️  Low confidence (${clarification.confidence.toFixed(2)}) — returning clarification request`);
      return {
        success: false,
        needsClarification: true,
        runId,
        prompt: userPrompt,
        clarification,
        pipelineState: tracker.snapshot(),
      };
    }
    
    const workingPrompt = clarification.sanitizedPrompt || userPrompt;
    tracker.success('clarification', { confidence: clarification.confidence, assumptions: clarification.assumptions.length });

    // ── Stage 1: Intent Extraction ──────────────────────────────────────
    tracker.start('intent_extraction');
    log(runId, '📥 Stage 1: Extracting intent...');
    const intent = await withRetry(
      'intent_extraction',
      () => withTimeout(extractIntent(workingPrompt), STAGE_TIMEOUT_MS),
      tracker
    );
    tracker.success('intent_extraction', { entities: intent.entities.length, roles: intent.roles.length });

    // ── Stage 2: System Design ──────────────────────────────────────────
    tracker.start('system_design');
    log(runId, '🏗️  Stage 2: Designing system...');
    const systemDesign = await withRetry(
      'system_design',
      () => withTimeout(designSystem(intent), STAGE_TIMEOUT_MS),
      tracker
    );
    tracker.success('system_design', { apiGroups: systemDesign.apiGroups?.length, routes: systemDesign.navigationFlow?.length });

    // ── Stage IR: Build AppSpec ─────────────────────────────────────────
    tracker.start('ir_build');
    log(runId, '📐 Stage IR: Building AppSpec IR...');
    const appSpec = buildAppSpec(intent, systemDesign);
    tracker.success('ir_build', { entities: appSpec.entities.length, pages: appSpec.pages.length, endpoints: appSpec.endpoints.length });
    log(runId, `   IR: ${appSpec.entities.length} entities, ${appSpec.pages.length} pages, ${appSpec.endpoints.length} endpoints`);

    // ── Stage 3: Schema Generation (all 4 from AppSpec IR) ──────────────
    tracker.start('schema_generation');
    log(runId, '⚙️  Stage 3: Generating schemas from IR (parallel)...');
    const rawSchemas = await withRetry(
      'schema_generation',
      () => withTimeout(generateSchemas(appSpec), STAGE_TIMEOUT_MS * 2), // longer for parallel
      tracker
    );
    tracker.success('schema_generation', {
      uiPages: rawSchemas.ui?.pages?.length,
      apiEndpoints: rawSchemas.api?.endpoints?.length,
      dbTables: rawSchemas.db?.tables?.length,
      authRoles: rawSchemas.auth?.roles?.length,
    });

    // ── Stage 4+5: Zod Validation + Patch Repair ────────────────────────
    tracker.start('zod_validation');
    log(runId, '🔍 Stage 4: Zod validation + patch repair...');
    const repairResult = applyPatches(rawSchemas, appSpec);
    const { schemas, patchLog } = repairResult;
    
    if (patchLog.applied > 0) {
      tracker.repaired('zod_validation', patchLog.applied);
      tracker.repaired('repair', patchLog.applied);
      log(runId, `   Applied ${patchLog.applied} patches, skipped ${patchLog.skipped}`);
    } else {
      tracker.success('zod_validation', { issues: 0 });
      tracker.success('repair', { patches: 0 });
    }

    // ── Stage 6: Runtime Generation ─────────────────────────────────────
    tracker.start('runtime');
    log(runId, '🔨 Stage 6: Generating runtime artifacts...');
    const artifacts = generateArtifacts(appSpec);
    tracker.success('runtime', { artifactCount: Object.keys(artifacts).length });
    log(runId, `   Generated ${Object.keys(artifacts).length} artifacts`);

    // ── Stage 7: Simulation ─────────────────────────────────────────────
    tracker.start('simulation');
    log(runId, '🧪 Stage 7: Simulating artifact correctness...');
    const simulation = simulate(appSpec, artifacts);
    if (simulation.executable) {
      tracker.success('simulation', { checks: simulation.summary });
    } else {
      tracker.fail('simulation', new Error(`${simulation.summary.failed} simulation checks failed`));
    }
    log(runId, `   Simulation: ${simulation.summary.passed}/${simulation.summary.total} checks passed`);

    // ── Stage 8: Evaluation ─────────────────────────────────────────────
    tracker.start('evaluation');
    log(runId, '📊 Stage 8: Evaluating quality...');
    const pipelineMetrics = tracker.snapshot();
    const evaluation = evaluateOutput(schemas, intent, systemDesign, {
      startTime: pipelineMetrics.stages.intent_extraction?.startTime || Date.now(),
      totalRetries: pipelineMetrics.totalRetries,
    });
    tracker.success('evaluation', { score: evaluation.score, grade: evaluation.grade });

    const finalSnapshot = tracker.snapshot();
    const success = evaluation.score >= 0.6 || simulation.executable;

    log(runId, `✅ Pipeline complete in ${finalSnapshot.totalMs}ms | Score: ${(evaluation.score * 100).toFixed(0)}% | Simulation: ${simulation.executable ? '✓' : '✗'}`);

    return {
      success,
      runId,
      prompt: userPrompt,
      // Core outputs
      intent,
      appSpec,
      systemDesign,
      schemas,
      // Repair
      patchLog,
      // Runtime
      artifacts,
      simulation,
      // Meta
      clarification,
      evaluation,
      pipelineState: finalSnapshot,
      costMetrics: metricsTracker.summary(),
      tradeoff: metricsTracker.tradeoffAnalysis(evaluation.score),
      assumptions: [
        ...(clarification.assumptions || []),
        ...(intent.assumptions || []),
      ],
      warnings: evaluation.warnings || [],
    };

  } catch (err) {
    const snapshot = tracker.snapshot();
    log(runId, `❌ Pipeline failed: ${err.message}`);
    return { success: false, runId, error: err.message, pipelineState: snapshot };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function withRetry(stageId, fn, tracker, maxAttempts = MAX_REPAIR_ATTEMPTS) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts) {
        tracker.fail(stageId, err);
        throw new Error(`Stage ${stageId} failed after ${attempt} attempts: ${err.message}`);
      }
      tracker.retry(stageId);
      console.warn(`[AppForge] ${stageId} attempt ${attempt} failed, retrying...`);
      await sleep(500 * attempt);
    }
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)),
  ]);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(id, msg) { console.log(`[AppForge:${id}] ${msg}`); }
