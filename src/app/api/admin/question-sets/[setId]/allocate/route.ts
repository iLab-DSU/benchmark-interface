import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, badRequest } from '@/lib/auth/guard';
import { getQuestionSet } from '@/lib/expert/store';
import { getSetCoverage, filterUnassigned } from '@/lib/expert/coverage';
import { getEffectiveAccessList } from '@/lib/auth/access';
import { allocate, estimateEffort, type Allocator } from '@/lib/expert/allocate';
import type { AllocationStrategy } from '@/lib/expert/allocate';

export const dynamic = 'force-dynamic';

/**
 * Proposes a division of a set between experts, without writing anything.
 *
 * A dry run on purpose: the admin sees who would get what, and how long it
 * would take them, before any of it exists. The result maps straight onto the
 * parcels the Distribute screen already stages, so an automatic split and a
 * hand-picked one commit through exactly the same path.
 */
export async function POST(
    request: NextRequest,
    context: { params: Promise<{ setId: string }> },
) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { setId } = await context.params;

    let body: {
        expertEmails?: string[];
        strategy?: 'split' | 'overlap' | 'all';
        coverage?: number;
        onlyUnassigned?: boolean;
        intentGroup?: string;
        minutesPerQuestion?: number;
    };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'A JSON body is required.' }, { status: 400 });
    }

    const emails = (body.expertEmails ?? []).map((email) => email.trim().toLowerCase()).filter(Boolean);
    if (emails.length === 0) {
        return NextResponse.json({ error: 'Choose at least one expert.' }, { status: 400 });
    }

    try {
        const set = await getQuestionSet(setId);
        if (!set) return NextResponse.json({ error: 'Question set not found.' }, { status: 404 });

        // Row numbers come from the set's own order, before any filtering, so
        // they match what the table shows.
        const rowNumbers = new Map(set.questions.map((question, index) => [question.id, index + 1]));

        let pool = set.questions;
        if (body.intentGroup) {
            pool = pool.filter((question) => question.meta?.intentGroup === body.intentGroup);
        }

        const coverage = await getSetCoverage(set);
        if (body.onlyUnassigned !== false) {
            pool = filterUnassigned(pool, coverage);
        }

        if (pool.length === 0) {
            return NextResponse.json(
                { error: 'Nothing left to assign with those filters.' },
                { status: 400 },
            );
        }

        // Profiles drive routing and capacity; an expert without one is a
        // generalist with no limit, which is what allocate() expects.
        const accessList = await getEffectiveAccessList();
        const panel: Allocator[] = emails.map((email) => {
            const entry = accessList.find((candidate) => candidate.email === email);
            return {
                email,
                valueChains: entry?.valueChains,
                capacity: entry?.capacity,
            };
        });

        const strategy: AllocationStrategy =
            body.strategy === 'all'
                ? { kind: 'all' }
                : body.strategy === 'overlap'
                  ? { kind: 'overlap', coverage: Math.max(1, Math.floor(body.coverage ?? 2)) }
                  : { kind: 'split' };

        const result = allocate(
            pool.map((question) => ({
                id: question.id,
                clusterId: question.meta?.clusterId,
                valueChain: question.meta?.valueChain,
            })),
            panel,
            strategy,
        );

        const effort = estimateEffort(result, body.minutesPerQuestion ?? 5);

        return NextResponse.json({
            poolSize: pool.length,
            parcels: result.allocations
                .filter((allocation) => allocation.questionIds.length > 0)
                .map((allocation) => ({
                    email: allocation.email,
                    questionIds: allocation.questionIds,
                    rowNumbers: allocation.questionIds
                        .map((id) => rowNumbers.get(id) ?? 0)
                        .filter(Boolean)
                        .sort((a, b) => a - b),
                })),
            unallocated: result.unallocated,
            warnings: result.warnings,
            coveredCount: result.coveredCount,
            totalAssignments: result.totalAssignments,
            effort,
        });
    } catch (error) {
        return badRequest(error);
    }
}
