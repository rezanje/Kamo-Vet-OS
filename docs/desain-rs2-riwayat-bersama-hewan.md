# RS-2 — Riwayat bersama terlihat di jalur normal pasien

Status:
- **Kode dan tes draft** sudah ada (§8). Pengerjaannya mengikuti review desain atas checkpoint 1f4b4dc: batas
  OWNER-only diterima, dan tiga koreksi sudah diterapkan di §4.3.
- **SQL final** ada di `supabase/migrations/20261104010000_rs2_riwayat_bersama_hewan.sql`. Teks §4.1 adalah ringkasan;
  bila berbeda, file migrasi yang berlaku. SQL final masih menunggu review independen.
- Tidak ada apply produksi, merge, atau deploy dalam izin saat ini. Semuanya butuh izin terpisah.
Basis: `main` 847fd9d (PR345 DP→Ranap, berisi PR342 9b7c47d).

## 1. Gejala (UAT 30 Okt 2026)

OWNER, cabang aktif klinik **VET_CMGG**. Jalurnya: CRM → Pelanggan "UJI SIM REKMED 291026" → hewan "UJI KUCING SINTETIS" → Riwayat medis
(`/klinik/rekam-medis?pet=…`). Hasilnya **0 riwayat / 0 hasil impor**, dengan pesan "Belum ada riwayat medis untuk anabul ini."

Panel RS-1 di layar impor menampilkan dua riwayat yang sama dengan benar (15/1/2026 dan 16/1/2026, diagnosis 1/2).

## 2. Akar masalah (terbukti, bukan asumsi)

1. **Halaman daftar** (`klinik/rekam-medis/page.tsx`) membaca `visits` + `medical_records!inner` langsung, tunduk RLS.
   Kode tidak punya filter cabang; yang menyaring adalah RLS + header cabang aktif.
2. **Halaman detail** (`klinik/rekam-medis/[visitId]/page.tsx`) melakukan `select … from visits where id = …`
   dengan `maybeSingle()`. Bila hasilnya kosong, halaman memanggil `notFound()`.
3. Middleware selalu mengirim `x-kamo-operational-branch` untuk `/klinik/*` sesuai cabang aktif yang dipilih
   (`mulai/cabang`). Untuk "Semua cabang" (`all`) header itu tidak diteruskan (`supabase/server.ts`).
4. Di visits ada kebijakan restrictive `operational_branch_isolation`, yaitu `user_can_access_branch(branch_id)`.
   Untuk riwayat bersama, `branch_id` bernilai NULL. Bila header ada, `v_selected <> NULL` bernilai NULL dan
   `not exists(branch NULL)` bernilai true, sehingga fungsi **mengembalikan false**. Akibatnya kunjungan disaring.
   `medical_records` ikut tersaring lewat `operational_parent_isolation` dan `mr_select`.
5. **Konteks efektif saat UAT benar-benar VET_CMGG.** UAT dilakukan dengan login baru, memilih klinik
   VET_CMGG, lalu dropdown sidebar tidak diubah. Jadi tidak ada konteks "Semua cabang" klinik yang sesungguhnya;
   header DB = VET_CMGG.
   - Dropdown "Semua Cabang" di sidebar memang hanya tampilan ("display-only for now") dan bukan konteks klinik.
   - Spanduk cabang aktif (`ActiveBranch`) dirender di layout `(app)` hanya bila ada header mode. Spanduk itu
     bisa tetap terlihat di CRM setelah navigasi sisi-klien karena layout tidak dirender ulang. Ini tidak
     mengubah query: query CRM berjalan tanpa header, sedangkan query `/klinik/rekam-medis` membawa header VET_CMGG.

### 2.1 Verifikasi produksi baca-saja (30 Okt 2026 04:28Z, terbatas dummy + katalog)

Pembungkus baca-saja hanya menerima satu SELECT/WITH dan menolak kata kunci tulis. Lingkupnya hanya UUID
dummy dan nama dummy persis. Tidak ada relink, impor ulang, atau penulisan, dan tidak ada pasien lain yang dibaca.

**Relasi dummy (exact join):**

