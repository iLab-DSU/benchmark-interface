'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Loader2,
    Share2,
    UserPlus,
    X,
    TriangleAlert,
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    Search,
    Wand2,
    Clock,
} from 'lucide-react';
import {
    callApi,
    ApiError,
    Notice,
    Panel,
    inputClass,
    primaryButtonClass,
    subtleButtonClass,
} from './ui';

interface QuestionRow {
    rowNumber: number;
    id: string;
    ref?: string;
    prompt: string;
    intentGroup?: string;
    farmerIntent?: string;
    assignedTo: string[];
}

interface PageData {
    setTitle: string;
    page: number;
    pageCount: number;
    total: number;
    totalInSet: number;
    assignedCount: number;
    unassignedCount: number;
    intentGroups: string[];
    questions: QuestionRow[];
}

interface SetOption {
    id: string;
    title: string;
    questionCount: number;
}

interface ExpertOption {
    email: string;
    valueChains?: string[];
    capacity?: number;
}

interface Parcel {
    key: string;
    email: string;
    questionIds: string[];
    rowNumbers: number[];
    dueAt: string;
}

const PAGE_SIZE = 15;
const MINUTES_PER_QUESTION = 5;

/** Turns "1-28, 30, 40-45" into row numbers. Tolerates spaces and en-dashes. */
export function parseRangeInput(input: string, max: number): number[] {
    const rows = new Set<number>();

    for (const part of input.split(',')) {
        const cleaned = part.trim().replace(/[–—]/g, '-');
        if (!cleaned) continue;

        const range = cleaned.match(/^(\d+)\s*-\s*(\d+)$/);
        if (range) {
            const from = Number(range[1]);
            const to = Number(range[2]);
            // Accepts "28-1" as well as "1-28"; the admin meant a span either way.
            for (let n = Math.min(from, to); n <= Math.max(from, to); n += 1) {
                if (n >= 1 && n <= max) rows.add(n);
            }
            continue;
        }

        const single = Number(cleaned);
        if (Number.isInteger(single) && single >= 1 && single <= max) rows.add(single);
    }

    return [...rows].sort((a, b) => a - b);
}

/** Collapses [1,2,3,7,8] to "1-3, 7-8" so a parcel reads as what was typed. */
export function formatRanges(rows: number[]): string {
    if (rows.length === 0) return '';
    const sorted = [...rows].sort((a, b) => a - b);
    const parts: string[] = [];
    let start = sorted[0];
    let previous = sorted[0];

    for (const row of sorted.slice(1)) {
        if (row === previous + 1) {
            previous = row;
            continue;
        }
        parts.push(start === previous ? `${start}` : `${start}-${previous}`);
        start = row;
        previous = row;
    }
    parts.push(start === previous ? `${start}` : `${start}-${previous}`);
    return parts.join(', ');
}

/** Coarse, and meant to be: it exists to stop an admin assigning a working week by accident. */
function hoursFor(count: number): string {
    const hours = (count * MINUTES_PER_QUESTION) / 60;
    if (hours < 1) return `${Math.round(hours * 60)} min`;
    return `${Math.round(hours * 10) / 10} h`;
}

