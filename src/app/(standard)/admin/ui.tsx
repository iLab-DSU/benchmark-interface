'use client';

import { TriangleAlert, CircleCheck } from 'lucide-react';

/** Shared presentation helpers for the admin panels. */

/**
 * A failed request, carrying what the server actually said.
 *
 * The status and body are kept because some failures are not dead ends: an
 * assignment held back for confirmation returns 409 with the warnings that
 * caused it, and the caller needs those to offer a way forward rather than
 * showing the admin an error they cannot act on.
 */
export class ApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly payload: any,
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

export async function callApi(url: string, init?: RequestInit): Promise<any> {
    const response = await fetch(url, {
        ...init,
        headers:
            init?.body instanceof FormData
                ? init.headers
                : { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new ApiError(
            payload.error ?? `Request failed (${response.status}).`,
            response.status,
            payload,
        );
    }
    return payload;
}

export function Notice({ kind, children }: { kind: 'error' | 'success'; children: React.ReactNode }) {
    const tone =
        kind === 'error'
            ? 'border-red-200 bg-red-50 text-red-800'
            : 'border-emerald-200 bg-emerald-50 text-emerald-800';
    const Icon = kind === 'error' ? TriangleAlert : CircleCheck;

    return (
        <div className={`mt-4 flex gap-2 rounded-lg border p-3 text-sm ${tone}`}>
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 whitespace-pre-wrap break-words">{children}</div>
        </div>
    );
}

export function Panel({
    title,
    description,
    children,
}: {
    title: string;
    description: string;
    children: React.ReactNode;
}) {
    return (
        <section className="rounded-xl border border-[#f2eaea] bg-white/60 p-6">
            <h2 className="font-semibold text-foreground">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            <div className="mt-6">{children}</div>
        </section>
    );
}

export const inputClass =
    'w-full rounded-lg border border-[#dadce0] bg-white px-3 py-2 text-sm outline-none focus:border-[#005B4A] focus:ring-1 focus:ring-[#005B4A]';

export const primaryButtonClass =
    'inline-flex items-center justify-center gap-2 rounded-lg bg-[#005B4A] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#004a3c] disabled:opacity-60';

export const subtleButtonClass =
    'inline-flex items-center justify-center gap-2 rounded-lg border border-[#dadce0] bg-white px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-[#f8f9fa] disabled:opacity-60';
