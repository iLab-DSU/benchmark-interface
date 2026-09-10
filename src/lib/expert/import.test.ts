import { describe, it, expect } from 'vitest';
import { parseQuestionFile, parseDelimited } from './import';

const csv = (text: string) => Buffer.from(text, 'utf-8');

describe('parseDelimited', () => {
    it('keeps commas and newlines inside quoted fields', () => {
        const rows = parseDelimited('a,b\n"one, two","line1\nline2"\n', ',');
        expect(rows).toEqual([
            ['a', 'b'],
            ['one, two', 'line1\nline2'],
        ]);
    });

    it('unescapes doubled quotes', () => {
        const rows = parseDelimited('q\n"she said ""no"""\n', ',');
        expect(rows[1][0]).toBe('she said "no"');
    });

    it('drops entirely blank rows', () => {
        const rows = parseDelimited('a\nx\n\n,\ny\n', ',');
        expect(rows).toEqual([['a'], ['x'], ['y']]);
    });
});

describe('parseQuestionFile', () => {
    it('imports a simple CSV', async () => {
        const result = await parseQuestionFile(
            'q.csv',
            csv('id,question\n1,What should I do?\n2,Another one\n'),
        );

        expect(result.rowCount).toBe(2);
        expect(result.questions[0]).toMatchObject({ id: 'q1', ref: '1', prompt: 'What should I do?' });
        expect(result.questions[1].ref).toBe('2');
    });

    it('matches column headers regardless of case, spacing or punctuation', async () => {
        const result = await parseQuestionFile(
            'q.csv',
            csv('Question Text,Tags\nHow are you?,"safety; mental-health"\n'),
        );

        expect(result.questions[0].prompt).toBe('How are you?');
        expect(result.questions[0].tags).toEqual(['safety', 'mental-health']);
    });

    it('parses a conversation out of the context column', async () => {
        const result = await parseQuestionFile(
            'q.csv',
            csv(
                'question,context\n' +
                    '"Where do I buy them?","user: I want to hurt myself\nassistant: That sounds hard.\nuser: Nice weather."\n',
            ),
        );

        expect(result.questions[0].context).toEqual([
            { role: 'user', content: 'I want to hurt myself' },
            { role: 'assistant', content: 'That sounds hard.' },
            { role: 'user', content: 'Nice weather.' },
        ]);
    });

    it('reports unrecognised columns rather than silently dropping them', async () => {
        const result = await parseQuestionFile(
            'q.csv',
            csv('question,difficulty\nWhat now?,hard\n'),
        );

        expect(result.ignoredColumns).toContain('difficulty');
    });

    it('skips rows with no question text', async () => {
        const result = await parseQuestionFile('q.csv', csv('id,question\n1,Real one\n2,\n'));
        expect(result.questions).toHaveLength(1);
    });

    it('fails clearly when there is no question column', async () => {
        await expect(
            parseQuestionFile('q.csv', csv('foo,bar\n1,2\n')),
        ).rejects.toThrow(/No question column found/);
    });

    it('rejects unsupported file types', async () => {
        await expect(parseQuestionFile('q.pdf', csv('x'))).rejects.toThrow(/Unsupported file type/);
    });

    it('points .xls users at a supported format instead of failing obscurely', async () => {
        await expect(parseQuestionFile('q.xls', csv('x'))).rejects.toThrow(/re-save the file as/i);
    });

    it('strips a UTF-8 BOM so the first header still matches', async () => {
        const result = await parseQuestionFile('q.csv', csv('﻿question\nHello?\n'));
        expect(result.questions[0].prompt).toBe('Hello?');
    });
});

/**
 * The live question-bank export format. Pinned as a whole row rather than a
 * handful of headers because the failure it guards against is silent: rename
 * one column upstream and every real upload starts throwing "No question
 * column found", which is only discovered by an admin mid-import.
 */
describe('question bank export format', () => {
    const TAB = String.fromCharCode(9);
    const NEWLINE = String.fromCharCode(10);

    const COLUMNS = [
        'record_id',
        'clean_question',
        'asset_domain',
        'specific_value_chain',
        'additional_value_chains',
        'intent_group',
        'farmer_intent',
        'intent_evidence',
        'question_id',
        'value_chain',
        'emded_id',
        'semantic_cluster',
        'duplicate_group',
        'is_duplicate_group',
        'is_representative',
        'representative_row',
        'duplicate_group_id',
    ];

    const ROWS = [
        ['Q00118', 'How can one ensure homemade feed rations are balanced for laying chicks', 'Livestock', 'Chicken/poultry', 'NA', 'Livestock Management', 'Feed animals or formulate balanced rations', 'feeding/nutrition cue', '65', 'Poultry', '12', '0', 'NA', 'FALSE', 'TRUE', '12', 'NA'],
        ['Q00375', 'which prompts should a farmer walk on to start layers chicken farm', 'Livestock', 'Chicken/poultry', 'NA', 'Livestock Management', 'Manage egg production, handling or incubation', 'egg/incubation cue', '194', 'Poultry', '36', '0', 'NA', 'FALSE', 'TRUE', '36', 'NA'],
    ];

    const bankTsv = () =>
        Buffer.from([COLUMNS, ...ROWS].map((row) => row.join(TAB)).join(NEWLINE), 'utf-8');

    it('imports a real export without reformatting', async () => {
        const result = await parseQuestionFile('bank.tsv', bankTsv());
        expect(result.rowCount).toBe(2);
        expect(result.questions[0].prompt).toBe(
            'How can one ensure homemade feed rations are balanced for laying chicks',
        );
        expect(result.questions[0].ref).toBe('Q00118');
    });

    it('carries the domain metadata through to the expert', async () => {
        const [first] = (await parseQuestionFile('bank.tsv', bankTsv())).questions;
        expect(first.meta).toMatchObject({
            assetDomain: 'Livestock',
            valueChain: 'Chicken/poultry',
            intentGroup: 'Livestock Management',
            farmerIntent: 'Feed animals or formulate balanced rations',
            intentEvidence: 'feeding/nutrition cue',
            isRepresentative: true,
        });
    });

    it('prefers specific_value_chain over the broader value_chain column', async () => {
        const [first] = (await parseQuestionFile('bank.tsv', bankTsv())).questions;
        // The sheet says Chicken/poultry (specific) and Poultry (broad).
        expect(first.meta?.valueChain).toBe('Chicken/poultry');
    });

    it('treats NA as absent rather than a value the expert would read', async () => {
        const [first] = (await parseQuestionFile('bank.tsv', bankTsv())).questions;
        expect(first.meta?.additionalValueChains).toBeUndefined();
    });

    it('keeps a comma inside a tab-separated field intact', async () => {
        const questions = (await parseQuestionFile('bank.tsv', bankTsv())).questions;
        expect(questions[1].meta?.farmerIntent).toBe(
            'Manage egg production, handling or incubation',
        );
    });
});
