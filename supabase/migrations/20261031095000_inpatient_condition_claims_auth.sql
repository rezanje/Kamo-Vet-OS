-- Rawat inap: ubah kondisi (Sembuh/RIP/Pulang Paksa/Kritis) selalu ditolak
-- "Akses cabang atau kunjungan tidak diizinkan" karena fungsi membaca GUC lama
-- request.jwt.claim.role yang tidak lagi dikirim PostgREST modern (hanya
-- request.jwt.claims). Pola sama dengan 20261012090000_official_compound_claims_auth:
-- ganti hanya pembaca peran sesi; isi fungsi, owner, dan ACL tetap.
do $migration$
declare
  v_oid regprocedure := 'public.clinic_change_inpatient_condition(uuid,text,text)'::regprocedure;
  v_definition text;
  v_legacy constant text := $legacy$coalesce(current_setting('request.jwt.claim.role', true), '')$legacy$;
begin
  v_definition := pg_get_functiondef(v_oid);
  if strpos(v_definition, v_legacy) = 0 then
    if strpos(v_definition, 'coalesce(auth.role(), '''')') > 0 then
      return; -- Sudah diterapkan.
    end if;
    raise exception 'Penjaga peran sesi rawat inap tidak dikenali; migrasi dibatalkan';
  end if;
  if (length(v_definition) - length(replace(v_definition, v_legacy, ''))) / length(v_legacy) <> 1 then
    raise exception 'Jangkar peran sesi rawat inap harus muncul tepat sekali';
  end if;
  execute replace(v_definition, v_legacy, 'coalesce(auth.role(), '''')');
end;
$migration$;
