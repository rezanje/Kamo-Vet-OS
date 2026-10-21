# Kartu Stok: pencarian nama dan kode terpisah

Base: main `d6d9c70`, fetched again before publication on 21 October 2026.
Branch/worktree: `codex/kamo-kartu-stok-search`, `/workspace/kamo-kartu-stok`.

The stock-card form now has a read-only **Kode Barang** and a searchable **Nama Item**. Selecting an option updates the code and hidden `item` ID together; clearing removes all three. Duplicate names remain distinguishable by their codes in the result list. Search filters the complete catalog before limiting visible results to 50, including products after row 1,000.

The existing PR61 `SearchableItemPicker` gains optional `selectedLabelFormat` and `inputId` props. The default remains `code-name`; only Kartu Stok opts into `name`. Code/name search, option labels, callback shape, keyboard selection and existing consumers are retained. Enter selects the highlighted option after ArrowDown; Enter while the list is open prevents form submission. Uncommitted text reverts on blur/Escape, preserving the previously selected ID/code. Tampilkan continues to submit GET with `item`, `gudang`, `dari`, `sampai`; the name and code display fields are not submitted. Query-selected item changes remount the local picker state.

Only the page import and form markup changed. `loadKatalogPermintaan`, server validation, stock reads/calculations, history rendering, layout authentication and access middleware are unchanged. No SQL, migration, stock write, external database operation, merge or production deploy was performed.

## Actual validation

- `npm test -- src/components/__tests__/kartu-stok-filter.test.tsx src/components/__tests__/searchable-item-picker.test.tsx src/lib/kartu-stok.test.ts src/lib/__tests__/permintaan.test.ts`: **4 files / 22 tests passed**. Uses the real async page and paginated loader with a fictional Supabase read adapter. Asserts name search after item 1,000, duplicate names, Arrow/Enter, mouse selection, clear, selected-name/code/hidden-ID synchronization, restored query, unknown ID rejection, GET field serialization and unchanged warehouse/date predicates for history.
- `npm test`: **2,200 passed / 3 failed**, 262 passing files and 2 failing files. The three failures reproduce on a separate untouched detached worktree at `d6d9c70`: two missing `supabase.auth.getUser` mocks in `merchant-fee-report-pages.test.tsx`, one missing PO `draft_key` assumption in `remaining-transaction-forms.test.tsx`. Baseline command: `npm test -- src/components/__tests__/merchant-fee-report-pages.test.tsx src/components/__tests__/remaining-transaction-forms.test.tsx` → 7 passed / the same 3 failed. These unrelated tests were not changed.
- `npx tsc --noEmit`: passed.
- Scoped ESLint on the page, new filter, shared picker and new integration test: passed, zero errors/warnings. `git diff --check`: passed.
- `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=fictional-kartu-stok-build npm run build`: passed. Existing Supabase Edge Runtime and unrelated lint/cache warnings remain. No real Supabase credentials were used.
- `python scripts/test-kartu-stok-browser.py`: passed Chromium at **1280px and 390px**. The harness extracts the actual form markup from the page and imports the real filter/picker/SubmitButton with 1,205 fictional items. Real browser navigation verifies GET submission, warehouse/date changes, reload restoration and Back, beyond name/code search, duplicate disambiguation, keyboard selection, clear and Escape. No horizontal overflow, runtime error or external request. The fixture aborts external requests and has no Supabase/auth client.

Evidence: [browser checks](../evidence/2026-10-21-kartu-stok/checks.json), [desktop search](../evidence/2026-10-21-kartu-stok/desktop-search.png), [mobile search](../evidence/2026-10-21-kartu-stok/mobile-search.png), [desktop selection](../evidence/2026-10-21-kartu-stok/desktop-selected.png), [mobile selection](../evidence/2026-10-21-kartu-stok/mobile-selected.png), [full test output](../evidence/2026-10-21-kartu-stok/full-tests.txt), [baseline failures](../evidence/2026-10-21-kartu-stok/baseline-tests.txt).

## Coordination and limits

Open PR titles/descriptions were reviewed (#76–68, #62, #23, #18, #11, #10). PR76's complete changed-file list has no overlap with the stock-card page or shared picker; its `pembelian/faktur/langsung/page.tsx` change is upstream of one existing consumer. That form's picker call and default contract remain untouched. PR62 also has no stock-card/picker file overlap. Do not pull SQL, lifecycle behavior or transaction corrections from those branches into this UI change. The loader still decides which active inventory items are available.

Repository AGENTS.md was read. Its requested `node_modules/next/dist/docs/` directory is absent from installed Next 15.5.25; this patch introduces no Next API or routing convention.

The browser fixture is a local component/form preview, not authenticated acceptance against a deployed Next application or a live catalog. Server reads are mocked in integration tests. Production data volume/performance and authenticated staging access remain unverified. An automatic Vercel preview, if available, is a UI/build target only. No production completion is claimed.
