-- Lanjutan hotfix 10 Nov 2026 (lihat 20261110090624_nomor_jurnal_lebih_dari_9999.sql).
-- create_purchase_invoice_from_po_internal dan create_fixed_asset_purchase_internal
-- membaca urutan jurnal hanya dari 4 karakter dan memformat dengan lpad(...,4):
-- setelah 9999, lpad memotong 10000 jadi "1000" yang sudah terpakai, loop retry
-- unique_violation tidak pernah ketemu nomor kosong → simpan faktur pembelian /
-- aset tetap menggantung. Tambal: baca semua digit depan sufiks dan biarkan nomor
-- tumbuh ke 5+ digit. Badan fungsi lain tidak disentuh; tiap pola wajib ditemukan
-- persis sekali supaya tambalan tidak diam-diam meleset.
do $patch$
declare
  v_fn text; v_prefix text; v_def text; v_old text; v_new text; v_i int;
  v_olds text[]; v_news text[];
begin
  foreach v_fn in array array['create_purchase_invoice_from_po_internal','create_fixed_asset_purchase_internal'] loop
    v_prefix := case v_fn when 'create_purchase_invoice_from_po_internal' then 'v_prefix_jurnal' else 'v_prefix' end;
    select pg_get_functiondef(p.oid) into strict v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    v_olds := array[
      format('max(substring(entry.no_jurnal from length(%s) + 1 for 4)::bigint)', v_prefix),
      format('and substring(entry.no_jurnal from length(%s) + 1 for 4) ~ ''^[0-9]{4}$''', v_prefix),
      format('v_no_jurnal := %s || lpad(v_seq::text, 4, ''0'');', v_prefix)
    ];
    v_news := array[
      format('max(substring(substring(entry.no_jurnal from length(%s) + 1) from ''^[0-9]{1,12}'')::bigint)', v_prefix),
      format('and substring(entry.no_jurnal from length(%s) + 1) ~ ''^[0-9]{4}''', v_prefix),
      format('v_no_jurnal := %s || lpad(v_seq::text, greatest(4, length(v_seq::text)), ''0'');', v_prefix)
    ];
    for v_i in 1..3 loop
      v_old := v_olds[v_i]; v_new := v_news[v_i];
      if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
        raise exception 'Pola % tidak ditemukan tepat sekali di %', v_i, v_fn;
      end if;
      v_def := replace(v_def, v_old, v_new);
    end loop;
    execute v_def;
  end loop;
end
$patch$;
