# VetOS — Spec Addendum: Shift, Rawat Inap, Racikan, Antrian, Inventory Approval, POS Discount, Invoice Edit, Staff Gamification

> **Untuk:** AI coding agent (Claude Code / Cursor / dsb)
> **Tech stack:** Next.js 15 App Router · TanStack Query v5 · Supabase (Postgres + RLS) · Vercel · Fonnte (WA)
> **Cara pakai:** Paste section per section sebagai satu prompt, atau seluruh file kalau context window agent cukup besar. Tiap section self-contained (schema + logic + UI + edge case) supaya bisa dieksekusi terpisah kalau perlu.
> **Catatan scope:** Section 8 (Quest/Gamification) sebelumnya di-flag sebagai di luar PKS/VetOS/2026/001 Pasal 1.2 — sekarang dimasukin atas keputusan Nje. Kalau addendum biaya ke Aldi belum jalan, itu urusan komersial terpisah; secara teknis section ini tetap dieksekusi.

---

## 0. Konvensi Global (berlaku di semua section di bawah)

- Semua tabel baru punya `branch_id uuid references branches(id)` kecuali eksplisit disebut cross-branch, dan wajib kena RLS policy pola yang sama dengan tabel existing (`auth.jwt() -> branch_id` atau setara — ikuti pola RLS yang sudah dipakai di skema VetOS saat ini, jangan bikin pola baru).
- Semua tabel transaksional pakai `created_at timestamptz default now()`, `created_by uuid references staff(id)`, `updated_at timestamptz`.
- Penamaan tabel & kolom: `snake_case`, Bahasa Inggris (konsisten dengan skema existing).
- Semua mutasi (create/update) via Next.js Server Actions, bukan client-side direct Supabase calls, kecuali untuk read-only queries dengan TanStack Query.
- Uang selalu `numeric(15,2)`, jangan pakai float.
- Setiap fitur di bawah butuh unit test minimal untuk business logic-nya (bukan UI).

---

## 1. Shift & Cash Reconciliation (Klinik + Petshop POS)

### Objective
Staff wajib buka shift dengan input modal kasir awal sebelum bisa akses POS. Di akhir shift, sistem hitung otomatis total transaksi per metode pembayaran dan minta staff input uang cash fisik untuk rekonsiliasi (deteksi selisih).

### Schema
```sql
create table pos_shifts (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references branches(id) not null,
  staff_id uuid references staff(id) not null,
  shift_type text not null check (shift_type in ('klinik','petshop')),
  opening_cash numeric(15,2) not null,
  closing_cash_actual numeric(15,2), -- diisi staff saat closing
  closing_cash_system numeric(15,2), -- dihitung sistem dari transaksi
  cash_variance numeric(15,2) generated always as (closing_cash_actual - closing_cash_system) stored,
  status text not null default 'open' check (status in ('open','closed')),
  opened_at timestamptz default now(),
  closed_at timestamptz
);

-- setiap transaksi POS wajib terikat ke shift aktif
alter table pos_transactions add column shift_id uuid references pos_shifts(id);
```

### Business Logic
- Saat staff login ke POS dan belum ada `pos_shifts` dengan `status='open'` untuk staff+branch+shift_type hari itu → paksa redirect ke layar "Mulai Shift", block semua akses menu lain.
- Satu staff hanya boleh punya 1 shift open per shift_type per waktu (validasi server-side, bukan cuma UI).
- Saat "Closing": query semua `pos_transactions` dengan `shift_id = current_shift.id`, group by `payment_method`, hitung total. Total cash method → jadi `closing_cash_system`.
- Staff input `closing_cash_actual` manual (uang fisik di kasir). Sistem hitung `cash_variance`. Kalau variance != 0, tampilkan warning tapi tetap boleh close (jangan block, cuma flag untuk laporan ke owner).
- Setelah closing, `pos_transactions` baru tidak bisa dibuat dengan `shift_id` itu lagi (enforce di server action).

### UI Requirements
- Layar "Mulai Shift": input Rp modal awal, tombol besar "Mulai Shift".
- Layar "Closing": breakdown per metode bayar (Tunai/Debit/Kredit/QRIS/E-Wallet) dengan subtotal masing-masing + grand total omset, input field "Total Uang Cash di Kasir", tampilkan selisih real-time saat staff ngetik.
- Setelah closing sukses → generate laporan shift (bisa dicetak/export) yang masuk ke dashboard manajer cabang.

