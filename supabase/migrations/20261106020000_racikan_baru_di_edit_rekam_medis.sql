-- Racikan baru dari layar Edit rekam medis (laporan Anisa, 1 Nov 2026: "racik ga muncul di sini").
--
-- Edit owner/dokter sebelum tagihan terbit (0408/0411, clinic_edit_queued_record) hanya
-- menyimpan baris resep biasa. Racikan baru di sana ditolak (COMPOUND_LOCKED) karena bahannya
-- harus keluar lewat alur racik berjejak, sehingga layar Edit sengaja mengosongkan daftar
-- racikan. Jalur racik berjejak untuk rekam medis tersimpan sudah ada: clinic_add_record_items
-- (item susulan, 20261104340000) memanggil fungsi peracikan yang sama dengan form pemeriksaan.
--
-- Pembungkus ini dipakai untuk SETIAP simpan Edit penuh dan menjalankan, dalam SATU transaksi:
--   1. clinic_edit_queued_record apa adanya — gerbang peran/cabang, revisi, "belum ada tagihan",
--      larangan menghapus baris tersimpan, audit koreksi penuh.
--   2. (bila ada racikan baru) clinic_add_record_items dengan p_items kosong dan
--      p_compounds = racikan baru — penanda susulan, stok bahan keluar saat diracik.
-- Bila salah satu gagal (mis. stok bahan kurang), seluruh simpanan batal: tidak ada edit
-- setengah jadi dan tidak ada bahan yang keluar tanpa rekam medisnya.
--
-- Kunci permintaan: kedua RPC di dalam masing-masing hanya membandingkan sebagian kiriman
-- (edit: baris resep; item susulan: racikan). Buku kunci di bawah menyimpan sidik SELURUH
-- kiriman per pelaku + kunci, jadi kiriman ulang yang sama dibaca ulang, dan kunci yang sama
-- dengan isi berbeda (mis. respons hilang, racikan dihapus, simpan lagi) ditolak
-- IDEMPOTENCY_CONFLICT — bukan "tersimpan" padahal racikannya sudah terlanjur diracik.
--
-- Aditif saja: tabel privat + fungsi baru, tidak ada definisi lama yang ditulis ulang.
-- Sengaja tanpa blok pemeriksaan saat pasang: PL/pgSQL mencari kedua RPC saat dipanggil, jadi
-- bila salah satunya tidak ada panggilan gagal 42883 dan seluruh transaksi batal. Uji rantai
-- lama yang memasang item susulan PALING AKHIR tetap jalan.
create table clinic_private.record_edit_requests (
  created_by uuid not null,
  request_key text not null,
  request_hash text not null,
  medical_record_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (created_by, request_key)
);
revoke all on clinic_private.record_edit_requests from public, anon, authenticated, service_role;

create function public.clinic_edit_queued_record_with_compounds(
  p_visit_id uuid, p_record_id uuid, p_expected_revision integer, p_changes jsonb,
  p_rows jsonb, p_compounds jsonb, p_reason text, p_request_key text
) returns uuid language plpgsql security definer set search_path = '' set lock_timeout = '8s' as $function$
declare
  v_user uuid := auth.uid();
  v_hash text;
  v_prev clinic_private.record_edit_requests%rowtype;
  v_record uuid;
  v_added uuid;
begin
  if coalesce(auth.role(), '') <> 'authenticated' or v_user is null then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  if nullif(btrim(p_request_key), '') is null or length(p_request_key) > 100
     or jsonb_typeof(p_compounds) is distinct from 'array' or jsonb_array_length(p_compounds) > 50 then
    raise exception using errcode = 'P0001', message = 'RECORD_INVALID: data edit atau racikan baru tidak valid';
  end if;
  -- Koordinator tagihan lebih dulu, sama dengan kedua RPC di dalamnya (kunci advisori
  -- transaksi bersifat re-entrant), supaya urutan kunci tetap koordinator -> kunjungan.
  perform clinic_private.billing_lock(clinic_private.billing_keys_visit(p_visit_id));
  -- Gerbang peran/cabang dicek ulang SEBELUM membaca ulang buku kunci (pola 0408/0411):
  -- pengguna yang perannya dicabut tidak mendapat hasil tersimpan.
  if not exists (select 1 from public.profiles where id = v_user and is_active and role in ('OWNER','DOCTOR'))
     or not public.clinic_record_correction_actor(p_visit_id) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: hanya owner atau dokter dapat mengubah rekam medis';
  end if;
  v_hash := md5(jsonb_build_array(p_visit_id, p_record_id, p_expected_revision, p_changes, p_rows,
    p_compounds, btrim(coalesce(p_reason, '')))::text);
  select * into v_prev from clinic_private.record_edit_requests
  where created_by = v_user and request_key = p_request_key for update;
  if found then
    if v_prev.request_hash is distinct from v_hash or v_prev.medical_record_id is distinct from p_record_id then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT: kunci edit rekam medis dipakai untuk data berbeda';
    end if;
    return v_prev.medical_record_id;
  end if;

  v_record := public.clinic_edit_queued_record(
    p_visit_id, p_record_id, p_expected_revision, p_changes, p_rows, p_reason, p_request_key);
  if jsonb_array_length(p_compounds) > 0 then
    v_added := public.clinic_add_record_items(
      p_visit_id, 'edit-racikan:' || md5(v_user::text || ':' || p_request_key), '[]'::jsonb, p_compounds);
    if v_added is distinct from p_record_id then
      raise exception using errcode = 'P0001', message = 'RECORD_INVALID: racikan harus masuk ke rekam medis yang sedang diedit';
    end if;
  end if;
  insert into clinic_private.record_edit_requests(created_by, request_key, request_hash, medical_record_id)
  values (v_user, p_request_key, v_hash, p_record_id);
  return v_record;
end;
$function$;
revoke all on function public.clinic_edit_queued_record_with_compounds(uuid,uuid,integer,jsonb,jsonb,jsonb,text,text) from public, anon, authenticated, service_role;
grant execute on function public.clinic_edit_queued_record_with_compounds(uuid,uuid,integer,jsonb,jsonb,jsonb,text,text) to authenticated;
