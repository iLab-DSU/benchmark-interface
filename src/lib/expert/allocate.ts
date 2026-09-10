/**
 * Dividing a pool of questions among a panel of experts.
 *
 * Nobody is handed a whole spreadsheet. The admin picks a pool, picks a panel,
 * and this decides who answers what — balancing workload, respecting who knows
 * which value chain, and keeping questions that mean the same thing together.
 *
 * Pure and deterministic: no storage, no clock, no randomness. Ties break on
 * email order so the same inputs always produce the same allocation, which is
 * what makes a preview trustworthy — what the admin sees confirmed is exactly
 * what gets written.
 */

export interface Allocatable {
    id: string;
    /**
     * Questions sharing a cluster mean the same thing. They are allocated as
     * one unit: two experts independently answering near-identical questions
     * produce contradictory criteria for what is really a single question.
     */
    clusterId?: string;
    valueChain?: string;
}

export interface Allocator {
    email: string;
    /**
     * Value chains this expert can answer. Empty or absent means a generalist
     * who can take anything — the permissive default, because an admin who has
     * not filled in profiles yet should still be able to distribute work.
     */
    valueChains?: string[];
    /** Maximum questions to give this person. Absent means no limit. */
    capacity?: number;
}

export type AllocationStrategy =
    | { kind: 'split' }
    | { kind: 'overlap'; coverage: number }
    | { kind: 'all' };

export interface ExpertAllocation {
    email: string;
    questionIds: string[];
}

export interface UnallocatedQuestion {
    questionId: string;
    reason: 'no_eligible_expert' | 'panel_at_capacity';
    valueChain?: string;
}

export interface AllocationWarning {
    code: 'under_covered' | 'mixed_cluster' | 'expert_unused' | 'capacity_reached';
    message: string;
}

export interface AllocationResult {
    allocations: ExpertAllocation[];
    unallocated: UnallocatedQuestion[];
    warnings: AllocationWarning[];
    /** Distinct questions that reached at least one expert. */
    coveredCount: number;
    /** Total answers requested across the panel — the real cost of the plan. */
    totalAssignments: number;
}

/** A cluster, or a lone question standing as its own unit. */
interface Unit {
    key: string;
    questionIds: string[];
    valueChain?: string;
    mixed: boolean;
}

function buildUnits(questions: Allocatable[]): Unit[] {
    const byCluster = new Map<string, Unit>();
    const units: Unit[] = [];

    for (const question of questions) {
        // A blank or placeholder cluster id is not a cluster. Treating "0" or
        // "NA" as one would collapse an entire unclustered bank into a single
        // unit handed to one expert.
        const cluster = question.clusterId?.trim();
        const isRealCluster = Boolean(cluster) && !['0', 'na', 'n/a', 'none'].includes(cluster!.toLowerCase());

        if (!isRealCluster) {
            units.push({
                key: `q:${question.id}`,
                questionIds: [question.id],
                valueChain: question.valueChain,
                mixed: false,
            });
            continue;
        }

        const existing = byCluster.get(cluster!);
        if (existing) {
            existing.questionIds.push(question.id);
            if (
                question.valueChain &&
                existing.valueChain &&
                question.valueChain !== existing.valueChain
            ) {
                existing.mixed = true;
            }
            existing.valueChain = existing.valueChain ?? question.valueChain;
        } else {
            const unit: Unit = {
                key: `c:${cluster}`,
                questionIds: [question.id],
                valueChain: question.valueChain,
                mixed: false,
            };
            byCluster.set(cluster!, unit);
            units.push(unit);
        }
    }

    return units;
}

function canAnswer(expert: Allocator, valueChain?: string): boolean {
    const chains = expert.valueChains?.filter(Boolean) ?? [];
    if (chains.length === 0) return true;
    if (!valueChain) return true;
    return chains.some((chain) => chain.toLowerCase() === valueChain.toLowerCase());
}

/**
 * Divides a pool among a panel.
 *
 * Units are allocated largest-first so a big cluster lands while there is
 * still room to place it; within that, each unit goes to the least-loaded
 * eligible experts. Least-loaded selection does double duty — it balances the
 * panel and it varies who overlaps with whom, so agreement data covers the
 * whole panel rather than the same pair every time.
 */
