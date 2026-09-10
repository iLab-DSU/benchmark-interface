import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireAdmin, badRequest } from '@/lib/auth/guard';
import { listQuestionSets, saveQuestionSet } from '@/lib/expert/store';
import { parseQuestionFile } from '@/lib/expert/import';
import type { QuestionSet } from '@/lib/expert/types';

export const dynamic = 'force-dynamic';

// Spreadsheets are small, but a stray large upload should not be parsed into
// memory before being rejected.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** All question sets, without their questions, for the listing UI. */
export async function GET() {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    try {
        const sets = await listQuestionSets();
        return NextResponse.json({
            sets: sets.map(({ questions, ...rest }) => ({
                ...rest,
                questionCount: questions.length,
            })),
        });
    } catch (error) {
        return badRequest(error);
    }
}

/** Creates a question set from an uploaded spreadsheet. */
export async function POST(request: NextRequest) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    let form: FormData;
    try {
        form = await request.formData();
    } catch {
        return NextResponse.json(
            { error: 'Expected a multipart form upload.' },
            { status: 400 },
        );
    }

    const file = form.get('file');
    const title = String(form.get('title') ?? '').trim();
    const description = String(form.get('description') ?? '').trim();

    if (!(file instanceof File)) {
        return NextResponse.json({ error: 'No file was uploaded.' }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json(
            { error: `File is too large (limit ${MAX_UPLOAD_BYTES / 1024 / 1024} MB).` },
            { status: 413 },
        );
    }

    try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const parsed = await parseQuestionFile(file.name, buffer);

        const set: QuestionSet = {
            id: randomUUID().replace(/-/g, '').slice(0, 24),
            title: title || file.name.replace(/\.[^.]+$/, ''),
            description: description || undefined,
            createdAt: new Date().toISOString(),
            createdBy: auth.user.email,
            questions: parsed.questions,
            source: {
                fileName: file.name,
                importedAt: new Date().toISOString(),
                rowCount: parsed.rowCount,
                ignoredColumns: parsed.ignoredColumns.length ? parsed.ignoredColumns : undefined,
            },
        };

        await saveQuestionSet(set);

        console.log(
            `[expert] ${auth.user.email} imported ${set.questions.length} questions from ${file.name}`,
        );

        return NextResponse.json({
            set: { ...set, questions: undefined, questionCount: set.questions.length },
            ignoredColumns: parsed.ignoredColumns,
            preview: set.questions.slice(0, 5),
        });
    } catch (error) {
        return badRequest(error);
    }
}
