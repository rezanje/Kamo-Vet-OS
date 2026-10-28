-- K08: a discharge bills every inpatient period (stay) of the visit exactly once.
--
-- Before: each discharge recomputed the automatic "Rawat Inap" line from the CURRENT stay
-- only and deleted the visit's earlier line, so a second stay on the same visit (admitted
-- again after a discharge, before the invoice) replaced the first period's days: only the
-- last period was billed. The delete also only matched the current tariff item, so a stay
-- tariff changed between two discharges left the old automatic line next to the new one.
--
-- After: the automatic line = sum over every discharged stay of the visit, each stay rounded
-- up per started 24 hours (unchanged rounding rule), at the current tariff, on one line.
-- Earlier automatic lines of the visit (any tariff, any of its medical records) are replaced.
-- Safe because a discharge is still refused while the visit has an active invoice
-- (INVOICE_EXISTS, unchanged): no period of this visit is billed anywhere yet. A K06
-- continuation visit keeps billing only its own stays. Reopen/extend of one stay remains
-- one period from admission to the final discharge (unchanged).
--
-- Anchored patch of the live definition: fails if the function drifted or is already
-- patched. Signature, SECURITY DEFINER, search_path, owner and ACL are preserved
-- (CREATE OR REPLACE of the same definition). No table, policy or grant changes.
do $migration$
declare
  signature regprocedure := 'public.clinic_change_inpatient_condition(uuid,text,text)'::regprocedure;
  definition text;
  decl_anchor text := E'  v_discharged_at timestamptz;\nbegin\n';
  decl_replacement text := E'  v_discharged_at timestamptz;\n  v_periods integer; -- K08_REBILL_PERIODS\nbegin\n';
  fee_anchor text := E'        v_days := greatest(1, ceil(extract(epoch from\n'
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
  fee_replacement text := E'        -- K08_REBILL_PERIODS_BEGIN\n'
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
  definition := pg_get_functiondef(signature);
  if position('K08_REBILL_PERIODS' in definition) > 0 then
    raise exception 'K08 rebill patch is already present; verify migration history';
  end if;
  if (length(definition) - length(replace(definition, decl_anchor, ''))) / length(decl_anchor) <> 1
     or (length(definition) - length(replace(definition, fee_anchor, ''))) / length(fee_anchor) <> 1 then
    raise exception 'K08 rebill patch anchors not found exactly once; clinic_change_inpatient_condition drifted, inspect before release';
  end if;
  execute replace(replace(definition, decl_anchor, decl_replacement), fee_anchor, fee_replacement);
end;
$migration$;
