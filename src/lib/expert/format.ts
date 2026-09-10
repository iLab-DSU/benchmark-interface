/**
 * Shared formatting for assignment dates.
 *
 * Lives here rather than beside one component because due dates are rendered
 * in three places — the expert's list, the expert's answering screen and the
 * admin table — and the raw ISO string leaking into any one of them looks like
 * a bug to whoever sees it.
 */

/**
 * "9 Oct 2026", or the original string when it is not a date.
 *
 * Falls back rather than throwing: a due date typed by hand into storage
 * should still show something, and an unreadable date is a smaller problem
 * than a page that will not render.
 */
export function formatDueDate(iso: string | undefined): string {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
}

/** True when a due date has passed, for the overdue styling. */
export function isOverdue(iso: string | undefined): boolean {
    if (!iso) return false;
    const date = new Date(iso);
    return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
}
