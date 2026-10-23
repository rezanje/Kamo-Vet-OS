# Feedback release integration — 23 October 2026

This release combines the reviewed feedback candidates on main `9765837c3966b5f0fde022037c75ca007ba2b10b`. Source branches are preserved; no squash, force push or unrelated J03 work is included. Earlier PR103 approval-review denial was resolved by a new explicit action-specific instruction and one successful official merge. Older candidate notes describing that blocker are historical.

Already released: PR103 `9db3b267245c12f2dcd490c4de711321be4d3025`, PR106 `9314e620d410f874c31c0d9bf92397e16e86c999`, PR108 `9765837c3966b5f0fde022037c75ca007ba2b10b`. PR106's standalone Vercel deployment was canceled from the dashboard; exact newer PR108 merge has Vercel SUCCESS and includes it. Merge and production verification remain separate evidence.

## Exact integrated sources

| PR | Source SHA |
|---|---|
| #104 | `fc05d835c2ce5fd8ee20f29eff8bf3de22fd0f8c` |
| #105 | `94f89eb7bea0d4d3156750a222ecf0882c9c1d92` |
| #107 | `5589c91cf4ed99afb67e6ee15350d114602c0d4c` |
| #109 | `1dca9a84820c8d662ac0dc744e508a3a4f634cd9` |
| #111 | `f915622732066ee219270d30440f777e2ebed21d` |
| #113 | `5b8656dc94f5a5375c7a44c6fd9f34244460fb88` |
| #114 | `17449d326710f17cb6d259d39270763292b98dff` |
| #115 | `7ead89c5b3ae1a5d561c1c019be27b6b80407dc9` |
| #117 | `a4b1ed65234091cd2e75d89e4e5c1aeb4713090f` |
| #118 | `2ab944dfa8f4f3cfb0fdc69414a5d9aedeb72b01` |
| #119 | `08063a5434a75373004c1698171e8ef74982a387` |
| #120 | `c5983bdf8306e2071e7eccc9d15f6b7e3026b64f` |
| #121 | `0a5b5eb20561d8976f72627e8a9950221cdd1dd0` |
| #122 | `7440af9087e7841984c560007054b71e42da5e73` |
| #123 | `55c84e8ce307eea8720e761dcf8929095e7e0d61` |
| #124 | `2d473593b8c1ca5f30d81d9702e2f30634af8a83` |
| #125 | `ac0d24779fcda8596be86d19132b596ed40cbe37` |

All exact source heads had Vercel SUCCESS before integration, including final PR124 `2d473593b8c1ca5f30d81d9702e2f30634af8a83`. PR119 includes unchanged PR110/112; PR120 includes unchanged PR116. These superseded candidates are included once through ancestry, not reapplied.

## Conflict and compatibility review

- Production page: retain checked pagination, extended branch/warehouse references, frozen sources, ad hoc form and guarded completion. Remove unused `rencanaJadi` import.
- Reports directory: preserve fail-closed session/profile/module reads and `ReportCatalog`; compose private presets before the catalog. Never restore the old permissive landing.
- Independent bounded review of both resolutions and therapy/service-performer RPC interaction found no P1/P2. It was read-only and did not claim independent SQL execution.
- Initial combined app run: 3,074 passed / 17 failed across five fixture files. Updated fixtures model counted item reads, staff assignment date filtering, frozen-source RPC, the real portal/name-code picker and composed report directory. No production guards were relaxed. Added assertions retain private-directory composition and suppress it when catalog authorization fails.

## Verification

- Final aggregate application suite: **415 files / 3,091 tests PASS**.
- Focused fixture compatibility: **28 / 28 PASS**.
- Combined TypeScript PASS before test-fixture updates; final post-build check recorded separately in release evidence.
- Scoped ESLint: **0 errors**, five existing image warnings.
- Combined PostgreSQL **17.6**, **244 repository migrations**, fictional auth/storage shims: advance cap/cent precision, therapy, atomic stock count, recipe/ad hoc production, owner-private report presets, retail and clinical per-line performers, clinic lifecycle, split payments and opening inventory regression PASS. No target transactions or customer fixtures used.
- Existing source-candidate concurrency/rollback suites are retained in their individual evidence; not repeatedly rerun for unchanged SQL. Combined fixture execution is not a claim that all target schema/auth behavior is equivalent.
- Full hosted/user workflow simulations remain deferred by instruction. This does not set simulation checkboxes.

## Explicit migration allowlist and order

| File | SHA256 |
|---|---|
| `20261023121500_purchase_advance_cent_precision.sql` | `4fbbf5cd66a1dce90e643b2b85dc6bbd22db71e66308a5f6a552ce7ea345c22f` |
| `20261023121700_clinic_therapy_note.sql` | `b41c9fc4b5ded07f7b9923fd29a53db5c5ecf0c80893a54016701e5b21adeb46` |
| `20261023134000_opname_atomic_posting.sql` | `554095cd4170227f74a83ea490a6c62692358df7c9d79b2e0d8b36225c349ba9` |
| `20261023143000_service_line_performers.sql` | `e7555c098de3ea83eccf459ae207df8a8cb6d3a134c20ea3f9cdc1d294eaf53c` |
| `20261023145000_production_atomic_core.sql` | `9d1d84121b520c4b29970aa2ddec422b776d9551261a6e8b103dc626f6845cd3` |
| `20261023154500_private_report_presets.sql` | `7b1719a16b7772cc6194328f19a6dac2fb0fbdc4b4bb5080fb2df1aa5bc293f3` |
| `20261023161000_production_adhoc_warehouses.sql` | `9e7454ff5f54dbf07cd0e8ff6d779138a4fdcf25b0d17bd17f13e2992054204d` |

Target preflight: project `koaglxcyjqfmgfzxszkj`, PostgreSQL17.6; 222 history entries/latest `20261023091210`; seven versions absent and new tables absent; FIFO; zero running legacy production jobs. All ten changed existing routines and fifteen called unchanged helpers match the tested baseline **exactly**. No missing migration-history replay is included.

Latest completed physical-backup metadata: `2026-10-23T15:14:21.325Z`. Physical restore has not been tested. This release does not restore/reset the target.

Rollout is one explicit error-stop transaction: advisory release lock, short lock timeout, history/function drift assertions, seven reviewed files and corresponding history entries, expected final-function assertions, unchanged owner/security/search-path/execute ACL assertions for existing routines. New private tables/RPCs enforce their own reviewed access controls; existing ACL/RLS are not weakened. No inventory/GL/customer transaction is invoked. Migration outcome is recorded separately after execution; this document alone does not assert it happened.

## Coverage and rollback bounds

Code-complete scopes eligible for main checklist after confirmed merge: U03/U04/U05 reviewed selector matrix, H01, K10/K11/K12, S01/S02/S03, M03, P06, I03/I04, R02/R03. Count item IDs, not PRs. S04 remains partial for two-performer ordinary commission policy; I02 exact incident evidence, I08 cross-branch/average/history policy, R04 arbitrary historical reconstruction and R05 shared/complex-report scope remain partial. C04 is a source-read and labeling fix, not full campaign policy. No claim that all74 are complete.

Prefer forward fix or pause affected posting over reversing safe atomic routines. App revert must retain receipts, source/actor snapshots, therapy notes, private presets and exact-cent values. Do not drop proof tables, narrow historical numeric precision, discard legitimate saved configurations or restore legacy multi-request production/opname posting. No bulk data deletion, credentials/settings change or target financial backfill.
