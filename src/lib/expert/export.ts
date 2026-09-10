/**
 * Compiles one expert's submission into a blueprint.
 *
 * This is the bridge between elicitation and the evaluation pipeline. It only
 * writes the file — nothing here runs an evaluation.
 *
 * Export is deliberately per-expert. When several experts answer the same
 * question their criteria can disagree, and silently unioning them would
 * produce a blueprint nobody actually authored. Merging is a judgement call for
 * the admin, made against the side-by-side view.
 */

import yaml from 'js-yaml';
import type { Answer, Question, QuestionSet, Submission } from './types';

interface PromptEntry {
    id: string;
    /**
     * What the farmer is trying to achieve.
     *
     * Carried into the blueprint because a judge scoring the response needs
     * the same framing the expert had. Where the expert corrected the bank's
     * label, the correction is what travels — their reading is the one the
     * criteria were written against.
     */
    description?: string;
    messages: Array<Record<string, string>>;
    ideal?: string;
    should?: string[];
    should_not?: string[];
}

function buildMessages(question: Question): Array<Record<string, string>> {
    const messages: Array<Record<string, string>> = [];

    for (const turn of question.context ?? []) {
        messages.push({ [turn.role]: turn.content });
    }

    messages.push({ user: question.prompt });
    return messages;
}

function criteriaTexts(criteria: Answer['must']): string[] {
    return criteria.map((criterion) => criterion.text.trim()).filter(Boolean);
}

export interface BlueprintExportOptions {
    /** Models to evaluate. Left to the admin; elicitation does not choose them. */
    models?: string[];
    /** Cut-off for treating a criterion score as met. */
    threshold?: number;
}

export function buildBlueprint(
    set: QuestionSet,
    submission: Submission,
    options: BlueprintExportOptions = {},
): string {
    const models = options.models?.length ? options.models : ['openrouter:openai/gpt-4o'];
    const threshold = options.threshold ?? 0.7;

    const prompts: PromptEntry[] = [];
    const critical: Record<string, string[]> = {};
    /**
     * Prompts whose turns do not alternate. This happens when a context cell
     * ends on a user turn, so appending the question produces two user
     * messages in a row. Some providers (Anthropic among them) reject that, so
     * it is flagged in the file rather than left to fail at run time.
     */
    const nonAlternating: string[] = [];

    for (const question of set.questions) {
        const answer = submission.answers[question.id];
        // A question the expert never answered has no criteria to evaluate
        // against, so including it would produce a prompt that always fails.
        if (!answer) continue;

        const should = criteriaTexts(answer.must);
        const shouldNot = criteriaTexts(answer.mustNot);
        if (should.length === 0 && shouldNot.length === 0 && !answer.ideal.trim()) continue;

        const entry: PromptEntry = {
            id: question.ref?.trim() || question.id,
            messages: buildMessages(question),
        };

        const intent = answer.intentCorrection?.corrected ?? question.meta?.farmerIntent;
        if (intent) {
            entry.description = answer.intentCorrection
                ? `Farmer intent (corrected by the expert): ${intent}`
                : `Farmer intent: ${intent}`;
        }

        if (answer.ideal.trim()) entry.ideal = answer.ideal.trim();
        if (should.length > 0) entry.should = should;
        if (shouldNot.length > 0) entry.should_not = shouldNot;

        const consecutive = entry.messages.some((message, index) => {
            if (index === 0) return false;
            return Object.keys(message)[0] === Object.keys(entry.messages[index - 1])[0];
        });
        if (consecutive) nonAlternating.push(entry.id);

        prompts.push(entry);

        const criticalTexts = [
            ...answer.must.filter((criterion) => criterion.critical),
            ...answer.mustNot.filter((criterion) => criterion.critical),
        ]
            .map((criterion) => criterion.text.trim())
            .filter(Boolean);

        if (criticalTexts.length > 0) critical[entry.id] = criticalTexts;
    }

    if (prompts.length === 0) {
        throw new Error('This submission contains no answered questions to export.');
    }

    const header: Record<string, unknown> = {
        title: set.title,
        description:
            `Authored by ${submission.expertEmail}` +
            (submission.submittedAt ? ` (submitted ${submission.submittedAt})` : ' (draft)'),
        tags: ['expert-authored'],
        models,
    };

    if (Object.keys(critical).length > 0) {
        header.safety_policy = { threshold, critical };
    }

    const corrections = set.questions
        .map((question) => ({ question, correction: submission.answers[question.id]?.intentCorrection }))
        .filter((row) => row.correction);

    const notes = [
        '# Generated from an expert submission by Safety Evals.',
        `# Question set: ${set.id}`,
        `# Expert: ${submission.expertEmail}`,
        '#',
        '# Review "models" before running: elicitation does not choose them.',
    ];

    if (corrections.length > 0) {
        notes.push(
            '#',
            '# The expert disagreed with the question bank about what these ask:',
            ...corrections.map(
                (row) =>
                    `#   ${row.question.ref ?? row.question.id}: "${row.correction!.original ?? '(none)'}"` +
                    ` -> "${row.correction!.corrected}"`,
            ),
        );
    }

    if (Object.keys(critical).length > 0) {
        notes.push(
            '#',
            '# safety_policy.critical lists the criteria the expert marked must-never-fail.',
            '# A policy entry that matches no criterion is a hard error, so keep these',
            '# strings identical to the criteria below if you edit either.',
        );
    }

    if (nonAlternating.length > 0) {
        notes.push(
            '#',
            '# WARNING: these prompts have two turns from the same speaker in a row:',
            `#   ${nonAlternating.join(', ')}`,
            '# Usually the context ended on a user turn and is missing the assistant',
            '# reply. Some providers reject non-alternating turns. Add the missing',
            '# turn before running this blueprint.',
        );
    }

    return [
        notes.join('\n'),
        yaml.dump(header, { lineWidth: 100, noRefs: true }).trimEnd(),
        '---',
        yaml.dump(prompts, { lineWidth: 100, noRefs: true }).trimEnd(),
        '',
    ].join('\n');
}
