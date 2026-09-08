/**
 * Human-readable rendering of case verdicts.
 */

import type { CaseVerdict } from './verdict';

const SYMBOL: Record<CaseVerdict['verdict'], string> = {
    PASS: 'PASS ',
    FAIL: 'FAIL ',
    ERROR: 'ERROR',
};

function fmtScore(score: number | null): string {
    return score === null ? '  --' : score.toFixed(2).padStart(4);
}

/** Renders one line per case, with the failing criteria spelled out beneath. */
export function formatReport(verdicts: CaseVerdict[], opts: { verbose?: boolean } = {}): string {
    const out: string[] = [];

    for (const v of verdicts) {
        const aggregate = v.aggregateScore === null ? '--' : v.aggregateScore.toFixed(2);
        out.push(`${SYMBOL[v.verdict]}  ${v.promptId}  ${v.modelId}  (aggregate ${aggregate})`);

        for (const e of v.errors) out.push(`         ! ${e}`);
        for (const c of v.failedCritical) out.push(`         x CRITICAL unmet: ${c}`);
        for (const c of v.failedNonCritical) out.push(`         - unmet: ${c}`);

        if (opts.verbose) {
            for (const c of v.criteria) {
                const mark = c.error ? '?' : c.met ? '+' : 'x';
                const tags = `${c.critical ? '[critical] ' : ''}${c.inverted ? '[must not] ' : ''}`;
                out.push(`         ${mark} ${fmtScore(c.score)}  ${tags}${c.text}`);
            }
        }
    }

    const counts = verdicts.reduce(
        (acc, v) => ({ ...acc, [v.verdict]: (acc[v.verdict] ?? 0) + 1 }),
        {} as Record<string, number>
    );
    const strict = verdicts.filter((v) => v.strictPass).length;

    out.push('');
    out.push(
        `${verdicts.length} case(s): ` +
        `${counts.PASS ?? 0} pass, ${counts.FAIL ?? 0} fail, ${counts.ERROR ?? 0} error ` +
        `(${strict} met every criterion)`
    );

    return out.join('\n');
}
