import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildSubmissionsWorkbook } from './workbook';
import type { Assignment, Question, QuestionSet, Submission } from './types';

const questions: Question[] = [
    {
        id: 'q1',
        ref: 'Q00118',
        prompt: 'How can one ensure homemade feed rations are balanced for laying chicks',
        meta: { valueChain: 'Chicken/poultry', intentGroup: 'Livestock Management', farmerIntent: 'Feed animals' },
    },
    {
        id: 'q2',
        ref: 'Q00187',
        prompt: 'what causes chicken not to feed n stay in a dull mode',
        meta: { valueChain: 'Chicken/poultry', intentGroup: 'Livestock Management', farmerIntent: 'Diagnose a problem' },
    },
];

const set: QuestionSet = {
    id: 'set1',
    title: 'Poultry question bank',
    createdAt: '2026-09-01T00:00:00.000Z',
    createdBy: 'admin@example.com',
    questions,
};

const assignment: Assignment = {
    id: 'a1',
    setId: 'set1',
    expertEmails: ['ann@example.com', 'bob@example.com'],
    assignedBy: 'admin@example.com',
    assignedAt: '2026-09-02T00:00:00.000Z',
    status: 'open',
};

const submission = (email: string, answers: Submission['answers']): Submission => ({
    assignmentId: 'a1',
    setId: 'set1',
    expertEmail: email,
    status: 'draft',
    updatedAt: '2026-09-03T00:00:00.000Z',
    answers,
});

async function read(buffer: Buffer): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    return workbook;
}

const cell = (workbook: ExcelJS.Workbook, sheet: string, row: number, column: number): string =>
    String(workbook.getWorksheet(sheet)?.getRow(row).getCell(column).value ?? '');

describe('buildSubmissionsWorkbook', () => {
    const submissions = [
        submission('ann@example.com', {
            q1: { ideal: 'Ann on feed', must: [{ text: 'protein range', critical: false }], mustNot: [] },
            q2: {
                ideal: 'Ann on illness',
                must: [],
                mustNot: [],
                intentCorrection: {
                    corrected: 'Urgent triage for a sick bird',
                    original: 'Diagnose a problem',
                    reason: 'It is an emergency, not routine',
                    correctedAt: '2026-09-03T00:00:00.000Z',
                },
            },
        }),
        submission('bob@example.com', {
            q1: { ideal: 'Bob on feed', must: [], mustNot: [] },
        }),
    ];

    it('gives every responder their own sheet, after a summary', async () => {
        const workbook = await read(
            await buildSubmissionsWorkbook({ assignment, set, submissions, questions }),
        );
        expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Summary', 'ann', 'bob']);
    });

    it('keeps each responder answering every question in scope', async () => {
        const workbook = await read(
            await buildSubmissionsWorkbook({ assignment, set, submissions, questions }),
        );
        // Row 1 is the responder banner, row 2 the header, so two questions
        // means four rows.
        expect(workbook.getWorksheet('bob')?.rowCount).toBe(4);
    });

    it('exports the corrected intent, the original, and the reason', async () => {
        const workbook = await read(
            await buildSubmissionsWorkbook({ assignment, set, submissions, questions }),
        );
        // Sheet "ann", row 4 = q2. Columns 6/7/8 are intent, original, reason.
        expect(cell(workbook, 'ann', 4, 6)).toBe('Urgent triage for a sick bird');
        expect(cell(workbook, 'ann', 4, 7)).toBe('Diagnose a problem');
        expect(cell(workbook, 'ann', 4, 8)).toContain('emergency');
    });

    it('does not leak one expert\'s correction onto another expert\'s sheet', async () => {
        const workbook = await read(
            await buildSubmissionsWorkbook({ assignment, set, submissions, questions }),
        );
        // Bob never corrected q2, so he still sees the bank's label.
        expect(cell(workbook, 'bob', 4, 6)).toBe('Diagnose a problem');
        expect(cell(workbook, 'bob', 4, 7)).toBe('');
    });

    it('marks unanswered questions rather than omitting them', async () => {
        const workbook = await read(
            await buildSubmissionsWorkbook({ assignment, set, submissions, questions }),
        );
        expect(cell(workbook, 'bob', 4, 13)).toBe('no');
        expect(cell(workbook, 'bob', 3, 13)).toBe('yes');
    });

    it('flags critical criteria inside the cell', async () => {
        const withCritical = [
            submission('ann@example.com', {
                q1: {
                    ideal: 'x',
                    must: [{ text: 'names calcium', critical: true }],
                    mustNot: [],
                },
            }),
        ];
        const workbook = await read(
            await buildSubmissionsWorkbook({
                assignment,
                set,
                submissions: withCritical,
                questions,
            }),
        );
        expect(cell(workbook, 'ann', 3, 10)).toContain('[CRITICAL]');
    });

    it('counts corrections on the summary sheet', async () => {
        const workbook = await read(
            await buildSubmissionsWorkbook({ assignment, set, submissions, questions }),
        );
        const summary = workbook.getWorksheet('Summary');
        const row = summary?.getRow(10);
        expect(String(row?.getCell(1).value)).toBe('Intent corrections');
        expect(row?.getCell(2).value).toBe(1);
    });

    it('still produces a readable file when nobody has started', async () => {
        const workbook = await read(
            await buildSubmissionsWorkbook({ assignment, set, submissions: [], questions }),
        );
        expect(workbook.worksheets.map((sheet) => sheet.name)).toContain('No submissions');
    });

    it('keeps sheet names distinct when two addresses share a local part', async () => {
        const clashing = [
            submission('ann@example.com', {}),
            submission('ann@other.org', {}),
        ];
        const workbook = await read(
            await buildSubmissionsWorkbook({ assignment, set, submissions: clashing, questions }),
        );
        const names = workbook.worksheets.map((sheet) => sheet.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('strips characters Excel refuses in a sheet name', async () => {
        const awkward = [submission('a/b:c*d@example.com', {})];
        const workbook = await read(
            await buildSubmissionsWorkbook({ assignment, set, submissions: awkward, questions }),
        );
        const name = workbook.worksheets[1].name;
        expect(name).not.toMatch(/[\\/*?:[\]]/);
        expect(name.length).toBeLessThanOrEqual(31);
    });
});
