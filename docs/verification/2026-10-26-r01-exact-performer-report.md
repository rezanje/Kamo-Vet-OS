# R01 — exact saved performer filter for manual payroll source report

Canonical source: Checklist R01, read 26 October 2026. This change extends the existing `/laporan/penjualan-barang` report, which already lists posted source lines, net amounts after item and invoice discounts, branch/period, invoice drilldown, and complete CSV/XLSX/print exports. No commission amount or rate is calculated here.

The report previously accepted only free-text search for a performer. That search also matched customers, item names, and document numbers, and could not distinguish two employees with the same saved name. The new `pelaksana_id` filter matches `doctor_id` or `staff_id` stored in each service-line snapshot. Options are labeled with the saved name and an ID suffix. Pagination, full exports, and export filter metadata preserve the selected ID. It does not query today's employee record to reconstruct old attribution.

A line with both doctor and non-doctor appears when either actor is selected, but appears once in the unfiltered branch total. Thus per-person filtered sales totals must not be summed as branch turnover or treated as a commission payout. Legacy lines without saved actors remain in the unfiltered report and do not acquire guessed attribution. The separate S04 two-person ordinary commission rule is still undecided.

Fictional fixtures exercise identical names with distinct actor IDs, two actors on one line, a zero-net line, and one mixed posted invoice with medicine, compounding, consultation and inpatient service. The mixed invoice's net amounts reconcile to its saved pre-tax total after line and invoice discounts; invoice drilldown remains exact. The test suite also covers preserved filter parameters and CSV metadata.

R05 companion PR #213 (SHA `90a1408`) allows this exact `pelaksana_id` key in private report presets. Integrate both for saved performer-filter configurations. No migration in this R01 branch, and no live data or field UAT performed.