- Pelanggan `90cfe46c-afee-4387-90bb-e29f64c68df0` "UJI SIM REKMED 291026" punya 1 hewan.
- Hewan `e3f979b2-0b67-4b46-825b-2ce0bc1409ab` "UJI KUCING SINTETIS" punya `customer_id` = pelanggan itu (cocok).
- Tepat 2 kunjungan memiliki `pet_id` = hewan itu atau `customer_id` = pelanggan itu. Keduanya cocok
  ke pet **dan** customer, tanpa cabang, berjejak impor, status Selesai, dengan 1 rekam medis masing-masing
  dan terapi terisi:

  | kunjungan | waktu (UTC) | diagnosis |
  |---|---|---|
  | `dc0e732e-ef3b-4363-b98f-f8501a06ccd7` | 2026-01-14 17:00 (15/1 WIB) | "UJI DIAGNOSIS 1 - BUKAN PASIEN NYATA" |
  | `8c944baf-0506-42da-9992-9c0f5f12bf12` | 2026-01-15 17:00 (16/1 WIB) | "UJI DIAGNOSIS 2 - BUKAN PASIEN NYATA" |

- Tidak ada pelanggan/hewan lain dengan nama dummy yang sama, dan tidak ada kunjungan lain untuk hewan
  bernama itu. Artinya dua hasil RS-1 **memang** terhubung ke UUID pet/customer di atas, tanpa duplikat.

**Konteks efektif dan drift kebijakan** (produksi PG 17.6 dibandingkan repo `main` 847fd9d di PG 17.10 lokal):

- Fungsi `user_can_access_branch`, `can_read_legacy_medical_history`, `has_role_capability`, dan `is_admin`
  identik menurut `md5(pg_get_functiondef)`.
- Kebijakan pada `visits`, `medical_records`, `pets`, `customers`, `inpatient_records`, `branches`, dan
  `profiles`: himpunannya sama (39). Semua kebijakan **SELECT** identik.
- `role_capabilities` kosong di produksi maupun lokal, sehingga OWNER memegang `all_branches` lewat
  `p.role='OWNER'`. Di produksi ada 1 profil OWNER aktif. VET_CMGG adalah cabang KLINIK aktif.
- Kesimpulan konteks: OWNER aktif + header VET_CMGG → `user_can_access_branch(NULL)` = false → kedua
  kunjungan tersaring. Dengan "Semua cabang" klinik yang sesungguhnya (header dihapus), OWNER lolos.
  Ini sama persis dengan reproduksi di bawah dan dengan pernyataan reviewer.
- **Satu drift, sisi tulis, di luar cakupan:** `medical_records.mr_write` WITH CHECK di produksi memakai
  `can_read_legacy_medical_history()`, sedangkan repo (`20260908133000`) memakai `is_admin()`. USING-nya identik.
  Drift ini tidak memengaruhi visibilitas baca. Untuk riwayat bersama, tulisan tetap ditolak oleh D2
  (`riwayat_bersama_terkunci_*`) dan oleh restrictive parent isolation. Ini dilaporkan, tidak diubah.

### Reproduksi lokal

Reproduksi memakai PG16 (dan diulang di PG17) sekali pakai, 324 migrasi repo + `20261101120000`, dan data fiktif. Isinya: satu
riwayat bersama dan satu riwayat cabang A untuk hewan berbeda. Query yang diuji setara daftar (filter pet +
inner MR), detail, MR, dan pets.

| aktor | header A: daftar / detail / MR / pet | tanpa header ("Semua cabang"): daftar / detail / MR / pet |
|---|---|---|
| OWNER | 0 / 0 / 0 / 1 | 1 / 1 / 1 / 1 |
| ADMIN (semua cabang) | 0 / 0 / 0 / 1 | 1 / 1 / 1 / 1 |
| ADMIN_A (hanya A) | 0 / 0 / 0 / 1 | 1 / 1 / 1 / 1 |
| DOCTOR | 0 / 0 / 0 / 1 | 0 / 0 / 0 / 1 |
| STAFF | 0 / 0 / 0 / 1 | 0 / 0 / 0 / 1 |

Kesimpulan dari tabel:

- Penyebabnya adalah header cabang aktif ditambah RLS restrictive, bukan data yang hilang atau duplikat.
- Hewan tetap terbaca (pet = 1). Jadi bukan RLS `pets`/`customers` yang menyebabkan halaman kosong.
- Tanpa header, OWNER dan ADMIN sudah bisa melihat riwayat ini lewat jalur normal.
  DOCTOR dan STAFF tidak bisa, karena itu wewenang D3 yang terpisah dan memang di luar cakupan ini.