export function allocate(
    questions: Allocatable[],
    panel: Allocator[],
    strategy: AllocationStrategy,
): AllocationResult {
    const warnings: AllocationWarning[] = [];
    const unallocated: UnallocatedQuestion[] = [];

    const experts = [...panel].sort((a, b) => a.email.localeCompare(b.email));
    const assigned = new Map<string, string[]>(experts.map((expert) => [expert.email, []]));
    const load = new Map<string, number>(experts.map((expert) => [expert.email, 0]));

    if (experts.length === 0 || questions.length === 0) {
        return {
            allocations: experts.map((expert) => ({ email: expert.email, questionIds: [] })),
            unallocated: questions.map((question) => ({
                questionId: question.id,
                reason: 'no_eligible_expert',
                valueChain: question.valueChain,
            })),
            warnings,
            coveredCount: 0,
            totalAssignments: 0,
        };
    }

    const units = buildUnits(questions);

    const mixed = units.filter((unit) => unit.mixed);
    if (mixed.length > 0) {
        warnings.push({
            code: 'mixed_cluster',
            message: `${mixed.length} cluster(s) span more than one value chain. Routed by the first chain seen.`,
        });
    }

    // Largest first, then by key so the order never depends on input order.
    const ordered = [...units].sort(
        (a, b) => b.questionIds.length - a.questionIds.length || a.key.localeCompare(b.key),
    );

    let underCovered = 0;
    let capacityHit = false;
    /**
     * Under-coverage caused by full experts rather than a small panel.
     *
     * Tracked separately because the two have opposite fixes — raise a cap
     * versus recruit another expert — and an admin told the wrong one will
     * chase the wrong problem.
     */
    let underCoveredByCapacity = 0;

    for (const unit of ordered) {
        const eligible = experts.filter((expert) => canAnswer(expert, unit.valueChain));

        if (eligible.length === 0) {
            for (const questionId of unit.questionIds) {
                unallocated.push({
                    questionId,
                    reason: 'no_eligible_expert',
                    valueChain: unit.valueChain,
                });
            }
            continue;
        }

        const wanted =
            strategy.kind === 'all'
                ? eligible.length
                : strategy.kind === 'split'
                  ? 1
                  : Math.max(1, Math.floor(strategy.coverage));

        const withRoom = eligible.filter((expert) => {
            if (expert.capacity === undefined) return true;
            return (load.get(expert.email) ?? 0) + unit.questionIds.length <= expert.capacity;
        });

        if (withRoom.length === 0) {
            capacityHit = true;
            for (const questionId of unit.questionIds) {
                unallocated.push({
                    questionId,
                    reason: 'panel_at_capacity',
                    valueChain: unit.valueChain,
                });
            }
            continue;
        }

        const chosen = [...withRoom]
            .sort(
                (a, b) =>
                    (load.get(a.email) ?? 0) - (load.get(b.email) ?? 0) ||
                    a.email.localeCompare(b.email),
            )
            .slice(0, Math.min(wanted, withRoom.length));

        if (chosen.length < wanted) {
            underCovered += unit.questionIds.length;
            // Someone eligible was passed over only because they were full.
            if (withRoom.length < eligible.length) {
                underCoveredByCapacity += unit.questionIds.length;
                capacityHit = true;
            }
        }

        for (const expert of chosen) {
            assigned.get(expert.email)!.push(...unit.questionIds);
            load.set(expert.email, (load.get(expert.email) ?? 0) + unit.questionIds.length);
        }
    }

    if (underCovered > 0 && strategy.kind === 'overlap') {
        const cause =
            underCoveredByCapacity >= underCovered
                ? 'every other eligible expert is already at their capacity limit'
                : underCoveredByCapacity > 0
                  ? 'some experts are at their capacity limit, and too few others cover that value chain'
                  : 'the panel is too small, or too few of them cover that value chain';

        warnings.push({
            code: 'under_covered',
            message:
                `${underCovered} question(s) will be answered by fewer than ${strategy.coverage} ` +
                `experts — ${cause}.`,
        });
    }

    if (capacityHit) {
        const full = experts
            .filter(
                (expert) =>
                    expert.capacity !== undefined && (load.get(expert.email) ?? 0) >= expert.capacity,
            )
            .map((expert) => `${expert.email} (${expert.capacity})`);

        warnings.push({
            code: 'capacity_reached',
            message: full.length
                ? `At capacity: ${full.join(', ')}. Raise their limit under Users, or add more experts.`
                : 'Some questions were left out because every eligible expert is at capacity.',
        });
    }

    const idle = experts.filter((expert) => (load.get(expert.email) ?? 0) === 0);
    if (idle.length > 0 && idle.length < experts.length) {
        warnings.push({
            code: 'expert_unused',
            message: `No work for ${idle.map((expert) => expert.email).join(', ')} — check their value chains.`,
        });
    }

    const allocations = experts.map((expert) => ({
        email: expert.email,
        // Restored to pool order: an expert reading down their list should see
        // the bank's own sequence, not the allocator's largest-cluster-first one.
        questionIds: orderByPool(assigned.get(expert.email)!, questions),
    }));

    const covered = new Set<string>();
    for (const allocation of allocations) {
        for (const id of allocation.questionIds) covered.add(id);
    }

    return {
        allocations,
        unallocated,
        warnings,
        coveredCount: covered.size,
        totalAssignments: allocations.reduce((sum, a) => sum + a.questionIds.length, 0),
    };
}

function orderByPool(ids: string[], questions: Allocatable[]): string[] {
    const rank = new Map(questions.map((question, index) => [question.id, index]));
    return [...ids].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
}

/**
 * What the plan will cost, for the preview.
 *
 * `hours` is deliberately coarse. It exists to stop an admin cheerfully
 * assigning 480 questions each without noticing that is a working week per
 * person, not to be an accurate estimate.
 */
export function estimateEffort(
    result: AllocationResult,
    minutesPerQuestion = 5,
): { perExpert: Array<{ email: string; count: number; hours: number }>; totalHours: number } {
    const perExpert = result.allocations.map((allocation) => ({
        email: allocation.email,
        count: allocation.questionIds.length,
        hours: Math.round(((allocation.questionIds.length * minutesPerQuestion) / 60) * 10) / 10,
    }));

    return {
        perExpert,
        totalHours: Math.round(perExpert.reduce((sum, row) => sum + row.hours, 0) * 10) / 10,
    };
}
