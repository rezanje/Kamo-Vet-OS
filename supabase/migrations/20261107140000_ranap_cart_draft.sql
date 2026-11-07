-- Rawat inap kasir: keranjang yang terlihat di layar tersimpan sebagai DRAFT walau langkah uangnya ditolak.
--
-- Laporan Andri (7 Nov 2026): "kalau gua udah hapus dan save, bukannya nyimpen transaksi sbg draft; yang udah dihapus
-- sebelumnya muncul lagi; dan jasa/obat yang ditambahkan oleh admin kasir malah jadi hilang."
--
-- Akar masalah: clinic_save_inpatient_cashier mengubah keranjang (tarik baris, tambah baris, ubah qty/harga) DAN menerbitkan
-- invoice + menerima uang dalam SATU transaksi. Setiap penolakan langkah uang (aturan P03 harga di bawah HPP, DP minimal,
-- CART_STALE ...) membatalkan seluruh transaksi, termasuk penghapusan dan baris tambahan kasir. Layar hanya menyimpan
-- perubahan itu di memori browser; muat ulang menampilkan keranjang lama. (Simpan yang BERHASIL sudah benar: baris yang
-- ditarik tidak kembali dan baris tambahan tertagih sekali.)
--
-- Perbaikan: fungsi baru public.clinic_save_inpatient_cart_draft memakai mesin keranjang yang SAMA (clinic_save_inpatient_cashier:
-- jabatan, shift, snapshot, COMPOUND_LOCKED, BMHP_LOCKED, harga racikan khusus Owner, pelaksana, jejak clinic_pending_cart_edits)
-- tetapi berhenti sebelum clinic_bill_and_pay_inpatient: tanpa invoice, tanpa uang, tanpa stok, tanpa jurnal. Aksi server
-- memanggilnya (a) bila langkah uang ditolak, dengan snapshot dan baris yang sama, dan (b) untuk tombol "Simpan Draft".
-- Aturan P03 (assert_invoice_price_floor), COMPOUND_LOCKED, BMHP_LOCKED dan semua pengaman lain TIDAK diubah: harga di bawah HPP
-- boleh disimpan sebagai draft, tetapi tetap ditolak saat invoice diterbitkan.
--
-- Penanda draft = baris izin satu-transaksi di clinic_private.cart_draft_permits (pola yang sama dengan performer_change_permits):
-- hanya pembungkus yang menulisnya, terikat txid_current() + auth.uid() + kunjungan, dihapus sebelum kembali, tidak ada hak akses
-- untuk peran aplikasi. Tanda tangan clinic_save_inpatient_cashier TIDAK berubah.

create table clinic_private.cart_draft_permits(
  transaction_id bigint primary key,
  actor uuid not null,
  visit_id uuid not null
);
revoke all on clinic_private.cart_draft_permits from public,anon,authenticated,service_role;

do $patch$
declare
  d text;
  needle text := 'result:=public.clinic_bill_and_pay_inpatient(p_record_id,p_visit_id,''cart:''||md5(p_request_key),p_tanggal,p_parts,p_overpayment_ack,p_add_owner_credit,p_dp_override_reason);';
  repl text := 'if exists(select 1 from clinic_private.cart_draft_permits where transaction_id=txid_current() and actor=auth.uid() and visit_id=p_visit_id)then
   result:=jsonb_build_object(''status'',''DRAFT_SAVED'',''visit_id'',p_visit_id,''record_id'',p_record_id,
    ''snapshot'',clinic_private.inpatient_cashier_snapshot(after_rows,clinic_private.inpatient_payment_quote(p_record_id,p_visit_id,''[]'')));
  else
   result:=public.clinic_bill_and_pay_inpatient(p_record_id,p_visit_id,''cart:''||md5(p_request_key),p_tanggal,p_parts,p_overpayment_ack,p_add_owner_credit,p_dp_override_reason);
  end if;';
begin
  d := pg_get_functiondef('public.clinic_save_inpatient_cashier(uuid,uuid,text,date,text,jsonb,jsonb,text,boolean,text,text)'::regprocedure);
  if (length(d) - length(replace(d, needle, ''))) / length(needle) <> 1 then
    raise exception 'Cart draft anchor drift: clinic_bill_and_pay_inpatient call not found exactly once';
  end if;
  execute replace(d, needle, repl);
end $patch$;

create function public.clinic_save_inpatient_cart_draft(
  p_record_id uuid, p_visit_id uuid, p_request_key text, p_snapshot text, p_rows jsonb, p_reason text
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='8s' as $$
declare result jsonb;
begin
  -- Same people as the money save (the roles that run the cashier). DOCTOR does not edit billing carts.
  -- Branch/stay/module/shift validation happens inside clinic_save_inpatient_cashier (quote + billing coordinator).
  if auth.uid() is null or coalesce(auth.role(),current_setting('role',true)) <> 'authenticated'
     or not exists(select 1 from public.profiles where id=auth.uid() and is_active and role in ('OWNER','ADMIN','FINANCE','STAFF')) then
    raise exception 'ACCESS_DENIED: hanya kasir, admin, atau pemilik yang boleh menyimpan draft keranjang';
  end if;
  -- the cashier idempotency key is limited to 80 characters; the draft keeps its own namespace ('draft:' + key)
  if nullif(btrim(p_request_key),'') is null or length(p_request_key) > 70 then
    raise exception 'CART_INVALID: kunci transaksi draft tidak valid';
  end if;
  insert into clinic_private.cart_draft_permits values(txid_current(), auth.uid(), p_visit_id);
  result := public.clinic_save_inpatient_cashier(p_record_id, p_visit_id, 'draft:'||p_request_key, null, p_snapshot, p_rows, '[]'::jsonb, null, false, null, p_reason);
  delete from clinic_private.cart_draft_permits where transaction_id = txid_current();
  return result;
end$$;
revoke all on function public.clinic_save_inpatient_cart_draft(uuid,uuid,text,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.clinic_save_inpatient_cart_draft(uuid,uuid,text,text,jsonb,text) to authenticated;

-- Install-time self-check: the patched engine has the draft branch and still reaches the original money engine exactly once.
do $check$
declare d text; w text;
begin
  d := pg_get_functiondef('public.clinic_save_inpatient_cashier(uuid,uuid,text,date,text,jsonb,jsonb,text,boolean,text,text)'::regprocedure);
  w := pg_get_functiondef('public.clinic_save_inpatient_cart_draft(uuid,uuid,text,text,jsonb,text)'::regprocedure);
  if d not like '%cart_draft_permits%' or d not like '%DRAFT_SAVED%' or (length(d)-length(replace(d,'clinic_bill_and_pay_inpatient(','')))/length('clinic_bill_and_pay_inpatient(') <> 1 then
    raise exception 'Cart draft self-check failed: engine patch';
  end if;
  if w like '%clinic_bill_and_pay_inpatient%' or w not like '%cart_draft_permits%' or w not like '%txid_current()%' or w not like '%OWNER%' then
    raise exception 'Cart draft self-check failed: wrapper';
  end if;
end $check$;
