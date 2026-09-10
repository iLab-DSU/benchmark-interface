import { describe, it, expect } from 'vitest';
import { allocate, estimateEffort, type Allocatable, type Allocator } from './allocate';

const pool = (count: number, valueChain?: string, clusterId?: string): Allocatable[] =>
    Array.from({ length: count }, (_, index) => ({
        id: `q${index + 1}`,
        valueChain,
        clusterId,
    }));

const panel = (...emails: string[]): Allocator[] => emails.map((email) => ({ email }));

const counts = (result: ReturnType<typeof allocate>) =>
    Object.fromEntries(result.allocations.map((a) => [a.email, a.questionIds.length]));

describe('allocate — splitting', () => {
    it('divides a pool evenly with no overlap', () => {
        const result = allocate(pool(12), panel('a@x.com', 'b@x.com', 'c@x.com'), { kind: 'split' });
        expect(counts(result)).toEqual({ 'a@x.com': 4, 'b@x.com': 4, 'c@x.com': 4 });
        expect(result.totalAssignments).toBe(12);
        expect(result.coveredCount).toBe(12);
    });

    it('spreads a remainder rather than dumping it on one person', () => {
        const result = allocate(pool(10), panel('a@x.com', 'b@x.com', 'c@x.com'), { kind: 'split' });
        const sizes = Object.values(counts(result)).sort();
        expect(sizes).toEqual([3, 3, 4]);
    });

    it('gives every question to exactly one expert when splitting', () => {
        const result = allocate(pool(9), panel('a@x.com', 'b@x.com'), { kind: 'split' });
        expect(result.totalAssignments).toBe(9);
        expect(result.coveredCount).toBe(9);
    });
});

describe('allocate — k-fold overlap', () => {
    it('has each question answered by exactly k experts', () => {
        const result = allocate(pool(12), panel('a@x.com', 'b@x.com', 'c@x.com'), {
            kind: 'overlap',
            coverage: 2,
        });
        expect(result.coveredCount).toBe(12);
        expect(result.totalAssignments).toBe(24);
    });

    it('keeps the workload balanced across the panel', () => {
        const result = allocate(pool(12), panel('a@x.com', 'b@x.com', 'c@x.com'), {
            kind: 'overlap',
            coverage: 2,
        });
        expect(Object.values(counts(result))).toEqual([8, 8, 8]);
    });

    it('warns when the panel is too small to reach k', () => {
        const result = allocate(pool(6), panel('a@x.com'), { kind: 'overlap', coverage: 2 });
        expect(result.warnings.map((w) => w.code)).toContain('under_covered');
        // Still allocated to the one expert available rather than dropped.
        expect(result.coveredCount).toBe(6);
    });

    it('treats coverage larger than the panel as everyone', () => {
        const result = allocate(pool(4), panel('a@x.com', 'b@x.com'), {
            kind: 'overlap',
            coverage: 5,
        });
        expect(counts(result)).toEqual({ 'a@x.com': 4, 'b@x.com': 4 });
    });
});

describe('allocate — everyone answers all', () => {
    it('gives the whole pool to each expert', () => {
        const result = allocate(pool(5), panel('a@x.com', 'b@x.com'), { kind: 'all' });
        expect(counts(result)).toEqual({ 'a@x.com': 5, 'b@x.com': 5 });
    });
});

describe('allocate — expertise routing', () => {
    const mixedPool: Allocatable[] = [
        { id: 'p1', valueChain: 'Poultry' },
        { id: 'p2', valueChain: 'Poultry' },
        { id: 'd1', valueChain: 'Dairy' },
        { id: 'd2', valueChain: 'Dairy' },
    ];

    it('routes questions only to experts who cover that value chain', () => {
        const result = allocate(
            mixedPool,
            [
                { email: 'poultry@x.com', valueChains: ['Poultry'] },
                { email: 'dairy@x.com', valueChains: ['Dairy'] },
            ],
            { kind: 'split' },
        );
        const byEmail = Object.fromEntries(
            result.allocations.map((a) => [a.email, a.questionIds.sort()]),
        );
        expect(byEmail['poultry@x.com']).toEqual(['p1', 'p2']);
        expect(byEmail['dairy@x.com']).toEqual(['d1', 'd2']);
    });

    it('matches a value chain case-insensitively', () => {
        const result = allocate(
            [{ id: 'p1', valueChain: 'poultry' }],
            [{ email: 'a@x.com', valueChains: ['Poultry'] }],
            { kind: 'split' },
        );
        expect(result.coveredCount).toBe(1);
    });

    it('treats an expert with no declared chains as a generalist', () => {
        const result = allocate(mixedPool, panel('generalist@x.com'), { kind: 'split' });
        expect(result.coveredCount).toBe(4);
    });

    it('reports questions no one on the panel can answer', () => {
        const result = allocate(
            [{ id: 'crop1', valueChain: 'Maize' }],
            [{ email: 'poultry@x.com', valueChains: ['Poultry'] }],
            { kind: 'split' },
        );
        expect(result.coveredCount).toBe(0);
        expect(result.unallocated).toEqual([
            { questionId: 'crop1', reason: 'no_eligible_expert', valueChain: 'Maize' },
        ]);
    });

    it('warns when an expert on the panel gets nothing', () => {
        const result = allocate(
            [{ id: 'p1', valueChain: 'Poultry' }],
            [
                { email: 'poultry@x.com', valueChains: ['Poultry'] },
                { email: 'dairy@x.com', valueChains: ['Dairy'] },
            ],
            { kind: 'split' },
        );
        expect(result.warnings.map((w) => w.code)).toContain('expert_unused');
    });
});

