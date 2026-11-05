-- P03 pesan penolakan harga di bawah HPP yang bisa ditindaklanjuti (kasir klinik rawat jalan + rawat inap).
-- Apply as ONE transaction (satu transaksi; tanpa begin/commit sendiri).
--
-- Masalah (kasus ranap VET_CMS, 5 Nov 2026): pesan lama hanya menyebut SATU baris pertama yang gagal per
-- percobaan, menyuruh "kurangi diskon" padahal kolom diskon ranap terkunci 0, dan tidak menyebut harga minimum.
--
-- Perubahan: HANYA teks galat clinic_private.assert_invoice_price_floor.
--  * semua baris/paket yang melanggar dikumpulkan (maksimal 30 ditampilkan) dengan nama, harga neto per satuan,
--    HPP per satuan, dan harga minimum per satuan (= pembulatan ke atas HPP per satuan; dengan diskon invoice
--    ikut dihitung; paket: total harga minimum paket);
--  * awalan galat tetap PRICE_ZERO / PRICE_BELOW_HPP / COST_MISSING milik baris pertama yang gagal, seperti dulu;
--  * petunjuk "kurangi diskon" dihilangkan untuk invoice tahap rawat inap (diskon tahap tidak bisa diubah);
--  * baris racikan diberi petunjuk khusus.
-- ATURAN (apa yang ditolak) TIDAK berubah: baris/paket ditolak persis ketika neto <= 0, HPP kosong, atau neto < HPP.
-- Signature, SECURITY DEFINER, search_path, pemilik dan ACL tetap. Penggantian memakai jangkar eksak dan gagal
-- tertutup bila definisinya sudah berubah dari teks yang ditinjau (P03, 20261104372000).

set local lock_timeout = '5s';

do $p03_pesan$
declare
  signature regprocedure := 'clinic_private.assert_invoice_price_floor(uuid,numeric,numeric)'::regprocedure;
  definition text := pg_get_functiondef(signature);
  pre text;
  old_text text := $old$declare
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
end$old$;
  new_text text := $new$declare
  v_share numeric;
  v_line record;
  v_net numeric;
  v_kind text;
  v_first text;
  v_head text;
  v_name text;
  v_rows text[] := '{}'::text[];
  v_cost text[] := '{}'::text[];
  v_count integer := 0;
  v_racik boolean := false;
  v_stage boolean := false;
  v_visit uuid;
  v_q numeric;
  v_unit text;
  v_factor numeric;
  v_min numeric;
  v_text text;
