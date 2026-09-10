'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';

interface NotificationRow {
    id: string;
    title: string;
    body: string;
    href?: string;
    createdAt: string;
    readAt?: string;
}

function timeAgo(iso: string): string {
    const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (!Number.isFinite(seconds) || seconds < 0) return '';
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * The in-app inbox.
 *
 * Polls rather than holding a socket open: an assignment is not a live feed,
 * and a minute of latency on a task due next week costs nothing while a
 * persistent connection per signed-in tab costs a connection per signed-in tab.
 */
export function NotificationBell() {
    const [items, setItems] = useState<NotificationRow[]>([]);
    const [unread, setUnread] = useState(0);
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const load = useCallback(async () => {
        try {
            const response = await fetch('/api/notifications');
            if (!response.ok) return;
            const data = await response.json();
            setItems(data.notifications ?? []);
            setUnread(data.unread ?? 0);
        } catch {
            // An unreachable inbox is not worth surfacing in the header.
        }
    }, []);

    useEffect(() => {
        void load();
        const timer = setInterval(load, 60_000);
        return () => clearInterval(timer);
    }, [load]);

    // Click-away and Escape, so the panel never traps the page.
    useEffect(() => {
        if (!open) return;

        const onPointerDown = (event: MouseEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };

        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    const markAllRead = async () => {
        setUnread(0);
        setItems((current) =>
            current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })),
        );
        try {
            await fetch('/api/notifications', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ all: true }),
            });
        } catch {
            void load();
        }
    };

    const openItem = async (item: NotificationRow) => {
        setOpen(false);
        if (item.readAt) return;
        try {
            await fetch('/api/notifications', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: item.id }),
            });
        } catch {
            // The navigation matters more than the read receipt.
        }
        void load();
    };

    return (
        <div ref={containerRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
                aria-expanded={open}
                className="relative flex h-8 w-8 items-center justify-center rounded-full text-foreground transition-colors hover:bg-foreground/5"
            >
                <Bell className="h-4 w-4" />
                {unread > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#005B4A] px-1 text-[10px] font-semibold text-white">
                        {unread > 9 ? '9+' : unread}
                    </span>
                )}
            </button>

            {open && (
                <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-background shadow-lg">
                    <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                        <span className="text-sm font-semibold text-foreground">Notifications</span>
                        {unread > 0 && (
                            <button
                                type="button"
                                onClick={markAllRead}
                                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                            >
                                Mark all read
                            </button>
                        )}
                    </div>

                    <div className="max-h-80 overflow-y-auto">
                        {items.length === 0 ? (
                            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                                Nothing yet.
                            </p>
                        ) : (
                            items.map((item) => {
                                const content = (
                                    <>
                                        <div className="flex items-start gap-2">
                                            {!item.readAt && (
                                                <span
                                                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#005B4A]"
                                                    aria-hidden
                                                />
                                            )}
                                            <div className={item.readAt ? 'pl-3.5' : ''}>
                                                <p className="text-sm font-medium text-foreground">
                                                    {item.title}
                                                </p>
                                                <p className="mt-0.5 text-xs text-muted-foreground">
                                                    {item.body}
                                                </p>
                                                <p className="mt-1 text-[11px] text-muted-foreground">
                                                    {timeAgo(item.createdAt)}
                                                </p>
                                            </div>
                                        </div>
                                    </>
                                );

                                return item.href ? (
                                    <Link
                                        key={item.id}
                                        href={item.href}
                                        onClick={() => void openItem(item)}
                                        className="block border-b border-border px-4 py-3 last:border-0 hover:bg-foreground/5"
                                    >
                                        {content}
                                    </Link>
                                ) : (
                                    <div
                                        key={item.id}
                                        className="border-b border-border px-4 py-3 last:border-0"
                                    >
                                        {content}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
