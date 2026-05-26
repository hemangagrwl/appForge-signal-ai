/**
 * Evaluation Benchmark Runner v2
 * Runs the full pipeline against the 20-prompt dataset.
 * Tracks: success rate, retries, latency, repair count, simulation pass, grade distribution.
 * 
 * Usage: ANTHROPIC_API_KEY=sk-... node tests/eval_benchmark.js
 */

import { runPipeline } from '../pipeline/orchestrator.js';
import { getAllPrompts } from '../evaluation/dataset.js';
import fs from "fs";
import BenchmarkSummary from "../evaluation/benchmarkSummary.js";
const RESULTS = [];
const dataset = JSON.parse(
    fs.readFileSync(
        "./evaluation/dataset.json",
        "utf-8"
    )
);

const benchmark =
    new BenchmarkSummary();
async function run() {
  console.log('\n🧪 AppForge v2 Evaluation Benchmark');
  console.log('='.repeat(52));
  console.log('Prompts: 10 real + 10 edge cases\n');

  const prompts = getAllPrompts();
  let totalRetries = 0, totalMs = 0, passed = 0, clarified = 0;
  const gradeMap = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  const failTypes = {};

  for (const item of prompts) {
    const label = `[${(item.category||'real').toUpperCase().padEnd(12)}] ${item.prompt.slice(0, 55)}...`;
    process.stdout.write(label + '\n');

    const start = Date.now();
    try {
      const result = await runPipeline(item.prompt, { skipClarification: false });
      const ms = Date.now() - start;

      if (result.needsClarification) {

    clarified++;

    passed++;

    console.log(
      `  ⚠ Needs clarification (conf: ${result.clarification?.confidence?.toFixed(2)})`
    );

    RESULTS.push({

        ...item,

        outcome:'clarification',

        success:true,

        ms,

        confidence:
            result.clarification?.confidence

    });

    continue;
}

      const score = result.evaluation?.score ?? 0;
      const grade = result.evaluation?.grade ?? 'F';
      const retries = result.pipelineState?.totalRetries ?? 0;
      const simOk = result.simulation?.executable ?? false;
      const patches = result.patchLog?.applied ?? 0;

      if (result.success) passed++;
      gradeMap[grade] = (gradeMap[grade] || 0) + 1;
      totalRetries += retries;
      totalMs += ms;

      const icon = result.success ? '✅' : '❌';
      console.log(`  ${icon} Grade:${grade} Score:${Math.round(score*100)}% Sim:${simOk?'✓':'✗'} Patches:${patches} Retries:${retries} ${ms}ms`);

      RESULTS.push({
        id: item.id, category: item.category || 'real',
        prompt: item.prompt.slice(0, 80),
        success: result.success, grade, score, simExecutable: simOk,
        patchesApplied: patches, retries, ms,
        entities: result.appSpec?.entities?.length ?? 0,
        endpoints: result.schemas?.api?.endpoints?.length ?? 0,
        tables: result.schemas?.db?.tables?.length ?? 0,
      });

      benchmark.add({

    success: result.success,

    retries: retries,

    latency: ms,

    failureType:
        result.success
        ? null
        : "pipelineFailure"
  });

    } catch (err) {
      const ms = Date.now() - start;
      const type = err.message.split(':')[0].slice(0, 30);
      failTypes[type] = (failTypes[type] || 0) + 1;
      console.log(`  💥 ${err.message.slice(0, 80)}`);
      RESULTS.push({ id: item.id, category: item.category || 'real', prompt: item.prompt.slice(0, 80), success: false, error: err.message, ms });
      benchmark.add({

    success:false,

    retries:0,

    latency:ms,

    failureType:type
    });
    }

    await sleep(800); // rate limit buffer
  }

  const total = prompts.length;
  const avgMs = total > 0 ? Math.round(totalMs / total) : 0;

  console.log('\n' + '='.repeat(52));
  console.log('📊 BENCHMARK RESULTS');
  console.log('='.repeat(52));
  console.log(`Total prompts      : ${total}`);
  console.log(`Passed             : ${passed}/${total} (${((passed/total)*100).toFixed(1)}%)`);
  console.log(`Needs Clarification: ${clarified}`);
  console.log(`Avg latency        : ${avgMs}ms`);
  console.log(`Avg retries/run    : ${(totalRetries/total).toFixed(2)}`);
  console.log(`\nGrade Distribution :`);
  Object.entries(gradeMap).filter(([,v])=>v>0).forEach(([g,c]) => {
    const bar = '█'.repeat(c);
    console.log(`  ${g}: ${bar} (${c})`);
  });

  const byCategory = {};
  RESULTS.forEach(r => {
    const cat = r.category;
    if (!byCategory[cat]) byCategory[cat] = { pass: 0, total: 0 };
    byCategory[cat].total++;
    if (
    r.success ||
    r.outcome === 'clarification'
){
    byCategory[cat].pass++;
}
  });
  console.log(`\nBy Category:`);
  Object.entries(byCategory).forEach(([cat, { pass, total }]) => {
    console.log(`  ${cat.padEnd(14)}: ${pass}/${total} (${Math.round(pass/total*100)}%)`);
  });

  if (Object.keys(failTypes).length) {
    console.log(`\nFailure Types:`);
    Object.entries(failTypes).forEach(([t, c]) => console.log(`  ${t}: ${c}`));
  }

  const simPassed = RESULTS.filter(r => r.simExecutable).length;
  const avgPatches = RESULTS.reduce((s,r)=>s+(r.patchesApplied||0),0) / RESULTS.filter(r=>r.patchesApplied!=null).length;
  console.log(`\nSimulation pass rate: ${simPassed}/${RESULTS.filter(r=>r.simExecutable!=null).length}`);
  console.log(`Avg patches/run     : ${avgPatches.toFixed(1)}`);
  console.log('\nBenchmark Summary');

  console.log(
    benchmark.generate()
  );

  console.log('='.repeat(52));

  return RESULTS;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

run().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