Skrip reproduksi tidak dimasukkan ke repo. Kasus yang sama akan menjadi bagian harness RS-2 (§6).

## 3. Jalan pintas operasional tanpa kode (sekarang)

OWNER bisa memilih **cabang aktif klinik = "Semua cabang"** lewat "Ganti cabang" (`/mulai/cabang?mode=klinik`).
`resolveOperationalBranch` mengizinkannya untuk pemegang semua cabang. Setelah itu header tidak dikirim
dan riwayat bersama tampil di daftar maupun detail (baris OWNER, kolom kanan pada tabel §2).

Catatan: tampilan detail untuk kunjungan tanpa cabang di mode ini belum diuji di peramban. Itu masuk daftar UAT.

## 4. Usulan RS-2 (sempit, baca-saja, OWNER saja)

Prinsipnya:

- Tidak ada perubahan kebijakan SELECT yang luas.
- Tidak ada service-role, header tidak dihapus, RLS tidak di-bypass.
- Tidak ada hak tabel/kolom baru, dan role tidak diperluas.
- D1/D2 tetap.

Pola yang dipakai sama persis dengan RS-1: pembungkus publik INVOKER memanggil pembaca privat SECURITY DEFINER milik
`kamo_legacy_import_writer` (NOLOGIN, NOBYPASSRLS). Pembaca privat itu membaca lewat kebijakan `kamo_import_baca` dan
hak kolom yang **sudah ada di produksi**.

### 4.1 Objek baru (migrasi baru; satu transaksi, gagal-tertutup)

