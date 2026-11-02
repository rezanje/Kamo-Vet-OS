-- Rawat inap: kunjungan yang sudah LUNAS dan pasiennya sudah pulang ditutup ("Selesai"),
-- apa pun urutannya.
--
-- Laporan Klinik TKI, 2 Nov 2026: Chloe (TKI-A003) dibayar lunas 17.06 WIB lewat kasir rawat
-- inap lalu dipulangkan "sembuh" 17.12 WIB, tetapi kunjungannya tertahan di "Pembayaran" dan
-- terus tampil di Antrian sebagai belum selesai (risiko ditagih ulang).
--
-- Penyebab: penutupan kunjungan hanya ada di clinic_receive_visit_payment, dan hanya bila
--   (a) pasien SUDAH pulang saat uang diterima, dan (b) uang itu melunasi tagihan yang sudah
--   ada. Dua urutan nyata tidak memenuhinya:
--   1. bayar dulu, baru pulang (Chloe) — saat bayar pasien masih dirawat;
--   2. pulang dulu, baru bayar lewat kasir rawat inap (clinic_bill_and_pay_inpatient) — uang
--      masuk sebagai uang muka, lalu dipakai tagihan tahap baru; (b) tidak pernah terjadi.
--
-- Perubahan:
--   * clinic_private.tutup_kunjungan_ranap_lunas(visit): satu aturan penutupan. Tutup bila
--     kunjungan punya rawat inap dan semuanya sudah pulang, ada tagihan aktif, semua tagihan
--     aktif Lunas, dan tidak ada baris rekam medis yang belum ditagih (baris yang ditarik
--     kasir dari tagihan tidak dihitung).
--   * clinic_change_inpatient_condition dan clinic_bill_and_pay_inpatient memanggilnya di
--     akhir. Teks definisi keduanya = teks produksi 2 Nov 2026 (hasil tambalan koordinator
--     20261104030000, diverifikasi sama dengan rangkaian migrasi); hanya baris panggilan
--     yang ditambah.
--   * Rapikan data: kunjungan yang sudah tertahan ditutup dengan aturan yang sama. Dicek
--     baca-saja di produksi 2 Nov 2026: hanya satu (Chloe, TKI-A003).
--
-- Tidak mengubah uang, jurnal, stok, kwitansi, hak akses, atau perhitungan tagihan.
-- `create or replace` mempertahankan pemilik dan hak eksekusi fungsi publik.

