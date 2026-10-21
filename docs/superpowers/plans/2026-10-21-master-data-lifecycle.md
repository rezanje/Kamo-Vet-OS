# Recoverable master actions

Base: main `d6d9c70`. Branch: `codex/kamo-masterdata-lifecycle`.

| Master | Existing edit | New lifecycle |
| --- | --- | --- |
| Employees | Profile and Edit | Nonaktifkan / Aktifkan; unused to Sampah; Pulihkan to Nonaktif |
| Items / SKU | Edit | Same lifecycle |
| Brands | Edit | Same lifecycle |
| Suppliers | Added an edit path preserving all supplier fields | Same lifecycle |
| Supplier categories | Edit | Same lifecycle |
| Units | Edit; reject renaming a used text label | Same lifecycle |

The label is **Pindah ke Sampah**, never permanent Hapus. Trash retains the original row, identifier, unique name/code and all FK relations. Restore returns an inactive row; activation is a separate explicit action. Default lists include active and inactive masters, excluding trash. Dedicated views expose Aktif, Nonaktif and Sampah; lifecycle returns preserve category/search/page filters, and changing views resets pagination. Browser failure retains the reason and explains an uncertain outcome without reporting success.

Trash is allowed only after a fresh, transactional reference check. Any incoming FK, configuration child, relevant unconstrained UUID, JSON request/provenance snapshot, known stored unit label, or code-only import provenance blocks trash. Even zero stock, exhausted FIFO, a canceled transaction, an employee branch assignment, or linked login account is evidence to retain. Used masters can be deactivated; no cascading deletion, automatic reassignment or SET NULL unlink is performed. Existing category-specific `remove_item_category` behavior remains separate and unchanged, including its explicit atomic replacement option.

`change_master_data_lifecycle` accepts only six named relations and four actions. It locks the target, rechecks the current active OWNER/ADMIN after any wait, keeps the profile/branch capability/grants stable, validates employee branch access, rejects a stale revision, and records reason, actor, before/after state and revision in one immutable audit transaction. The audit contains lifecycle state rather than employee salary/contact snapshots. A retry at an old revision is rejected; inspect/reload the list to learn the actual result. No blind toggle or permanent-delete endpoint is exposed.

Reference-write triggers lock the same parent before accepting a new reference. Both orderings are safe: an earlier reference makes trash fail; an earlier trash makes the new reference fail. Existing unchanged references remain available for history and transaction corrections. The guard also covers canonical JSON, denormalized unit text and import source codes. Normalized item/unit label lookups are indexed for reference writers. UUID/JSON checks are conservative and may block ambiguous data; choose Nonaktifkan instead of weakening evidence checks. Existing auth/profile/capability tables are excluded from the supplemental snapshot guards; account permissions and profile state are not changed.

Employee status never writes `profiles`, `auth.users` or login permissions. Employee Edit no longer accepts a hidden status change; the explicit lifecycle action supplies the reason/audit. Current active-role checks also cover SKU forms/import/variants and brand writes without adding a role. The old incomplete-group delete compensation now requests recoverable trash with a recorded system reason; the old physical delete helper is blocked by the master-delete trigger.

Inactive brand, supplier, category, unit and substitution selections are preserved when editing an existing SKU. They are retained as labeled existing options, avoiding silent FK clearing. New purchase forms and new SKU supplier choices use active suppliers. Historical joins and payment/debt readers retain archived suppliers.

## Integration boundaries

- Unique migration: `20261021134543_master_data_lifecycle.sql`. No production application or migration is performed by this work. Matching SQL/application require a separately authorized release.
- PR74 `af45994` is inspected. Shared application file: `src/app/(app)/pos/sku/impor/actions.ts`; this PR changes only its current-active-role guard. Preserve PR74's posting/review implementation. The lifecycle migration sorts after PR74 `20261021123000` so its snapshot table is included in the reference fences. A disposable compatibility run applies both migrations.
- PR75 `94b4474` has no changed-file overlap. Its closed reset action/read-only guidance remains intact. No reset is restored or authorized.
- PR62 has older overlapping purchase action/page changes. Do not combine its transaction/reset proposals automatically. Existing posted-transaction corrections, general stock/FIFO/GL helpers and payroll calculations are not reimplemented here.
- Reference fences are generated against the schema at migration time. Future migrations introducing new FK, UUID, JSON or unit-label columns must install equivalent fences and rerun concurrency checks. Unknown external representations require schema review; do not infer that absent stock means unused.
- A future separately authorized maintenance design must preserve lifecycle audit and trash. This PR adds no reset manifest, bulk-delete flow or maintenance execution capability.
