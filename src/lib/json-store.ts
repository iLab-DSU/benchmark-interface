/**
 * A small JSON key/value store over whichever backend the app is configured
 * for (local disk under .results, or S3 when STORAGE_PROVIDER=s3).
 *
 * The existing storageService is shaped around comparison results and their
 * summaries. Auth and expert-elicitation data are neither, so rather than bend
 * those functions (upstream code we want to keep mergeable) this provides the
 * generic read/write/list the new features need.
 *
 * Keys are always '/'-separated, never platform paths: S3 keys use '/' on every
 * OS, and path.join on Windows would produce '\'.
 */

import path from 'path';
import fs from 'fs/promises';
import { Readable } from 'stream';
import {
    GetObjectCommand,
    PutObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import {
    getStorageProvider,
    getS3Client,
    getBucketName,
    streamToString,
} from '@/lib/storageService';
import { RESULTS_DIR } from '@/cli/constants';

function localPathForKey(key: string): string {
    return path.join(RESULTS_DIR, ...key.split('/'));
}

export async function readJson<T>(key: string): Promise<T | null> {
    if (getStorageProvider() === 's3') {
        try {
            const response = await getS3Client().send(
                new GetObjectCommand({ Bucket: getBucketName(), Key: key }),
            );
            if (!response.Body) return null;
            return JSON.parse(await streamToString(response.Body as Readable)) as T;
        } catch (error: any) {
            if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) return null;
            throw error;
        }
    }

    try {
        return JSON.parse(await fs.readFile(localPathForKey(key), 'utf-8')) as T;
    } catch (error: any) {
        if (error?.code === 'ENOENT') return null;
        throw error;
    }
}

export async function writeJson(key: string, data: unknown): Promise<void> {
    const payload = JSON.stringify(data, null, 2);

    if (getStorageProvider() === 's3') {
        await getS3Client().send(
            new PutObjectCommand({
                Bucket: getBucketName(),
                Key: key,
                Body: payload,
                ContentType: 'application/json',
            }),
        );
        return;
    }

    const target = localPathForKey(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, payload, 'utf-8');
}

export async function deleteJson(key: string): Promise<void> {
    if (getStorageProvider() === 's3') {
        await getS3Client().send(
            new DeleteObjectCommand({ Bucket: getBucketName(), Key: key }),
        );
        return;
    }

    try {
        await fs.unlink(localPathForKey(key));
    } catch (error: any) {
        if (error?.code !== 'ENOENT') throw error;
    }
}

/** Full keys of every .json object directly under a prefix. */
export async function listJsonKeys(prefix: string): Promise<string[]> {
    const normalizedPrefix = prefix.endsWith('/') ? prefix : prefix + '/';

    if (getStorageProvider() === 's3') {
        const keys: string[] = [];
        let continuationToken: string | undefined;

        do {
            const response = await getS3Client().send(
                new ListObjectsV2Command({
                    Bucket: getBucketName(),
                    Prefix: normalizedPrefix,
                    ContinuationToken: continuationToken,
                }),
            );
            for (const item of response.Contents ?? []) {
                if (item.Key?.endsWith('.json')) keys.push(item.Key);
            }
            continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
        } while (continuationToken);

        return keys.sort();
    }

    try {
        const entries = await fs.readdir(localPathForKey(normalizedPrefix), { withFileTypes: true });
        return entries
            .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
            .map((entry) => normalizedPrefix + entry.name)
            .sort();
    } catch (error: any) {
        if (error?.code === 'ENOENT') return [];
        throw error;
    }
}
