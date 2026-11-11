-- P03 lantai harga klinik: potongan PROMO hanya dibebankan ke baris yang memang kena promo.
-- Apply as ONE transaction (satu transaksi; tanpa begin/commit sendiri).
--
-- Masalah (kasir klinik Panduraya, 11 Nov 2026): kode kampanye GROOM11 (promo 50% hanya untuk 16 jasa grooming)
-- dipakai pada nota Grooming 1 x Rp90.000 + Anthel Cat 1 x Rp18.000 (HPP Rp11.287). Aplikasi menghitung potongan promo benar
-- (Rp45.000 hanya di Grooming), tetapi penjaga P03 clinic_private.assert_invoice_price_floor membagi SELURUH diskon
-- invoice rata ke semua baris obat menurut porsi nilai: Anthel dinilai Rp10.500 dan ditolak
-- ("harga minimum Rp19.350"), padahal Anthel dijual Rp18.000 tanpa potongan apa pun.
--
-- Perubahan (tambahan, mundur-kompatibel):
--  1. invoice_items.promo_discount numeric(15,2) default 0, check >= 0: potongan PROMO yang jatuh pada baris itu (rupiah).
--     Baris lama / pemanggil lama = 0 = perilaku lama persis.
--  2. clinic_post_invoice: tiap baris p_lines boleh membawa "promo_discount". Database memeriksa: bukan negatif, paling banyak
--     dua desimal, tidak lebih dari nilai baris (setelah diskon baris), dan JUMLAH seluruh baris tidak lebih dari diskon invoice.
--     Tanpa kunci itu = 0.
--  2b. clinic_void_reissue_invoice_core: tagihan terbit ulang menyalin promo_discount tiap baris (diskon invoice juga disalin), supaya
--      koreksi sesudah terbit ulang tidak kehilangan alokasi promonya.
--  3. clinic_edit_invoice_core: baris koreksi yang merujuk baris asal (source_invoice_item_id) dan tidak berubah (qty, harga, diskon
--     baris, barang) mewarisi promo_discount baris asal DARI DATABASE; nilai dari klien tidak dibaca.
--  4. assert_invoice_price_floor: neto baris = (nilai baris - promo baris) x (subtotal - diskon) / (subtotal - jumlah promo).
--     Jadi promo hanya menurunkan baris yang membawanya, sisa diskon (voucher, poin, diskon golongan, diskon manual) tetap dibagi
--     menurut porsi nilai SETELAH promo. Jumlah (nilai baris - neto) seluruh baris = diskon invoice persis (nol-jumlah): memindahkan promo
--     antar baris tidak menambah diskon total, dan tiap baris obat/paket tetap harus neto >= HPP. Jumlah promo = 0 (atau lebih besar dari
--     diskon, mis. koreksi yang menurunkan diskon) = rumus lama persis.
-- ATURAN di bawah HPP TIDAK berubah: baris/paket ditolak persis ketika neto <= 0, HPP kosong, atau neto < HPP. Penghitungan stok, HPP, jurnal,
-- invoices.discount, laporan dan struk tidak disentuh. Signature, SECURITY DEFINER, search_path, pemilik dan ACL keempat fungsi tetap.
-- Penggantian memakai jangkar eksak dan gagal tertutup bila definisi sudah berubah dari teks yang ditinjau.

set local lock_timeout = '5s';

alter table public.invoice_items add column promo_discount numeric(15,2) default 0;
alter table public.invoice_items add constraint invoice_items_promo_discount_check check (promo_discount >= 0);
comment on column public.invoice_items.promo_discount is
  'Potongan promo (rupiah) yang jatuh pada baris ini; sudah termasuk di invoices.discount. 0/NULL = tidak ada. Hanya dibaca penjaga lantai harga klinik.';

create temp table pf_patch(n serial primary key, sig text not null, old_text text not null, new_text text not null) on commit drop;
insert into pf_patch(sig, old_text, new_text) values
    -- ---------------------------------------------------------------- clinic_post_invoice
    ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)',
     $old$  v_job_order_cost numeric(15,2);
begin
  perform public.inventory_assert_open_date(nullif(p_invoice ->> 'tanggal', '')::date);$old$,
     $new$  v_job_order_cost numeric(15,2);
  v_promo numeric;
  v_promo_total numeric;
begin
  perform public.inventory_assert_open_date(nullif(p_invoice ->> 'tanggal', '')::date);$new$),
    ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)',
     $old$    raise exception using errcode = 'P0001', message = 'INVOICE_INVALID: subtotal tidak sama dengan rincian';
  end if;