```sql
-- Validator: OWNER aktif saja; header (jika ada) harus cabang aktif yang boleh diakses. Tidak menghapus header.
create function kamo_import.pastikan_pembaca_riwayat_bersama() returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_header text;
  v_uid uuid := kamo_import.uid_permintaan();
begin
  if v_uid is null or not exists (
    select 1 from public.profiles p where p.id = v_uid and p.is_active and p.role = 'OWNER'
  ) then
    raise exception using errcode = '42501', message = 'Riwayat bersama dari cabang aktif hanya untuk OWNER aktif';
  end if;
  v_header := nullif(btrim(coalesce(nullif(current_setting('request.headers', true), '')::jsonb
                ->> 'x-kamo-operational-branch', '')), '');
  if v_header is not null and public.user_can_access_branch(v_header::uuid) is not true then
    raise exception using errcode = '42501', message = 'Cabang aktif tidak valid atau tidak boleh diakses';
  end if;
end $$;

-- Daftar per hewan: HANYA kunjungan tanpa cabang yang berjejak impor. Satu baris per kunjungan.
create function kamo_import.baca_riwayat_bersama_hewan(p_pet uuid, p_dari integer, p_jumlah integer)
returns table(visit_id uuid, pet_id uuid, customer_id uuid, tanggal timestamptz, dokter text, keluhan text,
              diagnosis text, anamnesis text, gejala_klinis text, terapi text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform kamo_import.pastikan_pembaca_riwayat_bersama();
  if p_pet is null or p_dari is null or p_jumlah is null
     or p_dari not between 0 and 10000 or p_jumlah not between 1 and 200 then
    raise exception using errcode = '22023', message = 'Hewan wajib diisi; halaman 0–10000, jumlah 1–200';
  end if;
  return query
    select v.id, v.pet_id, v.customer_id, v.created_at, v.dokter::text, v.keluhan, m.diagnosis, m.anamnesis, m.gejala_klinis, m.catatan_resep
    from public.visits v
    join public.pets p on p.id = v.pet_id and p.customer_id = v.customer_id   -- pelanggan↔hewan↔kunjungan konsisten
    join lateral (select mr.diagnosis, mr.anamnesis, mr.gejala_klinis, mr.catatan_resep
                  from public.medical_records mr where mr.visit_id = v.id order by mr.id limit 1) m on true
    where v.pet_id = p_pet and v.branch_id is null and v.legacy_source_key is not null
    order by v.created_at desc, v.id
    offset p_dari limit p_jumlah;
end $$;

-- Detail satu kunjungan: kosong bila tidak ada ATAU bercabang (tidak bisa dibedakan, jadi tidak membocorkan metadata).
create function kamo_import.baca_detail_riwayat_bersama(p_visit uuid)
returns table(visit_id uuid, pet_id uuid, customer_id uuid, tanggal timestamptz, dokter text, keluhan text,
              diagnosis text, anamnesis text, gejala_klinis text, terapi text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform kamo_import.pastikan_pembaca_riwayat_bersama();
  if p_visit is null then
    raise exception using errcode = '22023', message = 'Kunjungan wajib diisi';
  end if;
  return query
    select v.id, v.pet_id, v.customer_id, v.created_at, v.dokter::text, v.keluhan, m.diagnosis, m.anamnesis, m.gejala_klinis, m.catatan_resep
    from public.visits v
    join public.pets p on p.id = v.pet_id and p.customer_id = v.customer_id
    join lateral (select mr.diagnosis, mr.anamnesis, mr.gejala_klinis, mr.catatan_resep
                  from public.medical_records mr where mr.visit_id = v.id order by mr.id limit 1) m on true
    where v.id = p_visit and v.branch_id is null and v.legacy_source_key is not null;
end $$;

-- Pembungkus publik INVOKER (identitas & header asli pemanggil).
create function public.riwayat_bersama_hewan(p_pet uuid, p_dari integer, p_jumlah integer)
returns table(visit_id uuid, pet_id uuid, customer_id uuid, tanggal timestamptz, dokter text, keluhan text,
              diagnosis text, anamnesis text, gejala_klinis text, terapi text)
language sql stable security invoker set search_path = '' as $$
  select * from kamo_import.baca_riwayat_bersama_hewan(p_pet, p_dari, p_jumlah)
$$;
create function public.detail_riwayat_bersama(p_visit uuid)
returns table(visit_id uuid, pet_id uuid, customer_id uuid, tanggal timestamptz, dokter text, keluhan text,
              diagnosis text, anamnesis text, gejala_klinis text, terapi text)
language sql stable security invoker set search_path = '' as $$
  select * from kamo_import.baca_detail_riwayat_bersama(p_visit)
$$;

-- ACL dulu (sebelum pindah pemilik; sesudahnya admin migrasi tidak bisa memberi hak lagi) — pola §9 PR342.
revoke all on function kamo_import.pastikan_pembaca_riwayat_bersama(),
  kamo_import.baca_riwayat_bersama_hewan(uuid, integer, integer),
  kamo_import.baca_detail_riwayat_bersama(uuid) from public, anon, authenticated, service_role;
grant execute on function kamo_import.baca_riwayat_bersama_hewan(uuid, integer, integer),
  kamo_import.baca_detail_riwayat_bersama(uuid) to authenticated;   -- pembungkus INVOKER memanggilnya sebagai authenticated
-- validator TIDAK diberi ke authenticated: hanya dipanggil fungsi milik role penulis (pemiliknya sendiri).
revoke all on function public.riwayat_bersama_hewan(uuid, integer, integer),
  public.detail_riwayat_bersama(uuid) from public, anon, service_role;
grant execute on function public.riwayat_bersama_hewan(uuid, integer, integer),
  public.detail_riwayat_bersama(uuid) to authenticated;

-- Pindah pemilik ketiga fungsi privat BARU saja ke role penulis, urutan identik §10 PR342:
-- keanggotaan sementara `with set true, inherit false` + CREATE skema sementara, lalu keduanya dicabut
-- di transaksi yang sama. Fungsi kamo_import lama tidak disentuh.
```

Ini satu-satunya langkah di luar membuat fungsi. Keanggotaan sementara di role penulis dan CREATE pada skema
`kamo_import` diberikan lalu dicabut lagi di transaksi yang sama, persis seperti yang sudah ditinjau dan dijalankan
di PR342. Gerbang memastikan setelahnya tidak ada anggota role penulis maupun CREATE pada skema.

**Tidak ada `GRANT` tabel/kolom baru dan tidak ada kebijakan baru.** Semua kolom yang dibaca sudah diberikan ke
role penulis:

