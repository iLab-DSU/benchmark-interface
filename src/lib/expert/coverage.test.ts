import { describe, it, expect } from 'vitest';
import {
    getSetCoverage,
    filterUnassigned,
    filterUnderCovered,
    expertsAlreadyHolding,
} from './coverage';
import type { Assignment, QuestionSet } from './types';

const set: QuestionSet = {
    id: 'set1',
    title: 'Bank',
    createdAt: '2026-09-01T00:00:00.000Z',
    createdBy: 'admin@x.com',
    questions: [
        { id: 'q1', prompt: 'one', meta: { valueChain: 'Poultry' } },
        { id: 'q2', prompt: 'two', meta: { valueChain: 'Poultry' } },
        { id: 'q3', prompt: 'three', meta: { valueChain: 'Dairy' } },
        { id: 'q4', prompt: 'four', meta: { valueChain: 'Dairy' } },
    ],
};

const assignment = (over: Partial<Assignment>): Assignment => ({
    id: 'a1',
    setId: 'set1',
    expertEmails: ['ann@x.com'],
    assignedBy: 'admin@x.com',
    assignedAt: '2026-09-02T00:00:00.000Z',
    status: 'open',
    ...over,
});

describe('getSetCoverage', () => {
    it('reports nothing assigned when there are no assignments', async () => {
        const coverage = await getSetCoverage(set, 1, []);
        expect(coverage.assignedCount).toBe(0);
        expect(coverage.unassignedCount).toBe(4);
    });

    it('resolves a range scope to the questions it actually covers', async () => {
        const coverage = await getSetCoverage(set, 1, [
            assignment({ scope: { kind: 'range', start: 1, end: 2 } }),
        ]);
        expect([...coverage.byQuestion.keys()].sort()).toEqual(['q1', 'q2']);
        expect(coverage.unassignedCount).toBe(2);
    });

    it('resolves a filter scope', async () => {
        const coverage = await getSetCoverage(set, 1, [
            assignment({ scope: { kind: 'filter', valueChain: 'Dairy' } }),
        ]);
        expect([...coverage.byQuestion.keys()].sort()).toEqual(['q3', 'q4']);
    });

    it('treats a missing scope as the whole set', async () => {
        const coverage = await getSetCoverage(set, 1, [assignment({})]);
        expect(coverage.assignedCount).toBe(4);
    });

    it('merges experts when two assignments overlap on a question', async () => {
        const coverage = await getSetCoverage(set, 1, [
            assignment({ id: 'a1', expertEmails: ['ann@x.com'] }),
            assignment({ id: 'a2', expertEmails: ['bob@x.com'] }),
        ]);
        expect(coverage.byQuestion.get('q1')?.experts.sort()).toEqual(['ann@x.com', 'bob@x.com']);
        expect(coverage.byQuestion.get('q1')?.assignmentIds).toHaveLength(2);
    });

    it('ignores closed assignments, so finished work can be reassigned', async () => {
        const coverage = await getSetCoverage(set, 1, [assignment({ status: 'closed' })]);
        expect(coverage.assignedCount).toBe(0);
        expect(coverage.unassignedCount).toBe(4);
    });

    it('ignores assignments belonging to another set', async () => {
        const coverage = await getSetCoverage(set, 1, [assignment({ setId: 'other' })]);
        expect(coverage.assignedCount).toBe(0);
    });

    it('counts questions short of the target coverage', async () => {
        // q1 and q2 have one expert; target is two, so all four fall short.
        const coverage = await getSetCoverage(set, 2, [
            assignment({ scope: { kind: 'range', start: 1, end: 2 } }),
        ]);
        expect(coverage.underCoveredCount).toBe(4);
    });

    it('does not count a question that already met the target', async () => {
        const coverage = await getSetCoverage(set, 2, [
            assignment({ id: 'a1', expertEmails: ['ann@x.com', 'bob@x.com'] }),
        ]);
        expect(coverage.underCoveredCount).toBe(0);
    });
});

describe('pool filters', () => {
    it('filterUnassigned keeps only what nobody holds', async () => {
        const coverage = await getSetCoverage(set, 1, [
            assignment({ scope: { kind: 'filter', valueChain: 'Poultry' } }),
        ]);
        expect(filterUnassigned(set.questions, coverage).map((q) => q.id)).toEqual(['q3', 'q4']);
    });

    it('filterUnderCovered keeps what is short of a second opinion', async () => {
        const coverage = await getSetCoverage(set, 2, [
            assignment({ id: 'a1', expertEmails: ['ann@x.com', 'bob@x.com'], scope: { kind: 'range', start: 1, end: 1 } }),
            assignment({ id: 'a2', expertEmails: ['ann@x.com'], scope: { kind: 'range', start: 2, end: 2 } }),
        ]);
        // q1 has two experts and is done. q2 has one. q3/q4 have none.
        expect(filterUnderCovered(set.questions, coverage, 2).map((q) => q.id)).toEqual([
            'q2',
            'q3',
            'q4',
        ]);
    });

    it('expertsAlreadyHolding names who has it, so a top-up avoids them', async () => {
        const coverage = await getSetCoverage(set, 2, [
            assignment({ expertEmails: ['ann@x.com'], scope: { kind: 'range', start: 1, end: 1 } }),
        ]);
        expect(expertsAlreadyHolding('q1', coverage)).toEqual(['ann@x.com']);
        expect(expertsAlreadyHolding('q4', coverage)).toEqual([]);
    });
});
