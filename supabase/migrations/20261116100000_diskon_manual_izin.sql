-- Penjaga DATABASE untuk diskon manual (lanjutan migrasi 20261112072724 "diskon_manual_owner_admin").
--
-- Latar: Andri (11-12 Nov 2026): "tolong jangan sembarang kasih diskon, hanya Role yang dikasih akses saja". Izin 'kasir.diskon_manual' dan fungsi
-- public.manual_discount_allowed() (OWNER selalu; peran tanpa kebijakan tersimpan hanya ADMIN; peran berkebijakan bila dicentang Owner) sudah live bersama
-- penegakan di server aplikasi (PR #509). Migrasi ini menambah lapis yang tadinya tercatat sebagai "sisa": klien yang dimodifikasi / panggilan API
-- mentah tidak boleh melewati izin itu. Tidak ada id katalog baru dan tidak ada fungsi izin baru: semua memakai manual_discount_allowed().
--
-- Diskon MANUAL = potongan yang diketik orang di kasir: diskon nota (nominal/persen), diskon per baris (petshop: item_discount_*, klinik: diskon_persen).
-- BUKAN diskon manual (tetap jalan untuk semua peran): promo dari master, diskon bawaan barang dari master (items.default_discount, persen, nilainya sama),
-- kode kampanye/voucher, diskon golongan pelanggan, poin, paket, struk marketplace (potongan platform), dan dokumen lama yang diterbitkan ulang / diperbaiki (Owner).
--
-- Perubahan:
--   * kolom jejak (opsional, bawaan 0): sales.manual_discount dan invoices.manual_discount; klien yang mengirimnya tidak boleh melebihi diskon dokumen.
--   * petshop: trigger pada sales + sale_items (kasir /kasir dan POS back-office menulis langsung ke tabel). Peran tanpa izin ditolak bila ada
--     diskon baris yang diketik ATAU bila total potongan lebih besar daripada yang bisa dibenarkan master (promo aktif, voucher/kampanye, golongan, poin)
--     — jadi klien yang dimodifikasi tidak bisa menyamarkan diskon manual sebagai promo. Pemeriksaan penuh saat struk difinalkan.
--   * klinik: clinic_post_invoice dan clinic_edit_invoice_core memanggil clinic_private.assert_manual_discount (tambalan berjangkar);
--     clinic_void_reissue_invoice_core membawa kolom manual_discount ke tagihan pengganti.
--   * Promo yang dicabut Owner saat keranjang terbuka: kasir (server) menghitung ulang promo dari master saat bayar, jadi struk dari aplikasi tidak membawa promo yang sudah dicabut.
--     Database tidak bisa tahu kapan keranjang dihitung, maka ia menilai terhadap promo yang berlaku SAAT struk difinalkan (tidak dilonggarkan). Bila terjadi balapan, penolakan
--     terjadi di dalam transaksi finalisasi yang sama (stok/jurnal/pembayaran ikut batal, tidak ada baris sisa) dengan pesan: 'Jika promo sudah tidak berlaku, muat ulang keranjang.'
--   * OWNER dan peran berizin tidak diperiksa batasnya; tanpa pengguna login (SQL editor / tugas sistem) tidak diperiksa.

-- ───────────────────────── 1. Kolom jejak ─────────────────────────
alter table public.sales add column manual_discount numeric(15,2) not null default 0;
alter table public.sales add constraint sales_manual_discount_check check (manual_discount>=0);
alter table public.invoices add column manual_discount numeric(15,2) not null default 0;
alter table public.invoices add constraint invoices_manual_discount_check check (manual_discount>=0);

-- ───────────────────────── 2. Batas diskon yang bisa dibenarkan master (promo aktif, voucher/kampanye, golongan, poin) ─────────────────────────
-- Batas ATAS yang longgar, bukan hitungan ulang persis: nilai terbesar yang masih mungkin dari promo yang benar-benar aktif untuk barang itu.
create function clinic_private.promo_line_cap(p_branch uuid,p_item uuid,p_qty numeric,p_price numeric,p_on date) returns numeric
language sql stable security definer set search_path='' as $$
 select coalesce(max(least(p_qty*p_price,case
   when p.discount_type='percent' then p_qty*p_price*coalesce(p.discount_value,0)/100
   when p.discount_type='nominal' and p.rule->>'discount_mode'='package_total' then coalesce(p.discount_value,0)*ceil(p_qty/greatest(coalesce(p.min_qty,1),1))
   when p.discount_type='nominal' then p_qty*least(coalesce(p.discount_value,0),p_price)
   else 0 end)),0)
 from public.promos p join public.promo_items pi on pi.promo_id=p.id
 where pi.item_id=p_item and p.is_active
   and (p.valid_from is null or p.valid_from<=p_on) and (p.valid_until is null or p.valid_until>=p_on)
   and (p.branch_ids is null or cardinality(p.branch_ids)=0 or p_branch=any(p.branch_ids));
$$;
revoke all on function clinic_private.promo_line_cap(uuid,uuid,numeric,numeric,date) from public,anon,authenticated,service_role;

-- p_lines: [{item_id, qty, price, claim}] — claim = potongan promo yang SUDAH dibuktikan penjaga klaim lama (syarat-hasil / kolam kuantitas) atau null.
create function clinic_private.discount_explained_cap(p_branch uuid,p_customer uuid,p_voucher text,p_campaign text,p_subtotal numeric,p_points numeric,p_lines jsonb,p_part text default 'all') returns numeric
language plpgsql stable security definer set search_path='' as $$
declare d date:=(now() at time zone 'Asia/Jakarta')::date; v_promo numeric:=0; v_voucher numeric:=0; v_pct numeric; v_cat numeric:=0;
begin
 select coalesce(sum(case when x.claim is not null then x.claim else clinic_private.promo_line_cap(p_branch,x.item_id,x.qty,x.price,d) end),0) into v_promo
  from jsonb_to_recordset(coalesce(p_lines,'[]'::jsonb)) as x(item_id uuid,qty numeric,price numeric,claim numeric);
 select coalesce(max(case when v.tipe='persen' then least(p_subtotal*coalesce(v.nilai,0)/100,coalesce(v.max_potongan,p_subtotal)) else coalesce(v.nilai,0) end),0) into v_voucher
  from public.vouchers v
  where v.code in (nullif(p_voucher,''),(select vc.code from public.campaign_codes cc join public.vouchers vc on vc.id=cc.voucher_id where cc.code=nullif(p_campaign,'')));
 select greatest(coalesce(cc.diskon_persen,0),coalesce((select max(cd.diskon_persen) from public.category_discounts cd where cd.customer_category_id=cc.id),0)) into v_pct
  from public.customers c join public.customer_categories cc on cc.id=c.category_id where c.id=p_customer;
 v_cat:=ceil(p_subtotal*coalesce(v_pct,0)/100);
 -- p_part: 'category' = hanya golongan; 'noncategory' = promo+voucher+poin (petshop menyimpan golongan di kolom sendiri); 'all' = semua (klinik).
 return case p_part when 'category' then v_cat when 'noncategory' then v_promo+v_voucher+greatest(coalesce(p_points,0),0) else v_promo+v_voucher+v_cat+greatest(coalesce(p_points,0),0) end;
end $$;
revoke all on function clinic_private.discount_explained_cap(uuid,uuid,text,text,numeric,numeric,jsonb,text) from public,anon,authenticated,service_role;

-- ───────────────────────── 3. PETSHOP: trigger pada sale_items dan sales ─────────────────────────
create function public.guard_sale_item_manual_discount() returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- Tanpa pengguna (SQL editor / tugas sistem) bukan jalur kasir; struk marketplace (channel terisi DAN tanpa rencana pembayaran POS, seperti yang dibuat impor)
 -- membawa potongan platform, bukan diskon kasir. Struk berlabel marketplace yang membawa rencana pembayaran POS tetap diperiksa (label tidak bisa dipakai menyamarkan diskon).
 if auth.uid() is null or coalesce(new.item_discount_value,0)<=0 then return new; end if;
 if tg_op='UPDATE' and new.item_discount_value is not distinct from old.item_discount_value then return new; end if;
 if exists(select 1 from public.sales s where s.id=new.sale_id and s.channel is not null and s.payment_plan is null) then return new; end if;
 -- Diskon bawaan barang dari master (items.default_discount, persen) terpasang otomatis di kasir: bukan diskon manual selama nilainya sama dengan master.
 if new.item_discount_type='percent' and exists(select 1 from public.items i where i.id=new.item_id and i.default_discount>0 and abs(i.default_discount-new.item_discount_value)<0.0001) then return new; end if;
 if not public.manual_discount_allowed() then
  raise exception 'Anda tidak punya izin memberi diskon manual. Minta Owner mengaktifkannya di Pengaturan > Akses Grup.' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function public.guard_sale_item_manual_discount() from public,anon,authenticated,service_role;
create trigger guard_sale_item_manual_discount before insert or update of item_discount_value,item_discount_type on public.sale_items
 for each row execute function public.guard_sale_item_manual_discount();

create function public.guard_sale_manual_discount() returns trigger language plpgsql security definer set search_path='' as $$
declare cap numeric; lines jsonb; v_n integer;
begin
 if auth.uid() is null or (new.channel is not null and new.payment_plan is null) then return new; end if;
 if tg_op='UPDATE' and not (new.manual_discount is distinct from old.manual_discount or (old.payments_finalized_at is null and new.payments_finalized_at is not null)) then return new; end if;
 if public.manual_discount_allowed() then return new; end if;
 if new.manual_discount>(case when tg_op='UPDATE' then old.manual_discount else 0 end) then
  raise exception 'Anda tidak punya izin memberi diskon manual. Minta Owner mengaktifkannya di Pengaturan > Akses Grup.' using errcode='42501';
 end if;
 -- Pemeriksaan penuh hanya saat struk difinalkan (semua baris sudah ada).
 if new.payments_finalized_at is null or (tg_op='UPDATE' and old.payments_finalized_at is not null) then return new; end if;
 if exists(select 1 from public.sale_items l left join public.items i on i.id=l.item_id where l.sale_id=new.id and coalesce(l.item_discount_value,0)>0
           and not (l.item_discount_type='percent' and coalesce(i.default_discount,0)>0 and abs(i.default_discount-l.item_discount_value)<0.0001)) then
  raise exception 'Anda tidak punya izin memberi diskon manual. Minta Owner mengaktifkannya di Pengaturan > Akses Grup.' using errcode='42501';
 end if;
 -- Tanpa diskon sama sekali: tidak ada yang perlu dibenarkan (hemat biaya pada jalur final yang paling ramai).
 if coalesce(new.discount,0)<=0 and coalesce(new.diskon_kategori,0)<=0 then return new; end if;
 select coalesce(jsonb_agg(jsonb_build_object('item_id',l.item_id,'qty',l.qty,'price',l.harga,
         'claim',case when l.promo_claim_id is not null or coalesce(l.quantity_pool_claim,false) then least(coalesce(l.promo_discount,0),l.qty*l.harga)
                      when coalesce(l.item_discount_value,0)>0 then ceil(l.qty*l.harga*l.item_discount_value/100) else null end)),'[]'::jsonb),count(*)
   into lines,v_n from public.sale_items l where l.sale_id=new.id;
 cap:=clinic_private.discount_explained_cap(new.branch_id,new.customer_id,new.voucher_code,new.campaign_code,new.subtotal,coalesce(new.poin_digunakan,0),lines,'noncategory');
 if coalesce(new.discount,0)>cap+v_n+1
    or coalesce(new.diskon_kategori,0)>clinic_private.discount_explained_cap(new.branch_id,new.customer_id,null,null,new.subtotal,0,'[]'::jsonb,'category')+1 then
  raise exception 'Diskon melebihi yang bisa dibenarkan promo, voucher, golongan, atau poin. Jika promo sudah tidak berlaku, muat ulang keranjang. Diskon manual hanya untuk peran yang diberi izin: minta Owner mengaktifkannya di Pengaturan > Akses Grup.' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function public.guard_sale_manual_discount() from public,anon,authenticated,service_role;
create trigger guard_sale_manual_discount before insert or update of manual_discount,payments_finalized_at on public.sales
 for each row execute function public.guard_sale_manual_discount();

-- ───────────────────────── 4. KLINIK: penjaga dipanggil dari posting dan koreksi tagihan ─────────────────────────
create function clinic_private.assert_manual_discount(p_invoice_id uuid,p_visit_id uuid,p_invoice jsonb,p_lines jsonb) returns void
language plpgsql volatile security definer set search_path='' as $$
declare v_has boolean:=p_invoice ? 'manual_discount'; v_discount numeric; v_hdr numeric:=0; v_old_hdr numeric:=0; v_old_disc numeric:=0; v_old_lines numeric:=0; v_new_lines numeric;
        v_branch uuid; v_cust uuid; v_cap numeric; v_n integer;
begin
 begin
  v_discount:=coalesce(nullif(p_invoice->>'discount',''),'0')::numeric;
  if v_has then v_hdr:=coalesce(nullif(p_invoice->>'manual_discount',''),'0')::numeric; end if;
 exception when others then
  raise exception using errcode='P0001',message='INVOICE_INVALID: diskon manual tidak valid';
 end;
 if v_hdr<0 or v_hdr>v_discount+0.005 then raise exception using errcode='P0001',message='INVOICE_INVALID: diskon manual tidak valid'; end if;
 if public.manual_discount_allowed() then return; end if;
 if p_invoice_id is not null then
  select i.manual_discount,i.discount into v_old_hdr,v_old_disc from public.invoices i where i.id=p_invoice_id;
  select coalesce(sum(round(l.qty*l.harga*coalesce(l.diskon_persen,0)/100,2)),0) into v_old_lines from public.invoice_items l where l.invoice_id=p_invoice_id;
 end if;
 if not v_has then v_hdr:=coalesce(v_old_hdr,0); end if;
 select coalesce(sum(round((x.value->>'qty')::numeric*(x.value->>'price')::numeric*coalesce(nullif(x.value->>'discount_percent','')::numeric,0)/100,2)),0)
   into v_new_lines from jsonb_array_elements(p_lines) x;
 if v_hdr>coalesce(v_old_hdr,0)+0.005 or v_new_lines>coalesce(v_old_lines,0)+0.005 then
  raise exception using errcode='P0001',message='Anda tidak punya izin memberi diskon manual. Minta Owner mengaktifkannya di Pengaturan > Akses Grup.';
 end if;
 -- Diskon nota yang naik (atau tagihan baru) harus bisa dibenarkan master; diskon yang tidak naik pada koreksi dibiarkan.
 if v_discount>coalesce(v_old_disc,0)+0.005 then
  select v.branch_id,v.customer_id into v_branch,v_cust from public.visits v where v.id=p_visit_id;
  select count(*) into v_n from jsonb_array_elements(p_lines);
  v_cap:=clinic_private.discount_explained_cap(v_branch,v_cust,p_invoice->>'voucher_code',p_invoice->>'campaign_code',coalesce(nullif(p_invoice->>'subtotal','')::numeric,0),
          coalesce((select c.points from public.customers c where c.id=v_cust),0),
          (select coalesce(jsonb_agg(jsonb_build_object('item_id',nullif(x.value->>'item_id',''),'qty',(x.value->>'qty')::numeric,'price',(x.value->>'price')::numeric,'claim',null)),'[]'::jsonb) from jsonb_array_elements(p_lines) x))
         +least(v_hdr,coalesce(v_old_hdr,0));
  if v_discount>v_cap+v_n+1 then
   raise exception using errcode='P0001',message='Diskon melebihi yang bisa dibenarkan promo, voucher, golongan, atau poin. Jika promo sudah tidak berlaku, muat ulang keranjang. Diskon manual hanya untuk peran yang diberi izin: minta Owner mengaktifkannya di Pengaturan > Akses Grup.';
  end if;
 end if;
end $$;
revoke all on function clinic_private.assert_manual_discount(uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;

do $patch$
declare p record; definition text; sig regprocedure; hits integer; body text; old_body text;
begin
 for p in select * from (values
  -- A. Tagihan baru: penjaga sebelum nomor invoice dibuat; kolom manual_discount ikut tersimpan.
  ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)',1,
   E'  -- Serialize this generator with other invoice RPCs, then use the configured',
   E'  perform clinic_private.assert_manual_discount(null::uuid, p_visit_id, p_invoice, p_lines);\n  -- Serialize this generator with other invoice RPCs, then use the configured'),
  ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)',1,
   E'service_pricing_version, campaign_code, campaign_carrier_id\n  ) values (',
   E'service_pricing_version, campaign_code, campaign_carrier_id, manual_discount\n  ) values ('),
  ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)',1,
   E'nullif(p_invoice->>''campaign_carrier_id'','''')::uuid\n  ) returning id into v_invoice_id;',
   E'nullif(p_invoice->>''campaign_carrier_id'','''')::uuid,\n    least(greatest(coalesce(nullif(p_invoice->>''manual_discount'','''')::numeric,0),0),v_discount)\n  ) returning id into v_invoice_id;'),
  -- B. Koreksi tagihan: penjaga sebelum baris diganti (baris lama masih ada sebagai pembanding "tidak boleh naik").
  ('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)',1,
   E'    raise exception using errcode=''P0001'', message=''LINE_INVALID: potongan promo baris tidak valid, melebihi nilai baris, atau jumlahnya melebihi diskon invoice'';\n  end if;\n',
   E'    raise exception using errcode=''P0001'', message=''LINE_INVALID: potongan promo baris tidak valid, melebihi nilai baris, atau jumlahnya melebihi diskon invoice'';\n  end if;\n  perform clinic_private.assert_manual_discount(p_invoice_id, v_visit.id, p_invoice, p_lines);\n'),
  ('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)',1,
   E'    voucher_code=nullif(p_invoice->>''voucher_code'','''') where id=p_invoice_id;',
   E'    voucher_code=nullif(p_invoice->>''voucher_code'',''''),\n    manual_discount=case when p_invoice ? ''manual_discount'' then least(greatest(coalesce(nullif(p_invoice->>''manual_discount'','''')::numeric,0),0),v_discount) else least(manual_discount,v_discount) end where id=p_invoice_id;'),
  -- C. Tagihan terbit ulang membawa kolom jejak diskon manual.
  ('public.clinic_void_reissue_invoice_core(uuid,text,text)',1,
   E'reissued_from,request_key,request_hash,correction_pending,shift_cash_carry,service_pricing_version,created_at)',
   E'reissued_from,request_key,request_hash,correction_pending,shift_cash_carry,service_pricing_version,created_at,manual_discount)'),
  ('public.clinic_void_reissue_invoice_core(uuid,text,text)',1,
   E'v_shift_cash,v_invoice.service_pricing_version,v_invoice.created_at + interval ''1 millisecond'')',
   E'v_shift_cash,v_invoice.service_pricing_version,v_invoice.created_at + interval ''1 millisecond'',v_invoice.manual_discount)')
 ) as v(sig,expected,anchor,replacement) loop
  sig:=p.sig::regprocedure;
  select pg_get_functiondef(sig),prosrc into definition,old_body from pg_proc where oid=sig;
  hits:=(length(old_body)-length(replace(old_body,p.anchor,'')))/length(p.anchor);
  if hits<>p.expected then raise exception 'Jangkar tambalan berubah (% hit, diharapkan %) pada %: %',hits,p.expected,p.sig,left(p.anchor,60); end if;
  body:=replace(old_body,p.anchor,p.replacement);
  execute replace(definition,old_body,body);
 end loop;
end $patch$;

-- ───────────────────────── 5. Pemeriksaan pasang ─────────────────────────
-- Catatan: ketergantungan pada public.manual_discount_allowed() (migrasi 20261112072724) sengaja TIDAK diperiksa di sini supaya rantai uji lama yang memutar
-- migrasi itu belakangan tetap bisa dibangun; fungsinya dipanggil saat berjalan (gagal-tertutup bila hilang) dan skrip pasang Production memeriksanya dulu.
do $check$
begin
 if position('assert_manual_discount' in pg_get_functiondef('public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure))=0
    or position('assert_manual_discount' in pg_get_functiondef('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)'::regprocedure))=0 then raise exception 'DM_CHECK tambalan klinik'; end if;
 if (select count(*) from pg_trigger where tgname in('guard_sale_manual_discount','guard_sale_item_manual_discount') and not tgisinternal)<>2 then raise exception 'DM_CHECK trigger petshop'; end if;
end $check$;
