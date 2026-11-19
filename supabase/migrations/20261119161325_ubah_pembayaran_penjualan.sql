-- Ubah pembayaran penjualan kasir dalam satu langkah, gaya Accurate (19 Nov 2026).
--
-- Pelapor: Mba Anisa (finance) via Reza, video WA 19 Nov 2026: di Accurate penerimaan penjualan dibuka lalu tanggal/metode/nilai
-- langsung diubah dan disimpan. Di KAMO harus dua langkah: "Batalkan penerimaan" (struk jadi belum dibayar) lalu "Terima pembayaran".
-- Keputusan Reza (opsi A): mulai dari ubah PEMBAYARAN (tanggal bayar + pembagian metode); isi struk/diskon tetap lewat "Ubah transaksi".
--
-- change_pos_sale_payment(sale, revisi, kunci, alasan, rencana, tanggal):
--  * satu transaksi database = cancel_pos_sale_receipt + receive_pos_sale_payment (fungsi resmi yang sudah ada, dengan semua penjaganya:
--    izin cabang & Akses Grup, tanggal mundur hanya Owner/peran berizin, periode tutup buku, rekonsiliasi bank, fee merchant, retur/refund,
--    laci shift, jumlah = total struk). Gagal di langkah mana pun = tidak ada yang tersimpan, struk tidak pernah "belum dibayar".
--  * penerimaan lama dibalik di TANGGAL ASLINYA (bila pelaku boleh tanggal mundur; kalau tidak, hari ini), penerimaan baru dicatat di
--    tanggal bayar yang dipilih (tidak boleh sebelum tanggal penerimaan asli, tidak boleh di masa depan).
--  * tanpa perubahan apa pun (metode, jumlah, dan tanggal sama) ditolak supaya tidak ada jurnal kosong.
--  * idempoten: kunci yang sama (klik dua kali / koneksi putus) mengembalikan hasil yang sama.
-- Akun per metode tetap mengikuti pemetaan cabang (sama dengan kasir). Memilih rekening bank bebas per pembayaran belum termasuk.

create or replace function public.change_pos_sale_payment(p_sale_id uuid, p_expected_revision integer, p_request_key text, p_reason text,
 p_plan jsonb, p_effective_date date default null)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
 actor uuid:=auth.uid(); s public.sales%rowtype; reason text:=btrim(coalesce(p_reason,''));
 today date:=(now() at time zone 'Asia/Jakarta')::date; edate date; floor_date date; cancel_date date;
 k_cancel text; k_receive text; c jsonb; r jsonb; old_norm jsonb; plan_norm jsonb;
begin
 perform admin_online_private.deny_admin_online();
 if actor is null or auth.role() is distinct from 'authenticated' then raise exception 'Sesi login diperlukan' using errcode='42501'; end if;
 if p_sale_id is null or p_expected_revision is null or p_expected_revision<0
  or length(btrim(coalesce(p_request_key,''))) not between 1 and 110 or length(p_request_key)>110 or length(reason) not between 3 and 980
  or p_plan is null or jsonb_typeof(p_plan) is distinct from 'array' then
  raise exception 'Identitas, alasan (3–980 huruf), atau rincian pembayaran tidak valid.' using errcode='22023'; end if;
 k_cancel:=p_request_key||':batal'; k_receive:=p_request_key||':terima';
 -- Ulang kirim sesudah berhasil: kedua langkah mengembalikan hasil tersimpannya (isian berbeda tetap ditolak di sana).
 if exists(select 1 from public.receipt_cancel_requests where actor_id=actor and request_key=k_receive) then
  select result into c from public.receipt_cancel_requests where actor_id=actor and request_key=k_cancel;
  r:=public.receive_pos_sale_payment(p_sale_id,p_expected_revision,k_receive,p_plan,p_effective_date,reason);
  return r||jsonb_build_object('mode','ubah-pembayaran','cancel_journal_id',c->>'journal_id','cancel_effective_date',c->>'effective_date');
 end if;
 select * into s from public.sales where id=p_sale_id;
 if not found then raise exception 'Penjualan tidak ditemukan'; end if;
 if not public.pos_receipt_actor_allowed(s.branch_id) then
  raise exception 'Anda tidak diizinkan mengubah pembayaran struk ini. Minta Owner membukanya di Pengaturan > Akses Grup.' using errcode='42501'; end if;
 edate:=coalesce(p_effective_date,today);
 if edate>today then raise exception 'Tanggal bayar % belum tiba (hari ini %).',to_char(edate,'DD/MM/YYYY'),to_char(today,'DD/MM/YYYY') using errcode='22023'; end if;
 floor_date:=public.pos_receipt_date_floor(s.id,'cancel');
 if edate<floor_date then
  raise exception 'Tanggal bayar % tidak boleh sebelum tanggal pembayaran yang tercatat (%).',to_char(edate,'DD/MM/YYYY'),to_char(floor_date,'DD/MM/YYYY') using errcode='22023'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('method',p.method,'amount',p.amount) order by p.method),'[]'::jsonb) into old_norm
  from public.sale_payments p where p.sale_id=s.id;
 begin
  select coalesce(jsonb_agg(jsonb_build_object('method',x.method,'amount',x.amount) order by x.method),'[]'::jsonb) into plan_norm
   from jsonb_to_recordset(p_plan) as x(method text,amount numeric);
 exception when others then raise exception 'Rincian pembayaran tidak valid (metode dan jumlah).' using errcode='22023';
 end;
 if old_norm=plan_norm and edate=floor_date then
  raise exception 'Tidak ada yang berubah: metode, jumlah, dan tanggal bayar sama dengan yang tercatat.' using errcode='22023'; end if;
 -- Penerimaan lama dibalik di tanggal aslinya (butuh izin tanggal mundur); tanpa izin: hari ini, dan tanggal bayar baru juga hari ini.
 cancel_date:=case when floor_date<today and public.pos_receipt_backdate_allowed(s.branch_id) then floor_date end;
 c:=public.cancel_pos_sale_receipt(p_sale_id,p_expected_revision,k_cancel,'Ubah pembayaran: '||reason,cancel_date);
 r:=public.receive_pos_sale_payment(p_sale_id,p_expected_revision,k_receive,p_plan,p_effective_date,reason);
 return r||jsonb_build_object('mode','ubah-pembayaran','cancel_journal_id',c->>'journal_id','cancel_effective_date',c->>'effective_date');
end $$;
revoke all on function public.change_pos_sale_payment(uuid,integer,text,text,jsonb,date) from public,anon,service_role;
grant execute on function public.change_pos_sale_payment(uuid,integer,text,text,jsonb,date) to authenticated;
