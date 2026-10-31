-- C05 lanjutan (keputusan pemilik 29 Okt 2026): kode voucher yang ditautkan ke kode kampanye
-- AKTIF tidak boleh lagi diketik langsung. Hanya kode kampanyenya yang berlaku, supaya batas
-- pemakaian dan laporan kampanye tidak bisa dilewati dengan mengetik kode voucher aslinya.
--
--   * Berlaku di semua jalur yang menulis voucher ke dokumen: struk POS (/kasir), invoice klinik
--     per kunjungan, dan pembayaran rombongan klinik (semuanya lewat INSERT sales/invoices,
--     termasuk clinic_post_invoice, sehingga trigger C05 yang sudah ada cukup diperluas).
--   * Voucher yang tidak tertaut ke kampanye mana pun, atau hanya ke kampanye yang dinonaktifkan,
--     tetap bisa dipakai seperti biasa.
--   * Dokumen lama tidak disentuh: koreksi/terbit ulang yang mempertahankan voucher yang sama
--     tetap lolos. Yang ditolak hanya dokumen baru, atau perubahan yang MEMASANG voucher
--     tertaut tanpa kode kampanyenya.
--
-- Idempoten: create or replace saja; trigger yang ada (c05_sale_campaign_code,
-- c05_invoice_campaign_code) sudah memanggil fungsi ini.

create or replace function public.voucher_wajib_lewat_kampanye(p_voucher_code text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_voucher_code is not null and exists (
    select 1 from public.campaign_codes c
    join public.vouchers v on v.id = c.voucher_id
    where c.is_active and upper(v.code) = upper(btrim(p_voucher_code))
  )
$$;
revoke all on function public.voucher_wajib_lewat_kampanye(text) from public, anon, authenticated, service_role;
comment on function public.voucher_wajib_lewat_kampanye(text) is
  'C05: true bila voucher tertaut ke kode kampanye aktif, sehingga hanya boleh dipakai lewat kode kampanyenya.';

create or replace function public.guard_campaign_code_use() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k public.campaign_codes%rowtype; v_voucher text; v_used bigint; src_id uuid; src_code text; src_voucher text;
begin
  if tg_op = 'UPDATE' then
    if new.campaign_code is distinct from old.campaign_code then
      raise exception 'KODE_KAMPANYE: Kode kampanye pada dokumen tidak boleh diubah' using errcode = '23514';
    end if;
    if new.campaign_code is not null and new.voucher_code is distinct from old.voucher_code then
      raise exception 'KODE_KAMPANYE: Voucher dari kode kampanye tidak boleh diubah' using errcode = '23514';
    end if;
    -- Memasang voucher tertaut kampanye lewat koreksi sama saja dengan mengetiknya langsung.
    if new.campaign_code is null and new.voucher_code is distinct from old.voucher_code
       and public.voucher_wajib_lewat_kampanye(new.voucher_code) then
      raise exception 'KODE_KAMPANYE: Voucher ini hanya bisa dipakai lewat kode kampanye' using errcode = '23514';
    end if;
    return new;
  end if;

  -- Clinic void+reissue: the new invoice inherits the original code and its single use.
  if tg_table_name = 'invoices' then
    src_id := (to_jsonb(new) ->> 'reissued_from')::uuid;   -- sales rows have no such column
  end if;
  if src_id is not null then
    select i.campaign_code, i.voucher_code into src_code, src_voucher
      from public.invoices i where i.id = src_id;
    if new.campaign_code is null then new.campaign_code := src_code; end if;
    if new.campaign_code is distinct from src_code then
      raise exception 'KODE_KAMPANYE: Penerbitan ulang tidak boleh mengganti kode kampanye' using errcode = '23514';
    end if;
    if src_code is not null and new.voucher_code is distinct from src_voucher then
      raise exception 'KODE_KAMPANYE: Voucher dari kode kampanye tidak boleh diubah' using errcode = '23514';
    end if;
    -- Terbit ulang yang mempertahankan voucher lama tetap lolos; mengganti ke voucher tertaut tidak.
    if new.campaign_code is null and new.voucher_code is distinct from src_voucher
       and public.voucher_wajib_lewat_kampanye(new.voucher_code) then
      raise exception 'KODE_KAMPANYE: Voucher ini hanya bisa dipakai lewat kode kampanye' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.campaign_code is null then
    if public.voucher_wajib_lewat_kampanye(new.voucher_code) then
      raise exception 'KODE_KAMPANYE: Voucher ini hanya bisa dipakai lewat kode kampanye' using errcode = '23514';
    end if;
    return new;
  end if;

  -- Row lock serializes every checkout of this code until its transaction ends.
  select * into k from public.campaign_codes c where c.code = new.campaign_code for update;
  if not found then
    raise exception 'KODE_KAMPANYE: Kode % tidak ditemukan', new.campaign_code using errcode = 'P0001';
  end if;
  if not k.is_active then
    raise exception 'KODE_KAMPANYE: Kode % sedang dinonaktifkan', k.code using errcode = 'P0001';
  end if;
  if k.voucher_id is not null then
    select v.code into v_voucher from public.vouchers v where v.id = k.voucher_id;
    if new.voucher_code is distinct from v_voucher then
      raise exception 'KODE_KAMPANYE: Kode % harus memakai voucher %', k.code, v_voucher using errcode = '23514';
    end if;
  elsif new.voucher_code is not null then
    raise exception 'KODE_KAMPANYE: Kode promo % tidak bisa digabung dengan voucher', k.code using errcode = '23514';
  end if;
  if k.max_uses is not null then
    v_used := public.campaign_code_used(k.code);
    if v_used >= k.max_uses then
      raise exception 'KODE_KAMPANYE: Kode % sudah mencapai batas pemakaian (% kali)', k.code, k.max_uses
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_campaign_code_use() from public, anon, authenticated, service_role;