create or replace function clinic_private.tutup_kunjungan_ranap_lunas(p_visit_id uuid)
returns boolean language plpgsql set search_path = '' as $function$
declare v_rows integer;
begin
  update public.visits v set status = 'Selesai'
  where v.id = p_visit_id and v.status <> 'Selesai'
    and exists (select 1 from public.inpatient_records r where r.visit_id = v.id)
    and not exists (select 1 from public.inpatient_records r
      where r.visit_id = v.id and r.discharged_at is null)
    and exists (select 1 from public.invoices i where i.visit_id = v.id and i.voided_at is null)
    and not exists (select 1 from public.invoices i
      where i.visit_id = v.id and i.voided_at is null and i.paid_status <> 'Lunas')
    and not exists (
      select 1 from public.prescription_items pi
      join public.medical_records mr on mr.id = pi.medical_record_id
      where mr.visit_id = v.id and pi.billing_withdrawn_at is null
        and not exists (select 1 from public.invoice_items ii
          join public.invoices i on i.id = ii.invoice_id
          where ii.prescription_item_id = pi.id and i.voided_at is null));
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$function$;
revoke all on function clinic_private.tutup_kunjungan_ranap_lunas(uuid) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.clinic_change_inpatient_condition(p_inpatient_id uuid, p_new_status text, p_notes text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_record public.inpatient_records%rowtype;
  v_tariff public.items%rowtype;
  v_medical_record_id uuid;
  v_days integer;
  v_discharged_at timestamptz;
begin

  -- ranap-compound-coordinator: same key as clinic_private.billing_keys_visit.
  perform pg_advisory_xact_lock(hashtextextended('clinic-billing:' ||
    case when v.customer_id is not null then 'c:' || v.customer_id::text
         else 'v:' || coalesce(v.id::text,'-') end || '@' || coalesce(v.branch_id::text,'-'),0))
    from public.visits v where v.id=(select visit_id from public.inpatient_records where id=p_inpatient_id);

  if (false) and (coalesce(auth.role(),'')<>'authenticated' or auth.uid() is null
    or not exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active
      and p.role in ('OWNER','ADMIN','DOCTOR','STAFF'))
    or not exists(select 1 from public.visits v where v.id=(select visit_id from public.inpatient_records where id=p_inpatient_id)
      and public.user_can_access_branch(v.branch_id))) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: akses racikan atau cabang tidak diizinkan';
  end if;
  if (false) and not exists(select 1 from public.profiles p where p.id=auth.uid()
      and p.is_active and p.role in ('OWNER','ADMIN','DOCTOR')) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: komposisi racikan hanya untuk pemilik/admin/dokter';
  end if;
  if coalesce(auth.role(), '') <> 'authenticated'
     or v_user is null then
    raise exception using errcode='P0001', message='ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  if p_new_status not in ('stabil','kritis','sembuh','rip','pulang_paksa') then
    raise exception using errcode='P0001', message='LOG_INVALID: status rawat inap tidak valid';
  end if;
  select * into v_record from public.inpatient_records
  where id = p_inpatient_id for update;
  if not found or not public.user_can_access_branch(v_record.branch_id) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: rawat inap tidak dapat diakses';
  end if;
  if not exists(select 1 from public.visits v where v.id=v_record.visit_id
    and v.branch_id=v_record.branch_id) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: cabang kunjungan tidak cocok'; end if;
  select role into v_role from public.profiles where id = v_user;
  if v_role is null or (p_new_status = 'rip' and v_role <> 'DOCTOR') then
    raise exception using errcode='P0001', message='ACCESS_DENIED: status RIP hanya boleh diubah dokter';
  end if;
  if v_record.condition_status = p_new_status then return false; end if;
  if v_record.condition_status = 'pulang_paksa' then
    raise exception using errcode='P0001', message='INPATIENT_CLOSED: pasien sudah keluar';
  end if;
  if p_new_status = 'pulang_paksa' then
    if v_record.discharged_at is not null then
      raise exception using errcode='P0001', message='INPATIENT_CLOSED: pasien sudah keluar';
    end if;
    -- A distinct Owner/Admin-managed form is required. The signed snapshot and
    -- admission time are both retained; an older admission form cannot qualify.
    if not exists (
      select 1 from public.consents c
      join public.consent_templates t on t.id = c.template_id
      where c.visit_id = v_record.visit_id
        and c.consent_branch_id = v_record.branch_id
        and c.status = 'sudah_ttd' and c.kategori = 'Pulang Paksa'
        and nullif(btrim(c.signer_name), '') is not null
        and nullif(btrim(c.signature_data), '') is not null
        and c.signed_at >= v_record.admitted_at
        and t.kategori = 'Pulang Paksa' and t.is_active
        and (t.branch_id is null or t.branch_id = v_record.branch_id)
    ) then
      raise exception using errcode='P0001', message='CONSENT_REQUIRED: tandatangani form Pulang Paksa yang berlaku untuk cabang pasien';
    end if;
  end if;

  v_discharged_at := case when p_new_status in ('sembuh','rip','pulang_paksa') then now() else null end;
  -- Tagihan berjalan: pasien boleh pulang walau tagihannya sudah terbit dan belum
  -- lunas. Sisanya diselesaikan lewat layar tagihan rawat inap atau menjadi piutang.
  insert into public.inpatient_status_log(
    inpatient_record_id, previous_status, new_status, changed_by, notes
  ) values (p_inpatient_id, v_record.condition_status, p_new_status, v_user, p_notes);
  update public.inpatient_records set condition_status=p_new_status,
    discharged_at=v_discharged_at where id=p_inpatient_id;

  if v_discharged_at is not null and not exists(select 1 from public.invoices i
      where i.visit_id=v_record.visit_id and i.request_key is not null)
     and not exists(select 1 from public.prescription_items pi
      join public.medical_records mr on mr.id=pi.medical_record_id
      where mr.visit_id=v_record.visit_id and pi.kategori='Rawat Inap') then
    select * into v_tariff from public.items
    where tindakan_kategori='Rawat Inap' and is_active
    order by name, id limit 1;
    if found then
      select m.id into v_medical_record_id from public.medical_records m
      where m.visit_id = v_record.visit_id
      order by m.created_at desc, m.id desc limit 1;
      if v_medical_record_id is not null then
        v_days := greatest(1, ceil(extract(epoch from
          (v_discharged_at - v_record.admitted_at)) / 86400)::integer);
        delete from public.prescription_items
        where medical_record_id=v_medical_record_id and item_id=v_tariff.id;
        insert into public.prescription_items(
          medical_record_id, item_id, nama_obat, qty, harga, satuan,
          jenis, kategori, aturan_pakai
        ) values (
          v_medical_record_id, v_tariff.id, v_tariff.name, v_days,
          coalesce(v_tariff.sell_price, 0), coalesce(v_tariff.unit, 'hari'),
          'jasa', 'Rawat Inap',
          'Otomatis dari lama rawat inap: ' || v_days || ' hari'
        );
      end if;
    end if;
  end if;

  -- Bayar dulu, baru dipulangkan: tutup kunjungan bila semuanya sudah beres.
  if v_discharged_at is not null then
    perform clinic_private.tutup_kunjungan_ranap_lunas(v_record.visit_id);
  end if;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.clinic_bill_and_pay_inpatient(p_record_id uuid, p_visit_id uuid, p_request_key text, p_tanggal date, p_parts jsonb, p_overpayment_ack text DEFAULT NULL::text, p_add_owner_credit boolean DEFAULT false, p_dp_override_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  quote jsonb; fingerprint text; cached clinic_private.inpatient_bill_pay_requests%rowtype;
  receipt uuid; invoice uuid; old_invoice record; result jsonb; key text:=nullif(btrim(p_request_key),'');
  initial_accounts jsonb; locked_shift uuid; prior_applications uuid[]; applications jsonb;
begin
  quote:=clinic_private.inpatient_payment_quote(p_record_id,p_visit_id,p_parts);
  -- Coordinator -> validated own branch shift -> invoice/advance -> journal.
  -- Original receipt/release/posting take the shift before journal numbering.
  -- Never hold a monthly journal advisory lock while waiting on that shift.
  initial_accounts:=quote->'accounts';
  locked_shift:=(quote->>'shift_id')::uuid;
  perform 1 from public.cashier_shifts where id=locked_shift for update;
  -- A shift wait can outlive active-role/module/branch and monetary settings.
  quote:=clinic_private.inpatient_payment_quote(p_record_id,p_visit_id,p_parts);
  if locked_shift is distinct from (quote->>'shift_id')::uuid then
    raise exception 'SHIFT_INVALID: shift berubah saat menyimpan; muat ulang';
  end if;
  if initial_accounts is distinct from quote->'accounts' then
    raise exception 'ACCOUNT_INVALID: rekening berubah saat menyimpan; muat ulang dan periksa rekening';
  end if;
  if key is null or length(key)>80 or p_tanggal is null or p_add_owner_credit is null then raise exception 'PAYMENT_INVALID: kunci atau tanggal tidak valid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('clinic-bill-pay:'||key,0));
  fingerprint:=md5(jsonb_build_object('record',p_record_id,'visit',p_visit_id,'date',p_tanggal,'parts',p_parts,
    'credit',p_add_owner_credit,'reason',nullif(btrim(p_dp_override_reason),''))::text);
  select * into cached from clinic_private.inpatient_bill_pay_requests where request_key=key;
  if found then
    if cached.visit_id is distinct from p_visit_id or cached.record_id is distinct from p_record_id or cached.request_hash<>fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT: kunci dipakai untuk data berbeda';
    end if;
    return cached.result;
  end if;
  if ((quote->>'excess')::numeric>0 and p_overpayment_ack is distinct from quote->>'token')
     or (p_overpayment_ack is not null and p_overpayment_ack is distinct from quote->>'token') then
    return jsonb_build_object('status','OVERPAYMENT_CONFIRM_REQUIRED','quote',quote-'lines'-'shift_id');
  end if;
  if (quote->>'debt')::numeric=0 and jsonb_array_length(quote->'lines')=0 and not p_add_owner_credit then
    raise exception 'PAYMENT_SETTLED: tidak ada tagihan baru; gunakan Tambah saldo pemilik secara eksplisit';
  end if;
  if (quote->>'amount')::numeric=0 and jsonb_array_length(quote->'lines')=0 and (quote->>'apply_credit')::numeric<=0 then
    raise exception 'PAYMENT_INVALID: tidak ada transaksi untuk disimpan';
  end if;
  select coalesce(array_agg(a.id),'{}'::uuid[]) into prior_applications
    from public.clinic_advance_applications a join public.invoices i on i.id=a.invoice_id where i.visit_id=p_visit_id;
  -- Apply only AVAILABLE credit, never rewrite an old allocation/header.
  -- Same primitive as stage posting, same coordinator; older AR first.
  for old_invoice in select i.id from public.invoices i where i.visit_id=p_visit_id and i.voided_at is null
    and i.invoice_no is not null and i.request_key is not null and not i.correction_pending
    order by i.created_at,i.id loop
    perform clinic_private.apply_invoice_owner_credit(old_invoice.id,p_tanggal);
  end loop;
  -- Receipt first: oldest EXISTING debt, then real documented advance. Posting the
  -- new stage applies that advance and enforces the ORIGINAL initial minimum.
  -- Any downstream shortage/closed period/DP failure rolls back the receipt too.
  if (quote->>'amount')::numeric>0 then
    receipt:=public.clinic_receive_visit_payment(p_visit_id,'pay:'||key,p_tanggal,p_parts,null,null);
    -- Account-map settings have independent writers. Never silently post to a
    -- destination different from this locked monetary quote while waiting on
    -- the original shift lock. Receipt rows/journals roll back on a mismatch.
    if exists (
      select 1 from public.clinic_payment_receipt_parts rp
      left join jsonb_array_elements(quote->'accounts') a on a->>'method'=rp.metode
      where rp.receipt_id=receipt and rp.kas_code is distinct from a->>'code'
    ) then raise exception 'ACCOUNT_INVALID: rekening berubah saat menyimpan; muat ulang dan periksa rekening'; end if;
  end if;
  if jsonb_array_length(quote->'lines')>0 then
    invoice:=public.clinic_post_inpatient_stage_invoice(p_visit_id,'bill:'||key,
      jsonb_build_object('tanggal',p_tanggal,'subtotal',(quote->>'subtotal')::numeric,'discount',0,
        'tax',(quote->>'tax')::numeric,'total',(quote->>'pending')::numeric,'dp_amount',0,'dp_date',null,
        'paid_status','Belum Lunas','metode_bayar','Tunai','shift_id',quote->>'shift_id','voucher_code',null,
        'salesperson_id',null,'dp_override_reason',p_dp_override_reason),quote->'lines');
  end if;
  select coalesce(jsonb_agg(a.id order by a.id),'[]'::jsonb) into applications
    from public.clinic_advance_applications a join public.invoices i on i.id=a.invoice_id
    where i.visit_id=p_visit_id and not(a.id=any(prior_applications));
  if receipt is null and invoice is null and jsonb_array_length(applications)=0 then
    raise exception 'PAYMENT_INVALID: tidak ada saldo yang diterapkan';
  end if;
  result:=jsonb_build_object('status','SAVED','receipt_id',receipt,'invoice_id',invoice,'application_ids',applications,'visit_id',p_visit_id,'record_id',p_record_id);
  -- Pulang dulu, baru dibayar lewat kasir rawat inap: uangnya masuk sebagai uang muka lalu
  -- dipakai tagihan tahap baru, jadi penutupan di clinic_receive_visit_payment tidak pernah
  -- terpicu. Tutup kunjungan di sini bila semuanya sudah beres.
  perform clinic_private.tutup_kunjungan_ranap_lunas(p_visit_id);
  insert into clinic_private.inpatient_bill_pay_requests(request_key,visit_id,record_id,request_hash,result,created_by)
    values(key,p_visit_id,p_record_id,fingerprint,result,auth.uid());
  return result;
end $function$;

-- Rapikan kunjungan yang sudah tertahan sebelum perbaikan ini (idempoten).
select clinic_private.tutup_kunjungan_ranap_lunas(v.id)
from public.visits v
where v.status <> 'Selesai'
  and exists (select 1 from public.inpatient_records r
    where r.visit_id = v.id and r.discharged_at is not null);
