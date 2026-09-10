import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import yaml from 'js-yaml';
import { v4 as uuidv4 } from 'uuid';
import { requireAdmin, badRequest } from '@/lib/auth/guard';
import { callBackgroundFunction } from '@/lib/background-function-client';
import type { ComparisonConfig } from '@/cli/types/cli_types';

export const dynamic = 'force-dynamic';

const EXAMPLES_ROOT = path.join(process.cwd(), 'examples');

function parseBlueprint(content: string): ComparisonConfig | null {
    try {
        return JSON.parse(content) as ComparisonConfig;
    } catch {
        try {
            return yaml.load(content) as ComparisonConfig;
        } catch {
            return null;
        }
    }
}

async function listExampleBlueprints(): Promise<string[]> {
    const found: string[] = [];

    async function walk(dir: string): Promise<void> {
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(full);
            } else if (/\.(ya?ml|json)$/i.test(entry.name)) {
                found.push(path.relative(EXAMPLES_ROOT, full).split(path.sep).join('/'));
            }
        }
    }

    await walk(EXAMPLES_ROOT);
    return found.sort();
}

/**
 * Resolves a caller-supplied example path, refusing anything that escapes the
 * examples directory. Without this check a crafted "../../.env" would let an
 * admin read arbitrary server files through the run form.
 */
async function readExample(relativePath: string): Promise<string> {
    const resolved = path.resolve(EXAMPLES_ROOT, relativePath);
    const root = path.resolve(EXAMPLES_ROOT);

    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        throw new Error('Example path must stay inside the examples directory.');
    }

    return fs.readFile(resolved, 'utf-8');
}

/** Lists the blueprints an admin can launch without pasting YAML. */
export async function GET() {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    try {
        return NextResponse.json({ examples: await listExampleBlueprints() });
    } catch (error) {
        return badRequest(error);
    }
}

/** Launches an evaluation run in the background. */
export async function POST(request: NextRequest) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    let body: { blueprint?: string; examplePath?: string };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'A JSON body is required.' }, { status: 400 });
    }

    let content: string;
    try {
        if (body.examplePath) {
            content = await readExample(body.examplePath);
        } else if (body.blueprint && body.blueprint.trim()) {
            content = body.blueprint;
        } else {
            return NextResponse.json(
                { error: 'Provide either "blueprint" content or an "examplePath".' },
                { status: 400 },
            );
        }
    } catch (error) {
        return badRequest(error);
    }

    const config = parseBlueprint(content);
    if (!config) {
        return NextResponse.json(
            { error: 'Could not parse the blueprint as YAML or JSON.' },
            { status: 400 },
        );
    }

    if (!config.prompts || !Array.isArray(config.prompts) || config.prompts.length === 0) {
        return NextResponse.json(
            { error: 'Blueprint must include at least one prompt.' },
            { status: 400 },
        );
    }

    if (!config.models || !Array.isArray(config.models) || config.models.length === 0) {
        return NextResponse.json(
            { error: 'Blueprint must list at least one model. Add a "models:" block.' },
            { status: 400 },
        );
    }

    // Marks provenance so runs launched from the UI are distinguishable from
    // CLI runs and from the public API's '_public_api' tag.
    config.tags = [...(config.tags ?? []), '_admin_ui'];

    const runId = uuidv4();

    try {
        console.log(`[admin] ${auth.user.email} triggered run ${runId}`);

        // Same mechanism the public API uses, rather than a second execution
        // path that could drift from it.
        const response = await callBackgroundFunction({
            functionName: 'execute-evaluation-background',
            body: { runId, config },
        });

        if (!response.ok) {
            return NextResponse.json(
                {
                    error: `Could not start the run: ${response.error ?? `status ${response.status}`}`,
                    runId,
                },
                { status: 502 },
            );
        }

        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
        return NextResponse.json({
            ok: true,
            runId,
            statusUrl: `${appUrl}/api/v1/evaluations/status/${runId}`,
            viewUrl: `${appUrl}/api-run/${runId}`,
        });
    } catch (error) {
        console.error('[admin] Failed to trigger run:', error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : 'Could not reach the background execution endpoint.',
            },
            { status: 500 },
        );
    }
}
