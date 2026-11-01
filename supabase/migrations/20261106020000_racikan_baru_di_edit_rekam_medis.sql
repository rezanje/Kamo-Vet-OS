-- Racikan baru dari layar Edit rekam medis (laporan Anisa, 1 Nov 2026: "racik ga muncul di sini").
--
-- Edit owner/dokter sebelum tagihan terbit (0408/0411, clinic_edit_queued_record) hanya
-- menyimpan baris resep biasa. Racikan baru di sana ditolak (COMPOUND_LOCKED) karena bahannya
-- harus keluar lewat alur racik berjejak, sehingga layar Edit sengaja mengosongkan daftar
-- racikan. Jalur racik berjejak untuk rekam medis tersimpan sudah ada: clinic_add_record_items
-- (item susulan, 20261104340000) memanggil fungsi peracikan yang sama dengan form pemeriksaan.
--
-- Pembungkus ini menjalankan keduanya dalam SATU transaksi, berurutan:
--   1. clinic_edit_queued_record apa adanya — gerbang peran/cabang, revisi, "belum ada tagihan",
--      larangan menghapus baris tersimpan, audit koreksi penuh.
--   2. clinic_add_record_items dengan p_items kosong dan p_compounds = racikan baru — penanda
--      susulan, stok bahan keluar saat diracik (bukan saat ditagih), kunci idempoten sendiri.
-- Bila salah satu gagal (mis. stok bahan kurang), seluruh simpanan batal: tidak ada edit
-- setengah jadi dan tidak ada bahan yang keluar tanpa rekam medisnya.
--
-- Aditif saja: fungsi baru, tidak ada definisi lama yang ditulis ulang. Edit tanpa racikan baru
-- tetap memanggil clinic_edit_queued_record langsung dari aplikasi.
-- Sengaja tanpa blok pemeriksaan saat pasang: PL/pgSQL mencari kedua RPC saat dipanggil, jadi
-- bila salah satunya tidak ada panggilan gagal 42883 dan seluruh transaksi batal (aplikasi
-- menampilkan pesan jelas). Uji rantai lama yang memasang item susulan PALING AKHIR tetap jalan.
create function public.clinic_edit_queued_record_with_compounds(
  p_visit_id uuid, p_record_id uuid, p_expected_revision integer, p_changes jsonb,
  p_rows jsonb, p_compounds jsonb, p_reason text, p_request_key text
) returns uuid language plpgsql security definer set search_path = '' set lock_timeout = '8s' as $function$
declare
  v_key text := nullif(btrim(p_request_key), '');
  v_record uuid;
  v_added uuid;
begin
  if coalesce(auth.role(), '') <> 'authenticated' or auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  if v_key is null or length(v_key) > 100
     or jsonb_typeof(p_compounds) is distinct from 'array'
     or jsonb_array_length(p_compounds) = 0 or jsonb_array_length(p_compounds) > 50 then
    raise exception using errcode = 'P0001', message = 'RECORD_INVALID: racikan baru tidak valid';
  end if;
  -- Koordinator tagihan lebih dulu, sama dengan kedua RPC di dalamnya (kunci advisori
  -- transaksi bersifat re-entrant), supaya urutan kunci tetap koordinator -> kunjungan.
  perform clinic_private.billing_lock(clinic_private.billing_keys_visit(p_visit_id));
  v_record := public.clinic_edit_queued_record(
    p_visit_id, p_record_id, p_expected_revision, p_changes, p_rows, p_reason, p_request_key);
  -- Kunci item susulan diturunkan dari kunci edit + pelaku: kiriman ulang yang sama
  -- dibaca ulang oleh kedua RPC, isi racikan yang berbeda ditolak IDEMPOTENCY_CONFLICT.
  v_added := public.clinic_add_record_items(
    p_visit_id, 'edit-racikan:' || md5(auth.uid()::text || ':' || v_key), '[]'::jsonb, p_compounds);
  if v_added is distinct from p_record_id then
    raise exception using errcode = 'P0001', message = 'RECORD_INVALID: racikan harus masuk ke rekam medis yang sedang diedit';
  end if;
  return v_record;
end;
$function$;
revoke all on function public.clinic_edit_queued_record_with_compounds(uuid,uuid,integer,jsonb,jsonb,jsonb,text,text) from public, anon, authenticated, service_role;
grant execute on function public.clinic_edit_queued_record_with_compounds(uuid,uuid,integer,jsonb,jsonb,jsonb,text,text) to authenticated;
