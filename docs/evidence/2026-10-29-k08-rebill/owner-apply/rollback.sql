-- K08 REBILL ROLLBACK - WRITES (one function + one history row). Run ONLY if it is decided to go back.
-- Restores the exact pre-K08 stay-fee block (anchored reverse patch: the rest of the function, its
-- owner, SECURITY DEFINER, search_path and ACL stay as they are). Refuses if the K08 block is missing
-- or was edited. Stay-fee lines already written while K08 was active are NOT changed.
-- After rollback a second stay on the same visit again replaces the first period's days (the K08 bug).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $rollback$
declare
  signature regprocedure := 'public.clinic_change_inpatient_condition(uuid,text,text)'::regprocedure;
  definition text;
  decl_original text := E'  v_discharged_at timestamptz;\nbegin\n';
  decl_patched text := E'  v_discharged_at timestamptz;\n  v_periods integer; -- K08_REBILL_PERIODS\nbegin\n';
  fee_original text := E'        v_days := greatest(1, ceil(extract(epoch from\n'
    || E'          (v_discharged_at - v_record.admitted_at)) / 86400)::integer);\n'
    || E'        delete from public.prescription_items\n'
    || E'        where medical_record_id=v_medical_record_id and item_id=v_tariff.id;\n'
    || E'        insert into public.prescription_items(\n'
    || E'          medical_record_id, item_id, nama_obat, qty, harga, satuan,\n'
    || E'          jenis, kategori, aturan_pakai\n'
    || E'        ) values (\n'
    || E'          v_medical_record_id, v_tariff.id, v_tariff.name, v_days,\n'
    || E'          coalesce(v_tariff.sell_price, 0), coalesce(v_tariff.unit, ''hari''),\n'
    || E'          ''jasa'', ''Rawat Inap'',\n'
    || E'          ''Otomatis dari lama rawat inap: '' || v_days || '' hari''\n'
    || E'        );\n';
  fee_patched text := E'        -- K08_REBILL_PERIODS_BEGIN\n'
    || E'        -- Every discharged stay of this visit, each rounded up per started 24 hours.\n'
    || E'        select count(*)::integer, coalesce(sum(greatest(1, ceil(extract(epoch from\n'
    || E'            (r.discharged_at - r.admitted_at)) / 86400)::integer)), 0)::integer\n'
    || E'          into v_periods, v_days\n'
    || E'          from public.inpatient_records r\n'
    || E'          where r.visit_id = v_record.visit_id and r.discharged_at is not null;\n'
    || E'        v_days := greatest(1, v_days);\n'
    || E'        -- Replace the earlier automatic line(s) of this visit; never add a second one.\n'
    || E'        delete from public.prescription_items p\n'
    || E'        where (p.medical_record_id=v_medical_record_id and p.item_id=v_tariff.id)\n'
    || E'           or (p.kategori=''Rawat Inap'' and p.jenis=''jasa''\n'
    || E'               and p.aturan_pakai like ''Otomatis dari lama rawat inap: %''\n'
    || E'               and p.medical_record_id in (select m.id from public.medical_records m\n'
    || E'                 where m.visit_id = v_record.visit_id));\n'
    || E'        insert into public.prescription_items(\n'
    || E'          medical_record_id, item_id, nama_obat, qty, harga, satuan,\n'
    || E'          jenis, kategori, aturan_pakai\n'
    || E'        ) values (\n'
    || E'          v_medical_record_id, v_tariff.id, v_tariff.name, v_days,\n'
    || E'          coalesce(v_tariff.sell_price, 0), coalesce(v_tariff.unit, ''hari''),\n'
    || E'          ''jasa'', ''Rawat Inap'',\n'
    || E'          ''Otomatis dari lama rawat inap: '' || v_days || '' hari''\n'
    || E'            || case when v_periods > 1 then '' ('' || v_periods || '' periode)'' else '''' end\n'
    || E'        );\n'
    || E'        -- K08_REBILL_PERIODS_END\n';
begin
  if current_user <> 'postgres' then
    raise exception 'K08 rebill rollback must run as postgres (current role: %); nothing was changed', current_user;
  end if;
  definition := pg_get_functiondef(signature);
  if (length(definition) - length(replace(definition, decl_patched, ''))) / length(decl_patched) <> 1
     or (length(definition) - length(replace(definition, fee_patched, ''))) / length(fee_patched) <> 1 then
    raise exception 'K08 rebill block not found exactly as applied; inspect the function, nothing was changed';
  end if;
  definition := replace(replace(definition, fee_patched, fee_original), decl_patched, decl_original);
  if position('K08_REBILL_PERIODS' in definition) > 0 then
    raise exception 'K08 rebill rollback left a marker behind; nothing was changed';
  end if;
  execute definition;
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations where version = '20261029152000';
  end if;
end;
$rollback$;
commit;
