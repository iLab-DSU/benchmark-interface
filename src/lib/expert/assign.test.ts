import { describe, it, expect } from 'vitest';
import { selectQuestions, describeScope } from './assign';
import { formatDueDate, isOverdue } from './format';
import type { Question } from './types';

const question = (id: string, meta?: Question['meta']): Question => ({
    id,
    prompt: `prompt ${id}`,
    meta,
});

const bank: Question[] = [
    question('q1', { valueChain: 'Chicken/poultry', intentGroup: 'Livestock Management', isRepresentative: true }),
    question('q2', { valueChain: 'Chicken/poultry', intentGroup: 'Livestock Management', isRepresentative: false }),
    question('q3', { valueChain: 'Dairy', intentGroup: 'Livestock Management', isRepresentative: true }),
    question('q4', { valueChain: 'Chicken/poultry', intentGroup: 'Crop Management', isRepresentative: true }),
    question('q5'),
];

describe('selectQuestions', () => {
    it('returns everything for a whole-set scope', () => {
        expect(selectQuestions(bank, { kind: 'set' })).toHaveLength(5);
    });

    it('treats a range as inclusive and 1-based, the way a spreadsheet row is', () => {
        const selected = selectQuestions(bank, { kind: 'range', start: 2, end: 4 });
        expect(selected.map((q) => q.id)).toEqual(['q2', 'q3', 'q4']);
    });

    it('clamps a range that overshoots instead of returning nothing', () => {
        const selected = selectQuestions(bank, { kind: 'range', start: 4, end: 999 });
        expect(selected.map((q) => q.id)).toEqual(['q4', 'q5']);
    });

    it('returns nothing when a range is inverted', () => {
        expect(selectQuestions(bank, { kind: 'range', start: 4, end: 2 })).toEqual([]);
    });

    it('filters by value chain', () => {
        const selected = selectQuestions(bank, { kind: 'filter', valueChain: 'Chicken/poultry' });
        expect(selected.map((q) => q.id)).toEqual(['q1', 'q2', 'q4']);
    });

    it('combines filters as AND', () => {
        const selected = selectQuestions(bank, {
            kind: 'filter',
            valueChain: 'Chicken/poultry',
            intentGroup: 'Livestock Management',
        });
        expect(selected.map((q) => q.id)).toEqual(['q1', 'q2']);
    });

    it('drops flagged duplicates when representativeOnly is set', () => {
        const selected = selectQuestions(bank, {
            kind: 'filter',
            valueChain: 'Chicken/poultry',
            representativeOnly: true,
        });
        expect(selected.map((q) => q.id)).toEqual(['q1', 'q4']);
    });

    it('keeps rows whose representative flag is simply absent', () => {
        // Absent is unknown, not "duplicate" — excluding these would silently
        // drop every row from a bank that does not carry the column.
        const selected = selectQuestions(bank, { kind: 'filter', representativeOnly: true });
        expect(selected.map((q) => q.id)).toContain('q5');
    });
});

describe('describeScope', () => {
    it('describes a whole set', () => {
        expect(describeScope({ kind: 'set' }, 12)).toBe('all 12 questions');
    });

    it('describes a range with its row numbers', () => {
        expect(describeScope({ kind: 'range', start: 1, end: 50 }, 50)).toContain('rows 1');
    });

    it('names the filters it applied', () => {
        const text = describeScope(
            { kind: 'filter', valueChain: 'Poultry', representativeOnly: true },
            7,
        );
        expect(text).toContain('Poultry');
        expect(text).toContain('representative rows only');
    });
});

describe('formatDueDate', () => {
    it('turns an ISO timestamp into something a person would write', () => {
        expect(formatDueDate('2026-10-09T00:00:00.000Z')).toBe('9 Oct 2026');
    });

    it('passes through a value that is not a date rather than throwing', () => {
        expect(formatDueDate('next Tuesday')).toBe('next Tuesday');
    });

    it('renders nothing for an absent date', () => {
        expect(formatDueDate(undefined)).toBe('');
    });

    it('detects an overdue date', () => {
        expect(isOverdue('2020-01-01T00:00:00.000Z')).toBe(true);
        expect(isOverdue('2999-01-01T00:00:00.000Z')).toBe(false);
        expect(isOverdue(undefined)).toBe(false);
    });
});