### Edge Cases
- Staff logout/browser close tanpa closing shift → shift tetap `status='open'`, harus ada mekanisme force-close oleh manajer cabang dari backend kalau shift open lebih dari 24 jam.
- Refund/void transaksi yang terjadi di shift yang sudah closed → harus dicatat ke shift baru, bukan retroactive edit ke shift lama.

---

## 2. Racik Obat (Compounding)

### Objective
Resep dari dokter yang butuh diracik (bukan obat jadi) perlu instruksi detail komposisi + cara racik untuk apoteker/PCA, terpisah dari resep flat biasa.

### Schema
```sql
create table compounding_recipes (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references branches(id) not null,
  medical_record_id uuid references medical_records(id) not null,
  recipe_name text not null, -- e.g. "Mix Sirup"
  dosage_instruction text not null, -- e.g. "2x sehari 1 sendok"
  total_volume text not null, -- e.g. "60 ml"
  dosage_form text not null check (dosage_form in ('sirup','nebul','salep','puyer','kapsul','lainnya')),
  compounding_steps text not null, -- numbered steps, disimpan sebagai text/markdown
  prepared_by uuid references staff(id),
  prepared_at timestamptz,
  status text not null default 'pending' check (status in ('pending','ready','handed_over')),
  created_at timestamptz default now()
);

create table compounding_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid references compounding_recipes(id) not null,
  ingredient_name text not null, -- link ke inventory item kalau ada match
  inventory_item_id uuid references inventory_items(id),
  quantity numeric not null,
  unit text not null
);
```

### Business Logic
- Dokter isi resep di Rekam Medis seperti biasa (obat jadi via `resep_items`). Kalau ada item yang butuh diracik, dokter/apoteker bikin `compounding_recipes` terpisah yang reference `medical_record_id` yang sama.
- Saat racikan dibuat, sistem auto-deduct stok dari `compounding_ingredients` ke inventory (bukan dari obat jadi yang di-racik).
- Status `pending` → apoteker proses → `ready` → diserahkan ke pasien/rawat inap → `handed_over`.
- Layar "Racik Obat" (untuk PCA) nampilin: data pasien, catatan resep dokter, tabel racikan dengan komposisi+takaran, instruksi step-by-step, tombol "Obat Siap Diserahkan".

### Edge Cases
- Kalau ada perubahan resep setelah racikan mulai diproses (status != pending), block edit dan minta buat racikan baru + void yang lama.
- Racikan untuk pasien rawat inap harus bisa di-generate berkali-kali (racikan harian), bukan cuma sekali per medical record.

---

## 3. Rawat Inap — Status Expansion (4 states)

### Objective
Status pasien rawat inap perlu 4 kondisi: Sembuh, Stabil, Kritis, RIP (meninggal) — bukan cuma binary "boleh pulang / belum".

### Schema
```sql
alter table inpatient_records add column condition_status text not null default 'stabil'
  check (condition_status in ('stabil','kritis','sembuh','rip'));

create table inpatient_status_log (
  id uuid primary key default gen_random_uuid(),
  inpatient_record_id uuid references inpatient_records(id) not null,
  previous_status text,
  new_status text not null,
  changed_by uuid references staff(id) not null, -- harus dokter untuk transisi ke 'rip'
  notes text,
  changed_at timestamptz default now()
);
```

### Business Logic
- Setiap perubahan `condition_status` wajib tercatat di `inpatient_status_log` (siapa, kapan, catatan).
- Transisi ke `rip` **hanya boleh dilakukan oleh role dokter** (validasi role di server action, bukan cuma UI hide/show). Trigger:
  - Auto-notify WA ke pemilik dengan template khusus (bukan template rutin monitoring harian) — pakai Fonnte, trigger terpisah dari WA engine yang sudah ada.
  - `inpatient_records.discharged_at` otomatis di-set, status rawat inap jadi non-aktif dari dashboard "Total Rawat Inap".
  - Invoice tetap wajib terbit (biaya perawatan sampai saat itu tetap tertagih) — jangan block invoice generation untuk status rip.
- Transisi ke `sembuh` → trigger flow "boleh pulang" yang sudah ada (invoice generation existing tetap berlaku).

### Dashboard Requirements
- Card counter: Total Rawat Inap, Rawat Inap Hari Ini, Sembuh/Boleh Pulang, Kritis — tambahkan filter per cabang (dropdown "Semua Cabang").
- Laporan Rawat Inap Harian: tabel per tanggal dengan kondisi pasien, tindakan, keterangan, oleh dokter siapa — harus append-only (tiap entry baru, bukan overwrite).

