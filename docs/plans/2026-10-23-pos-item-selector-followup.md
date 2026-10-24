# U03 / U05 — POS request and transfer names

Separate local branch from preserved PR103. Do not retry blocked main merge or run target migrations.

Reuse existing SearchableItemPicker for two demonstrated remaining combined code/name controls: POS stock request and transfer. Keep exact IDs, units, quantity, request identity, draft state and warehouse stock hints. Normalize only visible legacy labels; do not rewrite saved draft payloads on restore. Existing catalog loader, role/branch access and stock/financial actions stay unchanged. Focused RED/GREEN, proportional lint/type/build, independent review. This is another explicit slice, not global checklist completion.
