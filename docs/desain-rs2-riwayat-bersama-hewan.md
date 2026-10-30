# RS-2 — Riwayat bersama terlihat di jalur normal pasien (checkpoint desain)

Status: **USULAN, belum diimplementasi.** Menunggu review independen sebelum kode keamanan/migrasi ditulis.
Tidak ada apply produksi, merge, atau deploy dalam izin saat ini.
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
5. **Dropdown "Semua Cabang" di sidebar hanya tampilan.** Sidebar sendiri menyebutnya "display-only for now".
   Dropdown itu tidak mengubah cabang aktif, jadi header tetap VET_CMGG. Inilah sebabnya demo terlihat
   "Semua cabang" padahal datanya tersaring per cabang.

### Reproduksi lokal

Reproduksi memakai PG16 sekali pakai, 324 migrasi repo + `20261101120000`, dan data fiktif. Isinya: satu
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
returns table(visit_id uuid, tanggal timestamptz, dokter text, keluhan text,
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
    select v.id, v.created_at, v.dokter::text, v.keluhan, m.diagnosis, m.anamnesis, m.gejala_klinis, m.catatan_resep
    from public.visits v
    join lateral (select mr.diagnosis, mr.anamnesis, mr.gejala_klinis, mr.catatan_resep
                  from public.medical_records mr where mr.visit_id = v.id order by mr.id limit 1) m on true
    where v.pet_id = p_pet and v.branch_id is null and v.legacy_source_key is not null
    order by v.created_at desc, v.id
    offset p_dari limit p_jumlah;
end $$;

-- Detail satu kunjungan: kosong bila tidak ada ATAU bercabang (tidak bisa dibedakan, jadi tidak membocorkan metadata).
create function kamo_import.baca_detail_riwayat_bersama(p_visit uuid)
returns table(visit_id uuid, pet_id uuid, tanggal timestamptz, dokter text, keluhan text,
              diagnosis text, anamnesis text, gejala_klinis text, terapi text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform kamo_import.pastikan_pembaca_riwayat_bersama();
  if p_visit is null then
    raise exception using errcode = '22023', message = 'Kunjungan wajib diisi';
  end if;
  return query
    select v.id, v.pet_id, v.created_at, v.dokter::text, v.keluhan, m.diagnosis, m.anamnesis, m.gejala_klinis, m.catatan_resep
    from public.visits v
    join lateral (select mr.diagnosis, mr.anamnesis, mr.gejala_klinis, mr.catatan_resep
                  from public.medical_records mr where mr.visit_id = v.id order by mr.id limit 1) m on true
    where v.id = p_visit and v.branch_id is null and v.legacy_source_key is not null;
end $$;

-- Pembungkus publik INVOKER (identitas & header asli pemanggil).
create function public.riwayat_bersama_hewan(p_pet uuid, p_dari integer, p_jumlah integer)
returns table(visit_id uuid, tanggal timestamptz, dokter text, keluhan text,
              diagnosis text, anamnesis text, gejala_klinis text, terapi text)
language sql stable security invoker set search_path = '' as $$
  select * from kamo_import.baca_riwayat_bersama_hewan(p_pet, p_dari, p_jumlah)
$$;
create function public.detail_riwayat_bersama(p_visit uuid)
returns table(visit_id uuid, pet_id uuid, tanggal timestamptz, dokter text, keluhan text,
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
- Daftar hak tabel/kolom serta kebijakan `kamo_import_*` identik dengan keadaan sebelum migrasi
  (snapshot dihitung di awal transaksi dan dibandingkan di akhir).
- Sidik `auth.uid` dan `kamo_import.uid_permintaan` tidak berubah (gerbang yang sama dengan PR342).
- Definisi `user_can_access_branch`, `operational_branch_isolation`, dan `visits_select` tidak berubah.

### 4.3 Aplikasi

- **Daftar** (`/klinik/rekam-medis?pet=…`): RPC dipanggil hanya bila tiga syarat terpenuhi:
  - ada `pet`;
  - cabang aktif spesifik (header ada dan bukan `all`);
  - profil pemanggil OWNER aktif.

  RPC dibaca per 200 baris sampai habis, dengan batas 1.000 baris (lima halaman). Batas ini sama dengan
  pola `readCompleteList`. Baris RPC digabung dengan baris normal dan **dideduplikasi per `visit_id`**, lalu
  diurutkan seperti sekarang. Label cabangnya "Riwayat lama · semua cabang".

  Penanganan galat:
  - galat 42501 berarti bukan OWNER atau header tidak sah, dan RPC dilewati diam-diam;
  - galat lain memunculkan pemberitahuan kecil "Riwayat lama bersama gagal dimuat" tanpa menggagalkan riwayat cabang.

  Tanpa `pet`, daftar umum tidak berubah. Ini disengaja agar cakupannya per hewan saja.
- **Detail** (`/klinik/rekam-medis/[visitId]`): bila select normal kosong dan pemanggil OWNER, aplikasi memanggil
  `detail_riwayat_bersama`.
  - Jika ada hasil, halaman merender tampilan **baca-saja** "Riwayat lama (hasil impor)". Isinya tanggal, dokter,
    keluhan, anamnesis, gejala klinis, diagnosis, terapi, serta hewan/pemilik dari jalur normal.
  - Tidak ada form, tombol simpan, adendum, invoice, atau rawat inap. D2 tetap menolak tulisan di database.
  - Hasil kosong atau galat apa pun berujung `notFound()`, sama seperti sekarang.
- **Mode "Semua cabang"**: tidak memanggil RPC. Jalur normal sudah menampilkan riwayat, jadi tidak ada duplikasi.

### 4.4 Prototipe lokal (bukan tes final, bukan produksi)

SQL §4.1 dijalankan di PG16 sekali pakai di atas 324 migrasi repo + `20261101120000`, dengan data fiktif
dan pemindahan pemilik ala §10 PR342.

| uji | hasil |
|---|---|
| OWNER, header A atau tanpa header | daftar 1 baris (diagnosis benar); detail riwayat bersama 1 baris |
| OWNER, detail kunjungan cabang A, cabang B, atau UUID acak | 0 baris, ketiganya identik |
| OWNER, hewan yang hanya punya riwayat bercabang | daftar 0 baris |
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
- **Hanya OWNER.** ADMIN, DOCTOR, STAFF, FINANCE, OWNER nonaktif, dan anon ditolak. Perluasan ke ADMIN atau
  dokter adalah keputusan terpisah (D3).

## 6. Rencana tes (setelah desain disetujui)

**Harness SQL** (PG16 dan PG17, data fiktif): harness baru, atau perluasan `test-impor-rekam-medis-rls-postgres.py`.

- Positif:
  - OWNER dengan header A atau tanpa header mendapat daftar riwayat bersama hewan dengan isi klinis yang benar,
    dan detailnya juga.
  - Hewan yang hanya punya riwayat bercabang menghasilkan daftar kosong.
- Negatif peran: ADMIN, ADMIN_A, DOCTOR, FINANCE, STAFF, OWNER nonaktif, tanpa JWT, dan anon ditolak 42501.
- Negatif header: cabang C nonaktif, cabang yang tidak boleh diakses, JSON rusak, dan UUID rusak ditolak 42501.
- Kebocoran: detail dengan ID kunjungan cabang A, cabang B, dan UUID acak menghasilkan kosong yang identik.
  Daftar untuk hewan dengan campuran baris tidak pernah memuat baris bercabang.
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
