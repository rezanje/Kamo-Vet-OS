# Numeric input coverage and verification — 2026-10-24

Initial base: `bcb039e90a78cfb3b42b771f308c51b8e96564d2`. Integrated on `2142e8c6760e1c0d7c25527c37852821e17b6da2` (PR #139); the clinical correction constraints/defaults/read-only behavior are preserved. Screenshot from Library `libfile_6b87ee9676e08191abd579d4aae0414f` was materialized and inspected.

The root cause is native number-input wheel stepping: existing CSS hid spinner buttons but did not disable wheel changes. The shared NumberInput retains the real numeric control, its name/value, constraints, handlers and ref. It overlays an exact Indonesian display while unfocused and exposes the native decimal editor while focused. No stored number, server parser or calculation is reformatted. Shared passive wheel capture blurs an active numeric editor before default stepping and never cancels normal scrolling.

Coverage: **197 numeric control declarations across 106 source files**, including raw amount, quantity, measurement, price, percentage and duration editors. Production ad hoc quantities previously using decimal text inputs are included. The employee field renderer delegates its numeric salary field and passes text/date fields through unchanged. The source coverage test rejects newly introduced raw numeric/decimal controls or unreviewed dynamic native input types.

Exceptions and interaction contract:

- Phone/account/employee identifiers, SKU/barcode/COA codes, calendar years, dates and free text remain ungrouped. Hidden canonical JSON fields remain unchanged.
- Grouping is presentation while unfocused. Focus retains the existing native editor, decimal dot, selection/caret, keyboard arrows and mobile decimal keyboard. Screen readers use the real spinbutton value.
- Copy/cut from numeric controls carries exact canonical clipboard metadata where the browser supports native selection and clipboard APIs. Raw canonical decimal pastes and unambiguous Indonesian grouped pastes are supported.
- External single-dot grouping-shaped pastes such as `15.000` or `1.234` are rejected with an explanation because they could be either a decimal or thousands. Use `15000` / `Rp 15.000` for thousands, or `15,000` for a decimal. Existing values are never changed on rejection. Leading-zero decimals such as `0.001` remain accepted.
- Extreme exponents remain short strings rather than allocating unbounded decimal output. Native canonical strings and validity are preserved.
- Draft restoration explicitly notifies the display after assigning native values. Trusted reset-button behavior synchronizes on the next task, after the browser's default reset.

Verification:

- SKU regression asserts exact base prices and numeric tier/unit JSON in FormData. Shared tests cover signed decimal precision, blanks/zero, required/range/step validity, controlled cancel, refs, both draft restorers and unfocused/focused wheel event behavior.
- Full integrated suite: 444 files / 3,293 tests passed. Initial migration exposed two structural cashier-test selectors; they now locate the enclosing table cell and still verify original plus/minus behavior.
- TypeScript check passed. ESLint: zero errors, 12 existing warnings. Production build passed with existing Supabase Edge Runtime warning.
- `node scripts/test-numeric-input-browser.mjs`: 17 bounded Chromium checks on a local React fixture using the actual component/CSS. Includes page scroll, caret insertion, localized/raw paste, canonical copy/cut, invalid constraints, fractional quantities, negative/trailing-zero precision, extreme exponents, repeated edits/cancel, native reset display+payload, mobile layout/inputMode. Requires Playwright and Chromium; supports CHROMIUM_EXECUTABLE_PATH.
- Independent review identified and resolved stale draft displays, exponent expansion and clipboard ambiguity. A separate trusted-browser reset discrepancy was also reproduced and fixed. Chromium browser checks are bounded; Firefox/Safari clipboard behavior and broad end-to-end product simulation are not verified. No live business-data mutations.

Inventory:

| Source | Numeric controls |
| --- | ---: |
| `src/app/(app)/buku-besar/anggaran/page.tsx` | 1 |
| `src/app/(app)/buku-besar/beban/page.tsx` | 1 |
| `src/app/(app)/buku-besar/transfer-anggaran/page.tsx` | 1 |
| `src/app/(app)/crm/anabul/baru/page.tsx` | 1 |
| `src/app/(app)/crm/kategori-pelanggan/[id]/page.tsx` | 1 |
| `src/app/(app)/crm/kategori-pelanggan/page.tsx` | 2 |
| `src/app/(app)/crm/promo/PromoFields.tsx` | 4 |
| `src/app/(app)/crm/voucher/page.tsx` | 3 |
| `src/app/(app)/hris/cuti/page.tsx` | 1 |
| `src/app/(app)/hris/karyawan/[id]/page.tsx` | 2 |
| `src/app/(app)/hris/karyawan/page.tsx` | 1 |
| `src/app/(app)/hris/komponen-gaji/page.tsx` | 2 |
| `src/app/(app)/hris/kpi/page.tsx` | 3 |
| `src/app/(app)/hris/pengajuan/page.tsx` | 1 |
| `src/app/(app)/hris/penggajian/page.tsx` | 1 |
| `src/app/(app)/kas-bank/kas/KasCorrectionForm.tsx` | 1 |
| `src/app/(app)/kas-bank/kas/KasEntryScreen.tsx` | 1 |
| `src/app/(app)/kas-bank/rekening/[id]/saldo-awal/MonetaryOpeningForm.tsx` | 1 |
| `src/app/(app)/kas-bank/rekening/page.tsx` | 1 |
| `src/app/(app)/kas-bank/transfer/TransferForm.tsx` | 2 |
| `src/app/(app)/keuangan/aset/[id]/AssetCorrectionForm.tsx` | 1 |
| `src/app/(app)/keuangan/aset/[id]/page.tsx` | 3 |
| `src/app/(app)/keuangan/aset/KategoriUmur.tsx` | 1 |
| `src/app/(app)/keuangan/aset/page.tsx` | 4 |
| `src/app/(app)/keuangan/jurnal-berulang/RecurringForm.tsx` | 4 |
| `src/app/(app)/keuangan/jurnal-berulang/SourceRecurringForm.tsx` | 2 |
| `src/app/(app)/keuangan/jurnal/JurnalCorrectionForm.tsx` | 2 |
| `src/app/(app)/keuangan/jurnal/JurnalForm.tsx` | 2 |
| `src/app/(app)/keuangan/kategori-aset-pajak/page.tsx` | 2 |
| `src/app/(app)/keuangan/kategori-aset/page.tsx` | 1 |
| `src/app/(app)/keuangan/piutang/page.tsx` | 1 |
| `src/app/(app)/keuangan/rekonsiliasi/RekonForm.tsx` | 3 |
| `src/app/(app)/keuangan/saldo-awal/SaldoAwalForm.tsx` | 1 |
| `src/app/(app)/keuangan/tutup-buku/page.tsx` | 1 |
| `src/app/(app)/klinik/aturan-demo/page.tsx` | 2 |
| `src/app/(app)/klinik/katalog-racikan/KatalogForm.tsx` | 1 |
| `src/app/(app)/klinik/maintenance/page.tsx` | 2 |
| `src/app/(app)/klinik/pembayaran/[visitId]/LunasiRombonganForm.tsx` | 2 |
| `src/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm.tsx` | 7 |
| `src/app/(app)/klinik/pengeluaran/TambahPengeluaran.tsx` | 1 |
| `src/app/(app)/klinik/permintaan/baru/PermintaanFormKlinik.tsx` | 1 |
| `src/app/(app)/klinik/rawat-inap/[id]/catatan/[logId]/LogEditForm.tsx` | 2 |
| `src/app/(app)/klinik/rawat-inap/[id]/catatan/CatatanForm.tsx` | 4 |
| `src/app/(app)/klinik/rawat-inap/[id]/ObatKhusus.tsx` | 2 |
| `src/app/(app)/klinik/registrasi/RegistrasiForm.tsx` | 1 |
| `src/app/(app)/klinik/rekam-medis/[visitId]/RekamForm.tsx` | 4 |
| `src/app/(app)/klinik/shift/page.tsx` | 2 |
| `src/app/(app)/laporan/retensi/page.tsx` | 1 |
| `src/app/(app)/pembelian/[id]/POCorrectionForm.tsx` | 2 |
| `src/app/(app)/pembelian/[id]/terima/TerimaForm.tsx` | 3 |
| `src/app/(app)/pembelian/baru/POForm.tsx` | 1 |
| `src/app/(app)/pembelian/faktur/baru/FakturForm.tsx` | 2 |
| `src/app/(app)/pembelian/faktur/langsung/FakturLangsungForm.tsx` | 2 |
| `src/app/(app)/pembelian/page.tsx` | 1 |
| `src/app/(app)/pembelian/perintah-bayar/page.tsx` | 1 |
| `src/app/(app)/pembelian/retur/baru/ReturBeliForm.tsx` | 1 |
| `src/app/(app)/pembelian/uang-muka/AdvanceForm.tsx` | 1 |
| `src/app/(app)/pengaturan/alert-operasional/AlertSettingsForm.tsx` | 2 |
| `src/app/(app)/pengaturan/cabang/page.tsx` | 3 |
| `src/app/(app)/pengaturan/gaji/page.tsx` | 6 |
| `src/app/(app)/pengaturan/operasional-klinik/page.tsx` | 1 |
| `src/app/(app)/pengaturan/pajak/page.tsx` | 1 |
| `src/app/(app)/pengaturan/penomoran/page.tsx` | 1 |
| `src/app/(app)/pengaturan/penyetuju/page.tsx` | 1 |
| `src/app/(app)/pengaturan/tier/page.tsx` | 3 |
| `src/app/(app)/penjualan/BarisJualForm.tsx` | 2 |
| `src/app/(app)/penjualan/faktur/[id]/WholesaleCorrectionForm.tsx` | 1 |
| `src/app/(app)/penjualan/faktur/page.tsx` | 1 |
| `src/app/(app)/penjualan/komisi/page.tsx` | 3 |
| `src/app/(app)/penjualan/online/baru/OnlineForm.tsx` | 2 |
| `src/app/(app)/penjualan/online/page.tsx` | 1 |
| `src/app/(app)/penjualan/pesanan/[id]/page.tsx` | 2 |
| `src/app/(app)/penjualan/retur/baru/ReturJualForm.tsx` | 1 |
| `src/app/(app)/penjualan/target/page.tsx` | 1 |
| `src/app/(app)/penjualan/uang-muka/page.tsx` | 1 |
| `src/app/(app)/pos/expense/page.tsx` | 1 |
| `src/app/(app)/pos/harga/page.tsx` | 2 |
| `src/app/(app)/pos/koreksi-stok/StockCorrectionForm.tsx` | 1 |
| `src/app/(app)/pos/pemindahan/[id]/TerimaForm.tsx` | 1 |
| `src/app/(app)/pos/pemindahan/baru/PemindahanForm.tsx` | 1 |
| `src/app/(app)/pos/penyesuaian/baru/BarisForm.tsx` | 1 |
| `src/app/(app)/pos/permintaan/[id]/page.tsx` | 2 |
| `src/app/(app)/pos/permintaan/baru/PermintaanForm.tsx` | 1 |
| `src/app/(app)/pos/produksi/page.tsx` | 2 |
| `src/app/(app)/pos/produksi/ProductionAdhocForm.tsx` | 2 |
| `src/app/(app)/pos/produksi/ResepForm.tsx` | 2 |
| `src/app/(app)/pos/quest/page.tsx` | 3 |
| `src/app/(app)/pos/shift/page.tsx` | 2 |
| `src/app/(app)/pos/sku/BarangForm.tsx` | 12 |
| `src/app/(app)/pos/transaksi/PosClient.tsx` | 2 |
| `src/app/kasir/KasirClient.tsx` | 4 |
| `src/app/kasir/KasirQuantityInput.tsx` | 1 |
| `src/app/kasir/mulai/page.tsx` | 1 |
| `src/app/kasir/opname/[id]/HitungForm.tsx` | 1 |
| `src/app/kasir/pengeluaran/page.tsx` | 1 |
| `src/app/kasir/persediaan/baru/PersediaanBaruForm.tsx` | 1 |
| `src/app/kasir/persediaan/terima/[id]/TerimaForm.tsx` | 1 |
| `src/app/kasir/tutup/TutupForm.tsx` | 1 |
| `src/app/me/CutiForm.tsx` | 1 |
| `src/app/me/PengajuanCards.tsx` | 4 |
| `src/components/CompoundEditor.tsx` | 1 |
| `src/components/pengeluaran/PengeluaranDetail.tsx` | 1 |
| `src/components/pos/PosPaymentFields.tsx` | 3 |
| `src/components/PurchasePaymentForm.tsx` | 1 |
| `src/components/PurchasePriceInput.tsx` | 1 |
| `src/components/returns/ReturnCorrectionForm.tsx` | 1 |
