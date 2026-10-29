# Desain: impor rekam medis gagal di cabang aktif (RLS `operational_branch_isolation`)

Status: **DESAIN untuk review — belum ada implementasi, migrasi, atau perubahan Production.**
Basis: `main` `a561b05`. Repro hanya di Postgres 17.10 sekali-pakai dengan data fiktif.

## 1. Gejala (UAT live 29 Okt 17:15 UTC, dilaporkan)
OWNER, cabang aktif VET_CMGG, folder sintetis 1 pemilik / 1 hewan / 2 tab → `0 tersimpan, 0 sudah ada, 2 ditahan`,
alasan `new row violates row-level security policy "operational_branch_isolation" for table "visits"`. Pembacaan
terbatas: 0 pelanggan, 0 riwayat untuk nama/HP uji.

## 2. Diagnosis (dibuktikan sendiri, konteks authenticated + header seperti server aplikasi)
Repro: role `authenticated`, `request.jwt.claim.sub` = OWNER/ADMIN fiktif, dan
`request.headers = {"x-kamo-operational-branch": "<cabang>"}` — persis yang dikirim `src/lib/supabase/server.ts`
saat cabang aktif bukan "Semua cabang".

| Aktor | Header cabang | Simpan massal | Per baris | Pelanggan/anabul tersisa |
|---|---|---|---|---|
| OWNER | tidak ada | 2 tersimpan | tersimpan | 1/1 |
| OWNER | ada | **2 ditahan (RLS visits)** | **ERROR RLS visits** | **0/0** (dibatalkan subtransaksi) |
| ADMIN | tidak ada | 2 tersimpan | tersimpan | 1/1 |
| ADMIN | ada | **2 ditahan (RLS visits)** | **ERROR RLS visits** | **0/0** |

Riwayat bersama yang SUDAH ada, dibaca OWNER: tanpa header 2 kunjungan + 2 rekam medis terlihat, kirim ulang
`sudah_ada`; **dengan header 0 terlihat**, kirim ulang ditahan RLS (dedup tidak bisa membuktikan apa pun).
`user_can_access_branch(NULL)` untuk OWNER: tanpa header `true`, dengan header `false`.

Akar masalah:
1. Impor menyimpan riwayat bersama dengan `visits.branch_id = NULL` (sengaja: lintas cabang).
2. `20261014052234` menambah kebijakan **restrictive** `operational_branch_isolation` (FOR ALL) pada `visits`:
   `user_can_access_branch(branch_id)`. Restrictive di-AND dengan kebijakan permissive, jadi pengecualian lama di
   permissive `visits_write`/`visits_select` (`legacy_source_key is not null and is_admin()` /
   `can_read_legacy_medical_history()`, dari `20260908133000`) tidak lagi cukup.
3. `user_can_access_branch` (versi `20261017090000`): bila header cabang ada, `v_selected <> NULL::text` bernilai
   NULL dan `not exists(... where id = NULL)` bernilai true → **false**, bahkan untuk OWNER.
4. `operational_parent_isolation` pada `medical_records` memeriksa kunjungan induk di bawah RLS pemanggil → rekam
   medis ikut tak terlihat/tertolak.
5. Harness lama (`scripts/test-impor-rekam-medis-postgres.py`) tidak pernah mengisi `request.headers`, jadi lulus
   padahal UI gagal. Ini celah tes, bukan bug di logika impor.

Temuan terkait (bukan bug impor, perlu keputusan terpisah): **DOCTOR tidak bisa melihat riwayat bersama sama sekali**
(dengan maupun tanpa header) walau `can_read_legacy_medical_history()` = true, karena `user_can_access_branch(NULL)`
selalu false untuk akun tanpa hak semua cabang. OWNER/ADMIN pun hanya melihatnya di konteks "Semua cabang".

Jalan pintas operasional yang sudah ada (tanpa perubahan kode): di mode klinik, OWNER/ADMIN bisa memilih
"Semua cabang"; header tidak dikirim, impor berjalan. Tidak dijalankan ulang di Production tanpa izin.

## 3. Alternatif

| Opsi | Inti | Penilaian |
|---|---|---|
| **A (disarankan)** | Pecah restrictive `operational_branch_isolation` pada `visits` per perintah. SELECT dan INSERT: `user_can_access_branch(branch_id) OR <kunjungan bersama impor oleh OWNER/ADMIN aktif>`. UPDATE dan DELETE: tetap ketat `user_can_access_branch(branch_id)`. | Paling sempit: hanya baris `branch_id IS NULL AND legacy_source_key IS NOT NULL`, hanya OWNER/ADMIN aktif, hanya baca+sisip. Tanpa definer-bypass, header tetap, RLS tetap aktif. |
| A+ | A, ditambah syarat penanda transaksi lokal yang hanya diset di dalam RPC impor (sisip hanya lewat RPC). | Lebih sempit lagi, tetapi menambah mekanisme baru yang perlu dibuktikan tidak bisa diset dari luar; untung kecil karena OWNER/ADMIN memang berhak impor. Tidak disarankan untuk perbaikan minimal. |
| B | RPC impor `SECURITY DEFINER` (pemilik melewati RLS). | Ditolak: bypass RLS. |
| C | RPC menghapus/mengosongkan `request.headers` sementara. | Ditolak: memalsukan konteks keamanan. |
| D | Isi `branch_id` kunjungan impor dengan cabang aktif. | Ditolak: riwayat bersama jadi lokal cabang. |
| E | Ubah `user_can_access_branch(NULL)` → true untuk OWNER/ADMIN saat ada header. | Ditolak: membuka baris NULL di 6 tabel (`sales`, `expenses`, …), bukan hanya impor. |
| F | Tidak ada perubahan; SOP "pilih Semua cabang sebelum impor". | Tanpa risiko keamanan baru, tetapi mudah lupa dan pesan galatnya membingungkan. Cocok sebagai sementara. |

