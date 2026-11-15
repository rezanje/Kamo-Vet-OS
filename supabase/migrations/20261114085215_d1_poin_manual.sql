-- D1 (meeting 12 Nov 2026): SESUAIKAN POIN PELANGGAN MANUAL — tambah/kurangi poin dengan alasan wajib, tercatat.
-- Apply as ONE transaction (satu transaksi; tanpa begin/commit sendiri).
--
-- Latar: pelanggan hasil migrasi punya poin dari sistem lama yang belum masuk VetOS (Production 14 Nov: semua 3.771 saldo poin
-- berasal dari transaksi VetOS sejak 1 Nov; tidak ada saldo awal). Juga dipakai untuk hadiah quest/game.
--
-- RANCANGAN
--  * Izin Akses Grup baru 'crm.poin_manual' (izin khusus, bawaan MATI; modul CRM) + public.customer_points_adjust_allowed():
--    OWNER selalu (tidak membaca tabel kebijakan); peran lain HANYA bila kebijakan tersimpan memuat izinnya.
--  * public.adjust_customer_points(pelanggan, jumlah ±, alasan, kunci): satu transaksi — kunci baris pelanggan, saldo baru tidak
--    boleh minus, satu baris point_ledger entry_type 'adjustment' (saldo berjalan, pelaku, alasan, kunci permintaan), lalu
--    customers.points diperbarui. Kunci sama + isi sama = hasil lama (tidak dobel); kunci sama + isi beda = ditolak.
--  * point_ledger mendapat kolom created_by / reason / request_key. Tabel ini terbuka untuk klien lewat RLS (jalur lama klinik
--    menulis langsung), jadi ketiga kolom dijaga trigger: hanya fungsi database yang boleh mengisinya (klien = dikosongkan).
--  * Log Aktifitas: point_ledger dan customers.points sudah tercatat (20261022070000/082000) — tidak perlu sumber baru.
--  * Poin tambahan ikut aturan kedaluwarsa yang sudah ada (trigger point_ledger_set_expiry), sama seperti poin transaksi.
--  * Tidak ada jurnal: poin di KAMO memang tidak dijurnal (1 poin = Rp1 dipakai sebagai potongan saat ditukar).
--
-- DAMPAK: tidak ada data yang berubah sampai seseorang memakai fitur ini. Jalur poin lama (kasir, klinik, refund, tutup tahun,
-- kedaluwarsa) tidak diubah; klien yang menulis point_ledger langsung tetap bisa, hanya kolom jejak baru yang dijaga.
--
-- ROLLBACK (satu transaksi): drop function public.adjust_customer_points(uuid,integer,text,uuid),
--   public.customer_points_adjust_allowed(); drop trigger point_ledger_guard_manual on public.point_ledger;
--   drop function public.guard_point_ledger_manual(); delete from role_settings_private.action_modules where id='crm.poin_manual';
--   delete from role_settings_private.action_catalog where id='crm.poin_manual'; (kolom baru boleh dibiarkan; nullable).
set local lock_timeout='5s';

-- ───────────── 1. Kolom jejak ─────────────
alter table public.point_ledger
 add column created_by uuid,
 add column reason text,
 add column request_key uuid;
create unique index point_ledger_request_key_uniq on public.point_ledger(request_key) where request_key is not null;
comment on column public.point_ledger.created_by is 'Pengguna yang menyesuaikan poin manual (diisi database lewat adjust_customer_points).';
comment on column public.point_ledger.reason is 'Alasan penyesuaian poin manual (D1), diisi database.';
comment on column public.point_ledger.request_key is 'Kunci permintaan penyesuaian manual (anti-dobel), diisi database.';

-- ───────────── 2. Penjaga kolom (point_ledger terbuka untuk klien lewat RLS) ─────────────
create function public.guard_point_ledger_manual() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if current_user in ('authenticated','anon') then
  if tg_op='INSERT' then new.created_by:=null; new.reason:=null; new.request_key:=null;
  else new.created_by:=old.created_by; new.reason:=old.reason; new.request_key:=old.request_key; end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_point_ledger_manual() from public,anon,authenticated,service_role;
create trigger point_ledger_guard_manual before insert or update on public.point_ledger
 for each row execute function public.guard_point_ledger_manual();

-- ───────────── 3. Izin Akses Grup + pemeriksa ─────────────
insert into role_settings_private.action_catalog(id,label,"group",enforced) values
 ('crm.poin_manual','Sesuaikan poin pelanggan — tambah/kurangi poin manual dengan alasan wajib (saldo awal sistem lama, hadiah quest); tercatat. Bawaan hanya Owner','CRM',true)
on conflict(id) do nothing;
insert into role_settings_private.action_modules(id,module_id) values('crm.poin_manual','crm') on conflict do nothing;