### Edge Cases
- Perlu konfirmasi ke Aldi: apakah transisi ke `rip` butuh dual-approval (dokter + manajer cabang) sebelum WA notification terkirim, mengingat sensitivitas pesan ke pemilik. **Default assumption kalau belum dikonfirmasi: single dokter approval, tapi flag ini di UI review sebelum kirim WA (bukan auto-send instant).**

---

## 4. Antrian Real-time

### Objective
Live queue counter per poli/dokter dengan status per pasien dan tombol panggil.

### Schema
```sql
create table queue_tickets (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references branches(id) not null,
  medical_record_id uuid references medical_records(id) not null,
  queue_number text not null, -- e.g. "A001"
  poli text not null,
  doctor_id uuid references staff(id) not null,
  status text not null default 'menunggu' check (status in ('menunggu','diperiksa','selesai')),
  estimated_wait_minutes int,
  called_at timestamptz,
  created_at timestamptz default now()
);
```

### Business Logic
- `queue_number` auto-generate per branch per hari, format `[Huruf][3 digit]`, reset tiap hari.
- Realtime update pakai Supabase Realtime subscription (bukan polling) supaya dashboard antrian update live tanpa refresh — pakai channel per `branch_id`.
- Tombol "Panggil" → update `status` jadi `diperiksa`, set `called_at`, dan trigger notifikasi visual/audio di layar tunggu (kalau ada display terpisah — kalau belum ada requirement display terpisah, cukup update status di dashboard staff).
- Counter "Informasi Poli" di sidebar: hitung `count(*) where status='menunggu' group by poli`.

### UI Requirements
- Tab filter: Semua Antrian / Menunggu / Sedang Diperiksa / Selesai.
- Panel "Panggilan Berikutnya" nampilin antrian paling atas di status `menunggu`, dengan tombol "Panggil Sekarang" yang besar dan jelas.
- Estimasi waktu tunggu — hitung sederhana dulu: `posisi_dalam_antrian * rata_rata_waktu_periksa` (rata-rata bisa hardcode 20 menit dulu untuk v1, jangan over-engineer dengan ML prediction).

---

## 5. Permintaan & Penerimaan Barang (Inter-branch Stock Approval)

### Objective
Workflow permintaan stok dari cabang ke gudang pusat dengan approval chain dan rekonsiliasi barang diterima vs dipesan.

### Schema
```sql
create table stock_requests (
  id uuid primary key default gen_random_uuid(),
  request_number text unique not null, -- format PRM-YYMMDD-NNN
  from_branch_id uuid references branches(id) not null,
  to_warehouse_id uuid references warehouses(id) not null,
  priority text not null default 'normal' check (priority in ('normal','tinggi')),
  status text not null default 'menunggu_persetujuan'
    check (status in ('menunggu_persetujuan','disetujui','dikirim','selesai','ditolak')),
  notes text,
  requested_by uuid references staff(id) not null,
  approved_by uuid references staff(id),
  created_at timestamptz default now()
);

create table stock_request_items (
  id uuid primary key default gen_random_uuid(),
  stock_request_id uuid references stock_requests(id) not null,
  inventory_item_id uuid references inventory_items(id) not null,
  qty_requested int not null,
  notes text -- e.g. "stok menipis", "untuk promo akhir minggu"
);

create table stock_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_number text unique not null, -- format TRM-YYMMDD-NNN
  stock_request_id uuid references stock_requests(id) not null,
  received_by uuid references staff(id) not null,
  received_at timestamptz default now(),
  attachment_url text
);

create table stock_receipt_items (
  id uuid primary key default gen_random_uuid(),
  stock_receipt_id uuid references stock_receipts(id) not null,
  inventory_item_id uuid references inventory_items(id) not null,
  qty_ordered int not null,
  qty_received int not null,
  condition text not null default 'baik' check (condition in ('baik','rusak','kurang')),
  notes text
);
```

### Business Logic
- Status flow linear: `menunggu_persetujuan → disetujui → dikirim → selesai`, atau `menunggu_persetujuan → ditolak` (terminal).
- Approval hanya bisa dilakukan role Kepala Gudang / Manajer (bukan staff biasa) — validasi role di server action.
- Saat `stock_receipts` dibuat, auto-update `inventory_items` stok di cabang tujuan sesuai `qty_received` (bukan `qty_ordered` — penting, karena bisa ada selisih).
- Kalau `qty_received != qty_ordered`, auto-flag selisih di UI (tampilkan "Selisih: X") dan simpan di `notes` kalau ada keterangan kondisi rusak/kurang.
- Scan barcode saat penerimaan → lookup `inventory_items` by barcode, auto-fill baris item, staff tinggal konfirmasi qty.