$old$,
     $new$    raise exception using errcode = 'P0001', message = 'INVOICE_INVALID: subtotal tidak sama dengan rincian';
  end if;

  -- LANTAI_PROMO_BARIS: potongan promo per baris (opsional) tidak boleh melebihi diskon invoice; nilai per baris
  -- diperiksa terhadap nilai barisnya di dalam perulangan di bawah.
  select coalesce(sum(coalesce(nullif(e.value ->> 'promo_discount', '')::numeric, 0)), 0)
    into v_promo_total
  from jsonb_array_elements(p_lines) as e(value);
  if v_promo_total < 0 or v_promo_total > v_discount then
    raise exception using errcode = 'P0001', message = 'INVOICE_INVALID: jumlah potongan promo per baris melebihi diskon invoice';
  end if;
$new$),
    ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)',
     $old$    v_line_amount := round(v_qty * v_price * (1 - v_discount_percent / 100), 2)::numeric(15,2);
    insert into public.invoice_items (
      invoice_id, deskripsi, qty, harga, jenis, diskon_persen, item_id, hpp,
      compound_recipe_id, prescription_item_id, satuan, faktor, service_performers, bmhp_components, salesperson_id, package_item_id, package_qty
    ) values (
      v_invoice_id, v_description, v_qty, v_price, v_kind, v_discount_percent,
      v_item_id, v_line_hpp, v_recipe_id, v_prescription_item_id, v_unit, v_factor, v_line.value->'service_performers', v_bmhp, nullif(v_line.value->>'salesperson_id','')::uuid,
      nullif(v_line.value->>'package_item_id','')::uuid, nullif(v_line.value->>'package_qty','')::numeric
    ) returning id into v_account_id;$old$,
     $new$    v_line_amount := round(v_qty * v_price * (1 - v_discount_percent / 100), 2)::numeric(15,2);
    -- LANTAI_PROMO_BARIS: promo baris tidak negatif, paling banyak dua desimal, dan tidak melebihi nilai barisnya.
    v_promo := coalesce(nullif(v_line.value ->> 'promo_discount', '')::numeric, 0);
    if v_promo < 0 or v_promo <> round(v_promo, 2) or v_promo > v_line_amount then
      raise exception using errcode = 'P0001', message = 'LINE_INVALID: potongan promo baris tidak valid atau melebihi nilai baris';
    end if;
    insert into public.invoice_items (
      invoice_id, deskripsi, qty, harga, jenis, diskon_persen, item_id, hpp,
      compound_recipe_id, prescription_item_id, satuan, faktor, service_performers, bmhp_components, salesperson_id, package_item_id, package_qty,
      promo_discount
    ) values (
      v_invoice_id, v_description, v_qty, v_price, v_kind, v_discount_percent,
      v_item_id, v_line_hpp, v_recipe_id, v_prescription_item_id, v_unit, v_factor, v_line.value->'service_performers', v_bmhp, nullif(v_line.value->>'salesperson_id','')::uuid,
      nullif(v_line.value->>'package_item_id','')::uuid, nullif(v_line.value->>'package_qty','')::numeric,
      v_promo
    ) returning id into v_account_id;$new$),
    -- ---------------------------------------------------------------- clinic_edit_invoice_core
    ('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)',
     $old$service_source_line_id,bmhp_components,salesperson_id)
    values(p_invoice_id,v_line->>'description',$old$,
     $new$service_source_line_id,bmhp_components,salesperson_id,promo_discount)
    values(p_invoice_id,v_line->>'description',$new$),
    ('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)',
     $old$      v_bmhp_map->nullif(v_line->>'prescription_item_id',''),nullif(v_line->>'salesperson_id','')::uuid);
  end loop;$old$,
     $new$      v_bmhp_map->nullif(v_line->>'prescription_item_id',''),nullif(v_line->>'salesperson_id','')::uuid,
      -- LANTAI_PROMO_BARIS: promo hanya diwarisi dari baris asal di database bila barisnya tidak berubah (nilai dari klien tidak dibaca).
      coalesce((select least(o.promo_discount,
          round((v_line->>'qty')::numeric*(v_line->>'price')::numeric*(1-coalesce((v_line->>'discount_percent')::numeric,0)/100),2))
        from public.invoice_items o
        where o.invoice_id=p_invoice_id and o.id=any(v_service_old_ids)
          and o.id=nullif(v_line->>'source_invoice_item_id','')::uuid and o.promo_discount>0
          and o.qty=(v_line->>'qty')::integer and o.harga=(v_line->>'price')::numeric
          and o.diskon_persen is not distinct from coalesce((v_line->>'discount_percent')::numeric,0)
          and o.item_id is not distinct from v_item),0));
  end loop;$new$),
    -- ---------------------------------------------------------------- clinic_void_reissue_invoice_core
    ('public.clinic_void_reissue_invoice_core(uuid,text,text)',
     $old$service_performers,service_source_line_id,bmhp_components)
  select v_new_id,deskripsi,qty,harga,jenis,diskon_persen,item_id,hpp,
    prescription_item_id,satuan,faktor,service_performers,id,bmhp_components from public.invoice_items where invoice_id=p_invoice_id;$old$,
     $new$service_performers,service_source_line_id,bmhp_components,promo_discount)
  select v_new_id,deskripsi,qty,harga,jenis,diskon_persen,item_id,hpp,
    prescription_item_id,satuan,faktor,service_performers,id,bmhp_components,promo_discount -- LANTAI_PROMO_BARIS: terbit ulang membawa promo baris
    from public.invoice_items where invoice_id=p_invoice_id;$new$),
    -- ---------------------------------------------------------------- assert_invoice_price_floor
    ('clinic_private.assert_invoice_price_floor(uuid,numeric,numeric)',
     $old$  v_text text;
begin
  if p_subtotal is null or p_discount is null or p_subtotal < 0 or p_discount < 0 or p_discount > p_subtotal then$old$,
     $new$  v_text text;
  v_promo_total numeric := 0;
  v_use_promo boolean := false;
begin
  if p_subtotal is null or p_discount is null or p_subtotal < 0 or p_discount < 0 or p_discount > p_subtotal then$new$),
    ('clinic_private.assert_invoice_price_floor(uuid,numeric,numeric)',
     $old$  v_share := case when p_subtotal > 0 then (p_subtotal - p_discount) / p_subtotal else 0 end;
  -- MESSAGE ONLY (the rule above keeps v_share)$old$,
     $new$  -- LANTAI_PROMO_BARIS: potongan PROMO yang tercatat pada baris (invoice_items.promo_discount) dibebankan ke barisnya
  -- sendiri; hanya sisa diskon (voucher, poin, golongan, manual) yang dibagi menurut porsi nilai setelah promo:
  --   neto baris = (nilai baris - promo baris) * (subtotal - diskon) / (subtotal - jumlah promo)
  -- sehingga jumlah (nilai baris - neto) seluruh baris = diskon invoice (nol-jumlah). Tanpa promo, atau bila jumlah promo
  -- melebihi diskon invoice, rumusnya persis rumus lama: (subtotal - diskon) / subtotal.
  select coalesce(sum(least(greatest(coalesce(ii.promo_discount, 0), 0),
      round(ii.qty * ii.harga * (1 - coalesce(ii.diskon_persen, 0) / 100), 2))), 0)
    into v_promo_total
  from public.invoice_items ii where ii.invoice_id = p_invoice_id;
  v_use_promo := v_promo_total > 0 and v_promo_total <= p_discount;
  if not v_use_promo then v_promo_total := 0; end if;
  v_share := case when p_subtotal - v_promo_total > 0 then (p_subtotal - p_discount) / (p_subtotal - v_promo_total) else 0 end;
  -- MESSAGE ONLY (the rule above keeps v_share)$new$),
    ('clinic_private.assert_invoice_price_floor(uuid,numeric,numeric)',
     $old$      round(ii.qty * ii.harga * (1 - coalesce(ii.diskon_persen, 0) / 100), 2) as amount
    from public.invoice_items ii
    where ii.invoice_id = p_invoice_id and ii.package_item_id is null and ii.jenis = 'obat'$old$,
     $new$      round(ii.qty * ii.harga * (1 - coalesce(ii.diskon_persen, 0) / 100), 2) as amount,
      case when v_use_promo then least(greatest(coalesce(ii.promo_discount, 0), 0),
        round(ii.qty * ii.harga * (1 - coalesce(ii.diskon_persen, 0) / 100), 2)) else 0 end as promo
    from public.invoice_items ii
    where ii.invoice_id = p_invoice_id and ii.package_item_id is null and ii.jenis = 'obat'$new$),
    ('clinic_private.assert_invoice_price_floor(uuid,numeric,numeric)',
     $old$    v_net := round(v_line.amount * v_share, 2);
    v_kind := case when v_net <= 0 then 'ZERO' when v_line.hpp is null then 'COST' when v_net < v_line.hpp then 'BELOW' end;$old$,
     $new$    v_net := round((v_line.amount - v_line.promo) * v_share, 2);
    v_kind := case when v_net <= 0 then 'ZERO' when v_line.hpp is null then 'COST' when v_net < v_line.hpp then 'BELOW' end;$new$),
    ('clinic_private.assert_invoice_price_floor(uuid,numeric,numeric)',
     $old$      v_min := case when v_factor > 0 then greatest(ceil(coalesce(v_line.hpp, 0) / v_factor), 1) end;$old$,
     $new$      -- harga minimum per satuan: (HPP / porsi sisa diskon + promo baris) / (jumlah x (1 - diskon baris)); tanpa promo = rumus lama.
      v_min := case when v_factor > 0 then greatest(ceil(case when v_line.promo > 0
        then (coalesce(v_line.hpp, 0) / v_mshare + v_line.promo) / (v_q * (1 - coalesce(v_line.diskon_persen, 0) / 100))
        else coalesce(v_line.hpp, 0) / v_factor end), 1) end;$new$),
    ('clinic_private.assert_invoice_price_floor(uuid,numeric,numeric)',
     $old$      sum(coalesce(ii.hpp, 0)) as hpp
    from public.invoice_items ii
    left join public.items i on i.id = ii.package_item_id$old$,
     $new$      sum(coalesce(ii.hpp, 0)) as hpp,
      sum(case when v_use_promo then least(greatest(coalesce(ii.promo_discount, 0), 0),
        round(ii.qty * ii.harga * (1 - coalesce(ii.diskon_persen, 0) / 100), 2)) else 0 end) as promo
    from public.invoice_items ii
    left join public.items i on i.id = ii.package_item_id$new$),
    ('clinic_private.assert_invoice_price_floor(uuid,numeric,numeric)',
     $old$    v_net := round(v_line.amount * v_share, 2);
    v_kind := case when v_net <= 0 then 'ZERO' when v_net < v_line.hpp then 'BELOW' end;$old$,
     $new$    v_net := round((v_line.amount - v_line.promo) * v_share, 2);
    v_kind := case when v_net <= 0 then 'ZERO' when v_net < v_line.hpp then 'BELOW' end;$new$),
    ('clinic_private.assert_invoice_price_floor(uuid,numeric,numeric)',
     $old$      v_min := case when v_mshare > 0 then greatest(ceil(v_line.hpp / v_mshare), 1) end;$old$,
     $new$      v_min := case when v_mshare > 0 then greatest(ceil(case when v_line.promo > 0
        then v_line.hpp / v_mshare + v_line.promo else v_line.hpp / v_mshare end), 1) end;$new$)
  ;

