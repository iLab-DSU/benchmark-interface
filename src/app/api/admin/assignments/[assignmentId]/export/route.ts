import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, badRequest } from '@/lib/auth/guard';
import {
    getAssignment,
    getQuestionSet,
    getSubmission,
    listSubmissions,
} from '@/lib/expert/store';
import { buildBlueprint } from '@/lib/expert/export';
import { buildSubmissionsWorkbook } from '@/lib/expert/workbook';
import { selectQuestions } from '@/lib/expert/assign';

export const dynamic = 'force-dynamic';

function fileStem(parts: string[]): string {
    return (
        parts
            .join('-')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 80) || 'export'
    );
}

/**
 * Downloads an assignment's results.
 *
 * Two formats, because they answer different questions:
 *   - yaml  (default) one expert's submission as a runnable blueprint. Stays
 *           per-expert: unioning criteria several people wrote separately
 *           produces a blueprint nobody actually authored.
 *   - xlsx  every responder in one workbook, a sheet each, for reading and
 *           comparing before deciding whose criteria to run.
 */
export async function GET(
    request: NextRequest,
    context: { params: Promise<{ assignmentId: string }> },
) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { assignmentId } = await context.params;
    const params = request.nextUrl.searchParams;
    const format = (params.get('format') ?? 'yaml').toLowerCase();
    const expert = params.get('expert');

    if (format !== 'yaml' && format !== 'xlsx') {
        return NextResponse.json(
            { error: 'format must be "yaml" or "xlsx".' },
            { status: 400 },
        );
    }

    try {
        const assignment = await getAssignment(assignmentId);
        if (!assignment) {
            return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 });
        }

        const set = await getQuestionSet(assignment.setId);
        if (!set) return NextResponse.json({ error: 'Question set not found.' }, { status: 404 });

        if (format === 'xlsx') {
            const all = await listSubmissions(assignmentId);

            // One expert can still be singled out, so the same button works
            // whether the admin wants everyone or one person.
            const submissions = expert
                ? all.filter(
                      (submission) =>
                          submission.expertEmail.toLowerCase() === expert.toLowerCase(),
                  )
                : all;

            const questions = selectQuestions(set.questions, assignment.scope ?? { kind: 'set' });

            const buffer = await buildSubmissionsWorkbook({
                assignment,
                set,
                submissions,
                questions,
            });

            const stem = fileStem([set.title, expert ?? 'all-responders']);

            return new NextResponse(new Uint8Array(buffer), {
                headers: {
                    'Content-Type':
                        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'Content-Disposition': `attachment; filename="${stem}.xlsx"`,
                    'Content-Length': String(buffer.length),
                },
            });
        }

        // --- YAML blueprint, per expert ---
        if (!expert) {
            return NextResponse.json(
                {
                    error:
                        'An "expert" query parameter is required for a YAML blueprint. ' +
                        'Use format=xlsx to export every responder at once.',
                },
                { status: 400 },
            );
        }

        const submission = await getSubmission(assignmentId, expert);
        if (!submission) {
            return NextResponse.json(
                { error: `${expert} has not started this assignment.` },
                { status: 404 },
            );
        }

        const models = params.get('models')?.split(',').map((m) => m.trim()).filter(Boolean);
        const thresholdRaw = params.get('threshold');
        const threshold = thresholdRaw ? Number(thresholdRaw) : undefined;

        if (threshold !== undefined && (Number.isNaN(threshold) || threshold < 0 || threshold > 1)) {
            return NextResponse.json(
                { error: 'threshold must be a number between 0 and 1.' },
                { status: 400 },
            );
        }

        const yamlText = buildBlueprint(set, submission, { models, threshold });

        return new NextResponse(yamlText, {
            headers: {
                'Content-Type': 'application/yaml; charset=utf-8',
                'Content-Disposition': `attachment; filename="${fileStem([set.title, submission.expertEmail])}.yml"`,
            },
        });
    } catch (error) {
        return badRequest(error);
    }
}
