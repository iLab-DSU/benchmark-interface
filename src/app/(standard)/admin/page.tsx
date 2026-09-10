import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getVerifiedUser } from '@/lib/auth/server';
import { AdminDashboard } from './AdminDashboard';

export const metadata: Metadata = {
    title: 'Admin — Safety Evals',
    robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
    // The middleware already enforces this. Repeated here so the page is still
    // safe if it is ever rendered through a path the matcher does not cover.
    const user = await getVerifiedUser();
    if (!user) redirect('/login?returnTo=/admin');
    if (user.role !== 'admin') redirect('/login?error=not_admin');

    return (
        <div className="px-4 sm:px-6 lg:px-8 py-12">
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground">Admin</h1>
                <p className="mt-2 text-muted-foreground">
                    Signed in as {user.email}. Actions here affect stored evaluation data and who can reach
                    it.
                </p>
            </div>

            <div className="mt-10">
                <AdminDashboard currentUserEmail={user.email} />
            </div>
        </div>
    );
}