### UI Requirements
- List permintaan dengan filter status, tanggal, keterangan status berwarna (badge: biru=menunggu, hijau=disetujui, orange=dikirim, hijau tua=selesai, merah=ditolak).
- Form "Buat Permintaan Barang": search item, input qty per item, catatan opsional per item.
- Form "Penerimaan Barang": tabel dipesan vs diterima side-by-side, dropdown kondisi per item, ringkasan total dipesan/diterima/selisih di footer.

---

## 6. POS — Item-level Discount + Promo Receipt Breakdown

### Objective
Diskon bisa diterapkan per item di cart (bukan cuma total transaksi), dan struk cetak harus breakdown promo yang dipakai.

### Schema
```sql
alter table pos_transaction_items add column item_discount_type text check (item_discount_type in ('nominal','percent'));
alter table pos_transaction_items add column item_discount_value numeric(15,2) default 0;
alter table pos_transaction_items add column promo_id uuid references promos(id); -- nullable, kalau diskon manual bukan dari promo terdaftar

alter table pos_transactions add column voucher_code text;
alter table pos_transactions add column points_redeemed int default 0;
```

### Business Logic
- Subtotal per item = `qty * unit_price - item_discount_amount` (hitung dari `item_discount_type` + `item_discount_value`).
- Total transaksi = sum(subtotal per item) - diskon_total_transaksi - nilai_poin_digunakan.
- Struk cetak (dan record digital) harus nampilin breakdown: per item dengan diskon yang dipakai (kalau ada), lalu section terpisah untuk diskon/voucher level transaksi, biar customer bisa lihat promo mana yang kepake di mana.
- **Reminder Promo popup**: saat cart berubah (item ditambah), cek rule engine promo aktif (bundling, tebus murah) yang match dengan isi cart → tampilkan popup non-blocking "Reminder Promo" dengan saran promo yang bisa ditawarkan kasir ke customer. Ini rekomendasi, bukan auto-apply — kasir yang decide apply atau nggak.

### Edge Cases
- Diskon item + diskon total + poin redeem bisa jalan bersamaan — pastikan urutan kalkulasi konsisten (item discount dulu, baru transaction discount, baru poin) dan didokumentasikan jelas di kode biar gak ambigu pas debugging.

---

## 7. Invoice Editability + Audit Log

### Objective
Invoice yang sudah dibuat harus bisa diedit (dikonfirmasi dari mockup Aldi), dengan audit trail wajib mengingat ini sistem finansial.

> **Catatan:** audit logging di bawah ini diimplementasikan sebagai default best-practice untuk ERP finansial. Kalau Aldi eksplisit bilang gak perlu, ini gampang di-strip belakangan — tapi jangan skip dari awal, karena retrofit audit log ke invoice yang udah jalan jauh lebih mahal daripada bikin dari awal.

### Schema
```sql
create table invoice_edit_log (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references invoices(id) not null,
  edited_by uuid references staff(id) not null,
  field_changed text not null,
  old_value text,
  new_value text,
  reason text, -- opsional tapi disarankan wajib diisi kalau field = total/item
  edited_at timestamptz default now()
);
```

### Business Logic
- Invoice dengan status `lunas` (sudah full paid) **tidak boleh diedit langsung** — harus lewat proses "Void & Reissue" (buat invoice baru, invoice lama di-mark `voided` dengan reference ke invoice baru). Ini standar akuntansi, jangan biarkan invoice lunas diedit diam-diam.
- Invoice dengan status `belum_lunas` / `dp` boleh diedit langsung, tapi setiap perubahan field signifikan (item obat/jasa, qty, harga, diskon) wajib nulis row baru ke `invoice_edit_log`.
- Server action untuk edit invoice wajib diff old vs new value sebelum commit, dan block silent overwrite tanpa log (jangan trust client-side untuk generate log entry).
- UI: tampilkan badge "Diedit" + link "Lihat Riwayat Perubahan" di layar invoice kalau ada entry di `invoice_edit_log`.

### Edge Cases
- Auto-journal ke modul Finance (yang sudah ada di PRD v1.1) harus re-trigger kalau invoice diedit setelah journal pertama terbentuk — jangan biarkan buku besar out-of-sync dari invoice yang sudah diubah. Ini titik kritis, tandain sebagai priority tinggi saat testing.

---

