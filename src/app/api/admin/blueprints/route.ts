import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, badRequest } from '@/lib/auth/guard';
import {
    listConfigIds,
    listRunsForConfig,
    deleteConfigData,
    deleteResultByFileName,
    removeConfigFromHomepageSummary,
} from '@/lib/storageService';

export const dynamic = 'force-dynamic';

/** Every stored blueprint and its runs. */
export async function GET() {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    try {
        const configIds = await listConfigIds();

        const blueprints = await Promise.all(
            configIds.map(async (configId) => {
                try {
                    const runs = await listRunsForConfig(configId);
                    return { configId, runs, error: null };
                } catch (error: any) {
                    // One unreadable blueprint must not blank the whole admin
                    // list, so the failure is reported per row instead.
                    return { configId, runs: [], error: error?.message ?? 'Could not list runs.' };
                }
            }),
        );

        return NextResponse.json({ blueprints });
    } catch (error) {
        return badRequest(error);
    }
}

/**
 * Deletes a single run, or an entire blueprint.
 *
 * Requires `confirm` to equal the configId. This is destructive and
 * irreversible, so a mis-aimed click or a stray fetch cannot trigger it.
 */
export async function DELETE(request: NextRequest) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const params = request.nextUrl.searchParams;
    const configId = params.get('configId');
    const fileName = params.get('fileName');
    const confirm = params.get('confirm');

    if (!configId) {
        return NextResponse.json({ error: 'A "configId" query parameter is required.' }, { status: 400 });
    }

    if (confirm !== configId) {
        return NextResponse.json(
            { error: 'Confirmation failed: "confirm" must exactly match the configId being deleted.' },
            { status: 400 },
        );
    }

    try {
        if (fileName) {
            const deleted = await deleteResultByFileName(configId, fileName);
            if (!deleted) {
                return NextResponse.json({ error: `Run "${fileName}" was not found.` }, { status: 404 });
            }
            console.warn(`[admin] ${auth.user.email} deleted run ${configId}/${fileName}`);
            return NextResponse.json({ ok: true, deleted: 'run', configId, fileName });
        }

        const deletedCount = await deleteConfigData(configId);
        await removeConfigFromHomepageSummary(configId).catch((error) => {
            console.warn(`[admin] Deleted ${configId} but could not update the homepage summary:`, error);
        });

        console.warn(`[admin] ${auth.user.email} deleted blueprint ${configId} (${deletedCount} objects)`);
        return NextResponse.json({ ok: true, deleted: 'blueprint', configId, objectsRemoved: deletedCount });
    } catch (error) {
        return badRequest(error);
    }
}
