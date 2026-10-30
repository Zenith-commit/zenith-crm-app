# Roadmap & Open Items

What is left to build, deferred work, known issues, and setup tasks outside the codebase. Moved verbatim from the old `CLAUDE.md` on 2026-10-31. Finished work is recorded in `docs/build-log.md`.

## Not Started Yet

Job Billing Integration (schema, RLS, bundle management UI, and Apply Bundle to Job) is fully complete — see `docs/build-log.md`. `job_costs` table drop, job number auto-generation, the hard-delete/unarchive decision for clients and bundles, the mocked email/SMS feature (satisfying both the Outlook/M365 and SMS backlog items), the security hardening pass, and invoicing are also complete — see `docs/build-log.md`. The security hardening pass left one outstanding item that isn't actionable from the repo — see "Security Handoff Checklist" below.

- Pilot testing — client will test the live Vercel deployment (see "Live environment" in `AGENTS.md`) and send feedback; no code/database access on their end.
- "Send to client" for invoices (routing a generated invoice PDF through the mocked email feature), void/delete of an issued invoice, and real payment-ledger tracking are explicitly deferred invoicing follow-ups, not scheduled yet.
- See "Client Feedback List" below for the full post-pilot feedback triage and status of every remaining item.

## Client Feedback List (post-pilot, 2026-09-02)

Client sent a feedback list after pilot testing (numbered 1-11 below, including the still-unresolved item). Triaged into three phases:

**Phase A — quick wins:**
1. Feedback page — done, see `docs/build-log.md`.
2. Repeat-client auto-populate — done, see `docs/build-log.md`.
3. Bundle/quote UX polish — done (searchable materials picker, custom one-off items, Duplicate Bundle, Duplicate line item), see `docs/build-log.md`. Line-item editing ergonomics, drag-reorder, item code visibility on job billing, quote notes field, and Quote PDF generation remain deliberately deferred from this pass.
4. Roof reports — done, see `docs/build-log.md`.

**Phase B — moderate, new territory, each needs its own scoping (like Job Billing did):**
5. Queue tab — done, see `docs/build-log.md`.
6. Shadow schedule — done (all three phases: data model/access, the Dispatch Board, and drag-and-drop), see `docs/build-log.md`.
7. Office team inbox — jobs "pop up" and stay until the assignee marks complete. Not yet scoped in detail.
8. Field staff job requirements — SWMS, check-in/out photos. Simplified for demo level (no strict enforcement/blocking yet). Not yet scoped in detail.

**Phase C — mock only, don't build real integrations (matches the "framework/vision demo" standard already used for email/SMS):**
9. Xero reporting integration — mock it, same treatment as email/SMS. No real OAuth or live financial data pull.
10. Hours-based auto-invoicing — simplify significantly; capture hours + running total, skip anomaly-detection logic for now.

**Still unresolved:**
11. In-CRM instant messaging — needs clarification on staff-to-staff vs. staff-to-client before this can be scoped at all.

## Known Issues

- **`FeedbackIcon` dropdown is not visually anchored correctly** — found while building the Staff Feedback feature (see `docs/superpowers/specs/2026-09-02-staff-feedback-design.md`). The compose dropdown is functionally correct (doesn't push the nav layout, submits successfully, closes on success) and its CSS (`position: relative` on `.feedback-icon`, `position: absolute; right: 0` on `.feedback-dropdown` in `src/index.css`) checked out correctly in DevTools computed styles on every individual check performed live, yet it visually renders near the top-left of the page (below the logo) instead of directly under the icon in the top-right, unlike `NotificationBell`'s dropdown which anchors correctly with the identical shared CSS rule. Root cause not yet found — parked as a cosmetic issue, not blocking. Revisit before considering this feature fully polished.

## Security Handoff Checklist (outside the codebase)

Found during the security hardening pass but not actionable from the repo — needs direct action in the Supabase dashboard and/or hosting provider:

- [ ] Supabase Auth: confirm leaked-password protection is enabled
- [ ] Supabase Auth: confirm email confirmation is required for new accounts (lower priority today — accounts are admin-created only, no self-serve signup exists yet)
- [ ] Supabase Auth: review JWT/session expiry length against how long a technician's phone session should realistically stay logged in
- [ ] Once a hosting provider is chosen for deployment: add security headers (CSP, `X-Frame-Options`, `X-Content-Type-Options`, etc.) at the host/CDN level — no deployment config exists in this repo yet
