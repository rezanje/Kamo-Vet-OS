# Fictional local compiled-app tab benchmark

Both completed runs used Next15.5.25 `build`/`start`, Chromium151, Node24.19.0, the same local GoTrue/PostgREST/PostgreSQL services, OWNER cookies, 1365×900 viewport and three warm rounds of one versus ten simultaneous tabs. Readiness required HTTP success, the expected route/filter and the first visible table body. External CDN requests were excluded. Each run completed99 warm navigations plus3 cold navigations with zero captured HTTP500/browser errors.

The QA-PERF core contains1,200 customers/pets/items/stock rows and350 medical records. Other fictional acceptance fixtures also exist; a small number were added between runs. The stock route explicitly selected the same QA-PERF warehouse. Measurements describe this local shared verification machine, not a production SLA or a controlled causal experiment; other verification activity could affect timing. Complete source reads still have explicit bounds and are not transactional snapshots.

| Route | Previous rendered rows | Current rendered rows | Previous1-tab median | Current1-tab median | Previous median all10 ready | Current median all10 ready |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Customers | 1,000 | 50 | 1,061ms | 724ms | 6,491ms | 2,631ms |
| Medical history | 300 | 50 | 761ms | 418ms | 4,266ms | 1,961ms |
| QA-PERF warehouse stock | 1,000 | 50 | 990ms | 412ms | 4,496ms | 1,625ms |

Customers and medical histories are now completely checked before search and summaries, within10,000 eligible source rows. Warehouse stock uses counted server pages; matrix totals use checked complete reads. Separate browser acceptance found the customer beyond1,000 and the older history beyond300, and verified last-page/matrix quantities. Bounded rendering therefore does not rely on silently truncating those sources.

Raw reports include source commits, times, runtime and every sample: `2026-10-04-baseline-compiled-tabs.json` and `2026-10-04-after-compiled-tabs.json`. Machine: AMD EPYC9V74,5 logical CPUs exposed, approximately17.6GiB host memory. The earlier dev benchmark that lost its server remains incomplete and is not used for this table. Its SIGKILL source was not identified.

Reproduce against a supervised fictional compiled app:

```sh
python3 scripts/hris-local-launcher.py --mode build --app-root /workspace/vetos-release-candidate
python3 scripts/hris-local-launcher.py --mode start --app-root /workspace/vetos-release-candidate --port 3130 --detach
node scripts/benchmark-local-tabs.mjs --url http://127.0.0.1:3130 --output /tmp/vetos-compiled-tabs.json
```

The launcher is supplied by the separate HRIS acceptance branch/PR18.
