import { parseAndNormalizeBlueprint, validateReservedPrefixes } from '@/lib/blueprint-parser';
import { validateBlueprintSchema } from '@/lib/blueprint-validator';
import { generateBlueprintIdFromPath, validateBlueprintId } from '@/app/utils/blueprintIdUtils';
import { ComparisonConfig } from '@/cli/types/cli_types';
import type { ErrorObject } from 'ajv';

export interface BlueprintIngestionSuccess {
    config: ComparisonConfig;
    error?: undefined;
    warnings: string[];
}

export interface BlueprintIngestionFailure {
    config?: undefined;
    error: string;
    warnings: string[];
}

export type BlueprintIngestionResult = BlueprintIngestionSuccess | BlueprintIngestionFailure;

export function formatSchemaErrors(errors: ErrorObject[] | null | undefined, maxErrors: number = 5): string {
    if (!errors || errors.length === 0) {
        return 'unknown schema error';
    }
    const shown = errors
        .slice(0, maxErrors)
        .map(e => `${e.instancePath || '/'} ${e.message ?? 'is invalid'}`)
        .join('; ');
    const remaining = errors.length - maxErrors;
    return remaining > 0 ? `${shown} (+${remaining} more)` : shown;
}

/**
 * Parse and validate a submitted blueprint the same way on every ingestion
 * path (PR staging webhook, push-to-main webhook, scheduled evals):
 *
 * - canonical parser (supports all multi-document YAML structures)
 * - canonical JSON-Schema validation, rejecting invalid blueprints up front
 *   instead of letting them fail mid-run
 * - blueprint ID derived from the repo-relative file path; an embedded `id`
 *   field is deprecated and ignored
 * - `models` defaults to the CORE collection when absent
 */
export function parseSubmittedBlueprint(
    content: string,
    repoRelativePath: string,
): BlueprintIngestionResult {
    const warnings: string[] = [];

    const fileType = repoRelativePath.endsWith('.json') ? 'json' : 'yaml';
    let config: ComparisonConfig;
    try {
        config = parseAndNormalizeBlueprint(content, fileType);
    } catch (error: any) {
        return { error: `Parse error: ${error.message}`, warnings };
    }

    const schemaCheck = validateBlueprintSchema(config, 'canonical');
    if (!schemaCheck.valid) {
        return {
            error: `Schema validation failed: ${formatSchemaErrors(schemaCheck.errors as ErrorObject[] | null)}`,
            warnings,
        };
    }

    if (config.id) {
        warnings.push(
            `Blueprint contains a deprecated 'id' field ('${config.id}'). It is ignored; the ID is derived from the file path.`,
        );
    }

    const pathForId = repoRelativePath.startsWith('blueprints/')
        ? repoRelativePath.substring('blueprints/'.length)
        : repoRelativePath;

    try {
        const id = generateBlueprintIdFromPath(pathForId);
        validateReservedPrefixes(id);
        validateBlueprintId(id);
        config.id = id;
    } catch (error: any) {
        return { error: error.message, warnings };
    }

    if (!config.title) {
        config.title = config.id;
    }

    if (!config.prompts || !Array.isArray(config.prompts) || config.prompts.length === 0) {
        return { error: 'Blueprint contains no prompts', warnings };
    }

    if (!config.models || !Array.isArray(config.models) || config.models.length === 0) {
        config.models = ['CORE'];
    }

    return { config, warnings };
}