## 8. Staff Gamification (Quest System)

### Objective
Sistem gamifikasi untuk staff kasir/frontliner — Daily Quest & Monthly Quest berbasis target penjualan, streak harian, leaderboard per cabang, dan katalog reward yang bisa ditukar poin. Tujuannya dorong sales performance staff, bukan program loyalitas customer (itu sistem terpisah, sudah ada di Modul 02 — tier Silver/Gold/dst). **Jangan gabung dua sistem poin ini** — beda currency, beda tujuan, beda owner (staff vs customer).

### Schema
```sql
create table staff_quest_definitions (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references branches(id), -- nullable = berlaku semua cabang
  quest_type text not null check (quest_type in ('daily','monthly')),
  title text not null, -- e.g. "Jual 5 Royal Canin Kitten 2kg"
  target_kind text not null check (target_kind in ('product_qty','category_qty','total_sales_amount')),
  target_ref_id uuid, -- inventory_item_id atau category_id, null kalau target_kind = total_sales_amount
  target_value numeric not null, -- qty atau nominal Rp
  points_reward int not null,
  is_active boolean default true,
  created_by uuid references staff(id),
  created_at timestamptz default now()
);

create table staff_quest_progress (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid references staff(id) not null,
  quest_definition_id uuid references staff_quest_definitions(id) not null,
  period_key text not null, -- 'YYYY-MM-DD' untuk daily, 'YYYY-MM' untuk monthly
  current_value numeric not null default 0,
  status text not null default 'in_progress' check (status in ('in_progress','completed','claimed')),
  completed_at timestamptz,
  claimed_at timestamptz,
  unique (staff_id, quest_definition_id, period_key)
);

create table staff_points (
  staff_id uuid primary key references staff(id),
  total_points int not null default 0,
  updated_at timestamptz default now()
);

create table staff_points_ledger (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid references staff(id) not null,
  points_delta int not null, -- positif = earn, negatif = redeem
  source_type text not null check (source_type in ('quest_completion','streak_bonus','reward_redemption','manual_adjustment')),
  source_id uuid, -- reference ke quest_progress_id / redemption_id
  notes text,
  created_at timestamptz default now()
);

create table staff_streaks (
  staff_id uuid primary key references staff(id),
  current_streak_days int not null default 0,
  longest_streak_days int not null default 0,
  last_active_date date,
  updated_at timestamptz default now()
);

create table staff_reward_catalog (
  id uuid primary key default gen_random_uuid(),
  reward_name text not null, -- e.g. "Voucher Diskon 10%"
  reward_type text not null check (reward_type in ('discount_voucher','free_shipping','free_product','bonus_points')),
  points_cost int not null,
  reward_value jsonb, -- fleksibel: {"discount_pct": 10} atau {"product_id": "..."} dsb
  is_active boolean default true
);

create table staff_reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid references staff(id) not null,
  reward_catalog_id uuid references staff_reward_catalog(id) not null,
  points_spent int not null,
  status text not null default 'pending_fulfillment' check (status in ('pending_fulfillment','fulfilled','cancelled')),
  redeemed_at timestamptz default now(),
  fulfilled_by uuid references staff(id),
  fulfilled_at timestamptz
);
```

### Business Logic
- **Quest progress tracking**: tiap kali `pos_transactions` berstatus `paid` (bukan draft/void), trigger job yang cek semua `staff_quest_definitions` aktif untuk staff kasir yang bersangkutan, match `target_kind`:
  - `product_qty` → sum qty item dengan `inventory_item_id = target_ref_id` di transaksi hari ini/bulan ini.
  - `category_qty` → sum qty item dalam kategori itu.
  - `total_sales_amount` → sum total transaksi staff itu di periode berjalan.
  - Update `staff_quest_progress.current_value`. Kalau `current_value >= target_value` dan status masih `in_progress` → set `completed`, insert row ke `staff_points_ledger` (auto-award, staff tetap harus klik "Klaim" di UI untuk pindah status ke `claimed` — biar ada momen positive reinforcement, bukan silent background credit).
  - **Void/refund transaksi** yang sudah kepakai buat quest progress → decrement `current_value` proporsional, dan kalau quest sudah `claimed`, jangan tarik balik poin yang sudah diklaim (accept the loss, jangan bikin staff pusing gara-gara refund customer) — cukup log anomali ini untuk review manajer.
