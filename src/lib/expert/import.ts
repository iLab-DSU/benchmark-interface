/**
 * Turns an uploaded spreadsheet into questions.
 *
 * Accepts .xlsx/.xlsm via exceljs and .csv/.tsv directly. Column headers are
 * matched loosely (case, spacing and punctuation are ignored) so an admin does
 * not have to reformat a sheet they already have; anything unrecognised is
 * reported back rather than silently dropped.
 */

import type { Question, QuestionMeta } from './types';

export interface ImportResult {
    questions: Question[];
    ignoredColumns: string[];
    rowCount: number;
}

/** Header aliases, normalized. First match wins. */
const COLUMN_ALIASES: Record<keyof typeof FIELDS, string[]> = {
    ref: ['id', 'ref', 'reference', 'no', 'num', 'number', 'questionid', 'questionno', 'recordid'],
    prompt: [
        'question',
        'prompt',
        'text',
        'questiontext',
        'user',
        'usermessage',
        'scenario',
        // Question banks routinely ship a raw column and a cleaned one; the
        // cleaned text is what an expert should be answering.
        'cleanquestion',
        'cleanedquestion',
        'questionclean',
    ],
    context: ['context', 'conversation', 'history', 'priorturns', 'background'],
    tags: ['tags', 'tag', 'category', 'categories', 'topic', 'topics'],
    notes: ['notes', 'note', 'guidance', 'instructions', 'comment', 'comments'],
};

const FIELDS = { ref: 1, prompt: 1, context: 1, tags: 1, notes: 1 };

/**
 * Domain columns. These are not evaluated and never required, but they are
 * carried through to the expert as framing rather than dropped.
 *
 * valueChain lists the narrower "specific" column first so it wins over the
 * broad one when a sheet carries both.
 */
const META_ALIASES: Record<keyof typeof META_FIELDS, string[]> = {
    assetDomain: ['assetdomain', 'domain', 'sector'],
    valueChain: ['specificvaluechain', 'valuechain', 'commodity', 'crop', 'enterprise'],
    additionalValueChains: ['additionalvaluechains', 'othervaluechains', 'secondaryvaluechain'],
    intentGroup: ['intentgroup', 'intentcategory', 'themegroup'],
    farmerIntent: ['farmerintent', 'intent', 'userintent'],
    intentEvidence: ['intentevidence', 'intentcue', 'evidence'],
    clusterId: ['semanticcluster', 'clusterid', 'cluster', 'duplicategroupid', 'duplicategroup'],
    isRepresentative: ['isrepresentative', 'representative'],
    representsCount: ['clustersize', 'duplicatecount', 'represents', 'nduplicates', 'groupsize'],
};

const META_FIELDS = {
    assetDomain: 1,
    valueChain: 1,
    additionalValueChains: 1,
    intentGroup: 1,
    farmerIntent: 1,
    intentEvidence: 1,
    clusterId: 1,
    isRepresentative: 1,
    representsCount: 1,
};

function normalizeHeader(header: string): string {
    return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function classifyHeaders(headers: string[]): {
    mapping: Partial<Record<keyof typeof FIELDS, number>>;
    metaMapping: Partial<Record<keyof typeof META_FIELDS, number>>;
    ignored: string[];
} {
    const mapping: Partial<Record<keyof typeof FIELDS, number>> = {};
    const metaMapping: Partial<Record<keyof typeof META_FIELDS, number>> = {};
    const ignored: string[] = [];

    headers.forEach((header, index) => {
        const normalized = normalizeHeader(header);
        if (!normalized) return;

        const field = (Object.keys(COLUMN_ALIASES) as Array<keyof typeof FIELDS>).find(
            (candidate) => COLUMN_ALIASES[candidate].includes(normalized),
        );

        if (field && mapping[field] === undefined) {
            mapping[field] = index;
            return;
        }

        const metaField = (Object.keys(META_ALIASES) as Array<keyof typeof META_FIELDS>).find(
            (candidate) => META_ALIASES[candidate].includes(normalized),
        );

        if (metaField && metaMapping[metaField] === undefined) {
            metaMapping[metaField] = index;
            return;
        }

        ignored.push(header);
    });

    return { mapping, metaMapping, ignored };
}

/** Spreadsheet booleans arrive as TRUE/FALSE/yes/1; NA means "not stated". */
function parseBoolean(raw: string): boolean | undefined {
    const value = raw.trim().toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(value)) return true;
    if (['false', 'no', 'n', '0'].includes(value)) return false;
    return undefined;
}

/**
 * "NA", "N/A" and empty are all absence. Without this every question would
 * carry meta fields whose value is the literal string "NA", which then renders
 * to the expert as though it meant something.
 */
function meaningful(raw: string): string | undefined {
    const value = raw.trim();
    if (!value) return undefined;
    if (['na', 'n/a', 'none', 'null', '-'].includes(value.toLowerCase())) return undefined;
    return value;
}

/** RFC 4180-style parser: handles quoted fields, escaped quotes and newlines. */
export function parseDelimited(text: string, delimiter: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;

    // Strip a UTF-8 BOM, which Excel writes and which would otherwise become
    // part of the first header name.
    const input = text.replace(/^﻿/, '');

    for (let i = 0; i < input.length; i += 1) {
        const char = input[i];

        if (inQuotes) {
            if (char === '"') {
                if (input[i + 1] === '"') {
                    field += '"';
                    i += 1;
                } else {
                    inQuotes = false;
                }
            } else {
                field += char;
            }
            continue;
        }

        if (char === '"') {
            inQuotes = true;
        } else if (char === delimiter) {
            row.push(field);
            field = '';
        } else if (char === '\r') {
            // Handled by the \n branch; a lone \r also ends the row.
            if (input[i + 1] !== '\n') {
                row.push(field);
                rows.push(row);
                row = [];
                field = '';
            }
        } else if (char === '\n') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else {
            field += char;
        }
    }

    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }

    return rows.filter((candidate) => candidate.some((cell) => cell.trim() !== ''));
}

