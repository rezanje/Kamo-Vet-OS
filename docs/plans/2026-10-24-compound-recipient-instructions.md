# Recipient instructions on the compound detail page

Screenshot materialized from Library `libfile_cbd0dbeb8fd48191b30a8bb4b0c596df` and inspected as pixels. It shows usage-like text inside the separate technical `compounding_steps` field. Schema and action inspection confirm distinct storage, not a mislabeled single field.

1. Add regression coverage for recipient editor/save/readback, legacy mixed text, blank values, official immutable recipes and status/access errors.
2. Use existing `dosage_instruction` for the main recipient editor. Preserve internal steps in a separate collapsed internal editor and never copy them into usage. Use a new local-draft scope so old internal drafts cannot populate recipient fields.
3. Synchronize explicit dosage edits to the linked prescription `aturan_pakai` atomically through a narrow invoker trigger, preserving current row policies, official snapshot guards, ingredients, stock and all financial fields. No backfill or clinical-record migration.
4. Run focused app/SQL tests, typecheck, lint and build, review the exact diff, publish this task's PR, and merge/deploy only this scope under the user's existing authorization. Verify the exact production commit before claiming live.

The installed Next 15.5.25 package does not ship the AGENTS.md-referenced `node_modules/next/dist/docs`; use existing app patterns, installed types and build checks.
