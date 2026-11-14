-- Owner boleh jual barang PERSEDIAAN di bawah modal (obral / mau kadaluarsa) dengan alasan wajib — petshop saja.
-- Apply as ONE transaction (satu transaksi; tanpa begin/commit sendiri).
--
-- Latar (Andri, 14 Nov 2026): kasir menolak "Harga neto Crystal Kitty HnS 400gr di bawah batas aman HPP FIFO; penjualan ditolak." saat Owner
-- mau menjual stok hampir kadaluarsa diskon 50%. Aturan Andri: "Jangan ada yang ngunci dan ga bisa melakukan action untuk akun owner."
-- Ruang lingkup (Andri): "khusus produk persediaan aja. sementara butuh untuk petshop dulu." => hanya barang Persediaan, hanya petshop
-- (kasir /kasir dan POS /pos/transaksi). Jasa dan paket Grup TIDAK bisa memakai ini (dijaga database). Klinik tidak disentuh.
--
-- RANCANGAN
--  * Izin Akses Grup baru 'kasir.jual_bawah_modal' (izin khusus, bawaan MATI) + public.below_cost_sale_allowed():
--    OWNER selalu (tidak membaca tabel kebijakan: tak bisa terkunci); peran lain HANYA bila kebijakan tersimpan memuat izinnya; tanpa kebijakan = tidak.
--  * Per baris struk: sale_items.below_hpp_owner_reason (alasan wajib, 3-200 huruf), below_hpp_owner_by (diisi database), below_hpp_loss (rugi, diisi
--    database saat posting). Tabel RLS-terbuka, jadi kolom itu dijaga trigger: klien tak bisa menulis by/loss; alasan hanya boleh untuk barang
--    Persediaan dan hanya oleh pemilik izin.
--  * Lantai HPP kasir (cashier_post_stock_atomic, P03) dilonggarkan HANYA untuk baris Persediaan berisi alasan DAN pemosting punya izin (dicek ke
--    database saat posting, bukan layar). Tetap ditolak: harga neto nol, HPP tak diketahui (null), paket Grup, jasa, baris promo-waiver,
--    COST_MISSING (HPP lapisan Rp0). Promo waiver P05 tidak disentuh. HPP tetap HPP FIFO asli: rugi tampil sebagai margin lebih kecil.
--  * Diskon yang menurunkan harga tetap lewat diskon manual biasa (manual_discount_allowed: Owner sudah boleh); penjaga diskon manual tidak dilewati.
--  * Ubah transaksi petshop (edit_posted_pos_sale) membawa alasan ke struk pengganti (seperti promo_floor_waiver). Pemosting struk pengganti
--    tetap harus punya izin; Finance tanpa izin ditolak jelas (tidak diam-diam kehilangan alasan).
--  * Laporan baca saja public.laporan_jual_bawah_modal (Owner/Admin/Finance) + 1 baris katalog sub-menu.

-- ───────────── 1. Kolom jejak + batas ─────────────
alter table public.sale_items
 add column below_hpp_owner_reason text,
 add column below_hpp_owner_by uuid,
 add column below_hpp_loss numeric(15,2);
alter table public.sale_items add constraint sale_items_below_hpp_reason_check
 check (below_hpp_owner_reason is null or length(btrim(below_hpp_owner_reason)) between 3 and 200) not valid;
alter table public.sale_items add constraint sale_items_below_hpp_shape_check
 check ((below_hpp_owner_reason is not null or (below_hpp_owner_by is null and below_hpp_loss is null))
        and not (below_hpp_owner_reason is not null and promo_floor_waiver)
        and (below_hpp_loss is null or below_hpp_loss>=0)) not valid;
comment on column public.sale_items.below_hpp_owner_reason is 'Alasan Owner menjual barang persediaan di bawah HPP (obral). Diisi hanya oleh pemilik izin kasir.jual_bawah_modal.';
comment on column public.sale_items.below_hpp_owner_by is 'Pengguna yang memberi alasan/memposting obral di bawah modal (diisi database).';
comment on column public.sale_items.below_hpp_loss is 'Selisih HPP baris - harga neto baris saat diposting (>=0), diisi database.';

-- ───────────── 2. Izin Akses Grup + pemeriksa ─────────────
insert into role_settings_private.action_catalog(id,label,"group",enforced) values
 ('kasir.jual_bawah_modal','Jual di bawah modal (obral) — jual barang persediaan di bawah HPP di kasir petshop dengan alasan wajib; dicatat dan masuk laporan. Bawaan hanya Owner','Kasir & Tagihan',true)
