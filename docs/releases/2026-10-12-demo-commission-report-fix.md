# DEMO commission report relationship correction

The full report smoke uncovered PostgREST PGRST201: invoice→DEMO snapshot embedding was ambiguous because the new schema also exposes an inferred relationship. Qualified the direct `clinic_demo_invoice_snapshots_invoice_id_fkey` without changing the returned key or excluding ordinary invoices.

Connected read-only reproduction: old query HTTP 300; qualified query returned four paid October invoices and one DEMO snapshot. Added two integrated query/business regressions: the fixed pool replaces legacy clinic commission, and reissue retains its original earning month. Independent review confirmed schema/JSON compatibility and ran 26 focused tests successfully. Production build and TypeScript passed. Full report and production smoke remain release gates before marking feedback complete.
