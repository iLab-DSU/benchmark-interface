import Link from 'next/link';
import type { Metadata } from 'next';
import { ShieldCheck, TriangleAlert, KeyRound } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth/session';
import { isGoogleConfigured } from '@/lib/auth/google';
import { GoogleSignInButton } from '@/app/components/auth/GoogleSignInButton';
import { PasswordSignInForm } from '@/app/components/auth/PasswordSignInForm';
import { isDevLoginEnabled } from '@/lib/auth/dev-login';

export const metadata: Metadata = {
    title: 'Sign in — Safety Evals',
    robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Error copy is deliberately specific about *why* a sign-in was refused, so an
 * operator can act on it. It never reveals whether a given address exists on
 * the access list beyond what the person signing in already knows about their
 * own account.
 */
function describeError(error: string | undefined, detail: string | undefined): {
    title: string;
    body: string;
} | null {
    if (!error) return null;

    switch (error) {
        case 'not_allowed':
            return {
                title: 'This account does not have access',
                body: `${detail ?? 'That account'} is not on the access list. Ask an administrator to add it, then sign in again.`,
            };
        case 'no_admins':
            return {
                title: 'No administrators are configured',
                body: 'Nobody can grant access yet. Set AUTH_ADMIN_EMAILS in the server environment to the first administrator address, restart the app, and sign in again.',
            };
        case 'not_admin':
            return {
                title: 'Administrator access required',
                body: 'You are signed in, but that area is limited to administrators.',
            };
        case 'not_configured':
            return {
                title: 'Google sign-in is not configured',
                body: 'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and NEXT_PUBLIC_APP_URL must all be set in the server environment.',
            };
        case 'email_unverified':
            return {
                title: 'Email address is not verified',
                body: `Google reports ${detail ?? 'that address'} as unverified. Verify it with Google before signing in.`,
            };
        case 'state_mismatch':
            return {
                title: 'Sign-in could not be verified',
                body: 'The login attempt did not match the one that started in this browser. This usually means it took too long, or cookies were blocked. Please try again.',
            };
        case 'provider_error':
            return {
                title: 'Google refused the sign-in',
                body: detail ? `Google reported: ${detail}` : 'The sign-in was cancelled or refused at Google.',
            };
        case 'exchange_failed':
            return {
                title: 'Could not complete sign-in',
                body: 'The token exchange with Google failed. Check the server logs for details.',
            };
        default:
            return {
                title: 'Sign-in failed',
                body: 'Something went wrong. Please try again.',
            };
    }
}

export default async function LoginPage({
    searchParams,
}: {
    searchParams: Promise<{ error?: string; detail?: string; returnTo?: string }>;
}) {
    const params = await searchParams;
    const user = await getCurrentUser();
    const problem = describeError(params.error, params.detail);
    const configured = isGoogleConfigured();
    const passwordSignIn = isDevLoginEnabled();
    const returnTo = params.returnTo?.startsWith('/') ? params.returnTo : '/analysis';

    return (
        <div className="px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
            <div className="mx-auto max-w-md">
                <div className="rounded-2xl border border-[#f2eaea] bg-white/70 p-8">
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#005B4A]/10">
                        <ShieldCheck className="h-5 w-5 text-[#005B4A]" />
                    </div>

                    <h1 className="mt-5 text-2xl font-bold tracking-tight text-foreground">
                        {user ? 'You are signed in' : 'Sign in to Safety Evals'}
                    </h1>

                    <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                        {user
                            ? `Signed in as ${user.email}.`
                            : 'Evaluation results contain crisis and self-harm case material, so access is limited to approved accounts.'}
                    </p>

                    {problem && (
                        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
                            <div className="flex items-center gap-2 text-amber-800">
                                <TriangleAlert className="h-4 w-4 shrink-0" />
                                <span className="text-sm font-semibold">{problem.title}</span>
                            </div>
                            <p className="mt-2 text-sm text-amber-800/90 leading-relaxed">{problem.body}</p>
                        </div>
                    )}

                    <div className="mt-8">
                        {user ? (
                            <div className="flex flex-col gap-3">
                                <Link
                                    href={user.role === 'expert' ? '/expert' : '/analysis'}
                                    className="inline-flex items-center justify-center rounded-lg bg-[#005B4A] px-5 py-3 text-sm font-semibold text-white hover:bg-[#004a3c] transition-colors"
                                >
                                    {user.role === 'expert' ? 'Open my assignments' : 'Browse evaluations'}
                                </Link>
                                <a
                                    href="/api/auth/logout"
                                    className="inline-flex items-center justify-center rounded-lg border border-[#dadce0] bg-white px-5 py-3 text-sm font-semibold text-foreground hover:bg-[#f8f9fa] transition-colors"
                                >
                                    Sign out
                                </a>
                            </div>
                        ) : (
                            <div className="space-y-5">
                                {configured && (
                                    <GoogleSignInButton returnTo={returnTo} className="w-full" />
                                )}

                                {configured && passwordSignIn && (
                                    <div className="flex items-center gap-3">
                                        <span className="h-px flex-1 bg-[#f2eaea]" />
                                        <span className="text-xs text-muted-foreground">or</span>
                                        <span className="h-px flex-1 bg-[#f2eaea]" />
                                    </div>
                                )}

                                {passwordSignIn && (
                                    <div>
                                        <div className="mb-4 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                                            <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                            <span>
                                                <strong>Temporary password sign-in is on.</strong> It
                                                bypasses Google. Set{' '}
                                                <code className="font-mono">AUTH_DEV_LOGIN=false</code>{' '}
                                                once OAuth is configured.
                                            </span>
                                        </div>
                                        <PasswordSignInForm returnTo={returnTo} />
                                    </div>
                                )}

                                {!configured && !passwordSignIn && (
                                    <div className="rounded-lg border border-[#f2eaea] bg-[#faf9f6] p-4 text-sm text-muted-foreground">
                                        Google sign-in is not configured on this server yet.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <p className="mt-6 text-center text-sm text-muted-foreground">
                    <Link href="/" className="hover:text-foreground transition-colors">
                        ← Back to the overview
                    </Link>
                </p>
            </div>
        </div>
    );
}
