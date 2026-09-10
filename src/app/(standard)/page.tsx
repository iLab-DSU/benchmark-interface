import Link from 'next/link';
import type { Metadata } from 'next';
import {
    ShieldCheck,
    MessagesSquare,
    Gavel,
    ArrowRight,
    CircleCheck,
    CircleX,
    TriangleAlert,
} from 'lucide-react';
import { getVerifiedUser } from '@/lib/auth/server';
import { GoogleSignInButton } from '@/app/components/auth/GoogleSignInButton';

const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3172';

export const metadata: Metadata = {
    title: 'Safety Evals — testing how models handle crisis conversations',
    description:
        'A self-hosted harness for testing how language models handle nuanced safety scenarios, principally mental-health crisis conversations, where a response can be fluent, on-topic and still dangerous.',
    openGraph: {
        title: 'Safety Evals',
        description:
            'Testing how language models handle nuanced safety scenarios — where a response can be fluent, on-topic and still dangerous.',
        url: appUrl,
        siteName: 'Safety Evals',
        type: 'website',
    },
};

const STEPS = [
    {
        icon: MessagesSquare,
        title: 'Describe a scenario',
        body: 'A blueprint is a conversation plus the criteria a safe reply must satisfy, written in plain English. Multi-turn by design.',
    },
    {
        icon: ShieldCheck,
        title: 'Run it against models',
        body: 'The harness replays the conversation against every model you list, capturing each response exactly as a user would receive it.',
    },
    {
        icon: Gavel,
        title: 'Judge and rule',
        body: 'A three-model consensus panel scores every criterion independently, then a strict pass/fail verdict is derived from the results.',
    },
];

const CASE_SHAPE = [
    'User discloses intent to self-harm.',
    'Assistant responds supportively.',
    'Conversation moves to small talk.',
    'User asks a question that is innocuous on its own.',
];

const VERDICTS = [
    {
        icon: CircleCheck,
        label: 'PASS',
        tone: 'text-emerald-700 bg-emerald-50 border-emerald-200',
        body: 'Every critical criterion was met.',
    },
    {
        icon: CircleX,
        label: 'FAIL',
        tone: 'text-red-700 bg-red-50 border-red-200',
        body: 'At least one critical criterion was not met.',
    },
    {
        icon: TriangleAlert,
        label: 'ERROR',
        tone: 'text-amber-700 bg-amber-50 border-amber-200',
        body: 'The case was never actually evaluated, so it is not evidence of safety.',
    },
];

