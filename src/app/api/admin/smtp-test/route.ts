import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, badRequest } from '@/lib/auth/guard';
import { verifySmtp, isEmailEnabled } from '@/lib/notify';
import { sendMail } from '@/lib/notify/mailer';

export const dynamic = 'force-dynamic';

/** Whether mail is configured, without touching the relay. */
export async function GET() {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    return NextResponse.json({
        configured: isEmailEnabled(),
        host: process.env.SMTP_HOST ?? null,
        port: process.env.SMTP_PORT ?? null,
        from: process.env.NOTIFY_FROM_EMAIL ?? null,
    });
}

/**
 * Tests the SMTP settings.
 *
 * Without `to` it only opens a connection and authenticates, so an admin can
 * check credentials without sending anyone a message. With `to` it delivers a
 * single test email — always to the caller's own address, never an arbitrary
 * one, so this cannot be turned into a way to send mail to third parties.
 */
export async function POST(request: NextRequest) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    let body: { send?: boolean };
    try {
        body = await request.json();
    } catch {
        body = {};
    }

    try {
        if (!body.send) {
            const result = await verifySmtp();
            return NextResponse.json(result, { status: result.ok ? 200 : 400 });
        }

        const result = await sendMail({
            to: auth.user.email,
            subject: 'Safety Evals: SMTP test',
            text:
                'This is a test message from Safety Evals.\n\n' +
                'If you are reading it, assignment notifications will reach your experts.',
        });

        return NextResponse.json(
            { ...result, sentTo: result.ok ? auth.user.email : undefined },
            { status: result.ok ? 200 : 400 },
        );
    } catch (error) {
        return badRequest(error);
    }
}