- visits: `id, branch_id, pet_id, created_at, dokter, keluhan, legacy_source_key`;
- medical_records: `id, visit_id, diagnosis, anamnesis, gejala_klinis, catatan_resep`;
- profiles: `id, role, is_active`.

Nama hewan, nama pemilik, spesies, dan ras dibaca aplikasi lewat jalur normal, karena pets/customers memang
terbaca OWNER.

### 4.2 Gerbang pasca-cek dalam migrasi (gagal → seluruh transaksi batal)

- Tiga fungsi privat dimiliki `kamo_legacy_import_writer`, berjenis `prosecdef`, `STABLE`, dengan
  `proconfig = {search_path=""}`. Dua pembungkus publik berjenis INVOKER dan `STABLE`.
- ACL tepat menurut `aclexplode(coalesce(proacl, acldefault('f', proowner)))`. PUBLIC, anon, dan service_role
  tidak punya EXECUTE pada kelima fungsi. Pada validator, hanya pemiliknya yang punya EXECUTE.
- Role penulis tetap `NOLOGIN NOBYPASSRLS`, tanpa anggota setelah transaksi, dan tanpa CREATE pada `kamo_import`.
- Fungsi `kamo_import` lama (pemilik, ACL, dan definisi) identik dengan sebelum migrasi.
- Jepretan diambil di awal transaksi (fungsi sementara sesi `pg_temp.rs2_jepret`) dan dibandingkan di akhir.
  Isinya harus identik:
  - hak tabel/kolom role penulis;
  - **semua** kebijakan RLS skema `public` (nama, perintah, jenis, role, USING, WITH CHECK);
  - fungsi `kamo_import` lama ditambah `user_can_access_branch`, `can_read_legacy_medical_history`,
    `has_role_capability`, `is_admin`, `hasil_impor_rekam_medis`, dan `auth.uid` (definisi, pemilik, ACL);
  - keanggotaan dan atribut role penulis;
  - ACL skema `kamo_import`.
- Prasyarat menolak bila salah satu kondisi ini tidak terpenuhi:
  - keadaan pasca-PR342 tepat (14 fungsi `kamo_import`, role sempit);
  - sidik `auth.uid` dan kesetaraan `uid_permintaan`;
  - kebijakan `kamo_import_baca` yang diandalkan ada;
  - hak kolom yang dibaca sudah ada.

  Migrasi ini tidak memberi hak apa pun yang kurang.
- Isi fungsi diperiksa:
  - validator memuat cek OWNER aktif dan header;
  - pembaca memvalidasi sebelum `return query`;
  - pembaca hanya memuat `branch_id is null and legacy_source_key is not null`, join konsistensi pelanggan↔hewan,
    dan `limit 1` rekam medis;
  - pembaca tidak memuat DML maupun `auth.uid`;
  - batas halaman 0–10000 / 1–200;
  - pembungkus memanggil pembaca yang benar.
- Skema sementara sesi migrasi itu sendiri dikecualikan dari cek CREATE skema. Postgres melaporkan CREATE di sana
  untuk setiap role yang punya hak TEMP, padahal itu bukan hak yang diberikan, dan skema tersebut hilang di akhir sesi.

### 4.3 Aplikasi (setelah koreksi review 1–3)

**Koreksi 1 — batas 1.000 eksplisit, gabung tanpa duplikat, paginasi konsisten.**
- `bacaRiwayatBersamaHewan` (`src/lib/riwayat-bersama.ts`) membaca per 200 baris sampai halaman pendek.
- Setelah lima halaman penuh, baris ke-1.001 dicek eksplisit (`dari=1000, jumlah=1`). Bila ada, halaman gagal
  dengan pesan "melebihi 1.000 baris dan belum dapat ditampilkan lengkap". Data tidak pernah dipotong diam-diam
  dan tidak pernah diklaim lengkap. Ini sejalan dengan `readCompleteList`, yang gagal bila melebihi 10.000.
- Daftar biasa (`readCompleteList`) dan riwayat bersama digabung per `visit_id`. Baris riwayat bersama dari SELECT
  biasa (mode "Semua cabang") **diganti** baris pembaca, bukan digandakan.
- Hasil gabungan diurutkan seperti query biasa (terbaru dulu, lalu id). Pencarian dan paginasi tetap berjalan
  di atas hasil gabungan, jadi totalnya konsisten.

