import { describe, it, expect } from 'vitest';
import { parseRangeInput, formatRanges } from './DistributePanel';

describe('parseRangeInput', () => {
    it('reads a simple span', () => {
        expect(parseRangeInput('1-5', 100)).toEqual([1, 2, 3, 4, 5]);
    });

    it('reads a single row', () => {
        expect(parseRangeInput('7', 100)).toEqual([7]);
    });

    it('combines spans and singles', () => {
        expect(parseRangeInput('1-3, 7, 10-11', 100)).toEqual([1, 2, 3, 7, 10, 11]);
    });

    it('tolerates spaces around the dash', () => {
        expect(parseRangeInput('1 - 3', 100)).toEqual([1, 2, 3]);
    });

    it('accepts an en-dash, which is what a paste from a document gives', () => {
        expect(parseRangeInput('1–3', 100)).toEqual([1, 2, 3]);
    });

    it('accepts a reversed span rather than returning nothing', () => {
        expect(parseRangeInput('5-1', 100)).toEqual([1, 2, 3, 4, 5]);
    });

    it('clamps to the size of the set', () => {
        expect(parseRangeInput('98-200', 100)).toEqual([98, 99, 100]);
    });

    it('drops rows below 1', () => {
        expect(parseRangeInput('0, 1', 100)).toEqual([1]);
    });

    it('de-duplicates overlapping spans', () => {
        expect(parseRangeInput('1-5, 3-7', 100)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it('ignores text that is not a row', () => {
        expect(parseRangeInput('abc, 4', 100)).toEqual([4]);
    });

    it('returns nothing for empty input', () => {
        expect(parseRangeInput('', 100)).toEqual([]);
        expect(parseRangeInput('   ,  ', 100)).toEqual([]);
    });
});

describe('formatRanges', () => {
    it('collapses a run', () => {
        expect(formatRanges([1, 2, 3, 4, 5])).toBe('1-5');
    });

    it('keeps separate runs apart', () => {
        expect(formatRanges([1, 2, 3, 7, 8])).toBe('1-3, 7-8');
    });

    it('leaves lone rows alone', () => {
        expect(formatRanges([1, 3, 5])).toBe('1, 3, 5');
    });

    it('sorts before collapsing, so click order does not matter', () => {
        expect(formatRanges([5, 1, 3, 2, 4])).toBe('1-5');
    });

    it('handles a single row', () => {
        expect(formatRanges([9])).toBe('9');
    });

    it('renders nothing for an empty selection', () => {
        expect(formatRanges([])).toBe('');
    });

    it('round-trips what the admin typed', () => {
        const typed = '1-28, 40, 55-60';
        expect(formatRanges(parseRangeInput(typed, 100))).toBe('1-28, 40, 55-60');
    });
});
