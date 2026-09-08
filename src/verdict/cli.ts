/**
 * Standalone entry point for strict safety verdicts.
 *
 *   pnpm verdict <result.json> [--json] [--verbose]
 *   pnpm verdict --latest <configId> [--json] [--verbose]
 *
 * Deliberately not registered in src/cli/index.ts: keeping it separate means
 * the fork adds no lines to an upstream file that changes often.
 *
 * Exit code is 0 only when every case passed. A FAIL or an ERROR exits 1, so
 * this is usable as a gate -- unlike run-config, which exits 0 even when every
 * model response failed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readPolicy, PolicyError } from './policy';
import { evaluateRun } from './verdict';
import { formatReport } from './report';

const RESULTS_ROOT = path.join(process.cwd(), '.results', 'live', 'blueprints');

function usage(): never {
    console.error(
        'Usage:\n' +
        '  pnpm verdict <path/to/_comparison.json> [--json] [--verbose]\n' +
        '  pnpm verdict --latest <configId>          [--json] [--verbose]\n'
    );
    process.exit(2);
}

/** Newest result file for a config in the local results tree. */
function findLatest(configId: string): string {
    const dir = path.join(RESULTS_ROOT, configId);
    if (!fs.existsSync(dir)) {
        console.error(`No local results found for config '${configId}' (looked in ${dir}).`);
        process.exit(2);
    }
    const files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('_comparison.json'))
        .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.m - a.m);

    if (files.length === 0) {
        console.error(`No comparison result files in ${dir}.`);
        process.exit(2);
    }
    return path.join(dir, files[0].f);
}

function main(): void {
    const argv = process.argv.slice(2);
    const asJson = argv.includes('--json');
    const verbose = argv.includes('--verbose');
    const positional = argv.filter((a) => !a.startsWith('--'));

    let resultPath: string;
    if (argv.includes('--latest')) {
        const configId = argv[argv.indexOf('--latest') + 1];
        if (!configId || configId.startsWith('--')) usage();
        resultPath = findLatest(configId);
    } else if (positional.length === 1) {
        resultPath = path.resolve(positional[0]);
    } else {
        usage();
    }

    if (!fs.existsSync(resultPath)) {
        console.error(`Result file not found: ${resultPath}`);
        process.exit(2);
    }

    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));

    let verdicts;
    try {
        // The policy travels inside the result file, so a verdict is always
        // reproducible from that file alone.
        verdicts = evaluateRun(result, readPolicy(result.config));
    } catch (err) {
        if (err instanceof PolicyError) {
            console.error(`\nsafety_policy error in ${path.basename(resultPath)}:\n\n${err.message}\n`);
            process.exit(2);
        }
        throw err;
    }

    if (asJson) {
        console.log(JSON.stringify({ resultFile: resultPath, verdicts }, null, 2));
    } else {
        console.log(`\n${path.relative(process.cwd(), resultPath)}\n`);
        console.log(formatReport(verdicts, { verbose }));
        console.log('');
    }

    const clean = verdicts.every((v) => v.verdict === 'PASS');
    process.exit(clean ? 0 : 1);
}

main();
