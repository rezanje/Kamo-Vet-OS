-- R05: private preferences only. No report rows, sharing, or existing policy changes.
create table public.private_report_presets (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
 name text not null check (length(btrim(name)) between 1 and 80),
 href text not null check (length(href) between 1 and 8000),
 saved_at timestamptz not null default now()
);
create index private_report_presets_user_saved on public.private_report_presets(user_id,saved_at desc,id);
alter table public.private_report_presets enable row level security;
alter table public.private_report_presets force row level security;
revoke all on public.private_report_presets from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.private_report_presets to authenticated;

-- Same report-module defaults/custom overrides as akses.ts; no OWNER exception
-- to the row's private ownership. No branch data is materialized in preferences.
create function public.private_report_presets_access() returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and
  (p.role='OWNER' or exists(select 1 from public.role_modules m where m.role=p.role and m.module_id='laporan')
   or (not exists(select 1 from public.role_modules m where m.role=p.role) and p.role in('ADMIN','DOCTOR','FINANCE'))));
$$;
revoke all on function public.private_report_presets_access() from public,anon,service_role;
grant execute on function public.private_report_presets_access() to authenticated;
create policy private_report_presets_owner on public.private_report_presets for all to authenticated
 using(user_id=(select auth.uid()) and (select public.private_report_presets_access()))
 with check(user_id=(select auth.uid()) and (select public.private_report_presets_access()));

create function public.guard_private_report_preset() returns trigger
language plpgsql security invoker set search_path='' as $$
declare part text;
begin
 if auth.role()='authenticated' and new.user_id is distinct from auth.uid() then
  raise exception using errcode='42501',message='PRIVATE_PRESET_DENIED: konfigurasi hanya untuk akun sendiri';
 end if;
 if tg_op='UPDATE' and (new.id is distinct from old.id or new.user_id is distinct from old.user_id) then
  raise exception using errcode='42501',message='PRIVATE_PRESET_DENIED: pemilik dan identitas konfigurasi tidak dapat diganti';
 end if;
 if new.href !~ '^/laporan/(absensi|nilai-persediaan|gaji|rekap-klinik|transaksi-cabang|jadwal-anabul|margin-racikan|akuisisi|operasional-penjualan|pelanggan-harian|penjual|penjualan-barang|member|penjualan-rinci|pelanggan-teratas|retensi|penjualan-kasir|anamnesa|pembelian|kpi|promo)([?][^#[:space:]]*)?$' then
  raise exception using errcode='23514',message='PRIVATE_PRESET_INVALID: tujuan laporan tidak didukung';
 end if;
 foreach part in array string_to_array(split_part(new.href,'?',2),'&') loop
  if part<>'' and part !~ '^(dari|sampai|periode|cabang|gudang|dokter|q|masalah|rincian|kanal|jenis|horizon|preset|from|to|channel|branch|ambang|cari|kolom)=[^&]*$' then
   raise exception using errcode='23514',message='PRIVATE_PRESET_INVALID: parameter laporan tidak didukung';
  end if;
 end loop;
 -- Serialize only this account's preference quota; never replace a full list.
 perform pg_advisory_xact_lock(hashtextextended('private-report-presets:'||new.user_id::text,0));
 if tg_op='INSERT' and not exists(select 1 from public.private_report_presets p where p.id=new.id and p.user_id=new.user_id)
  and (select count(*) from public.private_report_presets p where p.user_id=new.user_id)>=50 then
  raise exception using errcode='23514',message='PRIVATE_PRESET_LIMIT: maksimal 50 konfigurasi per akun';
 end if;
 new.name:=btrim(new.name);new.saved_at:=now();
 return new;
end $$;
revoke all on function public.guard_private_report_preset() from public,anon,authenticated,service_role;
create trigger private_report_preset_guard before insert or update on public.private_report_presets
 for each row execute function public.guard_private_report_preset();
comment on table public.private_report_presets is 'Private per-account report URLs/preferences. Does not grant report or branch access; no report data or shared visibility.';
