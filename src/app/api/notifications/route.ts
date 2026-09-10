import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { badRequest } from '@/lib/auth/guard';
import { listNotifications, markRead, markAllRead } from '@/lib/notify/store';

export const dynamic = 'force-dynamic';

/**
 * The signed-in user's own inbox.
 *
 * Scoped to the session's own address with no way to name another: the
 * recipient is taken from the session, never from a parameter, so there is no
 * request that reads someone else's notifications.
 */
export async function GET() {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const notifications = await listNotifications(user.email);
        return NextResponse.json({
            notifications: notifications.map(({ emailError, ...rest }) => rest),
            unread: notifications.filter((notification) => !notification.readAt).length,
        });
    } catch (error) {
        return badRequest(error);
    }
}

/** Marks one notification, or the whole inbox, as read. */
export async function POST(request: NextRequest) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: { id?: string; all?: boolean };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'A JSON body is required.' }, { status: 400 });
    }

    try {
        if (body.all) {
            const count = await markAllRead(user.email);
            return NextResponse.json({ ok: true, marked: count });
        }

        const id = String(body.id ?? '').trim();
        if (!id) return NextResponse.json({ error: 'An id is required.' }, { status: 400 });

        await markRead(user.email, id);
        return NextResponse.json({ ok: true, marked: 1 });
    } catch (error) {
        return badRequest(error);
    }
}
