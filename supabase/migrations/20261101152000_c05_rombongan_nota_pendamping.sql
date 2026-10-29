-- C05: pembayaran rombongan klinik + voucher yang hanya berlaku lewat kode kampanye.
--
-- Satu kedatangan rombongan = satu pemakaian kode kampanye. Kodenya menempel di SATU nota
-- ("nota pembawa", invoices.campaign_code terisi, dihitung database), sedangkan nota hewan lain
-- ikut menikmati voucher kampanyenya tanpa kode supaya pemakaian tidak terhitung ganda.
-- Aturan 20261101150000 menolak voucher tertaut kampanye aktif tanpa kode kampanye, sehingga
-- nota hewan lain itu ikut tertolak.
--
-- Perbaikan yang bisa diverifikasi database (bukan percaya pada klien):
--   * kolom baru invoices.campaign_carrier_id menunjuk nota pembawa kode;
--   * nota pendamping hanya diterima bila nota pembawanya ada, belum dibatalkan, membawa kode
--     kampanye, memakai voucher yang sama, dan berasal dari rombongan yang sama (pemilik dan
--     cabang sama, kunjungan di hari WIB yang sama, kunjungan berbeda);
--   * nota pendamping tidak membawa campaign_code → tidak menambah hitungan pemakaian;
--   * penanda tidak boleh diubah setelah nota terbit; terbit ulang mewarisinya.
-- Voucher mentah tanpa penanda tetap ditolak seperti sebelumnya.
--
-- clinic_post_invoice ikut menyimpan p_invoice->>'campaign_carrier_id' di INSERT atomiknya
-- (tambalan berjangkar eksak, gagal tertutup bila fungsinya berubah). Idempoten.

alter table public.invoices add column if not exists campaign_carrier_id uuid
  references public.invoices(id) on delete restrict;
create index if not exists invoices_campaign_carrier_idx on public.invoices (campaign_carrier_id)
  where campaign_carrier_id is not null;
comment on column public.invoices.campaign_carrier_id is
  'C05: nota rombongan pembawa kode kampanye; nota ini menikmati voucher kampanyenya tanpa menambah pemakaian.';

create or replace function public.guard_campaign_code_use() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k public.campaign_codes%rowtype; v_voucher text; v_used bigint; src_id uuid; src_code text; src_voucher text;
  src_carrier uuid; v_carrier uuid; old_carrier uuid; c public.invoices%rowtype;
  c_visit public.visits%rowtype; n_visit public.visits%rowtype; ada boolean;
