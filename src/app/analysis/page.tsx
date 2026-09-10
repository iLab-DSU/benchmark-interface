import Link from 'next/link';
import type { Metadata } from 'next';
import { FolderOpen, ArrowRight } from 'lucide-react';
import { getComparisonRunInfo } from '@/app/utils/homepageDataUtils';
import { fromSafeTimestamp } from '@/lib/timestampUtils';

export const metadata: Metadata = {
    title: 'Evaluations — Safety Evals',
    robots: { index: false, follow: false },
};

// Access-gated and backed by files that change whenever a run completes, so
// there is nothing useful to cache at the page level.
export const dynamic = 'force-dynamic';

function formatTimestamp(timestamp: string | undefined): string {
    if (!timestamp) return 'unknown date';
    try {
        const date = new Date(fromSafeTimestamp(timestamp));
        if (Number.isNaN(date.getTime())) return timestamp;
        return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
        return timestamp;
    }
}

export default async function AnalysisIndexPage() {
    let configs: Awaited<ReturnType<typeof getComparisonRunInfo>> = [];
    let loadError: string | null = null;

    try {
        configs = await getComparisonRunInfo();
    } catch (error: any) {
        loadError = error?.message ?? 'Could not load evaluations.';
    }

    const sorted = [...configs].sort((a, b) =>
        (b.latestRunTimestamp ?? '').localeCompare(a.latestRunTimestamp ?? ''),
    );

    return (
        <div className="px-4 sm:px-6 lg:px-8 py-12">
            <div className="flex items-baseline justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">Evaluations</h1>
                    <p className="mt-2 text-muted-foreground">
                        Every blueprint with at least one completed run.
                    </p>
                </div>
                <span className="text-sm text-muted-foreground">
                    {sorted.length} blueprint{sorted.length === 1 ? '' : 's'}
                </span>
            </div>

            {loadError && (
                <div className="mt-8 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                    {loadError}
                </div>
            )}

            {!loadError && sorted.length === 0 && (
                <div className="mt-8 rounded-xl border border-[#f2eaea] bg-white/60 p-8 text-center">
                    <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground" />
                    <h2 className="mt-4 font-semibold text-foreground">No evaluations yet</h2>
                    <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground leading-relaxed">
                        Run a blueprint with the CLI, or trigger one from the admin area. If runs already
                        exist, rebuild the summaries from Admin → Maintenance.
                    </p>
                </div>
            )}

            <div className="mt-8 grid gap-4">
                {sorted.map((config) => {
                    const latestRun = config.runs?.[0];
                    const href = latestRun
                        ? `/analysis/${config.configId}/${latestRun.runLabel}/${latestRun.timestamp}`
                        : `/analysis/${config.configId}`;

                    return (
                        <Link
                            key={config.configId}
                            href={href}
                            className="group rounded-xl border border-[#f2eaea] bg-white/60 p-5 transition-colors hover:border-[#005B4A]/30 hover:bg-white"
                        >
                            <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                    <h2 className="font-semibold text-foreground truncate">
                                        {config.configTitle || config.title || config.configId}
                                    </h2>
                                    {config.description && (
                                        <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                                            {config.description}
                                        </p>
                                    )}
                                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                        <span>
                                            {config.runs?.length ?? 0} run
                                            {(config.runs?.length ?? 0) === 1 ? '' : 's'}
                                        </span>
                                        <span>Latest: {formatTimestamp(config.latestRunTimestamp)}</span>
                                        {typeof config.overallAverageHybridScore === 'number' && (
                                            <span>
                                                Avg coverage:{' '}
                                                {config.overallAverageHybridScore.toFixed(2)}
                                            </span>
                                        )}
                                    </div>
                                    {config.tags && config.tags.length > 0 && (
                                        <div className="mt-3 flex flex-wrap gap-1.5">
                                            {config.tags.map((tag) => (
                                                <span
                                                    key={tag}
                                                    className="rounded-full bg-[#005B4A]/8 px-2 py-0.5 text-[11px] font-medium text-[#005B4A]"
                                                >
                                                    {tag}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-[#005B4A]" />
                            </div>
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}
