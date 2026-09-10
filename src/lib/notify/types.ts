/**
 * Notifications: the in-app inbox and the emails that mirror it.
 *
 * An assignment that nobody notices is the same as no assignment, so every
 * assignment writes a notification. Delivery is deliberately best-effort and
 * never allowed to fail the action that caused it — see notify().
 */

export type NotificationKind =
    | 'assignment_created'
    | 'assignment_updated'
    | 'assignment_revoked'
    | 'assignment_due_soon';

export interface Notification {
    id: string;
    /** Lower-cased recipient address; also the storage partition. */
    email: string;
    kind: NotificationKind;
    title: string;
    body: string;
    /** In-app link, always same-origin and root-relative. */
    href?: string;
    createdAt: string;
    readAt?: string;
    /** Set once an email for this notification has been accepted by the relay. */
    emailedAt?: string;
    /** Why the email did not go out, when it did not. Shown only to admins. */
    emailError?: string;
}

/** What a caller hands to notify(); the rest is filled in on write. */
export interface NotificationInput {
    email: string;
    kind: NotificationKind;
    title: string;
    body: string;
    href?: string;
}
