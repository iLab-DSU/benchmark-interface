import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, badRequest } from '@/lib/auth/guard';
import { configure } from '@/cli/config';
import { actionBackfillSummary } from '@/cli/commands/backfill-summary';

export const dynamic = 'force-dynamic';
// Rebuilding every summary walks all stored runs, which is well past the
// default serverless budget on a large dataset.
export const maxDuration = 300;

/**
 * Captures the CLI logger output so the caller sees what happened, rather than
 * a bare "ok" while the detail goes only to the server console.
 */
function captureLogger() {
    const lines: string[] = [];

    const record = (level: string) => (...args: any[]) => {
        const message = args
            .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
            .join(' ');
        lines.push(`[${level}] ${message}`);
        console.log(`[admin/maintenance] [${level}]`, ...args);
    };

    configure({
        errorHandler: (error: Error) => {
            lines.push(`[error] ${error.message}`);
            console.error('[admin/maintenance]', error);
        },
        logger: {
            info: record('info'),
            warn: record('warn'),
            error: record('error'),
            success: record('success'),
        },
    });

    return lines;
}

const TASKS = ['backfill-summary'] as const;
type Task = (typeof TASKS)[number];

export async function POST(request: NextRequest) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    let body: { task?: string; configId?: string; dryRun?: boolean };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'A JSON body is required.' }, { status: 400 });
    }

    const task = body.task as Task | undefined;
    if (!task || !TASKS.includes(task)) {
        return NextResponse.json(
            { error: `Unknown task. Supported tasks: ${TASKS.join(', ')}.` },
            { status: 400 },
        );
    }

    const startedAt = Date.now();
    const lines = captureLogger();

    try {
        console.log(`[admin] ${auth.user.email} started maintenance task "${task}"`);

        await actionBackfillSummary({
            verbose: false,
            configId: body.configId || undefined,
            dryRun: Boolean(body.dryRun),
        });

        return NextResponse.json({
            ok: true,
            task,
            dryRun: Boolean(body.dryRun),
            durationMs: Date.now() - startedAt,
            // Enough to confirm what happened without shipping a huge payload.
            log: lines.slice(-80),
        });
    } catch (error) {
        console.error(`[admin] Maintenance task "${task}" failed:`, error);
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : 'Maintenance task failed.',
                log: lines.slice(-80),
            },
            { status: 500 },
        );
    }
}

/** Advertises the tasks the UI may offer. */
export async function GET() {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    return NextResponse.json({
        tasks: [
            {
                id: 'backfill-summary',
                label: 'Rebuild summaries',
                description:
                    'Regenerates config, homepage and latest-run summaries from the stored result files. Safe to re-run; required after adding or deleting runs outside the app.',
                supportsConfigId: true,
                supportsDryRun: true,
            },
        ],
    });
}
