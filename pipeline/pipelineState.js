/**
 * Pipeline State Tracker
 * Tracks state of each stage with precise timing, retries, and status.
 * Frontend polls this for live visualization.
 */

export const StageState = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  REPAIRED: 'REPAIRED',
  SKIPPED: 'SKIPPED',
};

export const STAGES = [
  { id: 'clarification',     label: 'Prompt Analysis',        description: 'Checking confidence + conflicts' },
  { id: 'intent_extraction', label: 'Intent Extraction',       description: 'NL → structured intent' },
  { id: 'ir_build',          label: 'IR Construction',         description: 'Building AppSpec IR' },
  { id: 'system_design',     label: 'System Design',           description: 'Architecture + API groups' },
  { id: 'schema_generation', label: 'Schema Generation',       description: 'UI + API + DB + Auth (parallel)' },
  { id: 'zod_validation',    label: 'Zod Validation',          description: 'Type-safe schema checks' },
  { id: 'repair',            label: 'Repair Engine',           description: 'Patch + fix inconsistencies' },
  { id: 'runtime',           label: 'Runtime Generation',      description: 'Generating executable artifacts' },
  { id: 'simulation',        label: 'Simulation',              description: 'Validating artifact correctness' },
  { id: 'evaluation',        label: 'Evaluation',              description: 'Quality scoring' },
];

export class PipelineTracker {
  constructor(runId) {
    this.runId = runId;
    this.startTime = Date.now();
    this.stages = {};
    this.totalRetries = 0;

    // Initialize all stages as PENDING
    for (const stage of STAGES) {
      this.stages[stage.id] = {
        id: stage.id,
        label: stage.label,
        description: stage.description,
        state: StageState.PENDING,
        startTime: null,
        endTime: null,
        durationMs: null,
        retries: 0,
        error: null,
        metadata: {},
      };
    }
  }

  start(stageId, metadata = {}) {
    if (!this.stages[stageId]) return;
    this.stages[stageId].state = StageState.RUNNING;
    this.stages[stageId].startTime = Date.now();
    this.stages[stageId].metadata = { ...this.stages[stageId].metadata, ...metadata };
  }

  success(stageId, metadata = {}) {
    if (!this.stages[stageId]) return;
    const s = this.stages[stageId];
    s.state = StageState.SUCCESS;
    s.endTime = Date.now();
    s.durationMs = s.endTime - (s.startTime || s.endTime);
    s.metadata = { ...s.metadata, ...metadata };
  }

  repaired(stageId, patchCount = 0) {
    if (!this.stages[stageId]) return;
    const s = this.stages[stageId];
    s.state = StageState.REPAIRED;
    s.endTime = Date.now();
    s.durationMs = s.endTime - (s.startTime || s.endTime);
    s.metadata.patchCount = patchCount;
  }

  fail(stageId, error) {
    if (!this.stages[stageId]) return;
    const s = this.stages[stageId];
    s.state = StageState.FAILED;
    s.endTime = Date.now();
    s.durationMs = s.endTime - (s.startTime || s.endTime);
    s.error = error?.message || String(error);
  }

  retry(stageId) {
    if (!this.stages[stageId]) return;
    this.stages[stageId].retries++;
    this.totalRetries++;
  }

  skip(stageId) {
    if (!this.stages[stageId]) return;
    this.stages[stageId].state = StageState.SKIPPED;
  }

  snapshot() {
    return {
      runId: this.runId,
      totalMs: Date.now() - this.startTime,
      totalRetries: this.totalRetries,
      stages: { ...this.stages },
      overall: this._overallState(),
    };
  }

  _overallState() {
    const states = Object.values(this.stages).map(s => s.state);
    if (states.some(s => s === StageState.FAILED)) return StageState.FAILED;
    if (states.every(s => s === StageState.SUCCESS || s === StageState.SKIPPED || s === StageState.REPAIRED)) return StageState.SUCCESS;
    if (states.some(s => s === StageState.RUNNING)) return StageState.RUNNING;
    return StageState.PENDING;
  }
}