begin
  if tg_table_name = 'invoices' then
    v_carrier := (to_jsonb(new) ->> 'campaign_carrier_id')::uuid;   -- sales rows have no such column
  end if;

  if tg_op = 'UPDATE' then
    if tg_table_name = 'invoices' then
      old_carrier := (to_jsonb(old) ->> 'campaign_carrier_id')::uuid;
      if v_carrier is distinct from old_carrier then
        raise exception 'KODE_KAMPANYE: Penanda nota rombongan kampanye tidak boleh diubah' using errcode = '23514';
      end if;
    end if;
    if new.campaign_code is distinct from old.campaign_code then
      raise exception 'KODE_KAMPANYE: Kode kampanye pada dokumen tidak boleh diubah' using errcode = '23514';
    end if;
    if (new.campaign_code is not null or v_carrier is not null) and new.voucher_code is distinct from old.voucher_code then
      raise exception 'KODE_KAMPANYE: Voucher dari kode kampanye tidak boleh diubah' using errcode = '23514';
    end if;
    -- Memasang voucher tertaut kampanye lewat koreksi sama saja dengan mengetiknya langsung.
    if new.campaign_code is null and new.voucher_code is distinct from old.voucher_code
       and public.voucher_wajib_lewat_kampanye(new.voucher_code) then
      raise exception 'KODE_KAMPANYE: Voucher ini hanya bisa dipakai lewat kode kampanye' using errcode = '23514';
    end if;
    return new;
  end if;

  -- Clinic void+reissue: the new invoice inherits the original code (and group marker) and its single use.
  if tg_table_name = 'invoices' then
    src_id := (to_jsonb(new) ->> 'reissued_from')::uuid;
  end if;
  if src_id is not null then
    select i.campaign_code, i.voucher_code, i.campaign_carrier_id into src_code, src_voucher, src_carrier
      from public.invoices i where i.id = src_id;
    if new.campaign_code is null then new.campaign_code := src_code; end if;
    if v_carrier is null and src_carrier is not null then
      new.campaign_carrier_id := src_carrier; v_carrier := src_carrier;
    end if;
    if new.campaign_code is distinct from src_code then
      raise exception 'KODE_KAMPANYE: Penerbitan ulang tidak boleh mengganti kode kampanye' using errcode = '23514';
    end if;
    if v_carrier is distinct from src_carrier then
      raise exception 'KODE_KAMPANYE: Penanda nota rombongan kampanye tidak boleh diubah' using errcode = '23514';
    end if;
    if (src_code is not null or src_carrier is not null) and new.voucher_code is distinct from src_voucher then
      raise exception 'KODE_KAMPANYE: Voucher dari kode kampanye tidak boleh diubah' using errcode = '23514';
    end if;
    -- Terbit ulang yang mempertahankan voucher lama tetap lolos; mengganti ke voucher tertaut tidak.
    if new.campaign_code is null and new.voucher_code is distinct from src_voucher
       and public.voucher_wajib_lewat_kampanye(new.voucher_code) then
      raise exception 'KODE_KAMPANYE: Voucher ini hanya bisa dipakai lewat kode kampanye' using errcode = '23514';
    end if;
    return new;
  end if;

  -- Nota pendamping rombongan: voucher kampanye lewat nota pembawa kode, tanpa pemakaian tambahan.
  if v_carrier is not null then
    if new.campaign_code is not null then
      raise exception 'KODE_KAMPANYE: Nota pembawa kode tidak boleh sekaligus menjadi nota pendamping' using errcode = '23514';
    end if;
    select * into c from public.invoices i where i.id = v_carrier for share;
    ada := found;
    if ada then
      select * into c_visit from public.visits v where v.id = c.visit_id;
      select * into n_visit from public.visits v where v.id = new.visit_id;
    end if;
    if not ada or c.id = new.id or c.voided_at is not null or c.campaign_code is null
       or new.voucher_code is distinct from c.voucher_code
       or c_visit.id is null or n_visit.id is null or c_visit.id = n_visit.id
       or c_visit.customer_id is null or c_visit.customer_id is distinct from n_visit.customer_id
       or c_visit.branch_id is distinct from n_visit.branch_id
       or (c_visit.created_at at time zone 'Asia/Jakarta')::date <> (n_visit.created_at at time zone 'Asia/Jakarta')::date then
      raise exception 'KODE_KAMPANYE: Nota rombongan tidak cocok dengan nota pembawa kode kampanye' using errcode = '23514';
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
  select * into k from public.campaign_codes cc where cc.code = new.campaign_code for update;
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

-- The marker is guarded on update as well (sales keep the original trigger: no such column).
drop trigger if exists c05_invoice_campaign_code on public.invoices;
create trigger c05_invoice_campaign_code before insert or update of campaign_code, voucher_code, campaign_carrier_id on public.invoices
  for each row execute function public.guard_campaign_code_use();

-- Clinic posting stores the marker inside its own atomic invoice insert.
do $patch$
declare
  signature regprocedure := 'public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure;
  definition text := pg_get_functiondef(signature);
  cols_old text := 'service_pricing_version, campaign_code';
  vals_old text := E'nullif(p_invoice->>''campaign_code'','''')';
begin
  if position('campaign_carrier_id' in definition) > 0 then
    return;                                        -- already applied (idempotent re-run)
  end if;
  if (length(definition) - length(replace(definition, cols_old, ''))) / length(cols_old) <> 1
     or (length(definition) - length(replace(definition, vals_old, ''))) / length(vals_old) <> 1 then
    raise exception 'C05_CLINIC_POST_DRIFT: clinic_post_invoice changed; review before release';
  end if;
  definition := replace(definition, cols_old, cols_old || ', campaign_carrier_id');
  definition := replace(definition, vals_old, vals_old || E', nullif(p_invoice->>''campaign_carrier_id'','''')::uuid');
  execute definition;
end
$patch$;