## 4. Batas persis opsi A (draf, belum diterapkan)
Migrasi baru (sesudah `20261101110000`), satu transaksi, pra-cek/pasca-cek gagal tertutup:

```sql
-- Predikat sempit, satu sumber kebenaran.
create function public.shared_legacy_visit_admin(p_branch uuid, p_legacy_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_branch is null and p_legacy_key is not null and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active and p.role in ('OWNER', 'ADMIN'))
$$;
revoke all on function public.shared_legacy_visit_admin(uuid, text) from public, anon;
grant execute on function public.shared_legacy_visit_admin(uuid, text) to authenticated;

drop policy operational_branch_isolation on public.visits;
create policy operational_branch_isolation on public.visits as restrictive for select to authenticated
  using (public.user_can_access_branch(branch_id) or public.shared_legacy_visit_admin(branch_id, legacy_source_key));
create policy operational_branch_isolation_insert on public.visits as restrictive for insert to authenticated
  with check (public.user_can_access_branch(branch_id) or public.shared_legacy_visit_admin(branch_id, legacy_source_key));
create policy operational_branch_isolation_update on public.visits as restrictive for update to authenticated
  using (public.user_can_access_branch(branch_id)) with check (public.user_can_access_branch(branch_id));
create policy operational_branch_isolation_delete on public.visits as restrictive for delete to authenticated
  using (public.user_can_access_branch(branch_id));
```

- `SECURITY DEFINER` di predikat hanya untuk membaca `profiles` (pola sama dengan `is_admin`/`user_can_access_branch`);
  tidak ada penulisan dan tidak melewati RLS tabel mana pun.
- Berbeda dari `is_admin()` yang ada: predikat ini mensyaratkan `is_active`.
- Kebijakan permissive (`visits_select`, `visits_write`), tabel lain, `user_can_access_branch`, header aplikasi,
  dan RPC impor **tidak diubah**. `medical_records` ikut berfungsi karena induknya kini terlihat oleh OWNER/ADMIN.
- Efek samping yang disengaja: di cabang aktif, OWNER/ADMIN kini **melihat** riwayat bersama (diperlukan untuk
  dedup impor dan sesuai "riwayat bersama"). Tidak ada kunjungan bercabang lain yang terbuka.
- Perubahan perilaku kecil: UPDATE/DELETE kunjungan bersama oleh OWNER/ADMIN tetap hanya mungkin tanpa header
  ("Semua cabang"), sama seperti sekarang.

## 5. Rencana tes (test-first, sebelum migrasi ditulis)
Harness Postgres dengan `request.headers` diisi seperti server aplikasi; harus GAGAL di `main` dan LULUS sesudah:
- OWNER dan ADMIN, header cabang aktif: impor massal + per baris → `tersimpan`; kirim ulang → `sudah_ada`; jejak
  setara 08/62 → `sudah_ada`; rekam medis terlihat; pelanggan/anabul tercipta sekali.
- Negatif (harus tetap DITOLAK/0 baris), dengan header:
  - STAFF, DOCTOR, FINANCE: sisip kunjungan bersama ditolak; baca kunjungan bersama 0 baris; RPC impor ditolak
    oleh gerbang OWNER/ADMIN.
  - OWNER/ADMIN: sisip kunjungan `branch_id NULL` **tanpa** `legacy_source_key` ditolak (NULL biasa).
  - OWNER/ADMIN di cabang A: sisip/baca kunjungan cabang B ditolak/0 baris (lintas cabang).
  - OWNER/ADMIN: UPDATE/DELETE kunjungan bersama ditolak.
  - Profil OWNER/ADMIN `is_active = false`: ditolak.
- Seluruh kasus harness lama tetap lulus (tanpa header), plus tes repo yang memeriksa kebijakan
  (`scripts/test-employee-account-context-postgres.py`) tetap lulus.

## 6. Keputusan terpisah (tidak termasuk opsi A kecuali disetujui)
- **Visibilitas riwayat bersama untuk DOCTOR/klinik** (temuan §2). Bila diinginkan: tambah ke SELECT restrictive
  `or (branch_id is null and legacy_source_key is not null and public.can_read_legacy_medical_history())`. Ini
  membuka BACA riwayat bersama untuk peran yang sudah diizinkan permissive; perlu persetujuan kebijakan sendiri.
- Namespace fixture XLSX: isu terpisah, tidak disentuh.

## 7. Batas
Tidak ada service-role, penghapusan header, disable/bypass RLS, perluasan peran, perubahan riwayat bersama menjadi
lokal, migrasi/penulisan Production, impor pasien nyata, atau pembersihan data uji di Production.
