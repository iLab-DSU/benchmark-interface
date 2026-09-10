'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, KeyRound } from 'lucide-react';

/** Temporary password sign-in, shown only while AUTH_DEV_LOGIN is enabled. */
export function PasswordSignInForm({ returnTo = '/analysis' }: { returnTo?: string }) {
    const router = useRouter();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setPending(true);
        setError(null);

        try {
            const response = await fetch('/api/auth/dev-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });
            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                setError(data.error ?? `Sign-in failed (${response.status}).`);
                return;
            }

            // Experts have no access to the results area, so send them to their
            // own workspace rather than a page that would bounce them.
            const destination = data.user?.role === 'expert' ? '/expert' : returnTo;
            router.push(destination);
            router.refresh();
        } catch {
            setError('Could not reach the server.');
        } finally {
            setPending(false);
        }
    };

    const inputClass =
        'w-full rounded-lg border border-[#dadce0] bg-white px-3 py-2 text-sm outline-none focus:border-[#005B4A] focus:ring-1 focus:ring-[#005B4A]';

    return (
        <form onSubmit={submit} className="space-y-3">
            <div>
                <label className="text-sm font-medium text-foreground" htmlFor="dev-email">
                    Email
                </label>
                <input
                    id="dev-email"
                    type="email"
                    required
                    autoComplete="username"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className={inputClass + ' mt-1.5'}
                />
            </div>

            <div>
                <label className="text-sm font-medium text-foreground" htmlFor="dev-password">
                    Password
                </label>
                <input
                    id="dev-password"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className={inputClass + ' mt-1.5'}
                />
            </div>

            {error && (
                <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    {error}
                </p>
            )}

            <button
                type="submit"
                disabled={pending}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#005B4A] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#004a3c] disabled:opacity-60"
            >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                Sign in
            </button>
        </form>
    );
}
