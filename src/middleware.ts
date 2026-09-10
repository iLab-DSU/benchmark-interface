import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, readSessionFromCookieValue } from '@/lib/auth/session';

/**
 * Route gating.
 *
 * The landing page and the sign-in flow are public. Everything that exposes
 * evaluation content — analysis views, the comparison and runs APIs, the eval
 * card API — requires a signed-in user, because those surfaces render the
 * crisis and self-harm case material.
 *
 * /api/v1/* is deliberately NOT gated here: it is the machine-facing public API
 * and already authenticates with its own bearer token (PUBLIC_API_KEY). Adding
 * a cookie check would break existing integrations without improving anything.
 */

const PUBLIC_PATHS = ['/', '/login'];

const PUBLIC_PREFIXES = [
    '/api/auth/',
    '/api/v1/',
    '/_next/',
    '/static/',
];

const PUBLIC_FILES = ['/favicon.ico', '/icon', '/opengraph-image', '/robots.txt', '/sitemap.xml'];

const ADMIN_PREFIXES = ['/admin', '/api/admin'];

/**
 * Evaluation results. Experts are kept out on purpose: someone authoring the
 * criteria a model will be judged against should not first read how existing
 * models answered, or their criteria describe what they saw rather than what
 * good care looks like.
 */
const RESULTS_PREFIXES = [
    '/analysis',
    '/api-run',
    '/api/comparison',
    '/api/runs',
    '/eval-card-api',
];

function matchesPrefix(pathname: string, prefixes: string[]): boolean {
    return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'));
}

function isPublic(pathname: string): boolean {
    if (PUBLIC_PATHS.includes(pathname)) return true;
    if (PUBLIC_FILES.some((file) => pathname === file || pathname.startsWith(file + '/'))) return true;
    return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isApiPath(pathname: string): boolean {
    return pathname.startsWith('/api/') || pathname.startsWith('/eval-card-api/');
}

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    if (isPublic(pathname)) return NextResponse.next();

    const session = await readSessionFromCookieValue(request.cookies.get(SESSION_COOKIE_NAME)?.value);
    const user = session?.user;

    if (!user) {
        if (isApiPath(pathname)) {
            return NextResponse.json({ error: 'Unauthorized: sign-in required' }, { status: 401 });
        }
        const loginUrl = new URL('/login', request.url);
        loginUrl.searchParams.set('returnTo', pathname + request.nextUrl.search);
        return NextResponse.redirect(loginUrl);
    }

    if (matchesPrefix(pathname, ADMIN_PREFIXES) && user.role !== 'admin') {
        if (isApiPath(pathname)) {
            return NextResponse.json({ error: 'Forbidden: admin role required' }, { status: 403 });
        }
        return NextResponse.redirect(new URL('/login?error=not_admin', request.url));
    }

    if (matchesPrefix(pathname, RESULTS_PREFIXES) && user.role === 'expert') {
        if (isApiPath(pathname)) {
            return NextResponse.json(
                { error: 'Forbidden: evaluation results are not available to expert accounts' },
                { status: 403 },
            );
        }
        return NextResponse.redirect(new URL('/expert', request.url));
    }

    return NextResponse.next();
}

export const config = {
    /*
     * Everything except Next internals and static assets. Those are matched out
     * here rather than in isPublic so the middleware never even runs for them.
     */
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