describe('allocate — cluster integrity', () => {
    it('keeps a cluster on one expert when splitting', () => {
        const questions: Allocatable[] = [
            { id: 'a1', clusterId: 'c7' },
            { id: 'a2', clusterId: 'c7' },
            { id: 'a3', clusterId: 'c7' },
            { id: 'b1', clusterId: 'c8' },
            { id: 'b2', clusterId: 'c8' },
            { id: 'b3', clusterId: 'c8' },
        ];
        const result = allocate(questions, panel('a@x.com', 'b@x.com'), { kind: 'split' });

        for (const allocation of result.allocations) {
            const clusters = new Set(
                allocation.questionIds.map((id) => (id.startsWith('a') ? 'c7' : 'c8')),
            );
            expect(clusters.size).toBe(1);
        }
    });

    it('does not treat placeholder cluster ids as a real cluster', () => {
        // Every row in an unclustered bank carries semantic_cluster=0. Reading
        // that as one cluster would hand the whole bank to a single expert.
        const questions = pool(8, undefined, '0');
        const result = allocate(questions, panel('a@x.com', 'b@x.com'), { kind: 'split' });
        expect(Object.values(counts(result))).toEqual([4, 4]);
    });

    it('ignores "NA" as a cluster id too', () => {
        const questions = pool(6, undefined, 'NA');
        const result = allocate(questions, panel('a@x.com', 'b@x.com'), { kind: 'split' });
        expect(Object.values(counts(result))).toEqual([3, 3]);
    });

    it('warns when a cluster spans value chains', () => {
        const result = allocate(
            [
                { id: 'x1', clusterId: 'c1', valueChain: 'Poultry' },
                { id: 'x2', clusterId: 'c1', valueChain: 'Dairy' },
            ],
            panel('a@x.com'),
            { kind: 'split' },
        );
        expect(result.warnings.map((w) => w.code)).toContain('mixed_cluster');
    });
});

describe('allocate — capacity', () => {
    it('stops giving an expert work past their capacity', () => {
        const result = allocate(
            pool(10),
            [
                { email: 'a@x.com', capacity: 3 },
                { email: 'b@x.com' },
            ],
            { kind: 'split' },
        );
        const byEmail = counts(result);
        expect(byEmail['a@x.com']).toBeLessThanOrEqual(3);
        expect(byEmail['a@x.com'] + byEmail['b@x.com']).toBe(10);
    });

    it('reports what could not be placed when the whole panel is full', () => {
        const result = allocate(pool(10), [{ email: 'a@x.com', capacity: 4 }], { kind: 'split' });
        expect(result.coveredCount).toBe(4);
        expect(result.unallocated).toHaveLength(6);
        expect(result.warnings.map((w) => w.code)).toContain('capacity_reached');
    });
});

describe('allocate — determinism and edges', () => {
    it('produces the same allocation for the same inputs', () => {
        const run = () =>
            allocate(pool(20), panel('a@x.com', 'b@x.com', 'c@x.com'), {
                kind: 'overlap',
                coverage: 2,
            });
        expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
    });

    it('does not depend on the order experts were listed in', () => {
        const forwards = allocate(pool(9), panel('a@x.com', 'b@x.com', 'c@x.com'), { kind: 'split' });
        const backwards = allocate(pool(9), panel('c@x.com', 'b@x.com', 'a@x.com'), { kind: 'split' });
        expect(counts(forwards)).toEqual(counts(backwards));
    });

    it('returns each expert their questions in the pool order', () => {
        const result = allocate(pool(6), panel('a@x.com'), { kind: 'split' });
        expect(result.allocations[0].questionIds).toEqual(['q1', 'q2', 'q3', 'q4', 'q5', 'q6']);
    });

    it('handles an empty panel without throwing', () => {
        const result = allocate(pool(3), [], { kind: 'split' });
        expect(result.coveredCount).toBe(0);
        expect(result.unallocated).toHaveLength(3);
    });

    it('handles an empty pool without throwing', () => {
        const result = allocate([], panel('a@x.com'), { kind: 'split' });
        expect(result.totalAssignments).toBe(0);
    });
});

describe('estimateEffort', () => {
    it('turns a question count into hours per expert', () => {
        const result = allocate(pool(24), panel('a@x.com', 'b@x.com'), { kind: 'split' });
        const effort = estimateEffort(result, 5);
        expect(effort.perExpert).toEqual([
            { email: 'a@x.com', count: 12, hours: 1 },
            { email: 'b@x.com', count: 12, hours: 1 },
        ]);
        expect(effort.totalHours).toBe(2);
    });

    it('shows the real cost of a k=2 plan', () => {
        // 480 questions each is the number an admin needs to see before agreeing.
        const result = allocate(pool(1200), panel('a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com'), {
            kind: 'overlap',
            coverage: 2,
        });
        const effort = estimateEffort(result, 5);
        expect(effort.perExpert.every((row) => row.count === 480)).toBe(true);
        expect(effort.perExpert[0].hours).toBe(40);
    });
});
