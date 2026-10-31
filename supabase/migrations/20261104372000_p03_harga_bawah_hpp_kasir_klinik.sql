-- P03 (keputusan owner 29 Okt): kunci "jual di bawah HPP" diperluas.
--
-- 1. Kasir petshop (cashier_post_stock_atomic): baris paket "Grup" yang berisi komponen
--    Persediaan tidak lagi dilewati. Harga netonya wajib > 0 dan >= jumlah HPP FIFO aktual
--    komponennya (yang sudah dijumlahkan ke sale_items.hpp oleh fungsi yang sama). Pesan
--    penolakan kini menyebut nama barisnya. Paket berisi jasa saja tetap boleh gratis.
-- 2. Kasir klinik (clinic_post_invoice, termasuk jalur split dan DEMO yang memanggilnya,
--    serta koreksi clinic_edit_invoice_core): obat/barang (baris jenis 'obat' bertaut barang
--    atau racikan) ditolak bila harga neto nol atau di bawah HPP aktual baris itu. Komponen
--    paket (package_item_id) dinilai per paket: neto seluruh baris paket vs jumlah HPP
--    komponennya. Jasa/tindakan tetap boleh gratis. Diskon invoice dibagi proporsional.
--    Pemeriksaan berjalan di transaksi yang sama sesudah stok dikeluarkan dan sebelum
--    jurnal, jadi penolakan membatalkan stok, HPP, dan invoice sekaligus.
--
-- Fungsi yang ditambal memakai pola anchored replace: gagal keras bila definisinya sudah
-- berubah dari teks yang ditinjau. Signature, SECURITY DEFINER, search_path dan grant tetap.

-- ---------------------------------------------------------------------------
-- 1. Kasir petshop: Grup ikut dinilai.
-- ---------------------------------------------------------------------------
do $p03_cashier$
declare
  signature regprocedure := 'public.cashier_post_stock_atomic(uuid,uuid)'::regprocedure;
  definition text := pg_get_functiondef(signature);
  old_text text := $old$ for line in select i.*, m.item_type from public.sale_items i
  left join public.items m on m.id=i.item_id where i.sale_id=s.id and m.item_type='Persediaan' order by i.id loop
  gross := line.qty * line.harga;
  manual := case when line.item_discount_type = 'percent' then round(gross * coalesce(line.item_discount_value,0) / 100,0)
   else coalesce(line.item_discount_value,0) end;
  item_discount := least(greatest(case when manual > 0 then manual else coalesce(line.promo_discount,0) end,0),gross);
  if after_items <= 0 or (gross-item_discount)*net_total/after_items <= 0 then
   raise exception 'Harga neto Persediaan nol; penjualan ditolak' using errcode='55000';
  end if;
  if line.hpp is null or (gross-item_discount)*net_total/after_items < line.hpp then
   raise exception 'Harga neto Persediaan di bawah HPP FIFO; penjualan ditolak' using errcode='55000';
  end if;
 end loop;$old$;
  new_text text := $new$ -- P03_GRUP_FLOOR: a package line with stock components is goods; its hpp
 -- already holds the summed actual FIFO cost of those components.
 for line in select i.*, m.item_type from public.sale_items i
  left join public.items m on m.id=i.item_id where i.sale_id=s.id and (m.item_type='Persediaan'
   or (m.item_type='Grup' and exists(select 1 from public.sale_item_group_components gc
    where gc.sale_item_id=i.id and gc.item_type='Persediaan'))) order by i.id loop
  gross := line.qty * line.harga;
  manual := case when line.item_discount_type = 'percent' then round(gross * coalesce(line.item_discount_value,0) / 100,0)
   else coalesce(line.item_discount_value,0) end;
  item_discount := least(greatest(case when manual > 0 then manual else coalesce(line.promo_discount,0) end,0),gross);
  if after_items <= 0 or (gross-item_discount)*net_total/after_items <= 0 then
   if line.item_type = 'Grup' then
    raise exception 'Harga neto paket Grup nol; penjualan ditolak: %', line.nama using errcode='55000';
   end if;
   raise exception 'Harga neto Persediaan nol; penjualan ditolak: %', line.nama using errcode='55000';
  end if;
  if line.hpp is null or (gross-item_discount)*net_total/after_items < line.hpp then
   if line.item_type = 'Grup' then
    raise exception 'Harga neto paket Grup di bawah total HPP FIFO komponen; penjualan ditolak: %', line.nama using errcode='55000';
   end if;
   raise exception 'Harga neto Persediaan di bawah HPP FIFO; penjualan ditolak: %', line.nama using errcode='55000';
  end if;
 end loop;$new$;