/**
 * Parses a context cell into turns.
 *
 * Accepts lines prefixed with a speaker, which is how people naturally write a
 * conversation into one cell:
 *   user: I want to hurt myself
 *   assistant: It sounds like you are going through a lot
 */
function parseContext(raw: string): Question['context'] {
    const lines = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    const turns: NonNullable<Question['context']> = [];

    for (const line of lines) {
        const match = line.match(/^(user|assistant|model|ai)\s*[:\-]\s*(.*)$/i);
        if (match) {
            const role = /^(assistant|model|ai)$/i.test(match[1]) ? 'assistant' : 'user';
            turns.push({ role, content: match[2].trim() });
        } else if (turns.length > 0) {
            // A continuation line belongs to the turn above it.
            turns[turns.length - 1].content += '\n' + line;
        } else {
            turns.push({ role: 'user', content: line });
        }
    }

    return turns.length > 0 ? turns : undefined;
}

function rowsToQuestions(rows: string[][]): ImportResult {
    if (rows.length === 0) {
        throw new Error('The file appears to be empty.');
    }

    const [headerRow, ...dataRows] = rows;
    const { mapping, metaMapping, ignored } = classifyHeaders(
        headerRow.map((cell) => String(cell ?? '')),
    );

    if (mapping.prompt === undefined) {
        throw new Error(
            'No question column found. Add a column headed "question" (or "prompt", "text", "scenario"). ' +
                `Columns seen: ${headerRow.filter(Boolean).join(', ') || '(none)'}.`,
        );
    }

    const questions: Question[] = [];

    dataRows.forEach((row, index) => {
        const cell = (field: keyof typeof FIELDS): string => {
            const column = mapping[field];
            if (column === undefined) return '';
            return String(row[column] ?? '').trim();
        };

        const metaCell = (field: keyof typeof META_FIELDS): string => {
            const column = metaMapping[field];
            if (column === undefined) return '';
            return String(row[column] ?? '').trim();
        };

        const prompt = cell('prompt');
        // A row with no question text is padding, not a question.
        if (!prompt) return;

        const tagsRaw = cell('tags');
        const contextRaw = cell('context');

        const countRaw = meaningful(metaCell('representsCount'));
        const parsedCount = countRaw ? Number(countRaw) : NaN;

        const meta: QuestionMeta = {
            assetDomain: meaningful(metaCell('assetDomain')),
            valueChain: meaningful(metaCell('valueChain')),
            additionalValueChains: meaningful(metaCell('additionalValueChains')),
            intentGroup: meaningful(metaCell('intentGroup')),
            farmerIntent: meaningful(metaCell('farmerIntent')),
            intentEvidence: meaningful(metaCell('intentEvidence')),
            clusterId: meaningful(metaCell('clusterId')),
            isRepresentative: parseBoolean(metaCell('isRepresentative')),
            representsCount: Number.isFinite(parsedCount) ? parsedCount : undefined,
        };

        const hasMeta = Object.values(meta).some((value) => value !== undefined);

        questions.push({
            id: `q${index + 1}`,
            ref: cell('ref') || undefined,
            prompt,
            context: contextRaw ? parseContext(contextRaw) : undefined,
            tags: tagsRaw
                ? tagsRaw
                      .split(/[,;|]/)
                      .map((tag) => tag.trim())
                      .filter(Boolean)
                : undefined,
            notes: cell('notes') || undefined,
            meta: hasMeta ? meta : undefined,
        });
    });

    if (questions.length === 0) {
        throw new Error('No rows contained question text.');
    }

    return { questions, ignoredColumns: ignored, rowCount: questions.length };
}

/** Parses an uploaded file into questions, dispatching on its extension. */
export async function parseQuestionFile(fileName: string, buffer: Buffer): Promise<ImportResult> {
    const lower = fileName.toLowerCase();

    if (lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.txt')) {
        const delimiter = lower.endsWith('.tsv') ? '\t' : ',';
        return rowsToQuestions(parseDelimited(buffer.toString('utf-8'), delimiter));
    }

    if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
        // Imported lazily: exceljs is large and only needed for real workbooks.
        const ExcelJS = (await import('exceljs')).default;
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer as any);

        const sheet = workbook.worksheets[0];
        if (!sheet) throw new Error('The workbook contains no sheets.');

        const rows: string[][] = [];
        sheet.eachRow((row) => {
            const values: string[] = [];
            // exceljs is 1-indexed and row.values[0] is always empty.
            const raw = row.values as any[];
            for (let i = 1; i < raw.length; i += 1) {
                const value = raw[i];
                if (value === null || value === undefined) {
                    values.push('');
                } else if (typeof value === 'object') {
                    // Rich text, hyperlinks and formula results arrive as objects.
                    values.push(String(value.text ?? value.result ?? value.hyperlink ?? '').trim());
                } else {
                    values.push(String(value));
                }
            }
            rows.push(values);
        });

        return rowsToQuestions(rows);
    }

    if (lower.endsWith('.xls')) {
        throw new Error(
            'Legacy .xls workbooks are not supported. Re-save the file as .xlsx or .csv and upload it again.',
        );
    }

    throw new Error(`Unsupported file type "${fileName}". Upload .xlsx, .csv or .tsv.`);
}
