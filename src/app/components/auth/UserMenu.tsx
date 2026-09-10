'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Shield, ClipboardList } from 'lucide-react';
import { NotificationBell } from './NotificationBell';

interface SessionUser {
    email: string;
    name?: string;
    picture?: string;
    role: 'admin' | 'member' | 'expert';
}

/**
 * Auth state for the site header.
 *
 * Fetched client-side rather than passed down from a server component because
 * SiteHeader is rendered inside the analysis layout, which is a client
 * component and therefore cannot await a session.
 */
export function UserMenu() {
    const [user, setUser] = useState<SessionUser | null>(null);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        let cancelled = false;

        fetch('/api/auth/session')
            .then((response) => (response.ok ? response.json() : { user: null }))
            .then((data) => {
                if (!cancelled) setUser(data.user ?? null);
            })
            .catch(() => {
                if (!cancelled) setUser(null);
            })
            .finally(() => {
                if (!cancelled) setLoaded(true);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    // Renders nothing until known, so the header does not flash "Sign in" at
    // someone who is already signed in.
    if (!loaded) return <div className="h-8 w-24" aria-hidden />;

    if (!user) {
        return (
            <Link
                href="/login"
                className="text-sm font-medium text-foreground transition-colors hover:text-foreground/70"
            >
                Sign in
            </Link>
        );
    }

    return (
        <div className="flex items-center gap-4">
            <NotificationBell />

            {user.role !== 'member' && (
                <Link
                    href="/expert"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground transition-colors hover:text-foreground/70"
                >
                    <ClipboardList className="h-3.5 w-3.5" />
                    Assignments
                </Link>
            )}

            {user.role === 'admin' && (
                <Link
                    href="/admin"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground transition-colors hover:text-foreground/70"
                >
                    <Shield className="h-3.5 w-3.5" />
                    Admin
                </Link>
            )}

            <span className="hidden text-sm text-muted-foreground sm:inline" title={user.email}>
                {user.email}
            </span>

            <a
                href="/api/auth/logout"
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
                Sign out
            </a>
        </div>
    );
}
