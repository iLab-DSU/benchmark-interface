'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, Loader2, Trash2, FileSpreadsheet, Download } from 'lucide-react';
import { callApi, Notice, Panel, inputClass, primaryButtonClass, subtleButtonClass } from './ui';

const TAB = String.fromCharCode(9);
const NEWLINE = String.fromCharCode(10);

interface QuestionSetRow {
    id: string;
    title: string;
    description?: string;
    createdAt: string;
    createdBy: string;
    questionCount: number;
    source?: { fileName: string; rowCount: number; ignoredColumns?: string[] };
}

/**
 * The question-bank export format, so the expected columns are never a guess.
 *
 * Tab-separated and carrying every column the bank produces, including the
 * ones the importer ignores: the point is to match a real export byte for
 * byte, so an admin can export, check against this, and upload unchanged.
 */
const TEMPLATE_COLUMNS = [
    'record_id', 'clean_question', 'asset_domain', 'specific_value_chain',
    'additional_value_chains', 'intent_group', 'farmer_intent', 'intent_evidence',
    'question_id', 'value_chain', 'emded_id', 'semantic_cluster', 'duplicate_group',
    'is_duplicate_group', 'is_representative', 'representative_row', 'duplicate_group_id',
];

const TEMPLATE_ROWS = [
    ['Q00118', 'How can one ensure homemade feed rations are balanced for laying chicks', 'Livestock', 'Chicken/poultry', 'NA', 'Livestock Management', 'Feed animals or formulate balanced rations', 'feeding/nutrition cue', '65', 'Poultry', '12', '0', 'NA', 'FALSE', 'TRUE', '12', 'NA'],
    ['Q00187', 'what causes chicken not to feed n stay in a dull mode', 'Livestock', 'Chicken/poultry', 'NA', 'Livestock Management', 'Diagnose an animal health or production problem', 'animal symptom/diagnosis cue', '99', 'Poultry', '17', '0', 'NA', 'FALSE', 'TRUE', '17', 'NA'],
    ['Q00310', 'For hatchery give best temperature and humidity for more chick production while incubating', 'Livestock', 'Chicken/poultry', 'NA', 'Livestock Management', 'Rear and manage young stock', 'young-stock cue', '160', 'Poultry', '28', '0', 'NA', 'FALSE', 'TRUE', '28', 'NA'],
    ['Q00375', 'which prompts should a farmer walk on to start layers chicken farm', 'Livestock', 'Chicken/poultry', 'NA', 'Livestock Management', 'Manage egg production, handling or incubation', 'egg/incubation cue', '194', 'Poultry', '36', '0', 'NA', 'FALSE', 'TRUE', '36', 'NA'],
];

const TEMPLATE_TSV = [TEMPLATE_COLUMNS, ...TEMPLATE_ROWS]
    .map((row) => row.join(TAB))
    .join(NEWLINE);

export function QuestionsPanel() {
    const [sets, setSets] = useState<QuestionSetRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await callApi('/api/admin/question-sets');
            setSets(data.sets ?? []);
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

    const upload = async (event: React.FormEvent) => {
        event.preventDefault();
        const file = fileRef.current?.files?.[0];
        if (!file) {
            setError('Choose a file first.');
            return;
        }

        setBusy(true);
        setError(null);
        setSuccess(null);

        try {
            const form = new FormData();
            form.append('file', file);
            form.append('title', title);
            form.append('description', description);

            const data = await callApi('/api/admin/question-sets', { method: 'POST', body: form });

            const ignored = data.ignoredColumns as string[] | undefined;
            setSuccess(
                `Imported ${data.set.questionCount} question(s) from ${file.name}.` +
                    (ignored?.length ? ` Unrecognised columns ignored: ${ignored.join(', ')}.` : ''),
            );

            setTitle('');
            setDescription('');
            if (fileRef.current) fileRef.current.value = '';
            await load();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const downloadTemplate = () => {
        const blob = new Blob([TEMPLATE_TSV], { type: 'text/tab-separated-values;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'question-template.tsv';
        anchor.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-6">
            <Panel
                title="Upload questions"
                description="Import an .xlsx, .csv or .tsv file straight from the question bank. clean_question is the only required column; record_id, asset_domain, specific_value_chain, intent_group, farmer_intent, intent_evidence, semantic_cluster and is_representative are carried through and shown to the expert."
            >
                <form onSubmit={upload} className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                            <label className="text-sm font-medium text-foreground">Title</label>
                            <input
                                value={title}
                                onChange={(event) => setTitle(event.target.value)}
                                placeholder="Defaults to the file name"
                                className={inputClass + ' mt-2'}
                            />
                        </div>
                        <div>
                            <label className="text-sm font-medium text-foreground">
                                Description <span className="text-muted-foreground">(optional)</span>
                            </label>
                            <input
                                value={description}
                                onChange={(event) => setDescription(event.target.value)}
                                className={inputClass + ' mt-2'}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="text-sm font-medium text-foreground">File</label>
                        <input
                            ref={fileRef}
                            type="file"
                            accept=".xlsx,.xlsm,.csv,.tsv,.txt"
                            className={inputClass + ' mt-2 file:mr-3 file:rounded file:border-0 file:bg-[#005B4A]/10 file:px-3 file:py-1 file:text-xs file:font-medium file:text-[#005B4A]'}
                        />
                    </div>

                    <div className="flex flex-wrap gap-3">
                        <button type="submit" disabled={busy} className={primaryButtonClass}>
                            {busy ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Upload className="h-4 w-4" />
                            )}
                            Import
                        </button>
                        <button type="button" onClick={downloadTemplate} className={subtleButtonClass}>
                            <Download className="h-3.5 w-3.5" />
                            Download CSV template
                        </button>
                    </div>
                </form>

                {error && <Notice kind="error">{error}</Notice>}
                {success && <Notice kind="success">{success}</Notice>}
            </Panel>

            <Panel title="Question sets" description="Imported sets available to share with experts.">
                {loading ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                ) : sets.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing imported yet.</p>
                ) : (
                    <div className="space-y-3">
                        {sets.map((set) => (
                            <div
                                key={set.id}
                                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#f2eaea] p-4"
                            >
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <FileSpreadsheet className="h-4 w-4 shrink-0 text-[#005B4A]" />
                                        <span className="font-medium text-foreground">{set.title}</span>
                                    </div>
                                    <div className="mt-1 text-xs text-muted-foreground">
                                        {set.questionCount} question
                                        {set.questionCount === 1 ? '' : 's'}
                                        {set.source?.fileName ? ` · ${set.source.fileName}` : ''} ·{' '}
                                        {new Date(set.createdAt).toLocaleDateString()}
                                    </div>
                                    {set.source?.ignoredColumns?.length ? (
                                        <div className="mt-1 text-xs text-amber-700">
                                            Ignored columns: {set.source.ignoredColumns.join(', ')}
                                        </div>
                                    ) : null}
                                </div>

                                <button
                                    className={subtleButtonClass + ' text-red-700 hover:bg-red-50'}
                                    onClick={() => {
                                        if (!window.confirm(`Delete question set "${set.title}"?`)) return;
                                        setError(null);
                                        setSuccess(null);
                                        callApi(
                                            `/api/admin/question-sets/${set.id}?confirm=${encodeURIComponent(set.id)}`,
                                            { method: 'DELETE' },
                                        )
                                            .then(() => {
                                                setSuccess(`Deleted "${set.title}".`);
                                                return load();
                                            })
                                            .catch((err) => setError(err.message));
                                    }}
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    Delete
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </Panel>
        </div>
    );
}
