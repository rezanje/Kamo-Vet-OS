-- Edit Kas Masuk/Keluar & Transfer Kas untuk Admin dan Finance; tanggal transfer boleh dikoreksi (12 Nov 2026).
--
-- Pelapor: Mba Anisa via Reza ("pengeluaran, transfer kas, penerimaan kas, semuanya ada akses edit tgl,
-- edit item, edit lampiran"). Keputusan Reza (12 Nov): akses edit dibuka untuk OWNER, ADMIN, dan FINANCE.
--
-- Sebelumnya:
--  * revise_cash_entry (20261020112715): batal boleh OWNER/ADMIN/FINANCE, tapi edit hanya OWNER.
--  * internal_transfer_access (20261021073019): koreksi/batal transfer hanya OWNER.
--  * mutate_cash_transfer: koreksi wajib memakai tanggal catatan asli.
--
-- Sesudah:
--  * Edit kas dan koreksi/batal transfer boleh OWNER/ADMIN/FINANCE aktif. Pengaman lain tetap: akses cabang,
--    periode tutup buku, rekonsiliasi bank, revisi bersamaan, alasan wajib, jurnal pembalik + pengganti,
--    jejak revisi. Izin per grup (bank.cash_transfer.*) di Pengaturan > Akses Grup tetap berlaku.
--  * Koreksi transfer boleh mengganti tanggal: jurnal pembalik tetap di tanggal asli, pengganti di tanggal baru.
--    Tanggal baru tetap ditolak bila di masa depan, di periode tertutup, atau tercakup rekonsiliasi bank
--    (pemeriksaan untuk tanggal baru sudah ada di fungsi). Cabang tetap mengikuti catatan asli.
--
-- Fungsi yang sudah dipatch berlapis (role_bank_actions) diubah lewat penggantian teks pada definisi
-- yang sedang berjalan; setiap penggantian wajib menemukan tepat satu potongan, kalau tidak migrasi gagal.
-- Idempoten: bila potongan lama sudah tidak ada dan potongan baru sudah ada, langkah dilewati.

create or replace function public.internal_transfer_access(p_action text) returns void
language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype;begin
 select * into actor from public.profiles where id=auth.uid() for share;
 if not found or not actor.is_active or actor.role not in ('OWNER','ADMIN','FINANCE') then
  raise exception 'Akses ditolak. Hanya Super Admin/OWNER, Admin, atau Finance boleh mencatat atau mengoreksi transfer' using errcode='42501';
 end if;
 if actor.role<>'OWNER' and exists(select 1 from public.role_modules where role=actor.role)
  and not exists(select 1 from public.role_modules where role=actor.role and module_id='kas-bank') then
  raise exception 'Akses modul Kas & Bank diperlukan' using errcode='42501';
 end if;
end$$;
revoke all on function public.internal_transfer_access(text) from public,anon,authenticated,service_role;

do $migrate$
declare
 v_def text; v_count integer;
 v_old text := $q$ if p_action='edit' and v_profile.role<>'OWNER' then raise exception 'Hanya Super Admin yang bisa mengedit kas' using errcode='42501'; end if;$q$;
begin
 v_def := pg_get_functiondef('public.revise_cash_entry(text,uuid,integer,text,jsonb,text)'::regprocedure);
 v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
 if v_count = 1 then
  execute replace(v_def, v_old, $q$ -- Edit kas: OWNER/ADMIN/FINANCE (keputusan 12 Nov 2026), dicek di atas.$q$);
 elsif v_count <> 0 or position('Hanya Super Admin yang bisa mengedit kas' in v_def) > 0 then
  raise exception 'revise_cash_entry: pembatas edit OWNER tidak ditemukan tepat satu kali (%)', v_count;
 end if;
end
$migrate$;

do $migrate$
declare
 v_def text; v_count integer;
 v_old text := $q$if p_action='edit' and (d<>doc.tanggal or (nullif(p_header->>'branch_id','') is not null and (p_header->>'branch_id')::uuid is distinct from branch)) then
   raise exception 'Koreksi nominal/rekening harus memakai tanggal dan cabang catatan asli';$q$;
 v_new text := $q$if p_action='edit' and (nullif(p_header->>'branch_id','') is not null and (p_header->>'branch_id')::uuid is distinct from branch) then
   raise exception 'Koreksi transfer harus memakai cabang catatan asli';$q$;
begin
 v_def := pg_get_functiondef('public.mutate_cash_transfer(text,text,uuid,integer,jsonb,text)'::regprocedure);
 v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
 if v_count = 1 then
  execute replace(v_def, v_old, v_new);
 elsif v_count <> 0 or position(v_new in v_def) = 0 then
  raise exception 'mutate_cash_transfer: pembatas tanggal koreksi tidak ditemukan tepat satu kali (%)', v_count;
 end if;
end
$migrate$;