create function public.customer_points_adjust_allowed() returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_role public.user_role; v_allowed text[];
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then return false; end if;
 select role into v_role from public.profiles where id=auth.uid() and is_active;
 if v_role is null then return false; end if;
 -- OWNER: tidak membaca tabel kebijakan sama sekali, jadi galat/penguncian kebijakan tidak bisa menolaknya.
 if v_role='OWNER' then return true; end if;
 begin
  if not exists(select 1 from role_settings_private.action_catalog where id='crm.poin_manual' and enforced) then return false; end if;
  select a.allowed into v_allowed from role_settings_private.action_policies a where a.role=v_role;
  -- Tanpa kebijakan tersimpan: bawaan TIDAK (izin khusus).
  if not found then return false; end if;
  return 'crm.poin_manual'=any(v_allowed);
 exception when others then return false;
 end;
end $$;
comment on function public.customer_points_adjust_allowed() is 'Boleh menyesuaikan poin pelanggan manual? OWNER selalu; peran lain hanya bila dicentang (crm.poin_manual).';
revoke all on function public.customer_points_adjust_allowed() from public,anon,service_role;
grant execute on function public.customer_points_adjust_allowed() to authenticated;

-- ───────────── 4. Penyesuaian atomik ─────────────
create function public.adjust_customer_points(p_customer_id uuid,p_delta integer,p_reason text,p_request_key uuid) returns jsonb
language plpgsql volatile security definer set search_path='' set lock_timeout='5s' as $$
declare v_actor uuid:=auth.uid(); v_reason text; v_points integer; v_saldo integer; v_id uuid; v_dup public.point_ledger;
begin
 if not public.customer_points_adjust_allowed() then
  raise exception using errcode='42501', message='POIN_MANUAL_DITOLAK: hanya Owner atau peran yang diberi izin "Sesuaikan poin pelanggan".';
 end if;
 if p_customer_id is null then raise exception using errcode='22023', message='POIN_MANUAL_PELANGGAN: pelanggan tidak ditemukan.'; end if;
 if p_delta is null or p_delta=0 or abs(p_delta)>10000000 then
  raise exception using errcode='22023', message='POIN_MANUAL_JUMLAH: jumlah poin wajib diisi, bukan nol, maksimal 10.000.000.';
 end if;
 v_reason:=btrim(coalesce(p_reason,''));
 if length(v_reason) not between 3 and 300 then
  raise exception using errcode='22023', message='POIN_MANUAL_ALASAN: alasan wajib diisi 3 sampai 300 huruf.';
 end if;
 if p_request_key is null then raise exception using errcode='22023', message='POIN_MANUAL_KUNCI: muat ulang halaman lalu coba lagi.'; end if;

 perform pg_advisory_xact_lock(hashtextextended('poin-manual:'||p_request_key::text,0));
 select * into v_dup from public.point_ledger where request_key=p_request_key;
 if found then
  if v_dup.customer_id<>p_customer_id or v_dup.delta<>p_delta or v_dup.reason is distinct from v_reason or v_dup.created_by is distinct from v_actor then
   raise exception using errcode='22023', message='POIN_MANUAL_KUNCI_DIPAKAI: permintaan ini sudah dipakai dengan isi berbeda. Muat ulang halaman.';
  end if;
  return jsonb_build_object('ledger_id',v_dup.id,'customer_id',v_dup.customer_id,'delta',v_dup.delta,'saldo',v_dup.saldo,'already_applied',true);
 end if;

 select points into v_points from public.customers where id=p_customer_id for update;
 if not found then raise exception using errcode='22023', message='POIN_MANUAL_PELANGGAN: pelanggan tidak ditemukan.'; end if;
 v_saldo:=coalesce(v_points,0)+p_delta;
 if v_saldo<0 then
  raise exception using errcode='22023', message=format('POIN_MANUAL_MINUS: saldo poin tidak boleh minus (saldo sekarang %s).',coalesce(v_points,0));
 end if;
 insert into public.point_ledger(customer_id,delta,saldo,ref,description,entry_type,created_by,reason,request_key)
 values(p_customer_id,p_delta,v_saldo,'MANUAL-'||to_char(now() at time zone 'Asia/Jakarta','YYYYMMDD'),
        left('Penyesuaian manual: '||v_reason,160),'adjustment',v_actor,v_reason,p_request_key)
 returning id into v_id;
 update public.customers set points=v_saldo where id=p_customer_id;
 return jsonb_build_object('ledger_id',v_id,'customer_id',p_customer_id,'delta',p_delta,'saldo',v_saldo,'already_applied',false);
end $$;
comment on function public.adjust_customer_points(uuid,integer,text,uuid) is 'D1: tambah/kurangi poin pelanggan manual dengan alasan wajib (OWNER atau izin crm.poin_manual), atomik & anti-dobel.';
revoke all on function public.adjust_customer_points(uuid,integer,text,uuid) from public,anon,service_role;
grant execute on function public.adjust_customer_points(uuid,integer,text,uuid) to authenticated;

-- ───────────── 5. Pemeriksaan pasang ─────────────
do $check$
begin
 if not exists(select 1 from role_settings_private.action_catalog where id='crm.poin_manual' and enforced) then raise exception 'D1: katalog izin belum ada'; end if;
 if (select count(*) from pg_trigger where tgrelid='public.point_ledger'::regclass and tgname='point_ledger_guard_manual')<>1 then raise exception 'D1: penjaga belum terpasang'; end if;
end $check$;