on conflict(id) do nothing;
insert into role_settings_private.action_modules(id,module_id) values('kasir.jual_bawah_modal','kasir') on conflict do nothing;

create function public.below_cost_sale_allowed() returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_role public.user_role; v_allowed text[];
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then return false; end if;
 select role into v_role from public.profiles where id=auth.uid() and is_active;
 if v_role is null then return false; end if;
 -- OWNER: tidak membaca tabel kebijakan sama sekali, jadi galat/penguncian kebijakan tidak bisa menolaknya.
 if v_role='OWNER' then return true; end if;
 begin
  if not exists(select 1 from role_settings_private.action_catalog where id='kasir.jual_bawah_modal' and enforced) then return false; end if;
  select a.allowed into v_allowed from role_settings_private.action_policies a where a.role=v_role;
  -- Tanpa kebijakan tersimpan: bawaan TIDAK (izin khusus, hanya Owner yang boleh tanpa dicentang).
  if not found then return false; end if;
  return 'kasir.jual_bawah_modal'=any(v_allowed);
 exception when others then return false;
 end;
end $$;
comment on function public.below_cost_sale_allowed() is 'Boleh menjual barang persediaan di bawah HPP (obral) dengan alasan? OWNER selalu; peran lain hanya bila dicentang (kasir.jual_bawah_modal).';
revoke all on function public.below_cost_sale_allowed() from public,anon,service_role;
grant execute on function public.below_cost_sale_allowed() to authenticated;

-- ───────────── 3. Penjaga kolom (sale_items terbuka untuk klien lewat RLS) ─────────────
create function public.guard_sale_item_below_cost() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 -- Jalur klien (API langsung): by/loss hanya boleh ditulis database (fungsi posting/trigger ini), bukan klien.
 if current_user in ('authenticated','anon') then
  if tg_op='INSERT' then new.below_hpp_owner_by:=null; new.below_hpp_loss:=null;
  else new.below_hpp_owner_by:=old.below_hpp_owner_by; new.below_hpp_loss:=old.below_hpp_loss; end if;
 end if;
 if new.below_hpp_owner_reason is null then
  new.below_hpp_owner_by:=null; new.below_hpp_loss:=null; return new;
 end if;
 if tg_op='UPDATE' and new.below_hpp_owner_reason is not distinct from old.below_hpp_owner_reason
    and new.item_id is not distinct from old.item_id and new.promo_floor_waiver is not distinct from old.promo_floor_waiver then return new; end if;
 if length(btrim(new.below_hpp_owner_reason)) not between 3 and 200 then
  raise exception 'BAWAH_MODAL_ALASAN: alasan jual di bawah modal wajib diisi 3 sampai 200 huruf.' using errcode='22023';
 end if;
 if new.item_id is null or not exists(select 1 from public.items i where i.id=new.item_id and i.item_type='Persediaan') then
  raise exception 'BAWAH_MODAL_JENIS: jual di bawah modal hanya untuk barang persediaan (bukan jasa atau paket).' using errcode='22023';
 end if;
 if coalesce(new.promo_floor_waiver,false) then
  raise exception 'BAWAH_MODAL_PROMO: baris promo di bawah modal tidak bisa digabung dengan jual di bawah modal Owner.' using errcode='22023';
 end if;
 if auth.uid() is not null then
  if not public.below_cost_sale_allowed() then
   raise exception 'BAWAH_MODAL_IZIN: jual di bawah modal hanya untuk Owner atau peran yang diberi izin. Minta Owner mencentangnya di Pengaturan > Akses Grup.' using errcode='42501';
  end if;
  new.below_hpp_owner_by:=auth.uid();
 end if;
 return new;
end $$;
revoke all on function public.guard_sale_item_below_cost() from public,anon,authenticated,service_role;
create trigger guard_sale_item_below_cost before insert or update of below_hpp_owner_reason,below_hpp_owner_by,below_hpp_loss,item_id,promo_floor_waiver on public.sale_items
 for each row execute function public.guard_sale_item_below_cost();

