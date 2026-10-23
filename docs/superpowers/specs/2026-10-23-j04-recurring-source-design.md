# J04 — monthly recurrence from a general journal

Canonical Sheet row61 requests source-linked recurring accounting with finite period controls, pending/executed occurrences and duplicate-safe execution. Existing templates/count limits/atomic monthly posting remain useful, but creation accepts only manually entered lines, has no source link/first period, and legacy catch-up posts on visiting Jurnal Umum.

## Scope and choices

This batch adds monthly schedules from valid, non-void `manual`/`manual-correction` general journals. Active OWNER/ADMIN/FINANCE with existing Buku Besar and branch scope can preview a source, confirm its exact snapshot, choose the first month, posting day1–28 and either count or last month. Count means NEW monthly postings; the existing source journal is excluded. First month must follow the source month. Backdated first months require explicit confirmation and each execution still honors closed periods. Date/count are visible choices, not invented source metadata.

New source schedules run MANUALLY one oldest due period per click. Setup creates no ledger entry and future periods cannot execute. Old automatic templates keep their existing behavior. Weekly/other source families, changing historical entries, amendments/refunds and bank transfers are separate scope. This bounded monthly/manual choice follows the user's autonomous/main-first instruction rather than another design-permission prompt.

Source lines/description/branch are copied server-side from an expected, locked canonical snapshot; amounts remain exact to existing two-decimal precision, without normalization. Accounts must remain valid. One immutable schedule per source journal prevents different-key/actor duplicate setup. Same actor/request replay returns the original setup receipt, with a read-only recovery RPC. Source changes/voids block NEW occurrences; executed receipt replay remains valid. Pause/resume preserves history; no delete/rewrite of source/proofs.

## Architecture and access

Add only `recurring_journals.is_source_schedule boolean not null default false` to legacy storage. New source rows keep `lines=[]` and `deskripsi=NULL`; the original table is globally readable under existing RLS, so copied source amounts/description MUST stay in NEW branch/finance-scoped immutable `recurring_journal_sources`, not in that legacy row. A second immutable `recurring_source_occurrences` table stores unique(schedule,period), unique journal FK and exact execution receipt. New-object RLS/column grants preserve role/module/branch scope and hide setup key/payload; no existing RLS/role/settings/credential changes.

A definer create RPC authenticates finance, locks profile/source header/lines/accounts, compares expected snapshot, inserts the marker row plus immutable source/config/request receipt atomically. An execution RPC locks schedule then finance/profile/source, validates finite chronological period, source/config and accounting lock, writes through the existing internal journal writer, verifies exact source lines/date/branch, then records occurrence and last_posted in the same transaction. Existing A01 records schedule creation/progress; private proofs contain source/config/actor. Generic audit is not expanded to expose private source text.

Invoking the old posting RPC on a source-marker row is rejected; legacy catch-up skips source markers. New integrity triggers prohibit direct app mutation/deletion of source templates/progress and source-linked recurring journal headers/lines; the authorized definer writer remains the write path. Header/line RLS already share journal branch visibility. Existing legacy templates and unrelated journals keep existing permissions/behavior. Proof FKs and immutable update/delete/truncate triggers retain provenance.

Public RPCs: `preview_recurring_journal_source(uuid)`, `create_recurring_journal_from_source(text,uuid,jsonb,text,text,integer,integer,text,boolean,boolean)`, `get_recurring_journal_source_result(text)`, `post_recurring_journal_source_period(uuid,text)`. Source snapshot helper is internal/revoked from app roles. Create payload includes expected snapshot and canonical chosen config; recovery does not repost.

## UI and proof

Eligible journal rows link to a dedicated source setup page. Inherited description/lines are read-only; a fresh confirmation is excluded from draft restoration. Exact source/created-journal links use `?entry=<uuid>` filtering on Jurnal Umum, rather than guessing by description/number. A source schedule detail shows first/last month, remaining count, execution mode, immutable source and a bounded paginated window of virtual pending versus receipt-backed executed occurrences. Only oldest due month offers Run; no future ledger rows are precreated. Existing recurring list distinguishes manual source schedules and links details; legacy rows retain their workflow.

## Validation and boundaries

Fictional SQL: source preview/create RED, one-source/key/recovery, setup zero ledger writes,12 monthly occurrences, exact date/value/branch and replay, future/closed/source-changed/inactive/role/branch denial, direct-write guards, audit/journal rollback and one deterministic concurrent duplicate run. Existing atomic recurring/count suites must remain intact; report actual baseline failures rather than weakening controls. Client/page/action tests cover real source controls, exact links, fail-closed reads, draft reload/fresh confirmation, calendar/WIB/count/end-date and skipping manual sources in legacy catch-up. Focused tests while iterating, full app/type/lint/build once stable, one fresh scoped Sol6.1 high review; target/release remains serialized and separately evidenced. Hosted/full workflow UAT deferred per user.
