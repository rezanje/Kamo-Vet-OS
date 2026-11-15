-- JALUR OWNER: ubah isi struk petshop BERPROMO/BERVOUCHER yang penerimaannya sedang dibatalkan ("belum dibayar").
-- Keputusan Reza 15 Nov 2026 (DM: "go semua" + "ikut saran lo yg bener aja"); menutup temuan R4 audit 11 Nov (sebelumnya hanya peringatan).
--
-- Sebelum: struk yang pernah "Batalkan penerimaan" ditolak oleh Ubah transaksi, dan "Batalkan penjualan" menolak struk ber-promo/voucher
-- (kuota). Owner terjebak: struk berpromo yang belum dibayar hanya bisa diterima lagi dengan total yang sama.
--
-- Sekarang (HANYA tambalan berjangkar pada public.edit_posted_pos_sale; fungsi lain, tabel, izin TIDAK berubah):
--  * Struk dengan pembatalan penerimaan yang MASIH TERBUKA + memakai promo/voucher/kode kampanye boleh diubah isinya oleh OWNER aktif
--    lewat Ubah transaksi yang sama (struk lama ditutup, struk pengganti "-U" di tanggal asli, stok & HPP hari ini).
--    Peran lain (Finance, Admin, dst.) ditolak (42501) — gagal tertutup. Struk tanpa promo/voucher tetap lewat jalur lama
--    (Batalkan penjualan lalu siapkan pengganti). Struk yang pembatalan penerimaannya sudah ditutup tetap ditolak seperti dulu.
--  * Potongan promo per baris dihitung DATABASE dari baris asal, bukan dari klien (pola perbaikan klinik #501 F1):
--      baris tidak berubah (qty, harga, satuan, faktor, diskon manual sama) -> promo lama persis;
--      baris berubah -> promo lama x nilai baris baru / nilai baris lama, dibulatkan 2 desimal, dibatasi nilai baris baru.
--    Klien wajib mengirim angka yang sama (ditolak bila beda); identitas promo (promo_id, klaim, set, unit, waiver) wajib sama dengan
--    baris asal; barang baru tidak boleh membawa promo. Kuota promo tidak dihitung ulang (3A tetap).
--  * Voucher/poin/diskon total (potongan tingkat struk) tetap angka isian dengan aturan lama (tidak boleh melebihi total barang sesudah
--    diskon baris), lalu ikut dibagi ke baris menurut porsi oleh penjaga harga minimum di posting kasir.
--  * Aturan harga di bawah modal (P03/HPP) TIDAK dilonggarkan: struk pengganti tetap diposting lewat cashier_post_stock_atomic
--    (lantai per baris; pengecualian hanya jalur obral Owner #524 yang memang sudah ada).
--  * Laci: struk lama ditutup oleh varian pembatalan resmi (efek laci pembatalan penerimaan di shift asal yang masih terbuka
--    dinetralkan seperti Batalkan penjualan). Bila shift asal struk sudah tutup, uang struk pengganti dicatat sebagai efek 'terima'
--    di shift petshop terbuka milik Owner (aturan R2 yang sama dengan Terima pembayaran lagi); tanpa shift terbuka tidak menyentuh
--    laci siapa pun (Owner tidak dikunci). Shift asal yang masih terbuka menghitung struk pengganti seperti biasa.
--  * Penggajian bulan struk sudah dibuat, periode ditutup buku, rekonsiliasi bank, retur/refund: tetap ditolak seperti jalur lama.
-- Satu transaksi; jangkar eksak (harus tepat 1 kali) — gagal tertutup bila fungsi hidup sudah berbeda dari yang ditinjau.
set local lock_timeout = '5s';

do $patch$
declare p record; sig regprocedure:='public.edit_posted_pos_sale(uuid,integer,text,text,jsonb)'::regprocedure; definition text; old_body text; body text; hits integer;
begin
 if position('OWNER_PROMO_BELUM_DIBAYAR' in (select prosrc from pg_proc where oid=sig))>0 then
  raise exception 'OWNER_PROMO_BELUM_DIBAYAR sudah terpasang pada edit_posted_pos_sale'; end if;
 for p in select * from (values
  -- 1. variabel tambahan
  (1, $a$ codes text[];
begin$a$,
   $b$ codes text[];
 unpaid_path boolean:=false;rc_id uuid;src public.sale_items%rowtype;src_ids uuid[]:='{}';want numeric;ln_no integer;ln jsonb;eff_shift uuid;
begin$b$),
  -- 2. gerbang: pembatalan penerimaan terbuka + promo/voucher + OWNER -> jalur khusus; selain itu perilaku lama persis
  (1, $a$ if exists(select 1 from public.pos_receipt_cancellations where sale_id=s.id) then
  raise exception 'Struk ini pernah dibatalkan penerimaannya; ubah transaksi belum tersedia untuk struk seperti ini';end if;$a$,
   $b$ -- OWNER_PROMO_BELUM_DIBAYAR: struk berpromo/bervoucher yang penerimaannya sedang dibatalkan boleh diubah isinya oleh Owner.
 select c.id into rc_id from public.pos_receipt_cancellations c where c.sale_id=s.id and c.closed_at is null;
 unpaid_path:=rc_id is not null
  and not exists(select 1 from public.pos_receipt_cancellations c where c.sale_id=s.id and c.closed_at is not null)
  and (s.voucher_code is not null or s.campaign_code is not null or exists(select 1 from public.sale_items i where i.sale_id=s.id
   and (i.promo_id is not null or i.promo_claim_id is not null or coalesce(i.quantity_pool_claim,false) or coalesce(i.promo_discount,0)>0)));
 if unpaid_path and not exists(select 1 from public.profiles where id=actor and is_active and role='OWNER') then
  raise exception 'Struk berpromo/voucher yang penerimaannya dibatalkan hanya bisa diubah isinya oleh Owner. Terima pembayaran lagi, atau minta Owner.' using errcode='42501';end if;
 if not unpaid_path and exists(select 1 from public.pos_receipt_cancellations where sale_id=s.id) then
  raise exception 'Struk ini pernah dibatalkan penerimaannya; ubah transaksi belum tersedia untuk struk seperti ini';end if;
 if unpaid_path then
  -- Promo per baris dihitung dari baris asal di database (bukan dari klien), dibatasi nilai baris.
  for ln,ln_no in select value,ordinality from jsonb_array_elements(p_edit->'lines') with ordinality loop
   if jsonb_typeof(ln) is distinct from 'object' then raise exception 'Rincian barang tidak valid' using errcode='22023';end if;
   if nullif(ln->>'source_line_id','') is null then
    if nullif(ln->>'promo_id','') is not null or nullif(ln->>'promo_claim_id','') is not null or coalesce((ln->>'quantity_pool_claim')::boolean,false)
     or coalesce((ln->>'promo_discount')::numeric,0)<>0 or coalesce((ln->>'promo_sets')::integer,0)<>0 or coalesce((ln->>'promo_syarat_units')::numeric,0)<>0
     or coalesce((ln->>'promo_hasil_units')::numeric,0)<>0 or coalesce((ln->>'promo_floor_waiver')::boolean,false) then
     raise exception 'Baris % adalah barang baru; barang baru tidak boleh membawa promo.',ln_no using errcode='22023';end if;
    continue;
   end if;
   select * into src from public.sale_items i where i.id=(ln->>'source_line_id')::uuid and i.sale_id=s.id;
   if not found then raise exception 'Baris % bukan milik struk ini. Muat ulang halaman.',ln_no using errcode='22023';end if;
   if src.id=any(src_ids) then raise exception 'Baris % terduplikasi.',ln_no using errcode='22023';end if;
   src_ids:=src_ids||src.id;
   if nullif(ln->>'item_id','')::uuid is distinct from src.item_id then
    raise exception 'Barang baris % tidak boleh diganti; hapus barisnya lalu tambah barang baru.',ln_no using errcode='22023';end if;
   if nullif(ln->>'promo_id','')::uuid is distinct from src.promo_id or nullif(ln->>'promo_claim_id','')::uuid is distinct from src.promo_claim_id
    or coalesce((ln->>'quantity_pool_claim')::boolean,false) is distinct from coalesce(src.quantity_pool_claim,false)
    or coalesce((ln->>'promo_sets')::integer,0) is distinct from coalesce(src.promo_sets,0)
    or coalesce((ln->>'promo_syarat_units')::numeric,0) is distinct from coalesce(src.promo_syarat_units,0)
    or coalesce((ln->>'promo_hasil_units')::numeric,0) is distinct from coalesce(src.promo_hasil_units,0)
    or coalesce((ln->>'promo_floor_waiver')::boolean,false) is distinct from coalesce(src.promo_floor_waiver,false) then
    raise exception 'Data promo baris % tidak boleh diubah (promo lama terbawa apa adanya).',ln_no using errcode='22023';end if;
   if (ln->>'qty')::numeric is not distinct from src.qty and (ln->>'harga')::numeric is not distinct from src.harga
    and nullif(ln->>'satuan','') is not distinct from src.satuan and coalesce((ln->>'faktor')::numeric,1) is not distinct from coalesce(src.faktor,1)
    and (case when coalesce((ln->>'item_discount_value')::numeric,0)=0 then 'x' else coalesce(nullif(ln->>'item_discount_type',''),'nominal') end)
     is not distinct from (case when coalesce(src.item_discount_value,0)=0 then 'x' else coalesce(src.item_discount_type,'nominal') end)
    and coalesce((ln->>'item_discount_value')::numeric,0) is not distinct from coalesce(src.item_discount_value,0) then
    want:=coalesce(src.promo_discount,0);
   elsif coalesce(src.qty*src.harga,0)>0 then
    want:=least(round(coalesce(src.promo_discount,0)*(ln->>'qty')::numeric*(ln->>'harga')::numeric/(src.qty*src.harga),2),
     round((ln->>'qty')::numeric*(ln->>'harga')::numeric,2));
   else
    want:=0;
   end if;
   if coalesce((ln->>'promo_discount')::numeric,0) is distinct from want then
    raise exception 'Potongan promo baris % harus Rp% (sebanding nilai baris). Muat ulang halaman.',ln_no,to_char(want,'FM999G999G999G990D00') using errcode='22023';end if;
  end loop;
 end if;$b$),
  -- 3. laci: shift asal sudah tutup -> uang struk pengganti dicatat di shift petshop terbuka milik Owner (aturan R2)
  (1, $a$ if posted->>'finalized' is distinct from 'true' then raise exception 'Struk pengganti belum berhasil dibukukan';end if;$a$,
   $b$ if posted->>'finalized' is distinct from 'true' then raise exception 'Struk pengganti belum berhasil dibukukan';end if;
 -- OWNER_PROMO_BELUM_DIBAYAR: uang struk pengganti masuk laci yang benar.
 if unpaid_path and not exists(select 1 from public.cashier_shifts sh where sh.id=s.shift_id and sh.status='open') then
  select id into eff_shift from public.cashier_shifts where branch_id=s.branch_id and status='open' and shift_type='petshop' and opened_by=actor
   order by opened_at desc,id limit 1 for update;
  if eff_shift is not null then
   insert into public.sale_receipt_shift_effects(cancellation_id,sale_id,shift_id,method,amount,kind)
    select rc_id,new_id,eff_shift,p.method,p.amount,'terima' from public.sale_payments p where p.sale_id=new_id and p.amount<>0;
  end if;
 end if;$b$),
  -- 4. hasil: jalur lama identik; jalur Owner menambah penanda
  (1, $a$ result:=jsonb_build_object('old_sale_id',s.id,'sale_id',new_id,'no_struk',new_no,'edit_id',audit,'revision',s.revision+1);$a$,
   $b$ result:=jsonb_build_object('old_sale_id',s.id,'sale_id',new_id,'no_struk',new_no,'edit_id',audit,'revision',s.revision+1)
  ||case when unpaid_path then jsonb_build_object('unpaid_path',true,'effect_shift_id',eff_shift) else '{}'::jsonb end;$b$)
 ) as v(expected,anchor,replacement) loop
  select pg_get_functiondef(sig),prosrc into definition,old_body from pg_proc where oid=sig;
  hits:=(length(old_body)-length(replace(old_body,p.anchor,'')))/length(p.anchor);
  if hits<>p.expected then raise exception 'Jangkar tambalan berubah (% hit, diharapkan %) pada edit_posted_pos_sale: %',hits,p.expected,left(p.anchor,70); end if;
  body:=replace(old_body,p.anchor,p.replacement);
  execute replace(definition,old_body,body);
 end loop;
 select prosrc into body from pg_proc where oid=sig;
 if (length(body)-length(replace(body,'OWNER_PROMO_BELUM_DIBAYAR','')))/length('OWNER_PROMO_BELUM_DIBAYAR')<>2 then
  raise exception 'OWNER_PROMO_BELUM_DIBAYAR: penanda tidak lengkap sesudah tambalan'; end if;
end $patch$;

-- Hak eksekusi tidak berubah (CREATE OR REPLACE mempertahankan ACL); ditegaskan ulang.
revoke all on function public.edit_posted_pos_sale(uuid,integer,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.edit_posted_pos_sale(uuid,integer,text,text,jsonb) to authenticated;
