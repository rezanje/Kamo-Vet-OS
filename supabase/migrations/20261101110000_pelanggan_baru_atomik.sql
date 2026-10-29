-- Kasir & CRM: tambah pelanggan baru di bawah kunci identitas yang sama dengan impor rekam medis
-- dan registrasi klinik (menutup celah balapan yang tersisa di PR #333).
--
-- Persetujuan: koordinasi (Reza via Wowo) meminta pengaman minimal Kasir/CRM dalam DRAFT, bukan
-- mengandalkan SOP di luar jam. Pemasangan ke Production menunggu persetujuan terpisah atas teks
-- persis migrasi ini, SESUDAH 20261101090000 dan 20261101100000.
--
-- Perilaku Kasir (tambahCustomerKasir) dan CRM (simpanPelanggan) sebelum ini: cek `phone` PERSIS,
-- bila ada -> tolak "No HP sudah terdaftar", bila tidak -> insert. Aturan bisnisnya (TOLAK, bukan
-- pakai ulang) dipertahankan. Yang berubah hanya cara cek-lalu-insert:
--   * cek dan insert terjadi dalam satu transaksi di bawah customer_identity_lock(HP), jadi tidak bisa
--     lagi balapan dengan impor, registrasi klinik, atau Kasir/CRM lain untuk orang yang sama;
--   * pencocokan memakai kunci HP kanonik yang sama dengan impor/registrasi (08.. = +62.. = 0062..,
--     tanda baca diabaikan). Satu atau lebih pelanggan dengan kunci itu -> "terdaftar" (ditolak).
-- Validasi isian (nama/HP wajib, nomorHpValid), kolom yang diisi, dan nilai yang disimpan tetap dari
-- aplikasi apa adanya; fungsi ini tidak merapikan, menormalkan, atau menambah kolom.
-- SECURITY INVOKER: RLS dan hak insert customers milik pemanggil tetap berlaku; tidak ada hak baru.
-- Tidak ada UPDATE/DELETE, backfill, atau penggabungan pelanggan.

do $precheck$
begin
  if to_regprocedure('public.customer_identity_lock(text)') is null
     or to_regprocedure('public.customer_pick_by_phone(text)') is null
     or to_regprocedure('public.indonesian_phone_key(text)') is null then
    raise exception 'Pelanggan baru atomik: migrasi 20261101090000 belum terpasang';
  end if;
  if to_regprocedure('public.pelanggan_baru_atomik(text,text,text,date,text,text,text,text,text)') is not null then
    raise exception 'Pelanggan baru atomik: fungsi sudah ada';
  end if;
end $precheck$;

create function public.pelanggan_baru_atomik(
  p_name text,
  p_phone text,
  p_email text,
  p_dob date,
  p_address text,
  p_pekerjaan text,
  p_sumber_info text,
  p_catatan text,
  p_npwp text default null
) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Silakan masuk ulang';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null or public.indonesian_phone_key(p_phone) = '' then
    raise exception 'Nama dan No. HP wajib diisi';
  end if;
  perform public.customer_identity_lock(p_phone);
  -- Pernyataan baru sesudah kunci: pelanggan yang di-commit pemegang kunci sebelumnya terlihat.
  if public.customer_pick_by_phone(p_phone)->>'status' <> 'none' then
    return jsonb_build_object('status', 'terdaftar');
  end if;
  insert into public.customers(name, phone, email, dob, address, pekerjaan, sumber_info, catatan, npwp)
  values (p_name, p_phone, p_email, p_dob, p_address, p_pekerjaan, p_sumber_info, p_catatan, p_npwp)
  returning id into v_id;
  return jsonb_build_object('status', 'dibuat', 'customer_id', v_id);
end $$;
comment on function public.pelanggan_baru_atomik(text, text, text, date, text, text, text, text, text) is
  'Kasir/CRM: tambah pelanggan baru di bawah customer_identity_lock; HP kanonik yang sudah terdaftar ditolak (status terdaftar). Nilai disimpan apa adanya.';
revoke all on function public.pelanggan_baru_atomik(text, text, text, date, text, text, text, text, text) from public, anon;
grant execute on function public.pelanggan_baru_atomik(text, text, text, date, text, text, text, text, text) to authenticated;

do $check$
declare d text;
begin
  d := pg_get_functiondef('public.pelanggan_baru_atomik(text,text,text,date,text,text,text,text,text)'::regprocedure);
  if position('customer_identity_lock' in d) = 0 or position('customer_pick_by_phone' in d) = 0
     or position('customer_identity_lock' in d) > position('customer_pick_by_phone' in d)
     or (select p.prosecdef from pg_proc p where p.oid = 'public.pelanggan_baru_atomik(text,text,text,date,text,text,text,text,text)'::regprocedure) then
    raise exception 'Pelanggan baru atomik: kunci identitas harus diambil sebelum cek nomor, security invoker';
  end if;
end $check$;