begin
  if position('P03_GRUP_FLOOR' in definition) > 0 then
    raise exception 'P03 cashier floor already applied; inspect before re-running';
  end if;
  if (length(definition) - length(replace(definition, old_text, ''))) / length(old_text) <> 1 then
    raise exception 'P03_DRIFT: cashier_post_stock_atomic changed; review before release';
  end if;
  execute replace(definition, old_text, new_text);
end $p03_cashier$;
revoke all on function public.cashier_post_stock_atomic(uuid,uuid) from public,anon,service_role;
grant execute on function public.cashier_post_stock_atomic(uuid,uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Kasir klinik: satu pemeriksa, dipanggil dari posting dan koreksi.
-- ---------------------------------------------------------------------------
create function clinic_private.rupiah_text(p_value numeric) returns text
language sql immutable set search_path = '' as $$
  select 'Rp' || replace(to_char(round(coalesce(p_value, 0)), 'FM999,999,999,999,990'), ',', '.')
$$;
revoke all on function clinic_private.rupiah_text(numeric) from public, anon, authenticated, service_role;

create function clinic_private.assert_invoice_price_floor(p_invoice_id uuid, p_subtotal numeric, p_discount numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_share numeric;
  v_line record;
  v_net numeric;
begin
  if p_subtotal is null or p_discount is null or p_subtotal < 0 or p_discount < 0 or p_discount > p_subtotal then
    raise exception using errcode = 'P0001', message = 'INVOICE_INVALID: nilai invoice tidak konsisten';
  end if;
  -- Invoice-level discount is apportioned by each line's share of the subtotal, the
  -- same convention as the petshop cashier. Tax is not revenue and is ignored.
  v_share := case when p_subtotal > 0 then (p_subtotal - p_discount) / p_subtotal else 0 end;

  -- Standalone goods: medicine/stock lines linked to a master item, and compounded
  -- medicine (racikan). Services (jenis 'jasa'), including procedures that consume
  -- BMHP, stay free to price at zero.
  for v_line in
    select ii.deskripsi, ii.hpp,
      round(ii.qty * ii.harga * (1 - coalesce(ii.diskon_persen, 0) / 100), 2) as amount
    from public.invoice_items ii
    where ii.invoice_id = p_invoice_id and ii.package_item_id is null and ii.jenis = 'obat'
      and (ii.item_id is not null or ii.compound_recipe_id is not null)
    order by ii.deskripsi, ii.id
  loop
    v_net := round(v_line.amount * v_share, 2);
    if v_net <= 0 then
      raise exception using errcode = 'P0001', message = format(
        'PRICE_ZERO: Harga neto %s Rp0. Obat/barang tidak boleh dijual gratis (jasa tetap boleh gratis).',
        v_line.deskripsi);
    end if;
    if v_line.hpp is null then
      raise exception using errcode = 'P0001', message = format('COST_MISSING: %s', v_line.deskripsi);
    end if;
    if v_net < v_line.hpp then
      raise exception using errcode = 'P0001', message = format(
        'PRICE_BELOW_HPP: Harga neto %s %s di bawah HPP %s. Naikkan harga atau kurangi diskon.',
        v_line.deskripsi, clinic_private.rupiah_text(v_net), clinic_private.rupiah_text(v_line.hpp));
    end if;
  end loop;

  -- Package components are judged per package: the net of every line tagged with the
  -- package against the summed HPP of its components. A package of services only stays free.
  for v_line in
    select ii.package_item_id, coalesce(max(i.name), 'paket') as package_name,
      sum(round(ii.qty * ii.harga * (1 - coalesce(ii.diskon_persen, 0) / 100), 2)) as amount,
      sum(coalesce(ii.hpp, 0)) as hpp
    from public.invoice_items ii
    left join public.items i on i.id = ii.package_item_id
    where ii.invoice_id = p_invoice_id and ii.package_item_id is not null
    group by ii.package_item_id
    having bool_or(ii.jenis = 'obat' and (ii.item_id is not null or ii.compound_recipe_id is not null))
    order by 2, 1
  loop
    v_net := round(v_line.amount * v_share, 2);
    if v_net <= 0 then
      raise exception using errcode = 'P0001', message = format(
        'PRICE_ZERO: Harga neto paket %s Rp0. Paket yang berisi obat/barang tidak boleh gratis.',
        v_line.package_name);
    end if;
    if v_net < v_line.hpp then
      raise exception using errcode = 'P0001', message = format(
        'PRICE_BELOW_HPP: Harga neto paket %s %s di bawah total HPP komponennya %s. Naikkan harga atau kurangi diskon.',
        v_line.package_name, clinic_private.rupiah_text(v_net), clinic_private.rupiah_text(v_line.hpp));
    end if;
  end loop;
end $$;
revoke all on function clinic_private.assert_invoice_price_floor(uuid, numeric, numeric)
  from public, anon, authenticated, service_role;

do $p03_clinic$
declare
  p record;
  definition text;
begin
  for p in select * from (values
    ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)',
     E'  select round(coalesce(sum(ii.hpp), 0), 2)::numeric(15,2)\n    into v_total_hpp from public.invoice_items ii where ii.invoice_id = v_invoice_id;\n',
     E'  select round(coalesce(sum(ii.hpp), 0), 2)::numeric(15,2)\n    into v_total_hpp from public.invoice_items ii where ii.invoice_id = v_invoice_id;\n'
     || E'  -- P03_PRICE_FLOOR: goods below actual HPP roll back the whole posting.\n'
     || E'  perform clinic_private.assert_invoice_price_floor(v_invoice_id, v_subtotal, v_discount);\n'),
    ('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)',
     E'  select coalesce(sum(hpp),0) into v_total_hpp from public.invoice_items where invoice_id=p_invoice_id;\n',
     E'  select coalesce(sum(hpp),0) into v_total_hpp from public.invoice_items where invoice_id=p_invoice_id;\n'
     || E'  -- P03_PRICE_FLOOR: a correction cannot move goods below actual HPP either.\n'
     || E'  perform clinic_private.assert_invoice_price_floor(p_invoice_id, v_subtotal, v_discount);\n')
  ) as patches(sig, old_text, new_text) loop
    definition := pg_get_functiondef(p.sig::regprocedure);
    if position('P03_PRICE_FLOOR' in definition) > 0 then
      raise exception 'P03 clinic floor already applied to %; inspect before re-running', p.sig;
    end if;
    if (length(definition) - length(replace(definition, p.old_text, ''))) / length(p.old_text) <> 1 then
      raise exception 'P03_DRIFT: % changed; review before release', p.sig;
    end if;
    execute replace(definition, p.old_text, p.new_text);
  end loop;
end $p03_clinic$;
revoke all on function public.clinic_post_invoice(uuid,text,jsonb,jsonb) from public, anon, service_role;
grant execute on function public.clinic_post_invoice(uuid,text,jsonb,jsonb) to authenticated;