- **Streak**: dihitung dari `last_active_date` — kalau staff punya minimal 1 transaksi selesai hari ini dan `last_active_date` = kemarin, `current_streak_days += 1`. Kalau `last_active_date` < kemarin (ada hari bolong), reset ke 1. Job ini jalan sebagai bagian dari transaksi POS pertama staff tiap hari, bukan cron terpisah.
- Bonus streak (poin ekstra tiap kelipatan streak tertentu, misal tiap 5 hari) — nilai bonus configurable, jangan hardcode.
- **Daily quest reset**: `period_key` untuk daily otomatis ganti tiap hari (tanggal baru = row progress baru, quest_definition-nya tetap sama, cukup query ulang). Tampilkan countdown "Reset dalam: HH:MM:SS" di UI dihitung dari waktu sekarang ke tengah malam (timezone cabang, WIB default).
- **Leaderboard**: ranking per `branch_id`, periode bulan berjalan, `order by total_points desc` dari `staff_points_ledger` yang di-sum per staff per bulan (bukan dari `staff_points.total_points` yang lifetime — leaderboard harus reset tiap bulan, jangan pakai running total). Query: `sum(points_delta) where source_type='quest_completion' and created_at in current_month group by staff_id`.
- **Redeem reward**: validasi `staff_points.total_points >= points_cost` di server sebelum insert redemption, langsung deduct via ledger entry negatif. Status `pending_fulfillment` — reward fisik/voucher perlu di-approve/serahkan manual oleh manajer cabang (tandain di dashboard manajer), baru diubah ke `fulfilled`.

### UI Requirements
- Dashboard Quest (halaman staff): 4 card ringkasan (Total Poin, Quest Selesai, Streak Harian, Reward Terklaim), progress bar Daily Quest & Monthly Quest, tab switch antara keduanya.
- List quest aktif dengan progress bar per quest (current/target), tombol "Klaim" muncul kalau `status='completed'`.
- Kalender streak mingguan (checkmark per hari + flame icon di hari aktif).
- Leaderboard bulan ini — top 3 dengan trophy icon, list lengkap di bawahnya, link "Lihat Selengkapnya".
- Katalog reward — grid card dengan poin cost per item, tombol "Tukar" (disabled kalau poin gak cukup).

### Admin/Config Requirements (Owner/Manajer)
- Quest definitions **wajib bisa dikonfigurasi dari dashboard**, bukan hardcoded di kode — owner/manajer cabang perlu bisa bikin quest baru (pilih produk/kategori/nominal target, set poin reward, set daily/monthly, aktif per cabang mana aja) tanpa minta tolong developer tiap kali mau ganti target bulanan.
- Reward catalog juga configurable dari dashboard yang sama.

### Edge Cases
- Staff pindah cabang di tengah bulan → leaderboard & quest progress ikut `branch_id` transaksi, bukan `branch_id` staff — jadi kalau pindah cabang, progress lama tetap nempel di cabang lama (jangan migrate).
- Kolusi antar staff (misal transaksi fiktif buat kejar target) — di luar scope teknis untuk dicegah otomatis di v1, tapi pastikan `staff_points_ledger` immutable (no update/delete, cuma insert) supaya kalau ketauan curang, ada jejak audit yang bisa ditelusuri manajer.
- Reward `discount_voucher` yang di-redeem staff — ini voucher buat siapa? Kalau buat staff sendiri (bukan dikasih ke customer), perlu tabel voucher terpisah yang link ke akun staff tsb, bukan ke sistem promo customer di Section 6. **Perlu konfirmasi ke Aldi**: reward ini dipakai staff pribadi atau staff yang nentuin dikasih ke customer mana? Ini nentuin arsitektur redemption-nya, jangan asal asumsi.

---

## Urutan Eksekusi yang Disarankan

1. Section 1 (Shift) — foundational, POS transaction lain depend ke `shift_id`.
2. Section 6 (Item discount) + Section 7 (Invoice edit) — sama-sama nyentuh flow transaksi/invoice, kerjain berbarengan biar gak dua kali migrasi.
3. Section 2 (Racikan) + Section 3 (Rawat Inap status) — sama-sama nyentuh medical record flow.
4. Section 4 (Antrian) — bisa paralel, gak dependent ke yang lain.
5. Section 5 (Stock approval) — independent, bisa dikerjain kapan aja.
6. **Section 8 (Quest/Gamification) — kerjain PALING TERAKHIR.** Dia depend ke `pos_transactions.status='paid'` yang harus sudah stabil dari Section 1 & 6, dan trigger-nya nempel di alur checkout — kalau dikerjain duluan, bakal ada banyak rework pas Section 1/6 berubah.
