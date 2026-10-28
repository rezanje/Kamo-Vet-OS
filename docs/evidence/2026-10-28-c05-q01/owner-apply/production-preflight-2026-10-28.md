# Production preflight (read-only) — 28 Okt 2026

`preflight.sql` dijalankan ke production lewat Supabase MCP `execute_sql` (hanya SELECT, tanpa tulis),
setelah langkah DB J03, K06/K14, P02, P08, P01/U11 diterapkan. Belum ada apply C05/Q01.

| Cek | ok |
|---|---|
| anchor: apply_sale_staff_effects total_sales_amount line present once | true |
| anchor: clinic_post_invoice invoice insert present once | true |
| quest target kinds are the expected set | true |
| no voucher code would break the campaign code format later | true |
| sales.campaign_code / invoices.campaign_code not yet used by something else | true |
| customers.imported_at not yet used by something else | true |
| info: customers with a usable phone identity = 52 | true |

Kesimpulan: kedua fungsi production masih punya titik tambal yang diharapkan; `apply.sql` dapat diterapkan.
