/**
 * Compiles an assignment's submissions into one .xlsx workbook.
 *
 * Arranged one sheet per responder, plus a summary sheet up front. That layout
 * is deliberate: the reason to export several experts together is to compare
 * them, and comparison means putting each person's reasoning where it can be
 * read whole rather than interleaving rows from different authors.
 *
 * Criteria are flattened one-per-line inside a cell rather than exploded into
 * extra rows, so a question stays on one row and the sheet can be sorted and
 * filtered without tearing an answer apart.
 */

import ExcelJS from 'exceljs';
import type { Answer, Assignment, Question, QuestionSet, Submission } from './types';

/** Excel refuses these in a sheet name, and silently truncates past 31 chars. */
function safeSheetName(raw: string, taken: Set<string>): string {
    const cleaned = raw.replace(/[\\/*?:[\]]/g, '-').slice(0, 31) || 'Sheet';

    if (!taken.has(cleaned)) {
        taken.add(cleaned);
        return cleaned;
    }

    // Two experts on the same domain would otherwise collide once truncated.
    for (let suffix = 2; suffix < 100; suffix += 1) {
        const candidate = `${cleaned.slice(0, 31 - String(suffix).length - 1)}-${suffix}`;
        if (!taken.has(candidate)) {
            taken.add(candidate);
            return candidate;
        }
    }

    taken.add(cleaned);
    return cleaned;
}

function criteriaCell(criteria: Answer['must']): string {
    return criteria
        .map((criterion) => (criterion.critical ? `[CRITICAL] ${criterion.text}` : criterion.text))
        .join('\n');
}

function contextCell(question: Question): string {
    return (question.context ?? []).map((turn) => `${turn.role}: ${turn.content}`).join('\n');
}

/**
 * The intent actually in force, and whether the expert changed it.
 *
 * Both are exported: an admin needs to see not just what the expert believes
 * but that they disagreed with the bank, because a cluster of corrections on
 * one intent group means the classifier needs fixing upstream.
 */
function intentCells(question: Question, answer?: Answer): [string, string, string] {
    const bank = question.meta?.farmerIntent ?? '';
    const correction = answer?.intentCorrection;
    if (!correction) return [bank, '', ''];
    return [correction.corrected, bank, correction.reason ?? ''];
}

const COLUMNS = [
    { header: 'Ref', key: 'ref', width: 12 },
    { header: 'Question', key: 'question', width: 58 },
    { header: 'Context', key: 'context', width: 32 },
    { header: 'Value chain', key: 'valueChain', width: 18 },
    { header: 'Category', key: 'category', width: 22 },
    { header: 'Intent (in force)', key: 'intent', width: 32 },
    { header: 'Intent (bank, if corrected)', key: 'intentOriginal', width: 30 },
    { header: 'Why corrected', key: 'intentReason', width: 30 },
    { header: 'Ideal response', key: 'ideal', width: 64 },
    { header: 'Must', key: 'must', width: 46 },
    { header: 'Must not', key: 'mustNot', width: 46 },
    { header: 'Expert notes', key: 'notes', width: 34 },
    { header: 'Answered', key: 'answered', width: 11 },
];

function styleHeader(sheet: ExcelJS.Worksheet): void {
    const header = sheet.getRow(1);
    header.font = { bold: true };
    header.alignment = { vertical: 'middle' };
    header.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE8F0EE' },
    };
    // Frozen so the columns stay readable while scrolling a long bank.
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };
}

export interface WorkbookInput {
    assignment: Assignment;
    set: QuestionSet;
    submissions: Submission[];
    /** Questions actually assigned, once the scope has been applied. */
    questions: Question[];
}

export async function buildSubmissionsWorkbook(input: WorkbookInput): Promise<Buffer> {
    const { assignment, set, submissions, questions } = input;

    const workbook = new ExcelJS.Workbook();
    workbook.created = new Date();
    workbook.creator = 'Safety Evals';

    // --- Summary ---
    const summary = workbook.addWorksheet('Summary');
    summary.columns = [
        { header: 'Field', key: 'field', width: 26 },
        { header: 'Value', key: 'value', width: 64 },
    ];
    summary.getRow(1).font = { bold: true };

    const corrections = submissions.reduce(
        (total, submission) =>
            total +
            Object.values(submission.answers).filter((answer) => answer.intentCorrection).length,
        0,
    );

    summary.addRows([
        { field: 'Question set', value: set.title },
        { field: 'Assignment id', value: assignment.id },
        { field: 'Assigned by', value: assignment.assignedBy },
        { field: 'Assigned at', value: assignment.assignedAt },
        { field: 'Due', value: assignment.dueAt ?? '—' },
        { field: 'Status', value: assignment.status },
        { field: 'Questions in scope', value: questions.length },
        { field: 'Responders', value: submissions.length },
        { field: 'Intent corrections', value: corrections },
        { field: 'Exported at', value: new Date().toISOString() },
    ]);

    summary.addRow([]);
    const responderHeader = summary.addRow(['Responder', 'Answered / Status']);
    responderHeader.font = { bold: true };

    for (const submission of submissions) {
        const answered = questions.filter((question) => submission.answers[question.id]).length;
        summary.addRow([
            submission.expertEmail,
            `${answered} of ${questions.length} · ${submission.status}`,
        ]);
    }

    // --- One sheet per responder ---
    const taken = new Set<string>(['Summary']);

    for (const submission of submissions) {
        // The address is the identity, but the local part is what fits and what
        // a reader recognises.
        const sheetName = safeSheetName(submission.expertEmail.split('@')[0], taken);
        const sheet = workbook.addWorksheet(sheetName);
        sheet.columns = COLUMNS;
        styleHeader(sheet);

        // Named on the sheet too, because a truncated tab is not an identity.
        sheet.insertRow(1, [`Responder: ${submission.expertEmail} (${submission.status})`]);
        sheet.getRow(1).font = { bold: true, size: 12 };
        sheet.mergeCells(1, 1, 1, COLUMNS.length);
        sheet.views = [{ state: 'frozen', ySplit: 2 }];
        sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: COLUMNS.length } };

        for (const question of questions) {
            const answer = submission.answers[question.id];
            const [intent, intentOriginal, intentReason] = intentCells(question, answer);

            const row = sheet.addRow({
                ref: question.ref ?? question.id,
                question: question.prompt,
                context: contextCell(question),
                valueChain: question.meta?.valueChain ?? '',
                category: question.meta?.intentGroup ?? '',
                intent,
                intentOriginal,
                intentReason,
                ideal: answer?.ideal ?? '',
                must: answer ? criteriaCell(answer.must) : '',
                mustNot: answer ? criteriaCell(answer.mustNot) : '',
                notes: answer?.notes ?? '',
                answered: answer ? 'yes' : 'no',
            });

            row.alignment = { vertical: 'top', wrapText: true };

            // A corrected intent is the thing an admin is scanning for.
            if (intentOriginal) {
                row.getCell('intent').fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFFF3CD' },
                };
            }

            if (!answer) {
                row.getCell('answered').font = { color: { argb: 'FF9B1C1C' } };
            }
        }
    }

    if (submissions.length === 0) {
        const empty = workbook.addWorksheet('No submissions');
        empty.addRow(['Nobody has started this assignment yet.']);
    }

    // exceljs types this as its own Buffer alias; the runtime value is a Node Buffer.
    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
}