**Koreksi 2 — kosong ≠ gagal.**
- Galat apa pun dianggap "gagal", termasuk 42501, galat koneksi, bentuk jawaban aneh, atau jumlah baris melebihi
  permintaan. Untuk daftar, akibatnya `ListLoadFailure` dengan pesan generik, tanpa tabel dan tanpa "Belum ada riwayat".
- Daftar juga gagal bila:
  - profil atau hewan tidak terbaca;
  - ada baris yang `pet_id`/`customer_id`-nya tidak cocok;
  - ada ID ganda;
  - SELECT biasa melihat riwayat bersama yang ditolak pembaca (relasi tidak konsisten).
- Detail hanya `notFound()` bila pembaca menjawab **kosong** dan bacaan biasa tidak menemukan apa-apa tanpa galat.
  Selain itu `RekamMedisGagalDimuat` ("Rekam medis belum dapat dimuat. Coba muat ulang."), tanpa detail database.
  Galat bacaan biasa untuk kunjungan non-bersama juga menjadi pesan gagal, bukan 404.

**Koreksi 3 — renderer baca-saja yang sama di kedua mode.**
- OWNER aktif yang membuka kunjungan riwayat bersama selalu mendapat `RiwayatBersamaDetail`, baik di cabang aktif
  (SELECT biasa kosong) maupun "Semua cabang" sungguhan (SELECT biasa melihatnya). Kunjungan riwayat bersama di sini
  berarti kunjungan tanpa cabang dan berjejak impor.
- Isinya: tanggal (WIB), dokter, keluhan, anamnesis, gejala klinis, diagnosis, **terapi dari
  `medical_records.catatan_resep`** (bukan `record.therapy`), serta hewan dan pemilik dari `pets`.
  `pets.customer_id` wajib sama dengan `customer_id` pembaca.
- Halaman ini tidak punya form, tombol, tagihan, persetujuan, adendum, maupun rawat inap. Satu-satunya tautan
  kembali ke riwayat hewan.
- Daftar per hewan untuk OWNER selalu memakai pembaca, di kedua mode.

**Tidak berubah:**
- ADMIN, DOCTOR, STAFF, FINANCE, dan OWNER nonaktif (tidak ada panggilan RPC; perilaku lama);
- daftar umum tanpa `pet`;
- kunjungan bercabang;
- header (tetap dari middleware);
- tidak ada service-role, tidak ada pindah cabang, tidak ada relink.

### 4.4 Prototipe lokal (bukan tes final, bukan produksi)

SQL §4.1 dijalankan di PG16 sekali pakai di atas 324 migrasi repo + `20261101120000`, dengan data fiktif
dan pemindahan pemilik ala §10 PR342.

| uji | hasil |
|---|---|
| OWNER, header A atau tanpa header | daftar 1 baris (diagnosis benar); detail riwayat bersama 1 baris |
| OWNER, detail kunjungan cabang A, cabang B, atau UUID acak | 0 baris, ketiganya identik |
| OWNER, hewan yang hanya punya riwayat bercabang | daftar 0 baris |
| kunjungan bersama dengan `pet_id` hewan X tapi `customer_id` bukan pemilik X | tidak muncul di daftar X; detail 0 baris |
| ID keluaran daftar | `visit_id`/`pet_id`/`customer_id` cocok persis dengan fixture |
| OWNER, header cabang C nonaktif | ditolak "Cabang aktif tidak valid" |
| ADMIN, DOCTOR, STAFF, OWNER nonaktif (header apa pun) | ditolak "hanya untuk OWNER" |
| batas halaman/jumlah (−1, 0, 201, 10001) | ditolak |
| query langsung OWNER dengan header A setelah RS-2 | tetap 0 (RLS normal tidak melebar) |
| katalog | privat: pemilik role penulis, SECURITY DEFINER, STABLE; validator hanya pemilik; publik: INVOKER STABLE, EXECUTE `authenticated` saja; role penulis tanpa anggota, tanpa CREATE skema |

## 5. Mengapa aman (ringkas)

- **Tidak ada SELECT luas.** RLS normal tidak diubah. Query langsung di bawah header tetap 0 (diuji ulang di
  harness sebagai kontrol). Yang ditambahkan hanya dua pintu baca sempit.