export function DistributePanel() {
    const [sets, setSets] = useState<SetOption[]>([]);
    const [experts, setExperts] = useState<ExpertOption[]>([]);
    const [setId, setSetId] = useState('');
    const [data, setData] = useState<PageData | null>(null);
    const [page, setPage] = useState(1);
    const [intentGroup, setIntentGroup] = useState('');
    const [search, setSearch] = useState('');
    const [hideAssigned, setHideAssigned] = useState(false);

    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [rowById, setRowById] = useState<Map<string, number>>(new Map());
    const [rangeInput, setRangeInput] = useState('');
    const [assignee, setAssignee] = useState('');
    const [dueAt, setDueAt] = useState('');
    const [parcels, setParcels] = useState<Parcel[]>([]);

    const [autoPanel, setAutoPanel] = useState<string[]>([]);
    const [autoStrategy, setAutoStrategy] = useState<'split' | 'overlap'>('overlap');
    const [autoCoverage, setAutoCoverage] = useState(2);

    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [pendingWarnings, setPendingWarnings] = useState<Array<{ message: string }> | null>(null);
    const batchKey = useRef<string | null>(null);
    const lastClicked = useRef<number | null>(null);

    /**
     * Questions already staged this session.
     *
     * They are not assigned yet, so the server cannot warn about them — but
     * offering them again would let the admin give one question to two people
     * without noticing.
     */
    const staged = useMemo(() => {
        const ids = new Set<string>();
        for (const parcel of parcels) for (const id of parcel.questionIds) ids.add(id);
        return ids;
    }, [parcels]);

    useEffect(() => {
        void (async () => {
            try {
                const [setsData, usersData] = await Promise.all([
                    callApi('/api/admin/question-sets'),
                    callApi('/api/admin/users'),
                ]);
                setSets(setsData.sets ?? []);
                setExperts(
                    (usersData.users ?? usersData.entries ?? []).filter(
                        (user: any) => user.role === 'expert',
                    ),
                );
            } catch (err: any) {
                setError(err.message);
            }
        })();
    }, []);

    const loadPage = useCallback(async () => {
        if (!setId) {
            setData(null);
            return;
        }
        setLoading(true);
        try {
            const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
            if (intentGroup) params.set('intentGroup', intentGroup);
            if (hideAssigned) params.set('unassigned', 'true');
            if (search.trim()) params.set('search', search.trim());

            const result = await callApi(
                `/api/admin/question-sets/${setId}/questions?${params.toString()}`,
            );
            setData(result);
            setRowById((current) => {
                const next = new Map(current);
                for (const question of result.questions as QuestionRow[]) {
                    next.set(question.id, question.rowNumber);
                }
                return next;
            });
            setError(null);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [setId, page, intentGroup, hideAssigned, search]);

    // Debounced so typing in the search box does not fire a request per keystroke.
    useEffect(() => {
        const timer = setTimeout(() => void loadPage(), search ? 300 : 0);
        return () => clearTimeout(timer);
    }, [loadPage, search]);

    const resetForSet = (id: string) => {
        setSetId(id);
        setPage(1);
        setSelected(new Set());
        setParcels([]);
        setRowById(new Map());
        setSearch('');
        setIntentGroup('');
        setSuccess(null);
        setInfo(null);
        setPendingWarnings(null);
        batchKey.current = null;
        lastClicked.current = null;
    };

    const rows = data?.questions ?? [];
    const isLocked = (question: QuestionRow) =>
        question.assignedTo.length > 0 || staged.has(question.id);
    const selectableOnPage = rows.filter((question) => !isLocked(question));
    const allPageSelected =
        selectableOnPage.length > 0 && selectableOnPage.every((q) => selected.has(q.id));
    const somePageSelected = selectableOnPage.some((q) => selected.has(q.id));

    /** Shift-click extends from the last clicked row, the way a spreadsheet does. */
    const toggle = (question: QuestionRow, shiftKey: boolean) => {
        const index = rows.findIndex((row) => row.id === question.id);

        if (shiftKey && lastClicked.current !== null) {
            const from = Math.min(lastClicked.current, index);
            const to = Math.max(lastClicked.current, index);
            const span = rows.slice(from, to + 1).filter((row) => !isLocked(row));
            setSelected((current) => {
                const next = new Set(current);
                for (const row of span) next.add(row.id);
                return next;
            });
            return;
        }

        lastClicked.current = index;
        setSelected((current) => {
            const next = new Set(current);
            if (next.has(question.id)) next.delete(question.id);
            else next.add(question.id);
            return next;
        });
    };

    const togglePage = () => {
        setSelected((current) => {
            const next = new Set(current);
            for (const question of selectableOnPage) {
                if (allPageSelected) next.delete(question.id);
                else next.add(question.id);
            }
            return next;
        });
    };

    /** Fetches the whole set once, so ranges and auto-split can reach every row. */
    const fetchAllRows = async (): Promise<QuestionRow[]> => {
        const first = await callApi(
            `/api/admin/question-sets/${setId}/questions?page=1&pageSize=100`,
        );
        let all: QuestionRow[] = first.questions;
        for (let p = 2; p <= first.pageCount; p += 1) {
            const more = await callApi(
                `/api/admin/question-sets/${setId}/questions?page=${p}&pageSize=100`,
            );
            all = all.concat(more.questions);
        }
        return all;
    };

    const applyRange = async () => {
        if (!data || !rangeInput.trim()) return;
        const wanted = parseRangeInput(rangeInput, data.totalInSet);
        if (wanted.length === 0) {
            setError(`Nothing in "${rangeInput}" matches rows 1-${data.totalInSet}.`);
            return;
        }

        setBusy(true);
        setError(null);
        try {
            const all = await fetchAllRows();
            const wantedSet = new Set(wanted);
            const matched = all.filter((row) => wantedSet.has(row.rowNumber));
            const available = matched.filter(
                (row) => row.assignedTo.length === 0 && !staged.has(row.id),
            );
            const skipped = matched.length - available.length;

            setRowById((current) => {
                const next = new Map(current);
                for (const row of all) next.set(row.id, row.rowNumber);
                return next;
            });
            setSelected((current) => {
                const next = new Set(current);
                for (const row of available) next.add(row.id);
                return next;
            });
            setInfo(
                skipped > 0
                    ? `Added ${available.length}. Skipped ${skipped} already taken.`
                    : `Added ${available.length} question${available.length === 1 ? '' : 's'}.`,
            );
            setRangeInput('');
        } catch (err: any) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    /**
     * Asks the server to propose a whole division at once.
     *
     * Writes nothing — it fills the same parcel list the admin would build by
     * hand, so an automatic split can still be edited before it is committed.
     */
    const proposeSplit = async () => {
        if (autoPanel.length === 0) return;
        setBusy(true);
        setError(null);
        setInfo(null);
        try {
            const result = await callApi(`/api/admin/question-sets/${setId}/allocate`, {
                method: 'POST',
                body: JSON.stringify({
                    expertEmails: autoPanel,
                    strategy: autoStrategy,
                    coverage: autoCoverage,
                    onlyUnassigned: true,
                    intentGroup: intentGroup || undefined,
                    minutesPerQuestion: MINUTES_PER_QUESTION,
                }),
            });

            setParcels(
                result.parcels.map((parcel: any, index: number) => ({
                    key: `auto-${index}-${Date.now()}`,
                    email: parcel.email,
                    questionIds: parcel.questionIds,
                    rowNumbers: parcel.rowNumbers,
                    dueAt,
                })),
            );
            setSelected(new Set());

            const warned = (result.warnings ?? []).map((w: any) => w.message).join(' ');
            setInfo(
                `Proposed a split of ${result.poolSize} unassigned question(s) — ` +
                    `${result.totalAssignments} answers across ${result.parcels.length} expert(s).` +
                    (warned ? ` ${warned}` : ''),
            );
        } catch (err: any) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const addAssignee = () => {
        if (!assignee || selected.size === 0) return;
        const questionIds = [...selected];
        setParcels((current) => [
            ...current,
            {
                key: `${assignee}-${current.length}-${Date.now()}`,
                email: assignee,
                questionIds,
                rowNumbers: questionIds
                    .map((id) => rowById.get(id) ?? 0)
                    .filter(Boolean)
                    .sort((a, b) => a - b),
                dueAt,
            },
        ]);
        setSelected(new Set());
        setAssignee('');
        setInfo(null);
        setSuccess(null);
    };

    const submit = async (force = false) => {
        if (parcels.length === 0) return;
        setBusy(true);
        setError(null);
        if (!force) setPendingWarnings(null);

        const key = batchKey.current ?? crypto.randomUUID();
        batchKey.current = key;

        try {
            const result = await callApi('/api/admin/assignments/batch', {
                method: 'POST',
                body: JSON.stringify({
                    setId,
                    idempotencyKey: key,
                    force,
                    parcels: parcels.map((parcel) => ({
                        expertEmails: [parcel.email],
                        questionIds: parcel.questionIds,
                        dueAt: parcel.dueAt || undefined,
                    })),
                }),
            });

            const failures: string[] = result.emailFailures ?? [];
            setSuccess(
                `Created ${result.assignments.length} assignment(s) covering ${result.questionCount} question(s).` +
                    (failures.length > 0 ? ` Could not email: ${failures.join(', ')}.` : ''),
            );
            setParcels([]);
            setSelected(new Set());
            setPendingWarnings(null);
            setInfo(null);
            batchKey.current = null;
            await loadPage();
        } catch (err: any) {
            if (err instanceof ApiError && err.status === 409 && err.payload?.needsConfirmation) {
                setPendingWarnings(err.payload.warnings ?? []);
            } else {
                setError(err.message);
                batchKey.current = null;
            }
        } finally {
            setBusy(false);
        }
    };

    const stagedCount = staged.size;
    const totalToAssign = parcels.reduce((sum, parcel) => sum + parcel.questionIds.length, 0);

    return (
        <div className="space-y-6">
            <Panel
                title="Distribute questions"
                description="Split a question set between experts. Let it divide the work for you, or pick rows by hand — either way you can review every share before anything is sent."
            >
                <div className="space-y-5">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                            <label className="text-sm font-medium text-foreground">Question set</label>
                            <select
                                value={setId}
                                onChange={(event) => resetForSet(event.target.value)}
                                className={inputClass + ' mt-2'}
                            >
                                <option value="">Select a set…</option>
                                {sets.map((option) => (
                                    <option key={option.id} value={option.id}>
                                        {option.title} ({option.questionCount})
                                    </option>
                                ))}
                            </select>
                        </div>

                        {data && data.intentGroups.length > 0 && (
                            <div>
                                <label className="text-sm font-medium text-foreground">Category</label>
                                <select
                                    value={intentGroup}
                                    onChange={(event) => {
                                        setIntentGroup(event.target.value);
                                        setPage(1);
                                    }}
                                    className={inputClass + ' mt-2'}
                                >
                                    <option value="">All categories</option>
                                    {data.intentGroups.map((group) => (
                                        <option key={group} value={group}>
                                            {group}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>

                    {data && (
                        <>
                            {/* --- Progress --- */}
                            <div className="rounded-lg border border-[#f6f1f1] bg-[#faf9f6] px-4 py-3">
                                <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                                    <span className="text-foreground">
                                        <span className="font-semibold">{data.assignedCount}</span> of{' '}
                                        <span className="font-semibold">{data.totalInSet}</span> assigned
                                        <span className="text-muted-foreground">
                                            {' '}
                                            · {data.unassignedCount} still free
                                        </span>
                                    </span>
                                    <label className="flex items-center gap-2 text-muted-foreground">
                                        <input
                                            type="checkbox"
                                            checked={hideAssigned}
                                            onChange={(event) => {
                                                setHideAssigned(event.target.checked);
                                                setPage(1);
                                            }}
                                        />
                                        Only show unassigned
                                    </label>
                                </div>
                                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#e9e4e4]">
                                    <div
                                        className="h-full rounded-full bg-[#005B4A] transition-all"
                                        style={{
                                            width: data.assignedCount
                                                ? `${Math.max(2, (data.assignedCount / data.totalInSet) * 100)}%`
                                                : '0%',
                                        }}
                                    />
                                </div>
                            </div>

                            {/* --- Divide it for me --- */}
                            <div className="rounded-lg border border-[#005B4A]/20 bg-[#005B4A]/[0.04] p-4">
                                <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                    <Wand2 className="h-4 w-4" />
                                    Divide it for me
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Splits everything still unassigned between the experts you pick,
                                    balancing the load and keeping related questions together.
                                </p>

                                <div className="mt-3 flex flex-wrap gap-2">
                                    {experts.map((expert) => {
                                        const on = autoPanel.includes(expert.email);
                                        return (
                                            <button
                                                key={expert.email}
                                                type="button"
                                                onClick={() =>
                                                    setAutoPanel((current) =>
                                                        on
                                                            ? current.filter((e) => e !== expert.email)
                                                            : [...current, expert.email],
                                                    )
                                                }
                                                className={
                                                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors ' +
                                                    (on
                                                        ? 'border-[#005B4A] bg-[#005B4A] text-white'
                                                        : 'border-[#dadce0] bg-white text-foreground hover:border-[#005B4A]')
                                                }
                                            >
                                                {expert.email}
                                                {expert.capacity ? ` · max ${expert.capacity}` : ''}
                                            </button>
                                        );
                                    })}
                                    {experts.length === 0 && (
                                        <span className="text-xs text-muted-foreground">
                                            No experts yet — add them under Users.
                                        </span>
                                    )}
                                </div>

                                <div className="mt-3 flex flex-wrap items-end gap-3">
                                    <div>
                                        <label className="block text-xs font-medium text-muted-foreground">
                                            How many experts per question
                                        </label>
                                        <select
                                            value={autoStrategy === 'split' ? '1' : String(autoCoverage)}
                                            onChange={(event) => {
                                                const value = Number(event.target.value);
                                                setAutoStrategy(value === 1 ? 'split' : 'overlap');
                                                setAutoCoverage(value);
                                            }}
                                            className={inputClass + ' mt-1 sm:w-72'}
                                        >
                                            <option value="1">1 — split, no overlap</option>
                                            <option value="2">2 — lets you compare answers</option>
                                            <option value="3">3 — strongest agreement signal</option>
                                        </select>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => void proposeSplit()}
                                        disabled={busy || autoPanel.length === 0}
                                        className={primaryButtonClass}
                                    >
                                        {busy ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Wand2 className="h-4 w-4" />
                                        )}
                                        Propose a split
                                    </button>
                                </div>
                            </div>

                            {/* --- Or pick by hand --- */}
                            <div className="space-y-3">
                                <p className="text-sm font-semibold text-foreground">
                                    Or pick questions yourself
                                </p>

                                <div className="flex flex-wrap items-end gap-2">
                                    <div className="min-w-[180px] flex-1">
                                        <label className="text-xs font-medium text-muted-foreground">
                                            Search
                                        </label>
                                        <div className="relative mt-1">
                                            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                                            <input
                                                value={search}
                                                onChange={(event) => {
                                                    setSearch(event.target.value);
                                                    setPage(1);
                                                }}
                                                placeholder="Find a question…"
                                                className={inputClass + ' pl-9'}
                                            />
                                        </div>
                                    </div>
                                    <div className="min-w-[160px]">
                                        <label className="text-xs font-medium text-muted-foreground">
                                            Rows
                                        </label>
                                        <input
                                            value={rangeInput}
                                            onChange={(event) => setRangeInput(event.target.value)}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter') {
                                                    event.preventDefault();
                                                    void applyRange();
                                                }
                                            }}
                                            placeholder="1-28, 40, 55-60"
                                            className={inputClass + ' mt-1'}
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => void applyRange()}
                                        disabled={busy || !rangeInput.trim()}
                                        className={subtleButtonClass}
                                    >
                                        Add rows
                                    </button>
                                </div>

                                <div className="overflow-x-auto rounded-lg border border-[#f6f1f1]">
                                    <table className="w-full min-w-[680px] text-sm">
                                        <thead className="bg-[#faf9f6] text-left text-xs uppercase tracking-wide text-muted-foreground">
                                            <tr>
                                                <th className="w-10 px-3 py-2">
                                                    <input
                                                        type="checkbox"
                                                        aria-label="Select every free question on this page"
                                                        checked={allPageSelected}
                                                        ref={(node) => {
                                                            if (node) {
                                                                node.indeterminate =
                                                                    somePageSelected && !allPageSelected;
                                                            }
                                                        }}
                                                        disabled={selectableOnPage.length === 0}
                                                        onChange={togglePage}
                                                    />
                                                </th>
                                                <th className="w-12 px-2 py-2">#</th>
                                                <th className="w-24 px-2 py-2">Ref</th>
                                                <th className="px-2 py-2">Question</th>
                                                <th className="w-44 px-2 py-2">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {loading && (
                                                <tr>
                                                    <td colSpan={5} className="px-3 py-8 text-center">
                                                        <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
                                                    </td>
                                                </tr>
                                            )}

                                            {!loading && rows.length === 0 && (
                                                <tr>
                                                    <td
                                                        colSpan={5}
                                                        className="px-3 py-8 text-center text-sm text-muted-foreground"
                                                    >
                                                        {search
                                                            ? `Nothing matches "${search}".`
                                                            : 'Nothing left here — try clearing the filters.'}
                                                    </td>
                                                </tr>
                                            )}

                                            {!loading &&
                                                rows.map((question) => {
                                                    const taken = question.assignedTo.length > 0;
                                                    const inParcel = staged.has(question.id);
                                                    const locked = taken || inParcel;
                                                    const checked = selected.has(question.id);

                                                    return (
                                                        <tr
                                                            key={question.id}
                                                            onClick={(event) => {
                                                                if (locked) return;
                                                                toggle(question, event.shiftKey);
                                                            }}
                                                            className={
                                                                'border-t border-[#f6f1f1] ' +
                                                                (locked
                                                                    ? 'bg-[#faf9f6] text-muted-foreground'
                                                                    : 'cursor-pointer hover:bg-[#005B4A]/[0.03] ') +
                                                                (checked ? 'bg-[#005B4A]/[0.06]' : '')
                                                            }
                                                        >
                                                            <td className="px-3 py-2">
                                                                <input
                                                                    type="checkbox"
                                                                    disabled={locked}
                                                                    checked={checked}
                                                                    onClick={(event) => event.stopPropagation()}
                                                                    onChange={(event) =>
                                                                        toggle(
                                                                            question,
                                                                            (event.nativeEvent as MouseEvent)
                                                                                .shiftKey,
                                                                        )
                                                                    }
                                                                    aria-label={`Select row ${question.rowNumber}`}
                                                                />
                                                            </td>
                                                            <td className="px-2 py-2 tabular-nums">
                                                                {question.rowNumber}
                                                            </td>
                                                            <td className="px-2 py-2">
                                                                {question.ref ?? '—'}
                                                            </td>
                                                            <td className="px-2 py-2">
                                                                <span title={question.prompt}>
                                                                    {question.prompt}
                                                                </span>
                                                                {question.intentGroup && (
                                                                    <span className="mt-0.5 block text-xs text-muted-foreground">
                                                                        {question.intentGroup}
                                                                    </span>
                                                                )}
                                                            </td>
                                                            <td className="px-2 py-2">
                                                                {taken ? (
                                                                    <span
                                                                        className="rounded-full bg-[#005B4A]/10 px-2 py-0.5 text-[11px] font-medium text-[#005B4A]"
                                                                        title={question.assignedTo.join(', ')}
                                                                    >
                                                                        {question.assignedTo[0].split('@')[0]}
                                                                        {question.assignedTo.length > 1
                                                                            ? ` +${question.assignedTo.length - 1}`
                                                                            : ''}
                                                                    </span>
                                                                ) : inParcel ? (
                                                                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">
                                                                        Staged
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-xs text-muted-foreground">
                                                                        Free
                                                                    </span>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                                    <span className="text-muted-foreground">
                                        Showing {rows.length} of {data.total}
                                        {search || intentGroup || hideAssigned ? ' matching' : ''} · tip:
                                        shift-click to select a run of rows
                                    </span>
                                    <div className="flex items-center gap-1">
                                        <button
                                            type="button"
                                            onClick={() => setPage(1)}
                                            disabled={data.page <= 1}
                                            className={subtleButtonClass}
                                            aria-label="First page"
                                        >
                                            <ChevronsLeft className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                                            disabled={data.page <= 1}
                                            className={subtleButtonClass}
                                            aria-label="Previous page"
                                        >
                                            <ChevronLeft className="h-3.5 w-3.5" />
                                        </button>
                                        <span className="px-1 text-muted-foreground">
                                            <input
                                                type="number"
                                                min={1}
                                                max={data.pageCount}
                                                value={data.page}
                                                onChange={(event) => {
                                                    const next = Number(event.target.value);
                                                    if (next >= 1 && next <= data.pageCount) setPage(next);
                                                }}
                                                className="w-14 rounded border border-[#dadce0] px-2 py-1 text-center text-sm"
                                                aria-label="Page number"
                                            />{' '}
                                            of {data.pageCount}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setPage((p) => Math.min(data.pageCount, p + 1))}
                                            disabled={data.page >= data.pageCount}
                                            className={subtleButtonClass}
                                            aria-label="Next page"
                                        >
                                            <ChevronRight className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setPage(data.pageCount)}
                                            disabled={data.page >= data.pageCount}
                                            className={subtleButtonClass}
                                            aria-label="Last page"
                                        >
                                            <ChevronsRight className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* --- Selection bar: only when there is a selection to act on --- */}
                            {selected.size > 0 && (
                                <div className="rounded-lg border border-[#005B4A]/30 bg-white p-4 shadow-sm">
                                    <div className="flex flex-wrap items-end gap-3">
                                        <div className="min-w-[220px] flex-1">
                                            <label className="text-sm font-medium text-foreground">
                                                Give {selected.size} selected question
                                                {selected.size === 1 ? '' : 's'}
                                                <span className="ml-1 text-muted-foreground">
                                                    (~{hoursFor(selected.size)}) to
                                                </span>
                                            </label>
                                            <select
                                                value={assignee}
                                                onChange={(event) => setAssignee(event.target.value)}
                                                className={inputClass + ' mt-2'}
                                            >
                                                <option value="">Choose an expert…</option>
                                                {experts.map((expert) => (
                                                    <option key={expert.email} value={expert.email}>
                                                        {expert.email}
                                                        {expert.valueChains?.length
                                                            ? ` — ${expert.valueChains.join(', ')}`
                                                            : ''}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-sm font-medium text-foreground">
                                                Due
                                            </label>
                                            <input
                                                type="date"
                                                value={dueAt}
                                                onChange={(event) => setDueAt(event.target.value)}
                                                className={inputClass + ' mt-2'}
                                            />
                                        </div>
                                        <button
                                            type="button"
                                            onClick={addAssignee}
                                            disabled={!assignee}
                                            className={primaryButtonClass}
                                        >
                                            <UserPlus className="h-3.5 w-3.5" />
                                            Add assignee
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setSelected(new Set())}
                                            className={subtleButtonClass}
                                        >
                                            Clear
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {/* --- Staged parcels --- */}
                    {parcels.length > 0 && (
                        <div className="rounded-lg border border-[#005B4A]/20 bg-[#005B4A]/5 p-4">
                            <p className="text-sm font-semibold text-foreground">
                                Ready to send — {parcels.length} expert
                                {parcels.length === 1 ? '' : 's'}, {totalToAssign} question
                                {totalToAssign === 1 ? '' : 's'}
                                {stagedCount !== totalToAssign && (
                                    <span className="font-normal text-muted-foreground">
                                        {' '}
                                        ({stagedCount} distinct)
                                    </span>
                                )}
                            </p>
                            <ul className="mt-3 space-y-2">
                                {parcels.map((parcel) => (
                                    <li
                                        key={parcel.key}
                                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm"
                                    >
                                        <div className="min-w-0">
                                            <span className="font-medium text-foreground">
                                                {parcel.email}
                                            </span>
                                            <span className="ml-2 text-muted-foreground">
                                                {parcel.questionIds.length} question
                                                {parcel.questionIds.length === 1 ? '' : 's'}
                                                <span className="inline-flex items-center gap-1">
                                                    {' '}
                                                    · <Clock className="h-3 w-3" />
                                                    {hoursFor(parcel.questionIds.length)}
                                                </span>
                                                {parcel.rowNumbers.length > 0 &&
                                                parcel.rowNumbers.length <= 40
                                                    ? ` · rows ${formatRanges(parcel.rowNumbers)}`
                                                    : ''}
                                                {parcel.dueAt ? ` · due ${parcel.dueAt}` : ''}
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setParcels((current) =>
                                                    current.filter((p) => p.key !== parcel.key),
                                                )
                                            }
                                            className="shrink-0 text-muted-foreground hover:text-foreground"
                                            aria-label={`Remove ${parcel.email}`}
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                    </li>
                                ))}
                            </ul>

                            {pendingWarnings && pendingWarnings.length > 0 ? (
                                <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
                                    <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                                        <TriangleAlert className="h-4 w-4" />
                                        Check these before sending
                                    </p>
                                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
                                        {pendingWarnings.map((warning, index) => (
                                            <li key={index}>{warning.message}</li>
                                        ))}
                                    </ul>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            onClick={() => void submit(true)}
                                            disabled={busy}
                                            className={primaryButtonClass}
                                        >
                                            {busy ? (
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                            ) : (
                                                <Share2 className="h-4 w-4" />
                                            )}
                                            Send anyway
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setPendingWarnings(null)}
                                            className={subtleButtonClass}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => void submit(false)}
                                        disabled={busy}
                                        className={primaryButtonClass}
                                    >
                                        {busy ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Share2 className="h-4 w-4" />
                                        )}
                                        Send to {parcels.length} expert
                                        {parcels.length === 1 ? '' : 's'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setParcels([])}
                                        className={subtleButtonClass}
                                    >
                                        Discard
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {error && <Notice kind="error">{error}</Notice>}
                    {success && <Notice kind="success">{success}</Notice>}
                    {info && !error && !success && (
                        <p className="text-sm text-muted-foreground">{info}</p>
                    )}
                </div>
            </Panel>
        </div>
    );
}