do $promo_baris$
declare
  p record;
  q record;
  definition text;
  pre text;
  n_found integer;
begin
  for p in select distinct sig from pf_patch order by sig loop
    definition := pg_get_functiondef(p.sig::regprocedure);
    if position('LANTAI_PROMO_BARIS' in definition) > 0 then
      raise exception 'LANTAI_PROMO_BARIS already applied to %; inspect before re-running', p.sig;
    end if;
    pre := (select format('%s|%s|%s|%s|%s', proowner, proacl, prosecdef, proconfig, prorettype)
      from pg_proc where oid = p.sig::regprocedure);
    for q in select * from pf_patch where sig = p.sig order by n loop
      n_found := (length(definition) - length(replace(definition, q.old_text, ''))) / length(q.old_text);
      if n_found <> 1 then
        raise exception 'LANTAI_PROMO_DRIFT: % changed (anchor % found % times); review before release', p.sig, q.n, n_found;
      end if;
      definition := replace(definition, q.old_text, q.new_text);
    end loop;
    execute definition;
    if pre is distinct from (select format('%s|%s|%s|%s|%s', proowner, proacl, prosecdef, proconfig, prorettype)
      from pg_proc where oid = p.sig::regprocedure) then
      raise exception 'LANTAI_PROMO_BARIS: pemilik/ACL/definer/config % berubah setelah ditambal', p.sig;
    end if;
    if position('LANTAI_PROMO_BARIS' in pg_get_functiondef(p.sig::regprocedure)) = 0 then
      raise exception 'LANTAI_PROMO_BARIS: definisi % tidak sesuai setelah ditambal', p.sig;
    end if;
  end loop;
end $promo_baris$;
