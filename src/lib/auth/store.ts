/**
 * Persistence for the access list, on whichever storage backend is configured,
 * so access control survives a redeploy on an ephemeral filesystem.
 */

import { readJson, writeJson } from '@/lib/json-store';
import { LIVE_DIR } from '@/cli/constants';
import type { AccessList } from './types';

const ACCESS_LIST_KEY = [LIVE_DIR, 'auth', 'access-list.json'].join('/');

export async function readAccessList(): Promise<AccessList | null> {
    return readJson<AccessList>(ACCESS_LIST_KEY);
}

export async function writeAccessList(list: AccessList): Promise<void> {
    await writeJson(ACCESS_LIST_KEY, { ...list, updatedAt: new Date().toISOString() });
}
