import { parseSubmittedBlueprint, formatSchemaErrors } from '../blueprint-ingestion';

describe('parseSubmittedBlueprint', () => {
    const simpleBlueprint = `
title: Test Blueprint
description: A test
prompts:
  - id: p1
    prompt: What is the capital of France?
    should:
      - Mentions Paris
`;

    it('parses a simple single-document blueprint and derives the ID from the path', () => {
        const result = parseSubmittedBlueprint(simpleBlueprint, 'blueprints/my-eval.yml');
        expect(result.error).toBeUndefined();
        expect(result.config?.id).toBe('my-eval');
        expect(result.config?.prompts).toHaveLength(1);
    });

    it('parses multi-document YAML (header + prompt stream), which the old push webhook rejected', () => {
        const multiDoc = `
title: Multi Doc Blueprint
description: Header document
---
id: p1
prompt: First prompt
should:
  - Is helpful
---
id: p2
prompt: Second prompt
should:
  - Is accurate
`;
        const result = parseSubmittedBlueprint(multiDoc, 'blueprints/multi-doc.yml');
        expect(result.error).toBeUndefined();
        expect(result.config?.id).toBe('multi-doc');
        expect(result.config?.prompts).toHaveLength(2);
    });

    it('ignores a deprecated embedded id field and warns about it', () => {
        const withId = `
id: embedded-id
title: Test
prompts:
  - id: p1
    prompt: Hello?
`;
        const result = parseSubmittedBlueprint(withId, 'blueprints/path-id.yml');
        expect(result.error).toBeUndefined();
        expect(result.config?.id).toBe('path-id');
        expect(result.warnings.some(w => w.includes("deprecated 'id'"))).toBe(true);
    });

    it('strips a leading blueprints/ prefix but keeps subdirectory structure in the ID', () => {
        const result = parseSubmittedBlueprint(simpleBlueprint, 'blueprints/subdir/my-eval.weval.yml');
        expect(result.error).toBeUndefined();
        expect(result.config?.id).toContain('my-eval');
        expect(result.config?.id).not.toContain('blueprints');
    });

    it('rejects a blueprint with no prompts', () => {
        const noPrompts = `
title: Empty
description: No prompts here
prompts: []
`;
        const result = parseSubmittedBlueprint(noPrompts, 'blueprints/empty.yml');
        expect(result.config).toBeUndefined();
        expect(result.error).toBeTruthy();
    });

    it('rejects unparseable YAML with a parse error', () => {
        const result = parseSubmittedBlueprint('{{{ not yaml :::', 'blueprints/bad.yml');
        expect(result.config).toBeUndefined();
        expect(result.error).toMatch(/error/i);
    });

    it('rejects blueprints that fail canonical schema validation', () => {
        const badSchema = `
title: Bad
prompts:
  - id: p1
    prompt: Hello?
    weight: "not-a-number"
`;
        const result = parseSubmittedBlueprint(badSchema, 'blueprints/bad-schema.yml');
        expect(result.config).toBeUndefined();
        expect(result.error).toMatch(/Schema validation failed|Parse error/);
    });

    it('defaults models to CORE when absent', () => {
        const result = parseSubmittedBlueprint(simpleBlueprint, 'blueprints/my-eval.yml');
        expect(result.config?.models).toEqual(['CORE']);
    });

    it('defaults title to the derived ID when absent', () => {
        const noTitle = `
prompts:
  - id: p1
    prompt: Hello?
`;
        const result = parseSubmittedBlueprint(noTitle, 'blueprints/untitled.yml');
        expect(result.error).toBeUndefined();
        expect(result.config?.title).toBe('untitled');
    });

    it('rejects reserved ID prefixes derived from the path', () => {
        const result = parseSubmittedBlueprint(simpleBlueprint, 'blueprints/_pr_sneaky.yml');
        expect(result.config).toBeUndefined();
        expect(result.error).toMatch(/reserved prefix/);
    });
});

describe('formatSchemaErrors', () => {
    it('handles null/empty error lists', () => {
        expect(formatSchemaErrors(null)).toBe('unknown schema error');
        expect(formatSchemaErrors([])).toBe('unknown schema error');
    });

    it('truncates long error lists and reports the remainder', () => {
        const errors = Array.from({ length: 8 }, (_, i) => ({
            instancePath: `/prompts/${i}`,
            message: 'is invalid',
        })) as any;
        const formatted = formatSchemaErrors(errors, 5);
        expect(formatted).toContain('/prompts/0');
        expect(formatted).toContain('(+3 more)');
    });
});
