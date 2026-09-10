'use client';

import { useCallback, useEffect, useState } from 'react';
import {
    Users,
    Play,
    Wrench,
    Trash2,
    Loader2,
    RefreshCw,
    FileSpreadsheet,
    Share2,
    ListChecks,
} from 'lucide-react';
import {
    callApi,
    Notice,
    Panel,
    inputClass,
    primaryButtonClass,
    subtleButtonClass,
} from './ui';
import { QuestionsPanel } from './QuestionsPanel';
import { AssignmentsPanel } from './AssignmentsPanel';
import { DistributePanel } from './DistributePanel';

type Role = 'admin' | 'member' | 'expert';

interface AccessEntry {
    email: string;
    role: Role;
    addedAt: string;
    addedBy: string;
    lastLoginAt?: string;
    fromEnv?: boolean;
}

interface RunInfo {
    runLabel: string;
    timestamp: string | null;
    fileName: string;
}

interface BlueprintInfo {
    configId: string;
    runs: RunInfo[];
    error: string | null;
}

type TabId =
    | 'users'
    | 'questions'
    | 'distribute'
    | 'assignments'
    | 'runs'
    | 'maintenance'
    | 'data';

const TABS: { id: TabId; label: string; icon: typeof Users }[] = [
    { id: 'users', label: 'Users', icon: Users },
    { id: 'questions', label: 'Questions', icon: FileSpreadsheet },
    { id: 'distribute', label: 'Distribute', icon: Share2 },
    { id: 'assignments', label: 'Assignments', icon: ListChecks },
    { id: 'runs', label: 'Trigger run', icon: Play },
    { id: 'maintenance', label: 'Maintenance', icon: Wrench },
    { id: 'data', label: 'Data', icon: Trash2 },
];

