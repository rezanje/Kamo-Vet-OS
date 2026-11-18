-- Input penjualan PETSHOP dengan tanggal mundur (backdate) — kasir /kasir dan POS back office /pos/transaksi.
-- Apply as ONE transaction (satu transaksi; tanpa begin/commit sendiri).
--
-- Permintaan Andri (18 Nov 2026): barang yang terlupa harus masuk penjualan kemarin (17 Nov) padahal input penjualan tidak bisa mundur
-- (struk POS-20261117-0009-BJF5; Ubah transaksi ditolak karena penerimaannya pernah dibatalkan).
--
-- RANCANGAN (tanpa konsep tanggal baru; mengikuti #502 dan #518):
--  * Tanggal efektif = sales.created_at (tanggal struk): jurnal penjualan (Kas/Bank, Pendapatan, Diskon, PPN), omzet, Rincian Penjualan, komisi
--    membaca kolom itu. Dipasang SAAT INSERT (pos_sale_protect_header melarang UPDATE sesudah payment_plan terisi), pukul 23:59 WIB hari itu.
--  * Waktu nyata: pos_sale_backdates (izin-pakai + jejak: pelaku, cabang, kunci checkout, tanggal, alasan, waktu izin, sale_id) dan
--    sales.payments_finalized_at (waktu finalisasi nyata). Tidak ada kolom baru di sales.
--  * Stok dan jurnal HPP tetap HARI INI (keputusan "2A" Ubah transaksi; sale_stock_out_fifo memang memaksa tanggal stok = hari ini). FIFO memakai lapisan sekarang.
--  * Uang fisik: shift kasir yang sedang terbuka (sales.shift_id), tidak berubah; tutup shift menghitung per shift_id.
--  * Ditolak: voucher, kode kampanye, poin dipakai/didapat, promo di baris (DB di finalize_pos_sale + di INSERT header), melewati 31 hari,
--    periode tertutup (assert_actor), bulan yang sudah digaji, rekonsiliasi bank yang mencakup rekening pembayaran pada/ sesudah tanggal itu.
--  * Izin BARU 'penjualan.pos_penjualan.tanggal_mundur' (bawaan MATI): Owner selalu (tanpa membaca kebijakan); ADMIN/FINANCE hanya bila dicentang Owner + akses cabang.
--  * Gerbang di database: trigger BEFORE INSERT sales — peran klien (authenticated/anon) yang memasang tanggal struk selain hari ini hanya lolos dengan izin-pakai
--    yang cocok (kasir, cabang, kunci checkout, tanggal, jam 23:59, <= 15 menit). Jalur resmi lain (Ubah transaksi, impor) berjalan sebagai pemilik fungsi dan tidak terpengaruh.
--  * Fungsi lama yang ditambal (berjangkar, gagal-tertutup): sale_stock_out_fifo, finalize_pos_sale. Tidak ada tabel/fungsi uang lain yang disentuh.

set local lock_timeout = '5s';

-- ───────────────────────── 1. Jejak + izin-pakai ─────────────────────────
create table public.pos_sale_backdates(
 id uuid primary key default gen_random_uuid(),
 actor_id uuid not null references public.profiles(id),
 branch_id uuid not null references public.branches(id),
 checkout_key text not null check(length(btrim(checkout_key)) between 1 and 120),
 effective_date date not null,
 reason text not null check(length(btrim(reason)) between 3 and 200),
 authorized_at timestamptz not null default now(),
 sale_id uuid references public.sales(id) on delete set null,
 linked_at timestamptz,
 unique(actor_id,checkout_key),
 constraint pos_sale_backdates_date_check check(effective_date<(authorized_at at time zone 'Asia/Jakarta')::date)
);
create unique index pos_sale_backdates_sale_idx on public.pos_sale_backdates(sale_id) where sale_id is not null;
comment on table public.pos_sale_backdates is 'Input penjualan petshop bertanggal mundur: izin-pakai + jejak (pelaku, alasan, waktu nyata). Tanggal efektif = sales.created_at.';
alter table public.pos_sale_backdates enable row level security;
create policy pos_sale_backdates_read on public.pos_sale_backdates for select to authenticated
 using (public.user_can_access_branch(branch_id) and public.sales_module_access());
revoke all on public.pos_sale_backdates from public,anon,authenticated,service_role;
grant select on public.pos_sale_backdates to authenticated;

create function public.guard_pos_sale_backdates() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Jejak tanggal mundur tidak dapat dihapus';end if;
 -- baris belum dipakai: tanggal/alasan boleh diganti (pengguna belum menyimpan struk); identitas tidak
 if old.sale_id is null then
  if new.id is distinct from old.id or new.actor_id is distinct from old.actor_id
   or new.checkout_key is distinct from old.checkout_key then raise exception 'Jejak tanggal mundur tidak dapat diubah';end if;
  return new;
 end if;
 -- baris sudah dipakai: hanya pelepasan sale_id (struk dihapus saat gagal diposting) yang diizinkan, tanpa mengubah apa pun lain
 if new.sale_id is null and (to_jsonb(new)-array['sale_id','linked_at']) is not distinct from (to_jsonb(old)-array['sale_id','linked_at']) then return new;end if;
 raise exception 'Jejak tanggal mundur tidak dapat diubah';
end $$;
create trigger pos_sale_backdates_guard before update or delete on public.pos_sale_backdates for each row execute function public.guard_pos_sale_backdates();

insert into role_settings_private.action_catalog(id,label,"group",enforced) values
 ('penjualan.pos_penjualan.tanggal_mundur','Tanggal mundur — Input penjualan petshop (kasir dan POS belakang)','Penjualan',true)
on conflict(id) do nothing;
insert into role_settings_private.action_modules(id,module_id) values('penjualan.pos_penjualan.tanggal_mundur','penjualan') on conflict do nothing;

-- ───────────────────────── 2. Hak, batas, pemeriksaan ─────────────────────────
create function public.pos_sale_backdate_allowed(p_branch uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_role public.user_role;
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then return false; end if;
 select role into v_role from public.profiles where id=auth.uid() and is_active;
 if v_role is null then return false; end if;
 -- OWNER: tidak membaca tabel kebijakan sama sekali, jadi galat/penguncian kebijakan tidak bisa menolaknya.
 if v_role='OWNER' then return true; end if;
 begin
  if v_role not in('ADMIN','FINANCE') or not public.user_can_access_branch(p_branch) then return false; end if;
  return coalesce(public.role_action_allowed('penjualan.pos_penjualan.tanggal_mundur'),false)
   and exists(select 1 from role_settings_private.action_policies a where a.role=v_role and 'penjualan.pos_penjualan.tanggal_mundur'=any(a.allowed));
 exception when others then return false;
 end;
end $$;
revoke all on function public.pos_sale_backdate_allowed(uuid) from public,anon,service_role;
grant execute on function public.pos_sale_backdate_allowed(uuid) to authenticated;

create function public.pos_sale_backdate_stamp(p_date date) returns timestamptz language sql immutable set search_path='' as $$
 select ((p_date+time '23:59:00') at time zone 'Asia/Jakarta')
$$;
revoke all on function public.pos_sale_backdate_stamp(date) from public,anon,service_role;
grant execute on function public.pos_sale_backdate_stamp(date) to authenticated;

-- Pemeriksaan aturan tanggal (internal): NULL = lolos, selain itu kalimat penolakan. p_plan boleh NULL (pratinjau: rekonsiliasi bank belum bisa diperiksa).
create function public.pos_sale_backdate_check(p_branch uuid, p_date date, p_plan jsonb) returns text language plpgsql stable security definer set search_path='' as $$
declare today date:=(now() at time zone 'Asia/Jakarta')::date; closed date; codes text[];
begin
 if p_date is null then return 'Tanggal pembukuan belum dipilih.';end if;
 if p_date>=today then return 'Tanggal mundur harus sebelum hari ini.';end if;
 if today-p_date>31 then return 'Tanggal pembukuan terlalu jauh ke belakang (paling lama 31 hari). Lebih lama dari itu perlu koreksi pembukuan, bukan input kasir.';end if;
 select closed_until into closed from public.accounting_locks where id;
 if closed is not null and p_date<=closed then
  return 'Periode akuntansi sampai '||to_char(closed,'DD/MM/YYYY')||' sudah ditutup buku. Pilih tanggal sesudahnya, atau buka periodenya lewat Tutup Buku.';end if;
 if exists(select 1 from public.payrolls where periode=to_char(p_date,'YYYY-MM')) then
  return 'Penggajian bulan '||to_char(p_date,'MM/YYYY')||' sudah dibuat; komisi bulan itu tidak boleh berubah. Pilih tanggal di bulan yang belum digaji.';end if;
 if p_plan is not null then
  select array_agg(distinct public.unit_posting_cash(x.method,p_branch)) into codes from jsonb_to_recordset(p_plan) x(method text);
  if exists(select 1 from public.bank_reconciliations r left join public.cash_accounts a on a.id=r.cash_account_id
   left join public.coa_accounts c on c.code=coalesce(r.bank_coa_code,a.coa_code)
   where r.voided_at is null and r.tanggal>=p_date and (c.id is null or c.code=any(codes))) then
   return 'Rekonsiliasi bank sudah mencakup rekening pembayaran struk ini pada/sesudah tanggal itu; koreksi rekonsiliasi dahulu atau pilih metode/tanggal lain.';end if;
 end if;
 return null;
end $$;
revoke all on function public.pos_sale_backdate_check(uuid,date,jsonb) from public,anon,authenticated,service_role;

create function public.pos_sale_backdate_bounds(p_branch uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare today date:=(now() at time zone 'Asia/Jakarta')::date; closed date; mn date;
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then raise exception 'Sesi login diperlukan' using errcode='42501';end if;
 if p_branch is null or not public.user_can_access_branch(p_branch) then raise exception 'Anda tidak diizinkan memakai cabang ini.' using errcode='42501';end if;
 select closed_until into closed from public.accounting_locks where id;
 mn:=greatest(today-31,coalesce(closed+1,today-31));
 return jsonb_build_object('today',today,'max_date',today-1,'min_date',today-31,'closed_until',closed,'effective_min',mn,
  'can_backdate',public.pos_sale_backdate_allowed(p_branch));
end $$;
revoke all on function public.pos_sale_backdate_bounds(uuid) from public,anon,service_role;
grant execute on function public.pos_sale_backdate_bounds(uuid) to authenticated;

-- ───────────────────────── 3. Izin-pakai (dipanggil aplikasi tepat sebelum INSERT struk) ─────────────────────────
create function public.pos_sale_backdate_authorize(p_branch uuid, p_checkout_key text, p_date date, p_reason text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare actor uuid:=auth.uid(); v_key text:=btrim(coalesce(p_checkout_key,'')); v_reason text:=btrim(coalesce(p_reason,'')); msg text; g public.pos_sale_backdates%rowtype;
begin
 if actor is null or auth.role() is distinct from 'authenticated' then raise exception 'Sesi login diperlukan' using errcode='42501';end if;
 if p_branch is null or p_date is null or length(v_key) not between 1 and 120 then raise exception 'Isi tanggal mundur tidak valid' using errcode='22023';end if;
 if not exists(select 1 from public.branches where id=p_branch and is_active) or not public.user_can_access_branch(p_branch) then
  raise exception 'Anda tidak diizinkan memakai cabang ini.' using errcode='42501';end if;
 if not public.pos_sale_backdate_allowed(p_branch) then
  raise exception 'Anda tidak punya izin mencatat penjualan di tanggal sebelum hari ini. Minta Owner mencentang "Tanggal mundur" untuk peran Anda.' using errcode='42501';end if;
 if length(v_reason) not between 3 and 200 then raise exception 'Alasan tanggal mundur wajib diisi (3-200 huruf).' using errcode='22023';end if;
 msg:=public.pos_sale_backdate_check(p_branch,p_date,null);
 if msg is not null then raise exception '%',msg using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('vetos:pos-sale-backdate:'||actor::text||':'||v_key,0));
 select * into g from public.pos_sale_backdates where actor_id=actor and checkout_key=v_key for update;
 if found then
  if g.sale_id is not null then
   if g.branch_id=p_branch and g.effective_date=p_date then
    return jsonb_build_object('authorized',true,'effective_date',g.effective_date,'sale_id',g.sale_id,'reused',true);end if;
   raise exception 'Draft ini sudah dipakai untuk struk tanggal %. Muat ulang kasir untuk draft baru.',to_char(g.effective_date,'DD/MM/YYYY') using errcode='22023';end if;
  update public.pos_sale_backdates set branch_id=p_branch,effective_date=p_date,reason=v_reason,authorized_at=now() where id=g.id;
 else
  insert into public.pos_sale_backdates(actor_id,branch_id,checkout_key,effective_date,reason) values(actor,p_branch,v_key,p_date,v_reason);
 end if;
 return jsonb_build_object('authorized',true,'effective_date',p_date,'stamp',public.pos_sale_backdate_stamp(p_date),'reused',false);
end $$;
revoke all on function public.pos_sale_backdate_authorize(uuid,text,date,text) from public,anon,service_role;
grant execute on function public.pos_sale_backdate_authorize(uuid,text,date,text) to authenticated;

-- ───────────────────────── 4. Gerbang INSERT sales (database memutuskan, bukan layar) ─────────────────────────
create function public.pos_sale_backdate_gate_check(p_branch uuid, p_key text, p_created timestamptz, p_cashier uuid, p_plan jsonb,
 p_voucher text, p_campaign text, p_earned integer, p_used integer) returns void language plpgsql stable security definer set search_path='' as $$
declare d date:=(p_created at time zone 'Asia/Jakarta')::date; today date:=(now() at time zone 'Asia/Jakarta')::date; g public.pos_sale_backdates%rowtype; msg text;
begin
 if d>today then raise exception 'Tanggal struk tidak boleh di masa depan' using errcode='22023';end if;
 if auth.uid() is null or auth.role() is distinct from 'authenticated' or p_cashier is distinct from auth.uid() then
  raise exception 'Tanggal struk mundur tidak diizinkan.' using errcode='42501';end if;
 select * into g from public.pos_sale_backdates where actor_id=auth.uid() and checkout_key=p_key and sale_id is null;
 if not found or g.branch_id is distinct from p_branch or g.effective_date is distinct from d
  or p_created is distinct from public.pos_sale_backdate_stamp(d) or g.authorized_at<now()-interval '15 minutes' then
  raise exception 'Tanggal struk mundur tidak diizinkan: izin tanggal mundur tidak ditemukan atau sudah kedaluwarsa. Ulangi dari layar kasir.' using errcode='42501';end if;
 if not public.pos_sale_backdate_allowed(p_branch) then
  raise exception 'Anda tidak punya izin mencatat penjualan di tanggal sebelum hari ini.' using errcode='42501';end if;
 msg:=public.pos_sale_backdate_check(p_branch,d,p_plan);
 if msg is not null then raise exception '%',msg using errcode='22023';end if;
 if p_voucher is not null or p_campaign is not null or coalesce(p_earned,0)>0 or coalesce(p_used,0)>0 then
  raise exception 'Voucher, kode kampanye, dan poin tidak berlaku pada transaksi tanggal mundur.' using errcode='22023';end if;
end $$;
revoke all on function public.pos_sale_backdate_gate_check(uuid,text,timestamptz,uuid,jsonb,text,text,integer,integer) from public,anon,service_role;
grant execute on function public.pos_sale_backdate_gate_check(uuid,text,timestamptz,uuid,jsonb,text,text,integer,integer) to authenticated;

create function public.pos_sale_backdate_gate() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.channel is null and new.payment_plan is not null and current_user in('authenticated','anon')
  and (new.created_at at time zone 'Asia/Jakarta')::date is distinct from (now() at time zone 'Asia/Jakarta')::date then
  perform public.pos_sale_backdate_gate_check(new.branch_id,new.checkout_key,new.created_at,new.cashier_id,new.payment_plan,new.voucher_code,new.campaign_code,new.poin_earned,new.poin_digunakan);
 end if;
 return new;
end $$;
revoke all on function public.pos_sale_backdate_gate() from public,anon,authenticated,service_role;
create trigger a0_pos_sale_backdate_gate before insert on public.sales for each row execute function public.pos_sale_backdate_gate();

create function public.pos_sale_backdate_link() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.channel is null and new.payment_plan is not null
  and (new.created_at at time zone 'Asia/Jakarta')::date<(now() at time zone 'Asia/Jakarta')::date then
  update public.pos_sale_backdates set sale_id=new.id,linked_at=now()
   where actor_id=new.cashier_id and checkout_key=new.checkout_key and sale_id is null and branch_id=new.branch_id
    and effective_date=(new.created_at at time zone 'Asia/Jakarta')::date;
 end if;
 return new;
end $$;
revoke all on function public.pos_sale_backdate_link() from public,anon,authenticated,service_role;
create trigger pos_sale_backdate_link after insert on public.sales for each row execute function public.pos_sale_backdate_link();

create function public.pos_sale_backdated(p_sale_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.pos_sale_backdates where sale_id=p_sale_id)
$$;
revoke all on function public.pos_sale_backdated(uuid) from public,anon,authenticated,service_role;

-- ───────────────────────── 5. Tambalan berjangkar pada jalur resmi ─────────────────────────
create function pg_temp.patch(fn text, pairs text[], marker text) returns void language plpgsql as $f$
declare body text;i integer;n integer;
begin
 body:=pg_get_functiondef(fn::regprocedure);
 if position(marker in body)>0 then raise exception '% already present in %',marker,fn;end if;
 for i in 1..array_length(pairs,1)/2 loop
  n:=(length(body)-length(replace(body,pairs[2*i-1],'')))/length(pairs[2*i-1]);
  if n<>1 then raise exception '% anchor % found % time(s) in %, expected 1',marker,i,n,fn;end if;
  body:=replace(body,pairs[2*i-1],pairs[2*i]);
 end loop;
 if position(marker in body)=0 then raise exception '% marker missing after patch of %',marker,fn;end if;
 execute body;
end $f$;

-- 5a. Stok struk bertanggal mundur keluar HARI INI (lapisan FIFO sekarang); tanggal struk tetap tanggal mundur.
select pg_temp.patch('public.sale_stock_out_fifo(uuid,uuid,numeric,text,text,date,uuid)', array[
 $a$and not public.pos_sale_edit_allowed(s.id))$a$,
 $r$and not public.pos_sale_edit_allowed(s.id) and not public.pos_sale_backdated(s.id) /* BACKDATE_INPUT */)$r$], 'BACKDATE_INPUT');

-- 5b. finalize_pos_sale: jurnal HPP hari ini + penolakan voucher/kampanye/poin/promo pada struk mundur (pagar terakhir; INSERT header sudah menolak sebagian).
select pg_temp.patch('public.finalize_pos_sale(uuid)', array[
 $a$case when public.pos_sale_edit_allowed(sale.id) then$a$,
 $r$case when public.pos_sale_edit_allowed(sale.id) or public.pos_sale_backdated(sale.id) /* BACKDATE_INPUT */ then$r$,
 $a$ select * into strict posting from public.pos_sale_postings where sale_id=sale.id for update;$a$,
 $r$ select * into strict posting from public.pos_sale_postings where sale_id=sale.id for update;
 -- BACKDATE_INPUT: struk bertanggal mundur tanpa voucher/kampanye/poin/promo (harga = master sekarang).
 if public.pos_sale_backdated(sale.id) and (sale.voucher_code is not null or sale.campaign_code is not null or sale.poin_earned>0 or sale.poin_digunakan>0
  or exists(select 1 from public.sale_items where sale_id=sale.id and (promo_id is not null or promo_claim_id is not null or coalesce(promo_discount,0)>0
   or coalesce(promo_floor_waiver,false)))) then
  raise exception 'Voucher, kode kampanye, poin, dan promo tidak berlaku pada transaksi tanggal mundur.' using errcode='22023';end if;$r$], 'BACKDATE_INPUT');
