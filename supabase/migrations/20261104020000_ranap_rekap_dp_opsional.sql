-- Andri: DP lanjutan rawat inap opsional; DP awal tetap mengikuti pengaturan.
-- Hanya pintu masuk tahap yang sudah memvalidasi peran/cabang/shift/kunjungan dan
-- memegang koordinator uang yang boleh mengecualikan tahap lanjutan. Tidak ada
-- flag defer dari JSON/GUC dan enforce_min_dp global TIDAK diubah.
-- Satu invoice positif aktif lain yang selesai dikoreksi = tahap lanjutan. Invoice void
-- saja / pengganti correction_pending tidak memenuhi syarat; pembatalan penerimaan
-- tidak menghapus invoice aktif, sehingga tidak mengulang kewajiban DP awal.
do $patch$
declare
  signature regprocedure := 'public.clinic_post_inpatient_stage_invoice(uuid,text,jsonb,jsonb)'::regprocedure;
  definition text;
  old_text text := $old$  perform clinic_private.enforce_min_dp(v_invoice_id, p_invoice ->> 'dp_override_reason');$old$;
  new_text text := $new$  -- DP lanjutan opsional hanya di pembungkus tahap terpercaya ini.
  if not exists (
    select 1 from public.invoices prior
    where prior.visit_id = p_visit_id and prior.id <> v_invoice_id
      and prior.voided_at is null and prior.total > 0
      and not coalesce(prior.correction_pending, false)
  ) then
    perform clinic_private.enforce_min_dp(v_invoice_id, p_invoice ->> 'dp_override_reason');
  end if;$new$;
begin
  definition := pg_get_functiondef(signature);
  if position(new_text in definition) > 0 then return; end if;
  if (length(definition) - length(replace(definition, old_text, ''))) / length(old_text) <> 1 then
    raise exception 'DP opsional ranap: jangkar tahap harus muncul tepat sekali';
  end if;
  execute replace(definition, old_text, new_text);
end $patch$;
-- CREATE OR REPLACE mempertahankan hak yang ada; ditegaskan agar tetap tertutup.
revoke all on function public.clinic_post_inpatient_stage_invoice(uuid,text,jsonb,jsonb)
  from public, anon, service_role;
grant execute on function public.clinic_post_inpatient_stage_invoice(uuid,text,jsonb,jsonb) to authenticated;