- **Tidak ada kebocoran lintas cabang.** Pembaca hanya mengembalikan baris `branch_id IS NULL AND
  legacy_source_key IS NOT NULL`. ID kunjungan bercabang (A atau B) menghasilkan jawaban kosong yang identik
  dengan UUID acak, tanpa jumlah, sidik, atau cabang.
- **Tidak ada penulisan.** Fungsi `STABLE` sehingga DML di dalamnya ditolak Postgres. Tidak ada kebijakan
  INSERT/UPDATE/DELETE baru. D2 tetap berlaku.
- **Identitas asli.** Pembungkus INVOKER membawa JWT dan header yang dipilih middleware. Header tidak dihapus
  atau diganti. Header rusak atau cabang tidak sah ditolak 42501.
- **Relasi konsisten.** Pembaca hanya mengembalikan kunjungan yang `customer_id`-nya sama dengan pemilik hewan di
  `pets`, dan ikut mengembalikan `pet_id`/`customer_id`. Aplikasi menolak baris yang tidak cocok dengan pet/customer
  halaman.
- **Hanya OWNER.** ADMIN, DOCTOR, STAFF, FINANCE, OWNER nonaktif, dan anon ditolak. Perluasan ke ADMIN atau
  dokter adalah keputusan terpisah (D3).

## 6. Rencana tes (terlaksana, lihat §8)

**Harness SQL** (PG16 dan PG17, data fiktif): harness baru, atau perluasan `test-impor-rekam-medis-rls-postgres.py`.

- Positif:
  - OWNER dengan header A atau tanpa header mendapat daftar riwayat bersama hewan dengan isi klinis yang benar,
    dan detailnya juga.
  - Hewan yang hanya punya riwayat bercabang menghasilkan daftar kosong.
- Negatif peran: ADMIN, ADMIN_A, DOCTOR, FINANCE, STAFF, OWNER nonaktif, tanpa JWT, dan anon ditolak 42501.
- Negatif header: cabang C nonaktif, cabang yang tidak boleh diakses, JSON rusak, dan UUID rusak ditolak 42501.
- Kebocoran: detail dengan ID kunjungan cabang A, cabang B, dan UUID acak menghasilkan kosong yang identik.
  Daftar untuk hewan dengan campuran baris tidak pernah memuat baris bercabang.
- Konsistensi: `visit_id`↔`pet_id`↔`customer_id` dicek pada setiap baris; tautan silang tidak muncul.
- Batas:
  - halaman −1 atau 10001, jumlah 0 atau 201, serta argumen NULL ditolak 22023;
  - paginasi stabil, tanpa tumpang-tindih atau baris hilang antarhalaman;
  - dua MR pada satu kunjungan tetap menghasilkan satu baris.
- Tulis:
  - fungsi tidak bisa dipakai untuk DML;
  - `authenticated` tetap tidak bisa INSERT/UPDATE/DELETE riwayat bersama (D2, kontrol ulang);
  - pembungkus tidak bisa dipanggil anon.
- Kontrol: query langsung di bawah header tetap 0, sehingga RLS normal terbukti tidak melebar.
- Katalog: kepemilikan, ACL, `search_path`, volatilitas. Mutan migrasi (misalnya validator tanpa cek peran,
  pembaca tanpa `branch_id is null`, atau ACL ke anon) harus membuat gerbang membatalkan transaksi.
- Regresi: suite PR342 (394 kasus RLS dan 61 kasus importer) serta harness lain yang terdampak tetap hijau.

**Vitest:**

- pemetaan baris RPC;
- penggabungan dan dedup per `visit_id`;
- RPC hanya dipanggil untuk OWNER, `pet`, dan cabang spesifik;
- 42501 dilewati, sedangkan galat lain memunculkan pemberitahuan;
- fallback detail baca-saja, dan `notFound` saat kosong atau galat;
- batas 1.000 baris.

**Lint, typecheck, build, Technical checks** di head final PR.

## 7. Di luar cakupan / keputusan terpisah

- ADMIN atau DOCTOR melihat riwayat bersama dari cabang aktif (D3).
- Daftar rekam medis umum tanpa `pet` di bawah cabang aktif.
- Mengubah dropdown sidebar "Semua Cabang" yang saat ini hanya tampilan. Ini opsional sebagai perbaikan UX
  terpisah, misalnya diberi teks "ganti cabang aktif di sini".
