# AgentOps — Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants & Relationship Mapping
- **Master Gate & Relational Sync**:
  - `TicketMessage` (`/tickets/{ticketId}/messages/{messageId}`) belongs to `Ticket` (`/tickets/{ticketId}`). Access is strictly gated by `get(/databases/$(database)/documents/tickets/$(ticketId)).data.ownerId == request.auth.uid` or `isAdmin()`.
  - `AgentEvent` (`/workflowRuns/{runId}/events/{eventId}`) belongs to `WorkflowRun` (`/workflowRuns/{runId}`). Access is strictly gated by `get(/databases/$(database)/documents/workflowRuns/$(runId)).data.ownerId == request.auth.uid` or `isAdmin()`.
- **Identity & Ownership Integrity**:
  - Every created document MUST set `ownerId == request.auth.uid`.
  - Users MUST have `request.auth.token.email_verified == true`.
  - Bootstrapped Admin (`coinworkbook@gmail.com` with `email_verified == true` or existence in `/admins/$(request.auth.uid)`) has administrative override where appropriate.
- **Temporal Integrity**:
  - `createdAt == request.time` on `create`.
  - `updatedAt == request.time` on `update`, and `createdAt == existing().createdAt` (Immortal Field).
- **Terminal State Locking**:
  - `Ticket` cannot be updated once `existing().status == 'resolved'` or `'rejected'` unless `isAdmin()`.
  - `WorkflowRun` cannot be updated once `existing().status == 'completed'` or `'failed'` unless `isAdmin()`.
  - `Approval` cannot be updated once `existing().status != 'pending'` unless `isAdmin()`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Shadow Field Injection on Ticket Create**: Includes unauthorized field `isInternalAdmin: true` -> Rejected by `data.keys().hasOnly(...)`.
2. **Identity Spoofing on Ticket Create**: `ownerId: "victim-uid-999"` when `request.auth.uid == "attacker-uid"` -> Rejected by `data.ownerId == request.auth.uid`.
3. **Unverified Email Admin Spoof**: `request.auth.token.email == "coinworkbook@gmail.com"` with `email_verified: false` -> Rejected by `request.auth.token.email_verified == true`.
4. **Timestamp Forgery on Create**: `createdAt: Timestamp.fromMillis(1000000)` instead of `request.time` -> Rejected by `incoming().createdAt == request.time`.
5. **Immortal Field Mutation on Update**: Updating `Ticket.createdAt` or `Ticket.ownerId` -> Rejected by `incoming().createdAt == existing().createdAt && incoming().ownerId == existing().ownerId`.
6. **Terminal State Bypass on Approval**: Updating an `Approval` document whose `existing().status` is already `'approved'` -> Rejected by `existing().status == 'pending'`.
7. **Orphaned Subcollection Write on TicketMessage**: Creating `/tickets/non-existent-id/messages/msg-1` -> Rejected by `exists(/databases/$(database)/documents/tickets/$(ticketId))` and parent `ownerId` check.
8. **Orphaned WorkflowRun Create**: Creating a `WorkflowRun` referencing a `ticketId` that does not exist in `/tickets/$(incoming().ticketId)` -> Rejected by relational `exists()` check.
9. **Denial-of-Wallet Oversized String**: Sending a 10,000-character `subject` on `Ticket` -> Rejected by `data.subject.size() <= 300`.
10. **ID Poisoning Attack**: Creating a document with ID containing spaces or special characters (`ticket$123/../admin`) -> Rejected by `isValidId(ticketId)`.
11. **Value Poisoning on Update**: Updating `Approval.status` to `'super_approved'` -> Rejected by `isValidApproval(incoming())` wrapping the `allow update` block.
12. **Blanket List Query Scraping**: Listing `/tickets` without filtering `where('ownerId', '==', uid)` as a non-admin -> Rejected by `allow list: if isSignedIn() && (resource.data.ownerId == request.auth.uid || isAdmin())`.

## 3. Red Team Audit Conflict Report
- **Identity Spoofing**: Blocked across all 9 collections via `data.ownerId == request.auth.uid` on create and `incoming().ownerId == existing().ownerId` on update.
- **State Shortcutting / Terminal State Locking**: Enforced on `tickets`, `workflowRuns`, and `approvals`.
- **Resource / ID Poisoning**: Enforced via `isValidId()` regex `^[a-zA-Z0-9_\-]+$` and length `<= 128` on all single-document operations (`get`, `create`, `update`, `delete`), plus `.size()` bounds on every string field.
- **Validation Helper Wrapping Update**: Every `allow update` block begins with `isSignedIn() && isVerified() && isValidId(...) && isValid[Entity](incoming())`.