-- ───────────── 4. Lantai HPP kasir + ubah transaksi (tambalan berjangkar, gagal tertutup) ─────────────
do $patch$
declare p record; definition text; sig regprocedure; hits integer; body text; old_body text;
begin
 for p in select * from (values
  -- A. lantai: lolos hanya untuk baris Persediaan beralasan + pemosting berizin (dicek DB), bukan baris promo-waiver, HPP harus diketahui.
  ('public.cashier_post_stock_atomic(uuid,uuid)',1,
   $a$if line.hpp is null or (gross-item_discount)*net_total/after_items < (case when coalesce(line.promo_floor_waiver,false) and manual<=0 then least(line.hpp,gross-item_discount) else line.hpp end) then -- P05_PROMO_WAIVER$a$,
   $b$if (line.hpp is null or (gross-item_discount)*net_total/after_items < (case when coalesce(line.promo_floor_waiver,false) and manual<=0 then least(line.hpp,gross-item_discount) else line.hpp end))
    and not (line.hpp is not null and line.item_type='Persediaan' and not coalesce(line.promo_floor_waiver,false)
     and nullif(btrim(coalesce(line.below_hpp_owner_reason,'')),'') is not null and public.below_cost_sale_allowed()) then -- P05_PROMO_WAIVER P06_OWNER_BELOW_COST$b$),
  -- B. pesan penolakan: bila alasan ada tapi pemosting tak berizin, katakan jelas.
  ('public.cashier_post_stock_atomic(uuid,uuid)',1,
   $a$else '' end) using errcode='55000';$a$,
   $b$else '' end)||(case when nullif(btrim(coalesce(line.below_hpp_owner_reason,'')),'') is not null then ' (jual di bawah modal ditolak: hanya Owner atau peran yang diberi izin Jual di bawah modal)' else '' end) using errcode='55000';$b$),
  -- C. catat rugi + pelaku untuk baris yang lolos dengan alasan (setelah lantai; hanya jalan bila lantai lolos).
  ('public.cashier_post_stock_atomic(uuid,uuid)',1,
   E' end loop;\n if issued = 0 then',
   E'  if line.item_type=''Persediaan'' and line.hpp is not null and nullif(btrim(coalesce(line.below_hpp_owner_reason,'''')),'''') is not null then -- P06_OWNER_BELOW_COST\n   update public.sale_items set below_hpp_owner_by=auth.uid(),below_hpp_loss=greatest(round(line.hpp-(gross-item_discount)*net_total/after_items,2),0) where id=line.id;\n  end if;\n end loop;\n if issued = 0 then'),
  -- D. ubah transaksi petshop: alasan ikut ke struk pengganti (seperti promo_floor_waiver).
  ('public.edit_posted_pos_sale(uuid,integer,text,text,jsonb)',1,
   $a$promo_hasil_units,promo_floor_waiver,hpp)$a$,
   $b$promo_hasil_units,promo_floor_waiver,hpp,below_hpp_owner_reason)$b$),
  ('public.edit_posted_pos_sale(uuid,integer,text,text,jsonb)',1,
   $a$coalesce((line->>'promo_floor_waiver')::boolean,false),case when nullif(line->>'item_id','') is null then null else 0 end);$a$,
   $b$coalesce((line->>'promo_floor_waiver')::boolean,false),case when nullif(line->>'item_id','') is null then null else 0 end,
   nullif(btrim(coalesce(line->>'below_hpp_owner_reason','')),''));$b$)
 ) as v(sig,expected,anchor,replacement) loop
  sig:=p.sig::regprocedure;
  select pg_get_functiondef(sig),prosrc into definition,old_body from pg_proc where oid=sig;
  hits:=(length(old_body)-length(replace(old_body,p.anchor,'')))/length(p.anchor);
  if hits<>p.expected then raise exception 'Jangkar tambalan berubah (% hit, diharapkan %) pada %: %',hits,p.expected,p.sig,left(p.anchor,60); end if;
  body:=replace(old_body,p.anchor,p.replacement);
  execute replace(definition,old_body,body);
 end loop;
end $patch$;