- Impor ulang, audit backlog, dan data pasien asli: tidak disentuh.
- Produksi (migrasi, apply, merge, deploy) selalu menunggu review persis dan izin spesifik.

## 8. Implementasi draft dan hasil tes (30 Okt 2026)

**File:**

- `supabase/migrations/20261104010000_rs2_riwayat_bersama_hewan.sql`: prasyarat, jepretan, 3 fungsi privat,
  2 pembungkus, ACL, pindah pemilik, dan gerbang.
- `src/lib/riwayat-bersama.ts`: pembaca aplikasi (paging, cek baris ke-1.001, validasi relasi, gagal ≠ kosong).
- `src/app/(app)/klinik/rekam-medis/page.tsx`: gabung daftar per hewan untuk OWNER.
- `src/app/(app)/klinik/rekam-medis/[visitId]/page.tsx` dan `RiwayatBersamaDetail.tsx`: renderer baca-saja
  serta pesan gagal generik.
- `scripts/test-riwayat-bersama-hewan-postgres.py`: harness SQL RS-2.
- `scripts/test-impor-rekam-medis-rls-postgres.py`: perubahan kecil saja. Migrasi turunan dikecualikan dari
  bootstrap PR342, dan ada kait `after` di emulasi hosted. Kasus PR342 tidak diubah.
- `src/lib/__tests__/riwayat-bersama.test.ts` dan `src/components/__tests__/riwayat-bersama-pages.test.tsx`.

**Hasil (lokal, Postgres sekali pakai, data fiktif; tidak ada panggilan produksi):**

| uji | hasil |
|---|---|
| Harness RS-2 PG16 / PG17 | 89/89 dan 89/89 |
| Rincian harness RS-2 | 16 mutan (validator tanpa OWNER/header, pembaca tanpa syarat tanpa-cabang/relasi/validasi, batas dilonggarkan, VOLATILE, pembungkus DEFINER, EXECUTE ke anon/validator ke authenticated, hak kolom baru, kebijakan SELECT luas, fungsi akses cabang diubah, role tetap bisa di-SET, auth.uid berubah, kebijakan baca hilang): semua batal tanpa sisa dan katalog lama utuh. Ditambah positif OWNER (header A dan tanpa header), kebocoran (cabang A/B, UUID acak, tautan silang, tanpa jejak, tanpa MR), dua MR → satu baris, paginasi 205 baris, batas, 7 peran/identitas ditolak, anon, validator privat, header rusak/nonaktif/tidak ada, kontrol RLS normal tak berubah, D2 tetap menolak tulis, katalog/ACL, pasang dua kali ditolak, emulasi runner non-superuser |
| Regresi PR342 RLS PG16 / PG17 | 394/394 dan 394/394 |
| Regresi importer lama | 61/61 |
| Ranap mitigasi (PR345) | 66/66 |
| Terapi klinik | lulus |
| Suite 18 harness yang memasang semua migrasi | status dan galat identik dengan `main` 847fd9d (2 lulus, 16 gagal bawaan sebelum/di luar RS-2, misalnya tiruan `auth.jwt` dan DP minimal) |
| Vitest baru | 51/51 (22 modul + 29 halaman) |
| `npm test` penuh | 5055 lulus, 1 dilewati (bawaan) |
| `npm run lint` dan `tsc --noEmit` | bersih |
| `npm run build` | lulus. Percobaan pertama kehabisan memori karena berjalan bersamaan dengan harness Postgres; lulus saat diulang dengan heap 8 GB |
| CI `Technical checks` | hijau di 5e7110a (run 41005054554) |

**Gerbang hosted sebelum apply.** Ini terpisah dan butuh izin. Bacaan katalog baca-saja diperlukan untuk:

- memastikan runner masih memegang keanggotaan ADMIN-only atas `kamo_legacy_import_writer` (syarat pindah
  pemilik §7 migrasi);
- memastikan 14 fungsi `kamo_import` pasca-PR342 utuh.

**Belum diuji:** UAT peramban di Production. Migrasi ini belum dipasang di mana pun selain Postgres lokal sekali pakai.