export default async function LandingPage() {
    const user = await getVerifiedUser();
    // Experts cannot reach /analysis, so point them at their own workspace.
    const primaryHref = user?.role === 'expert' ? '/expert' : '/analysis';
    const primaryLabel = user?.role === 'expert' ? 'Open my assignments' : 'Browse evaluations';

    return (
        <div className="w-full">
            <section className="px-4 sm:px-6 lg:px-8 pt-16 pb-20 sm:pt-24 sm:pb-28">
                <div className="max-w-3xl">
                    <span className="inline-flex items-center gap-2 rounded-full border border-[#005B4A]/20 bg-[#005B4A]/5 px-3 py-1 text-xs font-medium text-[#005B4A]">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Self-hosted safety evaluation
                    </span>

                    <h1 className="mt-6 text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-foreground">
                        A response can be fluent, on-topic,
                        <span className="text-[#005B4A]"> and still dangerous.</span>
                    </h1>

                    <p className="mt-6 text-lg sm:text-xl text-muted-foreground leading-relaxed">
                        Safety Evals is a harness for testing how language models handle nuanced safety
                        scenarios — principally mental-health crisis conversations. It scores what a model
                        actually said against criteria you write, and rules on it strictly.
                    </p>

                    <div className="mt-10 flex flex-col sm:flex-row gap-3 sm:items-center">
                        {user ? (
                            <>
                                <Link
                                    href={primaryHref}
                                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#005B4A] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#004a3c]"
                                >
                                    {primaryLabel}
                                    <ArrowRight className="h-4 w-4" />
                                </Link>
                                <span className="text-sm text-muted-foreground">
                                    Signed in as {user.email}
                                </span>
                            </>
                        ) : (
                            <>
                                <GoogleSignInButton returnTo="/analysis" />
                                <span className="text-sm text-muted-foreground">
                                    Access is limited to approved accounts.
                                </span>
                            </>
                        )}
                    </div>
                </div>
            </section>

            <section className="px-4 sm:px-6 lg:px-8 py-16 border-t border-[#f2eaea]">
                <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
                    <div>
                        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                            The danger usually lives in an earlier turn
                        </h2>
                        <p className="mt-4 text-muted-foreground leading-relaxed">
                            Single-turn benchmarks miss the cases that matter most. A model can decline a
                            risky request perfectly well in isolation, and still fail badly when the same
                            request follows a disclosure it was supposed to be holding on to.
                        </p>
                        <p className="mt-4 text-muted-foreground leading-relaxed">
                            That is what these blueprints test: whether the model connects a later question
                            back to what was established several turns ago — not whether it can produce a
                            safety disclaimer on demand.
                        </p>
                    </div>

                    <div className="rounded-xl border border-[#f2eaea] bg-white/60 p-6">
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Shape of a case
                        </div>
                        <ol className="mt-4 space-y-3 text-sm">
                            {CASE_SHAPE.map((line, index) => (
                                <li key={line} className="flex gap-3">
                                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#005B4A]/10 text-[11px] font-semibold text-[#005B4A]">
                                        {index + 1}
                                    </span>
                                    <span className="text-muted-foreground">{line}</span>
                                </li>
                            ))}
                        </ol>
                        <div className="mt-5 border-t border-[#f2eaea] pt-4 text-sm text-foreground">
                            Did the model notice the connection? That is the criterion — and it is the one a
                            coverage average is most likely to round away.
                        </div>
                    </div>
                </div>
            </section>

            <section className="px-4 sm:px-6 lg:px-8 py-16 border-t border-[#f2eaea]">
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                    How it works
                </h2>
                <div className="mt-10 grid gap-8 sm:grid-cols-3">
                    {STEPS.map((step) => (
                        <div key={step.title}>
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#005B4A]/10">
                                <step.icon className="h-5 w-5 text-[#005B4A]" />
                            </div>
                            <h3 className="mt-4 font-semibold text-foreground">{step.title}</h3>
                            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{step.body}</p>
                        </div>
                    ))}
                </div>
            </section>

            <section className="px-4 sm:px-6 lg:px-8 py-16 border-t border-[#f2eaea]">
                <div className="max-w-3xl">
                    <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                        Strict verdicts, not averages
                    </h2>
                    <p className="mt-4 text-muted-foreground leading-relaxed">
                        Averaging a prompt&apos;s criteria into one coverage score means a model satisfying
                        three of four scores about 0.75. For safety work that is the wrong shape. Failing to
                        refuse a request for means of self-harm is not a 25% deduction — it is a failure.
                    </p>
                    <p className="mt-4 text-muted-foreground leading-relaxed">
                        You mark the criteria that must never fail, and every case resolves to one of three
                        outcomes:
                    </p>
                </div>

                <div className="mt-8 grid gap-4 sm:grid-cols-3 max-w-4xl">
                    {VERDICTS.map((verdict) => (
                        <div key={verdict.label} className={`rounded-xl border p-5 ${verdict.tone}`}>
                            <div className="flex items-center gap-2">
                                <verdict.icon className="h-4 w-4" />
                                <span className="font-mono text-sm font-bold">{verdict.label}</span>
                            </div>
                            <p className="mt-2 text-sm opacity-90">{verdict.body}</p>
                        </div>
                    ))}
                </div>

                <p className="mt-6 max-w-3xl text-sm text-muted-foreground">
                    <strong className="text-foreground">ERROR is deliberately distinct from FAIL.</strong> A
                    generation or judgement that failed means the case was never tested — and an untested
                    case must never be reported as safe.
                </p>
            </section>

            <section className="px-4 sm:px-6 lg:px-8 py-16 border-t border-[#f2eaea]">
                <div className="rounded-2xl bg-[#005B4A] px-6 py-12 sm:px-12">
                    <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                        {user ? 'Pick up where you left off' : 'Sign in to view evaluations'}
                    </h2>
                    <p className="mt-3 max-w-2xl text-white/80">
                        {user
                            ? 'Browse completed runs, inspect per-criterion judgements, and compare models side by side.'
                            : 'Evaluation results contain crisis and self-harm case material, so access is limited to approved accounts. Ask an administrator to add your address.'}
                    </p>
                    <div className="mt-8">
                        {user ? (
                            <Link
                                href={primaryHref}
                                className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-semibold text-[#005B4A] transition-colors hover:bg-white/90"
                            >
                                {primaryLabel}
                                <ArrowRight className="h-4 w-4" />
                            </Link>
                        ) : (
                            <GoogleSignInButton returnTo="/analysis" variant="onDark" />
                        )}
                    </div>
                </div>
            </section>
        </div>
    );
}
