import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, badRequest } from '@/lib/auth/guard';
import { getQuestionSet } from '@/lib/expert/store';
import { getSetCoverage } from '@/lib/expert/coverage';

export const dynamic = 'force-dynamic';

const DEFAULT_PAGE_SIZE = 15;
const MAX_PAGE_SIZE = 100;

/**
 * One page of a set's questions, each marked with who already holds it.
 *
 * Paginated because a set is hundreds of rows and the assignment screen has to
 * stay usable; coverage is joined here rather than fetched separately so a row
 * can never render as unassigned when it is not.
 */
export async function GET(
    request: NextRequest,
    context: { params: Promise<{ setId: string }> },
) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { setId } = await context.params;
    const params = request.nextUrl.searchParams;

    const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
    const pageSize = Math.min(
        MAX_PAGE_SIZE,
        Math.max(1, Number(params.get('pageSize') ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE),
    );
    const search = params.get('search')?.trim().toLowerCase() ?? '';
    const intentGroup = params.get('intentGroup')?.trim() ?? '';
    const onlyUnassigned = params.get('unassigned') === 'true';

    try {
        const set = await getQuestionSet(setId);
        if (!set) return NextResponse.json({ error: 'Question set not found.' }, { status: 404 });

        const coverage = await getSetCoverage(set);

        // Row numbers are assigned before filtering, so "1-28" always means
        // the same questions no matter what the admin is currently filtering by.
        let rows = set.questions.map((question, index) => ({
            rowNumber: index + 1,
            id: question.id,
            ref: question.ref,
            prompt: question.prompt,
            intentGroup: question.meta?.intentGroup,
            farmerIntent: question.meta?.farmerIntent,
            valueChain: question.meta?.valueChain,
            assignedTo: coverage.byQuestion.get(question.id)?.experts ?? [],
        }));

        if (search) {
            rows = rows.filter(
                (row) =>
                    row.prompt.toLowerCase().includes(search) ||
                    (row.ref ?? '').toLowerCase().includes(search),
            );
        }

        if (intentGroup) {
            rows = rows.filter((row) => row.intentGroup === intentGroup);
        }

        if (onlyUnassigned) {
            rows = rows.filter((row) => row.assignedTo.length === 0);
        }

        const total = rows.length;
        const pageCount = Math.max(1, Math.ceil(total / pageSize));
        const safePage = Math.min(page, pageCount);
        const start = (safePage - 1) * pageSize;

        return NextResponse.json({
            setId: set.id,
            setTitle: set.title,
            page: safePage,
            pageSize,
            pageCount,
            total,
            totalInSet: set.questions.length,
            assignedCount: coverage.assignedCount,
            unassignedCount: coverage.unassignedCount,
            // Offered as filter options so the admin does not have to know them.
            intentGroups: [
                ...new Set(
                    set.questions
                        .map((question) => question.meta?.intentGroup)
                        .filter((value): value is string => Boolean(value)),
                ),
            ].sort(),
            questions: rows.slice(start, start + pageSize),
        });
    } catch (error) {
        return badRequest(error);
    }
}
