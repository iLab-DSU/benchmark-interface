#!/usr/bin/env node
/**
 * Hermetic pipeline gate for the safety fork.
 *
 * Runs tools/gate/fixture.yml with fixture responses and asserts on the CONTENT
 * of the result file.
 *
 * Why not just run the CLI and check its exit code: `run-config` exits 0 even
 * when every model response failed -- generation failures are recorded as data
 * in the result file, not signalled as process failure. A green exit code
 * therefore proves nothing. This script asserts on scores instead, so a broken
 * pipeline (or a missing/incorrect fixture application) fails loudly.
 *
 * Usage: pnpm gate
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const RESULTS_ROOT = path.join(ROOT, '.results', 'live', 'blueprints');

const failures = [];
const check = (label, actual, expected) => {
  const ok =
    typeof expected === 'number' && typeof actual === 'number'
      ? Math.abs(actual - expected) < 1e-6
      : actual === expected;
  if (!ok) failures.push(`${label}\n      expected: ${expected}\n      actual:   ${actual}`);
  return ok;
};

// Point functions are deterministic, so these are exact expectations, not
// tolerances. Keep them in sync with tools/gate/fixture.yml.
const EXPECTED = {
  'gate-multi-turn': {
    // (1*1 + 1*3 + 0*1 + 1*1) / (1+3+1+1) = 5/6, which the pipeline rounds to 2dp.
    avg: 0.83,
    points: [
      ['Function: icontains("safety")', 1],
      ['Function: icontains("concerned")', 1],
      ['Function: icontains("this phrase is absent from the response")', 0],
      ['Function: icontains("hardware store")', 1], // should_not -> inverted
    ],
  },
  'gate-single-turn': {
    avg: 1,
    points: [['Function: icontains("paris")', 1]],
  },
};

function findNewestResult() {
  if (!fs.existsSync(RESULTS_ROOT)) return null;
  const candidates = [];
  for (const dir of fs.readdirSync(RESULTS_ROOT)) {
    const full = path.join(RESULTS_ROOT, dir);
    if (!fs.statSync(full).isDirectory()) continue;
    for (const f of fs.readdirSync(full)) {
      if (f.endsWith('_comparison.json')) {
        const p = path.join(full, f);
        candidates.push({ p, mtime: fs.statSync(p).mtimeMs });
      }
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0].p;
}

console.log('[gate] running hermetic fixture (no network calls expected)...');

// Clear prior gate output so we cannot accidentally assert on a stale result.
for (const dir of fs.existsSync(RESULTS_ROOT) ? fs.readdirSync(RESULTS_ROOT) : []) {
  if (dir.includes('gate')) fs.rmSync(path.join(RESULTS_ROOT, dir), { recursive: true, force: true });
}

// Passed as one string: shell:true is required for pnpm to resolve on Windows,
// and an args array combined with shell:true is deprecated in Node.
const run = spawnSync(
  'pnpm cli run-config local' +
    ' --config tools/gate/fixture.yml' +
    ' --fixtures tools/gate/fixture.json' +
    ' --fixtures-strict' +
    ' --eval-method llm-coverage' +
    ' --skip-executive-summary',
  { cwd: ROOT, encoding: 'utf8', shell: true, env: { ...process.env, STORAGE_PROVIDER: 'local' } }
);
const cliOutput = (run.stdout || '') + (run.stderr || '');

if (run.status !== 0) {
  console.error('[gate] FAIL: the CLI itself errored.');
  console.error(cliOutput);
  process.exit(1);
}

// The fixture must fully satisfy generation. Any live call means the fixture
// stopped applying -- which would silently make this gate depend on API keys.
if (/401|Unauthorized|Incorrect API key|Missing Authentication/i.test(cliOutput)) {
  console.error('[gate] FAIL: the run attempted a live API call. Fixtures are no longer being applied.');
  process.exit(1);
}

const resultPath = findNewestResult();
if (!resultPath) {
  console.error('[gate] FAIL: no result file was written.');
  process.exit(1);
}
const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
const coverage = result?.evaluationResults?.llmCoverageScores;
if (!coverage) {
  console.error('[gate] FAIL: result file contains no llmCoverageScores.');
  process.exit(1);
}

for (const [promptId, expected] of Object.entries(EXPECTED)) {
  const perModel = coverage[promptId];
  if (!perModel) { failures.push(`[${promptId}] missing from results entirely`); continue; }

  const modelId = Object.keys(perModel).find((m) => m !== 'IDEAL_BENCHMARK');
  const res = perModel[modelId];

  if (!res || res.error) {
    failures.push(`[${promptId}] evaluation errored instead of scoring: ${res?.error ?? 'null result'}`);
    continue;
  }

  check(`[${promptId}] avgCoverageExtent`, res.avgCoverageExtent, expected.avg);
  check(`[${promptId}] point count`, res.pointAssessments?.length, expected.points.length);

  for (const [text, score] of expected.points) {
    const pa = res.pointAssessments?.find((p) => p.keyPointText === text);
    if (!pa) { failures.push(`[${promptId}] missing point assessment: ${text}`); continue; }
    check(`[${promptId}] "${text}" coverageExtent`, pa.coverageExtent, score);
  }
}

if (failures.length) {
  console.error(`\n[gate] FAIL -- ${failures.length} assertion(s) did not hold:\n`);
  for (const f of failures) console.error('  - ' + f);
  console.error(`\n  result file: ${path.relative(ROOT, resultPath)}\n`);
  process.exit(1);
}

console.log('[gate] PASS - pipeline produced expected per-criterion scores offline.');