function UsersPanel({ currentUserEmail }: { currentUserEmail: string }) {
    const [entries, setEntries] = useState<AccessEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [email, setEmail] = useState('');
    const [role, setRole] = useState<Role>('member');
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await callApi('/api/admin/users');
            setEntries(data.entries ?? []);
            setError(null);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const run = async (action: () => Promise<void>, message: string) => {
        setBusy(true);
        setError(null);
        setSuccess(null);
        try {
            await action();
            setSuccess(message);
            await load();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Panel
            title="Access list"
            description="Only these addresses can sign in. Entries seeded from the server environment are marked and cannot be changed here."
        >
            <form
                className="flex flex-col gap-3 sm:flex-row"
                onSubmit={(event) => {
                    event.preventDefault();
                    const target = email.trim();
                    if (!target) return;
                    void run(async () => {
                        await callApi('/api/admin/users', {
                            method: 'POST',
                            body: JSON.stringify({ email: target, role }),
                        });
                        setEmail('');
                    }, `Granted ${role} access to ${target}.`);
                }}
            >
                <input
                    type="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="person@example.com"
                    className={inputClass + ' sm:flex-1'}
                />
                <select
                    value={role}
                    onChange={(event) => setRole(event.target.value as Role)}
                    className={inputClass + ' sm:w-40'}
                >
                    <option value="member">Member</option>
                    <option value="expert">Expert</option>
                    <option value="admin">Admin</option>
                </select>
                <button type="submit" disabled={busy} className={primaryButtonClass}>
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                    Add
                </button>
            </form>

            {error && <Notice kind="error">{error}</Notice>}
            {success && <Notice kind="success">{success}</Notice>}

            <div className="mt-6 overflow-x-auto">
                {loading ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                ) : (
                    <table className="w-full min-w-[640px] text-sm">
                        <thead>
                            <tr className="border-b border-[#f2eaea] text-left text-xs uppercase tracking-wide text-muted-foreground">
                                <th className="pb-2 font-medium">Email</th>
                                <th className="pb-2 font-medium">Role</th>
                                <th className="pb-2 font-medium">Last sign-in</th>
                                <th className="pb-2 font-medium text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {entries.map((entry) => {
                                const isSelf = entry.email === currentUserEmail;
                                return (
                                    <tr key={entry.email} className="border-b border-[#f6f1f1] last:border-0">
                                        <td className="py-3 pr-4">
                                            <span className="font-medium text-foreground">{entry.email}</span>
                                            {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                                            {entry.fromEnv && (
                                                <span className="ml-2 rounded bg-[#005B4A]/8 px-1.5 py-0.5 text-[10px] font-medium text-[#005B4A]">
                                                    from env
                                                </span>
                                            )}
                                        </td>
                                        <td className="py-3 pr-4">
                                            <span
                                                className={
                                                    entry.role === 'admin'
                                                        ? 'rounded-full bg-[#005B4A]/10 px-2 py-0.5 text-xs font-medium text-[#005B4A]'
                                                        : entry.role === 'expert'
                                                          ? 'rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700'
                                                          : 'text-xs text-muted-foreground'
                                                }
                                            >
                                                {entry.role}
                                            </span>
                                        </td>
                                        <td className="py-3 pr-4 text-xs text-muted-foreground">
                                            {entry.lastLoginAt
                                                ? new Date(entry.lastLoginAt).toLocaleString()
                                                : 'never'}
                                        </td>
                                        <td className="py-3 text-right">
                                            <div className="flex justify-end gap-2">
                                                {!entry.fromEnv && !isSelf && (
                                                    <select
                                                        disabled={busy}
                                                        value={entry.role}
                                                        aria-label={`Role for ${entry.email}`}
                                                        className="rounded-lg border border-[#dadce0] bg-white px-2 py-1.5 text-xs font-medium text-foreground disabled:opacity-60"
                                                        onChange={(event) => {
                                                            const nextRole = event.target.value as Role;
                                                            if (nextRole === entry.role) return;
                                                            void run(
                                                                () =>
                                                                    callApi('/api/admin/users', {
                                                                        method: 'PATCH',
                                                                        body: JSON.stringify({
                                                                            email: entry.email,
                                                                            role: nextRole,
                                                                        }),
                                                                    }),
                                                                `${entry.email} is now ${nextRole === 'admin' ? 'an' : 'a'} ${nextRole}.`,
                                                            );
                                                        }}
                                                    >
                                                        <option value="member">Member</option>
                                                        <option value="expert">Expert</option>
                                                        <option value="admin">Admin</option>
                                                    </select>
                                                )}
                                                {!entry.fromEnv && !isSelf && (
                                                    <button
                                                        disabled={busy}
                                                        className={subtleButtonClass + ' text-red-700 hover:bg-red-50'}
                                                        onClick={() => {
                                                            if (
                                                                !window.confirm(
                                                                    `Revoke access for ${entry.email}?`,
                                                                )
                                                            )
                                                                return;
                                                            void run(
                                                                () =>
                                                                    callApi(
                                                                        `/api/admin/users?email=${encodeURIComponent(entry.email)}`,
                                                                        { method: 'DELETE' },
                                                                    ),
                                                                `Removed ${entry.email}.`,
                                                            );
                                                        }}
                                                    >
                                                        Remove
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </Panel>
    );
}

function RunsPanel() {
    const [examples, setExamples] = useState<string[]>([]);
    const [examplePath, setExamplePath] = useState('');
    const [blueprint, setBlueprint] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<{ runId: string; viewUrl: string } | null>(null);

    useEffect(() => {
        callApi('/api/admin/runs')
            .then((data) => setExamples(data.examples ?? []))
            .catch((err) => setError(err.message));
    }, []);

    const submit = async () => {
        setBusy(true);
        setError(null);
        setResult(null);
        try {
            const data = await callApi('/api/admin/runs', {
                method: 'POST',
                body: JSON.stringify(
                    blueprint.trim() ? { blueprint } : { examplePath },
                ),
            });
            setResult({ runId: data.runId, viewUrl: data.viewUrl });
        } catch (err: any) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Panel
            title="Trigger an evaluation run"
            description="Launches a run in the background using the same execution path as the public API. Runs call model providers and cost money."
        >
            <label className="block text-sm font-medium text-foreground">Example blueprint</label>
            <select
                value={examplePath}
                onChange={(event) => setExamplePath(event.target.value)}
                disabled={Boolean(blueprint.trim())}
                className={inputClass + ' mt-2'}
            >
                <option value="">Select a blueprint from examples/…</option>
                {examples.map((example) => (
                    <option key={example} value={example}>
                        {example}
                    </option>
                ))}
            </select>

            <div className="mt-6">
                <label className="block text-sm font-medium text-foreground">
                    Or paste a blueprint (YAML or JSON)
                </label>
                <textarea
                    value={blueprint}
                    onChange={(event) => setBlueprint(event.target.value)}
                    rows={10}
                    spellCheck={false}
                    placeholder={'title: "My case"\nmodels: [openrouter:openai/gpt-4o]\n---\n- id: example\n  messages:\n    - user: "…"'}
                    className={inputClass + ' mt-2 font-mono text-xs'}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                    Pasted content takes priority over the dropdown. A blueprint must list at least one
                    model and one prompt.
                </p>
            </div>

            <button
                onClick={() => void submit()}
                disabled={busy || (!examplePath && !blueprint.trim())}
                className={primaryButtonClass + ' mt-6'}
            >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Start run
            </button>

            {error && <Notice kind="error">{error}</Notice>}
            {result && (
                <Notice kind="success">
                    Run started. Run ID <code className="font-mono">{result.runId}</code>.{' '}
                    {result.viewUrl && (
                        <a className="underline" href={result.viewUrl}>
                            Track its progress
                        </a>
                    )}
                </Notice>
            )}
        </Panel>
    );
}

function MaintenancePanel() {
    const [configId, setConfigId] = useState('');
    const [dryRun, setDryRun] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [log, setLog] = useState<string[] | null>(null);

    const submit = async () => {
        setBusy(true);
        setError(null);
        setLog(null);
        try {
            const data = await callApi('/api/admin/maintenance', {
                method: 'POST',
                body: JSON.stringify({
                    task: 'backfill-summary',
                    configId: configId.trim() || undefined,
                    dryRun,
                }),
            });
            setLog(data.log ?? []);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Panel
            title="Rebuild summaries"
            description="Regenerates the config, homepage and latest-run summaries from stored result files. Safe to re-run, and required after runs are added or removed outside the app."
        >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <input
                    value={configId}
                    onChange={(event) => setConfigId(event.target.value)}
                    placeholder="Optional: a single configId"
                    className={inputClass + ' sm:flex-1'}
                />
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                        type="checkbox"
                        checked={dryRun}
                        onChange={(event) => setDryRun(event.target.checked)}
                    />
                    Dry run
                </label>
                <button onClick={() => void submit()} disabled={busy} className={primaryButtonClass}>
                    {busy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <RefreshCw className="h-4 w-4" />
                    )}
                    Rebuild
                </button>
            </div>

            {error && <Notice kind="error">{error}</Notice>}

            {log && (
                <div className="mt-4">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Output
                    </div>
                    <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-[#1f2321] p-4 text-xs leading-relaxed text-[#e6e6e6]">
                        {log.join('\n') || '(no output)'}
                    </pre>
                </div>
            )}
        </Panel>
    );
}

function DataPanel() {
    const [blueprints, setBlueprints] = useState<BlueprintInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await callApi('/api/admin/blueprints');
            setBlueprints(data.blueprints ?? []);
            setError(null);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const destroy = async (url: string, message: string) => {
        setBusy(true);
        setError(null);
        setSuccess(null);
        try {
            await callApi(url, { method: 'DELETE' });
            setSuccess(message);
            await load();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Panel
            title="Stored evaluation data"
            description="Deleting is permanent. Removing a blueprint removes every run it contains. Rebuild summaries afterwards so the listings match."
        >
            {error && <Notice kind="error">{error}</Notice>}
            {success && <Notice kind="success">{success}</Notice>}

            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : blueprints.length === 0 ? (
                <p className="text-sm text-muted-foreground">No stored blueprints.</p>
            ) : (
                <div className="space-y-4">
                    {blueprints.map((blueprint) => (
                        <div key={blueprint.configId} className="rounded-lg border border-[#f2eaea] p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="font-mono text-sm font-medium text-foreground break-all">
                                        {blueprint.configId}
                                    </div>
                                    <div className="mt-1 text-xs text-muted-foreground">
                                        {blueprint.runs.length} run{blueprint.runs.length === 1 ? '' : 's'}
                                        {blueprint.error && ` — ${blueprint.error}`}
                                    </div>
                                </div>
                                <button
                                    disabled={busy}
                                    className={subtleButtonClass + ' text-red-700 hover:bg-red-50'}
                                    onClick={() => {
                                        const typed = window.prompt(
                                            `This permanently deletes "${blueprint.configId}" and all ${blueprint.runs.length} of its runs.\n\nType the configId to confirm:`,
                                        );
                                        if (typed !== blueprint.configId) return;
                                        void destroy(
                                            `/api/admin/blueprints?configId=${encodeURIComponent(blueprint.configId)}&confirm=${encodeURIComponent(blueprint.configId)}`,
                                            `Deleted blueprint ${blueprint.configId}.`,
                                        );
                                    }}
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    Delete blueprint
                                </button>
                            </div>

                            {blueprint.runs.length > 0 && (
                                <ul className="mt-4 space-y-2 border-t border-[#f6f1f1] pt-3">
                                    {blueprint.runs.map((run) => (
                                        <li
                                            key={run.fileName}
                                            className="flex flex-wrap items-center justify-between gap-2 text-xs"
                                        >
                                            <span className="font-mono text-muted-foreground break-all">
                                                {run.runLabel} · {run.timestamp ?? 'no timestamp'}
                                            </span>
                                            <button
                                                disabled={busy}
                                                className={subtleButtonClass + ' text-red-700 hover:bg-red-50'}
                                                onClick={() => {
                                                    if (
                                                        !window.confirm(
                                                            `Permanently delete this run?\n\n${run.fileName}`,
                                                        )
                                                    )
                                                        return;
                                                    void destroy(
                                                        `/api/admin/blueprints?configId=${encodeURIComponent(blueprint.configId)}&fileName=${encodeURIComponent(run.fileName)}&confirm=${encodeURIComponent(blueprint.configId)}`,
                                                        `Deleted run ${run.fileName}.`,
                                                    );
                                                }}
                                            >
                                                Delete run
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </Panel>
    );
}

export function AdminDashboard({ currentUserEmail }: { currentUserEmail: string }) {
    const [tab, setTab] = useState<TabId>('users');

    return (
        <div>
            <div className="flex flex-wrap gap-2 border-b border-[#f2eaea] pb-3">
                {TABS.map((entry) => {
                    const active = entry.id === tab;
                    return (
                        <button
                            key={entry.id}
                            onClick={() => setTab(entry.id)}
                            className={
                                'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ' +
                                (active
                                    ? 'bg-[#005B4A] text-white'
                                    : 'text-muted-foreground hover:bg-[#005B4A]/5 hover:text-foreground')
                            }
                        >
                            <entry.icon className="h-4 w-4" />
                            {entry.label}
                        </button>
                    );
                })}
            </div>

            <div className="mt-6">
                {tab === 'users' && <UsersPanel currentUserEmail={currentUserEmail} />}
                {tab === 'questions' && <QuestionsPanel />}
                {tab === 'distribute' && <DistributePanel />}
                {tab === 'assignments' && <AssignmentsPanel />}
                {tab === 'runs' && <RunsPanel />}
                {tab === 'maintenance' && <MaintenancePanel />}
                {tab === 'data' && <DataPanel />}
            </div>
        </div>
    );
}