-- ───────────── 5. Laporan baca saja: Penjualan di bawah modal (Owner) ─────────────
create function public.laporan_jual_bawah_modal(p_dari date,p_sampai date,p_cabang uuid default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $fn$
declare v_rows jsonb;
begin
 if auth.uid() is null then raise exception 'LOGIN_DIPERLUKAN' using errcode='28000'; end if;
 if not exists(select 1 from public.profiles where id=auth.uid() and is_active and role in('OWNER','ADMIN','FINANCE')) then
  raise exception 'Hanya Owner, Admin, atau Finance yang boleh melihat laporan ini' using errcode='42501';
 end if;
 if p_dari is null or p_sampai is null or p_sampai<p_dari or p_sampai-p_dari>366 then raise exception 'RENTANG_TIDAK_VALID' using errcode='22023'; end if;
 with sel as (
  select s.id,s.no_struk,s.branch_id,s.created_at,s.total-coalesce(s.merchant_fee_total,0) as net_total
  from public.sales s
  where s.voided_at is null and s.payments_finalized_at is not null and s.channel is null
    and (s.created_at at time zone 'Asia/Jakarta')::date between p_dari and p_sampai
    and (p_cabang is null or s.branch_id=p_cabang)
    and exists(select 1 from public.sale_items x where x.sale_id=s.id and x.below_hpp_owner_reason is not null)
 ), ln as (
  select i.*,sel.no_struk as s_no,sel.branch_id as s_branch,sel.created_at as s_at,sel.net_total,
   g.gross,g.idisc,sum(g.gross-g.idisc) over (partition by i.sale_id) as after_items
  from public.sale_items i join sel on sel.id=i.sale_id
  cross join lateral (select i.qty*i.harga as gross,
    least(greatest(case when (case when i.item_discount_type='percent' then round(i.qty*i.harga*coalesce(i.item_discount_value,0)/100,0) else coalesce(i.item_discount_value,0) end)>0
      then (case when i.item_discount_type='percent' then round(i.qty*i.harga*coalesce(i.item_discount_value,0)/100,0) else coalesce(i.item_discount_value,0) end)
      else coalesce(i.promo_discount,0) end,0),i.qty*i.harga) as idisc) g
 ), hasil as (
  select ln.*,case when ln.after_items>0 then round((ln.gross-ln.idisc)*ln.net_total/ln.after_items,2) else 0 end as net_baris
  from ln where ln.below_hpp_owner_reason is not null
 )
 select coalesce(jsonb_agg(jsonb_build_object(
   'sale_id',h.sale_id,'tanggal',(h.s_at at time zone 'Asia/Jakarta')::date,'cabang_id',h.s_branch,'cabang',b.name,'no_struk',h.s_no,
   'item_id',h.item_id,'kode',m.code,'barang',h.nama,'qty',h.qty,'satuan',h.satuan,'faktor',h.faktor,
   'hpp',round(coalesce(h.hpp,0),2),'harga_neto',h.net_baris,
   'rugi',coalesce(h.below_hpp_loss,greatest(round(coalesce(h.hpp,0)-h.net_baris,2),0)),
   'alasan',h.below_hpp_owner_reason,'oleh_id',h.below_hpp_owner_by,'oleh',coalesce(pr.full_name,'-')
  ) order by h.s_at desc,h.s_no,h.source_position nulls last,h.id),'[]'::jsonb) into v_rows
 from hasil h left join public.branches b on b.id=h.s_branch left join public.items m on m.id=h.item_id
 left join public.profiles pr on pr.id=h.below_hpp_owner_by
 where coalesce(h.below_hpp_loss,greatest(round(coalesce(h.hpp,0)-h.net_baris,2),0))>0;
 return jsonb_build_object('dari',p_dari,'sampai',p_sampai,'cabang_id',p_cabang,'baris',v_rows);
end $fn$;
comment on function public.laporan_jual_bawah_modal(date,date,uuid) is 'Hanya baca. Baris struk petshop yang dijual di bawah modal dengan alasan Owner (struk aktif, bukan yang dibatalkan/diubah).';
revoke all on function public.laporan_jual_bawah_modal(date,date,uuid) from public,anon;
grant execute on function public.laporan_jual_bawah_modal(date,date,uuid) to authenticated,service_role;

insert into role_settings_private.submenu_catalog(id,module_id) values
('laporan.jual-bawah-modal','laporan')
on conflict (id) do nothing;

-- ───────────── 6. Pemeriksaan pasang ─────────────
do $check$
begin
 if position('P06_OWNER_BELOW_COST' in pg_get_functiondef('public.cashier_post_stock_atomic(uuid,uuid)'::regprocedure))=0
    or position('P05_PROMO_WAIVER' in pg_get_functiondef('public.cashier_post_stock_atomic(uuid,uuid)'::regprocedure))=0
    or position('P03_GRUP_FLOOR' in pg_get_functiondef('public.cashier_post_stock_atomic(uuid,uuid)'::regprocedure))=0 then raise exception 'BM_CHECK lantai kasir'; end if;
 if position('below_hpp_owner_reason' in pg_get_functiondef('public.edit_posted_pos_sale(uuid,integer,text,text,jsonb)'::regprocedure))=0 then raise exception 'BM_CHECK ubah struk'; end if;
 if (select count(*) from pg_trigger where tgname='guard_sale_item_below_cost' and not tgisinternal)<>1 then raise exception 'BM_CHECK trigger'; end if;
end $check$;