begin
  if p_subtotal is null or p_discount is null or p_subtotal < 0 or p_discount < 0 or p_discount > p_subtotal then
    raise exception using errcode = 'P0001', message = 'INVOICE_INVALID: nilai invoice tidak konsisten';
  end if;
  -- Invoice-level discount is apportioned by each line's share of the subtotal, the
  -- same convention as the petshop cashier. Tax is not revenue and is ignored.
  v_share := case when p_subtotal > 0 then (p_subtotal - p_discount) / p_subtotal else 0 end;
  -- Inpatient stage invoices cannot carry a discount (stage discount is locked at 0):
  -- the hint must not tell the cashier to lower a discount there.
  -- Stage = the posting context opened by the inpatient stage RPC (first posting and its corrections) or an
  -- invoice already marked stage_billing.
  select i.visit_id, coalesce(i.stage_billing, false) into v_visit, v_stage
  from public.invoices i where i.id = p_invoice_id;
  v_stage := coalesce(v_stage, false) or coalesce(clinic_private.stage_billing(v_visit), false);

  -- P03_PESAN_JELAS: the RULE below is unchanged (a row/package is refused exactly when its net is
  -- <= 0, its HPP is missing, or its net is below HPP). Only the message changed: every offending row
  -- is collected, not just the first, and each gets its net price, HPP and minimum price per unit.
  -- The prefix (PRICE_ZERO / PRICE_BELOW_HPP / COST_MISSING) is the one of the FIRST failing row, as before.

  -- Standalone goods: medicine/stock lines linked to a master item, and compounded
  -- medicine (racikan). Services (jenis 'jasa'), including procedures that consume
  -- BMHP, stay free to price at zero.
  for v_line in
    select ii.deskripsi, ii.hpp, ii.qty, ii.satuan, ii.diskon_persen,
      (ii.compound_recipe_id is not null) as racik,
      round(ii.qty * ii.harga * (1 - coalesce(ii.diskon_persen, 0) / 100), 2) as amount
    from public.invoice_items ii
    where ii.invoice_id = p_invoice_id and ii.package_item_id is null and ii.jenis = 'obat'
      and (ii.item_id is not null or ii.compound_recipe_id is not null)
    order by ii.deskripsi, ii.id
  loop
    v_net := round(v_line.amount * v_share, 2);
    v_kind := case when v_net <= 0 then 'ZERO' when v_line.hpp is null then 'COST' when v_net < v_line.hpp then 'BELOW' end;
    continue when v_kind is null;
    v_name := btrim(regexp_replace(v_line.deskripsi, '\s+', ' ', 'g'));
    if v_first is null then
      v_first := v_kind;
      v_head := case when v_kind = 'ZERO' then format(
          'PRICE_ZERO: Harga neto %s Rp0. Obat/barang tidak boleh dijual gratis (jasa tetap boleh gratis).', v_name)
        else format('PRICE_BELOW_HPP: Harga neto %s %s di bawah HPP %s.', v_name,
          clinic_private.rupiah_text(v_net), clinic_private.rupiah_text(v_line.hpp)) end;
    end if;
    if v_kind = 'COST' then
      v_cost := v_cost || v_name;
      continue;
    end if;
    v_count := v_count + 1;
    v_racik := v_racik or v_line.racik;
    if v_count <= 30 then
      v_q := greatest(v_line.qty, 1);
      v_unit := coalesce(nullif(btrim(v_line.satuan), ''), 'unit');
      v_factor := v_q * (1 - coalesce(v_line.diskon_persen, 0) / 100) * v_share;
      v_min := case when v_factor > 0 then greatest(ceil(coalesce(v_line.hpp, 0) / v_factor), 1) end;
      v_rows := v_rows || format('- %s%s: harga neto %s per %s, %s, %s', v_name,
        case when v_line.racik then ' (racikan)' else '' end,
        clinic_private.rupiah_text(v_net / v_q), v_unit,
        case when v_line.hpp is null then 'HPP belum tersedia'
          else format('HPP %s per %s', clinic_private.rupiah_text(v_line.hpp / v_q), v_unit) end,
        case when v_min is null then 'harga minimum tidak dapat dihitung (diskon invoice 100%)'
          else format('harga minimum %s per %s', clinic_private.rupiah_text(v_min), v_unit) end)::text;
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
    v_kind := case when v_net <= 0 then 'ZERO' when v_net < v_line.hpp then 'BELOW' end;
    continue when v_kind is null;
    v_name := btrim(regexp_replace(v_line.package_name, '\s+', ' ', 'g'));
    if v_first is null then
      v_first := v_kind;
      v_head := case when v_kind = 'ZERO' then format(
          'PRICE_ZERO: Harga neto paket %s Rp0. Paket yang berisi obat/barang tidak boleh gratis.', v_name)
        else format('PRICE_BELOW_HPP: Harga neto paket %s %s di bawah total HPP komponennya %s.', v_name,
          clinic_private.rupiah_text(v_net), clinic_private.rupiah_text(v_line.hpp)) end;
    end if;
    v_count := v_count + 1;
    if v_count <= 30 then
      v_min := case when v_share > 0 then greatest(ceil(v_line.hpp / v_share), 1) end;
      v_rows := v_rows || format('- %s (paket): harga neto %s untuk seluruh paket, total HPP komponen %s, %s', v_name,
        clinic_private.rupiah_text(v_net), clinic_private.rupiah_text(v_line.hpp),
        case when v_min is null then 'harga minimum tidak dapat dihitung (diskon invoice 100%)'
          else format('harga minimum paket %s', clinic_private.rupiah_text(v_min)) end)::text;
    end if;
  end loop;

  if v_first is null then
    return;
  end if;
  if v_first = 'COST' then
    raise exception using errcode = 'P0001', message = 'COST_MISSING: ' || array_to_string(v_cost, ', ');
  end if;

  v_text := v_head
    || case when v_count > 1 then format(' Ada %s baris yang ditolak; semuanya tercantum di bawah.', v_count) else '' end
    || E'\n' || array_to_string(v_rows, E'\n')
    || case when v_count > 30 then format(E'\ndan %s baris lain lagi.', v_count - 30) else '' end
    || case when cardinality(v_cost) > 0 then E'\nHPP belum tersedia untuk: ' || array_to_string(v_cost, ', ') else '' end
    || E'\n' || case when v_stage
        then 'Naikkan Harga di baris tersebut atau ubah Harga jual di Barang & Jasa.'
        else 'Naikkan Harga di baris tersebut, kurangi diskon, atau ubah Harga jual di Barang & Jasa.' end
    || ' Mengubah Harga jual di Barang & Jasa tidak mengubah baris di tagihan yang sudah terbuka.'
    || case when v_racik and v_stage then ' Untuk racikan: ubah harga racikan (Owner) atau ubah komposisi lewat dokter.'
        when v_racik then ' Untuk racikan: ubah komposisi lewat dokter.' else '' end;
  raise exception using errcode = 'P0001', message = v_text;
end$new$;
begin
  if position('P03_PESAN_JELAS' in definition) > 0 then
    raise exception 'P03 pesan jelas already applied; inspect before re-running';
  end if;
  if (length(definition) - length(replace(definition, old_text, ''))) / length(old_text) <> 1 then
    raise exception 'P03_PESAN_DRIFT: assert_invoice_price_floor changed; review before release';
  end if;
  pre := (select format('%s|%s|%s|%s|%s', proowner, proacl, prosecdef, proconfig, prorettype)
    from pg_proc where oid = signature);
  execute replace(definition, old_text, new_text);
  if pre is distinct from (select format('%s|%s|%s|%s|%s', proowner, proacl, prosecdef, proconfig, prorettype)
    from pg_proc where oid = signature) then
    raise exception 'P03 pesan jelas: pemilik/ACL/definer/config berubah setelah ditambal';
  end if;
  if position('P03_PESAN_JELAS' in pg_get_functiondef(signature)) = 0 then
    raise exception 'P03 pesan jelas: definisi tidak sesuai setelah ditambal';
  end if;
end $p03_pesan$;
revoke all on function clinic_private.assert_invoice_price_floor(uuid, numeric, numeric)
  from public, anon, authenticated, service_role;
