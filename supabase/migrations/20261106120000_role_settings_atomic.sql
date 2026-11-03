-- Existing Akses Grup, checkpoint 1. No existing role configuration is rewritten.
-- Original capability consumers and business functions/policies remain untouched.
create schema if not exists role_settings_private;
revoke all on schema role_settings_private from public, anon, authenticated, service_role;

-- Planned inventory only: activation belongs to separately proven domain candidates.
create table role_settings_private.action_catalog (
 id text primary key, label text not null, "group" text not null, enforced boolean not null default false
);
create table role_settings_private.action_policies (
 role public.user_role primary key check(role<>'OWNER'), allowed text[] not null
);
create table role_settings_private.epochs (
 role public.user_role primary key, epoch bigint not null default 0 check(epoch>=0)
);
insert into role_settings_private.epochs(role) values('OWNER'),('ADMIN'),('FINANCE'),('STAFF'),('DOCTOR');
insert into role_settings_private.action_catalog(id,label,"group",enforced) values
('bank.cash_dashboard.view_balance_history','Lihat saldo dan riwayat — Ringkasan kas dan bank','Kas & Bank',false),
('bank.cash_accounts.view_balance_history','Lihat saldo dan riwayat — Rekening kas dan bank','Kas & Bank',false),
('bank.payment_mapping.view_balance_history','Lihat saldo dan riwayat — Peta rekening pembayaran','Kas & Bank',false),
('bank.cash_transfer.view_balance_history','Lihat saldo dan riwayat — Transfer bank','Kas & Bank',false),
('bank.cash_ledger.view_balance_history','Lihat saldo dan riwayat — Buku kas','Kas & Bank',false),
('bank.cash_entry.view_history','Lihat riwayat — Transaksi kas','Kas & Bank',false),
('bank.ap.view_aging','Lihat umur saldo — Hutang','Kas & Bank',false),
('bank.ap.view_subledger','Lihat buku pembantu — Hutang','Kas & Bank',false),
('bank.ar.view_aging','Lihat umur saldo — Piutang','Kas & Bank',false),
('bank.ar.view_subledger','Lihat buku pembantu — Piutang','Kas & Bank',false),
('bank.bank_reconciliation.view_history','Lihat riwayat — Rekonsiliasi bank','Kas & Bank',false),
('bank.cash_accounts.create','Buat — Rekening kas dan bank','Kas & Bank',false),
('bank.cash_accounts.activate_deactivate','Aktifkan atau nonaktifkan — Rekening kas dan bank','Kas & Bank',false),
('bank.cash_accounts.rename_via_coa','Ubah nama melalui daftar akun — Rekening kas dan bank','Kas & Bank',false),
('bank.payment_mapping.set_global','Atur rekening umum — Peta rekening pembayaran','Kas & Bank',false),
('bank.payment_mapping.set_branch','Atur rekening cabang — Peta rekening pembayaran','Kas & Bank',false),
('bank.payment_mapping.delete','Hapus — Peta rekening pembayaran','Kas & Bank',false),
('bank.cash_entry_masuk.create_and_post','Buat dan bukukan — Kas masuk','Kas & Bank',false),
('bank.cash_entry_keluar.create_and_post','Buat dan bukukan — Kas keluar','Kas & Bank',false),
('bank.cash_entry.void','Batalkan pembukuan — Transaksi kas','Kas & Bank',false),
('bank.cash_entry.edit','Ubah — Transaksi kas','Kas & Bank',false),
('bank.cash_transfer.create','Buat — Transfer bank','Kas & Bank',false),
('bank.cash_transfer.edit','Ubah — Transfer bank','Kas & Bank',false),
('bank.cash_transfer.void','Batalkan pembukuan — Transfer bank','Kas & Bank',false),
('bank.cash_transfer.recover','Pulihkan — Transfer bank','Kas & Bank',false),
('bank.monetary_opening.preview','Pratinjau — Saldo awal keuangan','Kas & Bank',false),
('bank.monetary_opening.correct_and_post','Koreksi dan bukukan — Saldo awal keuangan','Kas & Bank',false),
('bank.bank_reconciliation.create','Buat — Rekonsiliasi bank','Kas & Bank',false),
('bank.bank_reconciliation.edit','Ubah — Rekonsiliasi bank','Kas & Bank',false),
('bank.bank_reconciliation.void','Batalkan pembukuan — Rekonsiliasi bank','Kas & Bank',false),
('bank.bank_reconciliation.recover','Pulihkan — Rekonsiliasi bank','Kas & Bank',false),
('bank.ar_clinic.receive_payment','Terima pembayaran — Piutang klinik','Kas & Bank',false),
('bank.ar_wholesale.receive_payment','Terima pembayaran — Piutang grosir','Kas & Bank',false),
('bank.ar_wholesale.cancel_receipt','Batalkan penerimaan — Piutang grosir','Kas & Bank',false),
('bank.ap.pay_invoice','Bayar tagihan — Hutang','Kas & Bank',false),
('bank.ap.cancel_payment','Batalkan pembayaran — Hutang','Kas & Bank',false),
('bank.ap_payment_order.create','Buat — Perintah pembayaran hutang','Kas & Bank',false),
('bank.ap_payment_order.approve','Setujui — Perintah pembayaran hutang','Kas & Bank',false),
('bank.ap_payment_order.cancel','Batalkan — Perintah pembayaran hutang','Kas & Bank',false),
('bank.ap_payment_order.pay','Bayar — Perintah pembayaran hutang','Kas & Bank',false),
('bank.refund_sales.claim','Ambil penanganan — Pengembalian penjualan','Kas & Bank',false),
('bank.refund_sales.complete','Selesaikan — Pengembalian penjualan','Kas & Bank',false),
('bank.refund_sales.cancel','Batalkan — Pengembalian penjualan','Kas & Bank',false),
('bank.refund_clinic.claim','Ambil penanganan — Pengembalian klinik','Kas & Bank',false),
('bank.refund_clinic.complete','Selesaikan — Pengembalian klinik','Kas & Bank',false),
('bank.refund_clinic.cancel','Batalkan — Pengembalian klinik','Kas & Bank',false),
('bank.refund_queue.view_office','Lihat antrean kantor — Antrean pengembalian','Kas & Bank',false),
('bank.expense_cash.create_and_post','Buat dan bukukan — Biaya tunai','Kas & Bank',false),
('bank.expense_cash.edit','Ubah — Biaya tunai','Kas & Bank',false),
('bank.expense_cash.void','Batalkan pembukuan — Biaya tunai','Kas & Bank',false),
('bank.expense_cash.recover','Pulihkan — Biaya tunai','Kas & Bank',false),
('bank.cash_ledger.print','Cetak — Buku kas','Kas & Bank',false),
('bank.cash_flow_report.export_csv','Unduh CSV — Laporan arus kas','Kas & Bank',false),
('bank.cash_flow_report.export_xlsx','Unduh Excel — Laporan arus kas','Kas & Bank',false),
('bank.cash_flow_report.print_pdf','Cetak PDF — Laporan arus kas','Kas & Bank',false),
('bank.cash_approval.approve','Setujui — Persetujuan kas','Kas & Bank',false),
('bank.cash_approval.reject','Tolak — Persetujuan kas','Kas & Bank',false),
('bank.cash_approval.configure_rules','Atur aturan persetujuan — Persetujuan kas','Kas & Bank',false),
('bank.ar_subledger.export_csv','Unduh CSV — Buku pembantu piutang','Kas & Bank',false),
('bank.ar_subledger.export_xlsx','Unduh Excel — Buku pembantu piutang','Kas & Bank',false),
('bank.ar_subledger.print_pdf','Cetak PDF — Buku pembantu piutang','Kas & Bank',false),
('bank.ap_subledger.export_csv','Unduh CSV — Buku pembantu hutang','Kas & Bank',false),
('bank.ap_subledger.export_xlsx','Unduh Excel — Buku pembantu hutang','Kas & Bank',false),
('bank.ap_subledger.print_pdf','Cetak PDF — Buku pembantu hutang','Kas & Bank',false),
('people.simpanAbsensi','Simpan absensi','Karyawan & Pengguna',false),
('people.ajukanCuti','Ajukan cuti','Karyawan & Pengguna',false),
('people.updateLeaveStatus','Ubah status cuti','Karyawan & Pengguna',false),
('people.simpanJadwal','Simpan jadwal','Karyawan & Pengguna',false),
('people.simpanKaryawan','Simpan karyawan','Karyawan & Pengguna',false),
('people.simpanPenugasanCabang','Simpan penugasan cabang','Karyawan & Pengguna',false),
('people.akhiriPenugasanCabang','Akhiri penugasan cabang','Karyawan & Pengguna',false),
('people.setCabangUtamaMassal','Atur cabang utama sekaligus','Karyawan & Pengguna',false),
('people.editKaryawan','Ubah karyawan','Karyawan & Pengguna',false),
('people.imporKaryawanExcel','Impor karyawan dari Excel','Karyawan & Pengguna',false),
('people.simpanKomponen','Simpan komponen gaji','Karyawan & Pengguna',false),
('people.toggleKomponen','Aktifkan atau nonaktifkan komponen gaji','Karyawan & Pengguna',false),
('people.pasangKomponen','Pasang komponen gaji','Karyawan & Pengguna',false),
('people.lepasKomponen','Lepas komponen gaji','Karyawan & Pengguna',false),
('people.simpanTemplateSlip','Simpan templat slip gaji','Karyawan & Pengguna',false),
('people.pasangKomponenTemplate','Pasang komponen templat slip','Karyawan & Pengguna',false),
('people.lepasKomponenTemplate','Lepas komponen templat slip','Karyawan & Pengguna',false),
('people.pasangTemplateKaryawan','Pasang templat karyawan','Karyawan & Pengguna',false),
('people.simpanKpi','Simpan penilaian kinerja','Karyawan & Pengguna',false),
('people.setujuiLembur','Setujui lembur','Karyawan & Pengguna',false),
('people.tolakLembur','Tolak lembur','Karyawan & Pengguna',false),
('people.setujuiReimburse','Setujui penggantian biaya','Karyawan & Pengguna',false),
('people.tolakReimburse','Tolak penggantian biaya','Karyawan & Pengguna',false),
('people.tolakKasbon','Tolak kasbon','Karyawan & Pengguna',false),
('people.setujuiKasbon','Setujui kasbon','Karyawan & Pengguna',false),
('people.hitungPenggajian','Hitung penggajian','Karyawan & Pengguna',false),
('people.simpanKoreksi','Simpan koreksi gaji','Karyawan & Pengguna',false),
('people.sahkanPenggajian','Sahkan penggajian','Karyawan & Pengguna',false),
('people.simpanShift','Simpan shift kerja','Karyawan & Pengguna',false),
('people.toggleShift','Aktifkan atau nonaktifkan shift kerja','Karyawan & Pengguna',false),
('people.simpanAturanGaji','Simpan aturan gaji','Karyawan & Pengguna',false),
('people.buatPengguna','Buat akun pengguna','Karyawan & Pengguna',false),
('people.togglePengguna','Aktifkan atau nonaktifkan akun pengguna','Karyawan & Pengguna',false),
('people.tautkanPengguna','Tautkan akun pengguna','Karyawan & Pengguna',false),
('people.simpanEditPengguna','Simpan perubahan akun pengguna','Karyawan & Pengguna',false),
('people.employee_directory_read','Lihat daftar dan pencarian karyawan','Karyawan & Pengguna',false),
('people.employee_detail_read','Lihat rincian karyawan','Karyawan & Pengguna',false),
('people.salary_read','Lihat gaji dan penggajian','Karyawan & Pengguna',false),
('people.employee_base_salary_write','Atur gaji pokok karyawan','Karyawan & Pengguna',false),
('people.employee_activate','Aktifkan karyawan','Karyawan & Pengguna',false),
('people.employee_deactivate','Nonaktifkan karyawan','Karyawan & Pengguna',false),
('people.employee_trash','Pindahkan karyawan ke sampah','Karyawan & Pengguna',false),
('people.employee_restore','Pulihkan karyawan','Karyawan & Pengguna',false),
('people.login_accounts_list','Lihat daftar akun pengguna','Karyawan & Pengguna',false),
('people.account_edit_read_audit','Lihat rincian perubahan dan audit akun','Karyawan & Pengguna',false),
('people.account_branch_direct_assign','Atur atau hapus penugasan cabang akun','Karyawan & Pengguna',false),
('people.hris_absensi_read','Lihat absensi','Karyawan & Pengguna',false),
('people.hris_jadwal_read','Lihat jadwal kerja','Karyawan & Pengguna',false),
('people.hris_shift_read','Lihat shift kerja','Karyawan & Pengguna',false),
('people.hris_cuti_read','Lihat cuti','Karyawan & Pengguna',false),
('people.hris_kpi_read','Lihat penilaian kinerja','Karyawan & Pengguna',false),
('people.hris_pengajuan_read','Lihat pengajuan karyawan','Karyawan & Pengguna',false);
revoke all on all tables in schema role_settings_private from public,anon,authenticated,service_role;
alter table role_settings_private.action_catalog enable row level security;
alter table role_settings_private.action_policies enable row level security;
alter table role_settings_private.epochs enable row level security;

create function role_settings_private.snapshot(p_role text) returns jsonb
language sql stable security definer set search_path='' set timezone='UTC' as $$
 with catalogue as (
 select array['dashboard','klinik','crm','hris','pengaturan','perusahaan','buku-besar','kas-bank','penjualan','pembelian','pos','aset-tetap','pajak','laporan','kasir','quest-staff','pos-shift']::text[] ids
 ), saved as (
 select coalesce(jsonb_agg(to_jsonb(m) order by m.module_id),'[]'::jsonb) raw,
 coalesce(array_agg(m.module_id::text order by m.module_id),array[]::text[]) ids
 from public.role_modules m where m.role::text=p_role
 ), caps as (
 select (select to_jsonb(c) from public.role_capabilities c where c.role::text=p_role) raw
 ), effective as (
 select s.raw modules_raw,c.raw caps_raw,s.ids saved_ids,
 case when '__role_v2__'=any(s.ids) then 'custom' when cardinality(s.ids)>0 then 'legacy' else 'defaults' end source,
 case when cardinality(s.ids)=0 then
   case p_role when 'STAFF' then array['klinik','kasir','quest-staff']::text[]
   when 'FINANCE' then array['dashboard','buku-besar','kas-bank','aset-tetap','pajak','laporan','pos-shift']::text[]
   else cat.ids end
 when '__role_v2__'=any(s.ids) then s.ids
 else s.ids || case when p_role in ('STAFF','DOCTOR') then array['kasir','quest-staff'] else array[]::text[] end
 || case when 'pos'=any(s.ids) then array['quest-staff','pos-shift'] else array[]::text[] end
 || case when p_role='FINANCE' then array['pos-shift'] else array[]::text[] end end ids
 from saved s cross join caps c cross join catalogue cat
 )
 select jsonb_build_object('role',p_role,'revision',md5(jsonb_build_object('modules',e.modules_raw,'capability',e.caps_raw,'actions',(select to_jsonb(a) from role_settings_private.action_policies a where a.role::text=p_role),'epoch',(select epoch from role_settings_private.epochs where role::text=p_role))::text),
 'source',e.source,'modules',(select coalesce(jsonb_agg(id order by ord),'[]') from catalogue c,unnest(c.ids) with ordinality u(id,ord) where id=any(e.ids)),
 'capabilities',jsonb_build_object('all_branches',coalesce((e.caps_raw->>'all_branches')::boolean,p_role in ('ADMIN','FINANCE')),
 'create_accounts',coalesce((e.caps_raw->>'create_accounts')::boolean,p_role='ADMIN')),
 'actions',jsonb_build_object('source',case when exists(select 1 from role_settings_private.action_policies a where a.role::text=p_role) then 'custom' else 'legacy' end,
 'allowed',coalesce((select to_jsonb(a.allowed) from role_settings_private.action_policies a where a.role::text=p_role),'[]'::jsonb)))
 from effective e;
$$;
revoke all on function role_settings_private.snapshot(text) from public,anon,authenticated,service_role;

create table role_settings_private.audit (
 id uuid primary key default gen_random_uuid(),
 role public.user_role not null,
 created_at timestamptz not null default clock_timestamp(),
 created_by uuid not null,
 reason text not null,
 before jsonb not null,
 after jsonb not null
);
create table role_settings_private.requests (
 request_key uuid primary key,
 actor uuid not null,
 payload jsonb not null,
 result jsonb not null
);
revoke all on all tables in schema role_settings_private from public,anon,authenticated,service_role;
alter table role_settings_private.audit enable row level security;
alter table role_settings_private.requests enable row level security;

create function public.get_role_access_config(p_role text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_owner boolean; v_result jsonb;
begin
 if p_role is null or p_role not in ('ADMIN','FINANCE','STAFF','DOCTOR') then raise exception 'ROLE_SCOPE_INVALID'; end if;
 if auth.role() is distinct from 'authenticated' then raise exception 'ROLE_AUTH_REQUIRED'; end if;
 select p.role='OWNER' into v_owner from public.profiles p where p.id=auth.uid() and p.is_active;
 if v_owner is null then raise exception 'ROLE_AUTH_REQUIRED'; end if;
 v_result:=role_settings_private.snapshot(p_role);
 return v_result || jsonb_build_object('action_catalog',(select jsonb_agg(to_jsonb(c) order by c.id) from role_settings_private.action_catalog c),'audit',case when v_owner then
 (select coalesce(jsonb_agg(to_jsonb(a)-'role' order by a.created_at desc,a.id),'[]')
 from (select * from role_settings_private.audit where role::text=p_role order by created_at desc,id limit 50) a)
 else '[]'::jsonb end);
end $$;

revoke all on function public.get_role_access_config(text) from public,anon,service_role;
grant execute on function public.get_role_access_config(text) to authenticated;

-- Only the atomic RPC can mint transaction-local target permits. No GUC trust.
create table role_settings_private.permits (
 xid bigint not null, actor uuid not null, role public.user_role not null,
 primary key(xid,actor,role)
);
revoke all on role_settings_private.permits from public,anon,authenticated,service_role;
alter table role_settings_private.permits enable row level security;
create function role_settings_private.config_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_role public.user_role;
begin
 -- Explicit native DBA maintenance only; API service_role is NOT a DBA.
 if auth.uid() is null and auth.role() is null
 and current_setting('role') in ('none','postgres')
 and exists(select 1 from pg_roles where rolname=session_user and rolsuper) then
   if tg_op='DELETE' then return old; else return new; end if;
 end if;
 if tg_op='TRUNCATE' then raise exception 'Pengaturan akses berubah; muat ulang dan gunakan simpan atomik.'; end if;
 v_role:=case when tg_op='DELETE' then old.role else new.role end;
 if not exists(select 1 from role_settings_private.permits
 where xid=txid_current() and actor=auth.uid() and role=v_role)
 or (tg_op='UPDATE' and old.role<>new.role) then
 raise exception 'Pengaturan akses berubah; muat ulang dan gunakan simpan atomik.';
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function role_settings_private.config_guard() from public,anon,authenticated,service_role;
create trigger role_settings_atomic_guard before insert or update or delete on public.role_modules
 for each row execute function role_settings_private.config_guard();
create trigger role_settings_atomic_truncate_guard before truncate on public.role_modules
 for each statement execute function role_settings_private.config_guard();
create trigger role_settings_atomic_guard before insert or update or delete on public.role_capabilities
 for each row execute function role_settings_private.config_guard();
create trigger role_settings_atomic_truncate_guard before truncate on public.role_capabilities
 for each statement execute function role_settings_private.config_guard();
create trigger action_policy_guard before insert or update or delete on role_settings_private.action_policies for each row execute function role_settings_private.config_guard();
create trigger epoch_guard before insert or update or delete on role_settings_private.epochs for each row execute function role_settings_private.config_guard();
create trigger action_policy_truncate_guard before truncate on role_settings_private.action_policies for each statement execute function role_settings_private.config_guard();
create trigger epoch_truncate_guard before truncate on role_settings_private.epochs for each statement execute function role_settings_private.config_guard();
create function role_settings_private.audit_immutable() returns trigger
language plpgsql set search_path='' as $$begin raise exception 'ROLE_AUDIT_IMMUTABLE'; end $$;
revoke all on function role_settings_private.audit_immutable() from public,anon,authenticated,service_role;
create trigger role_settings_audit_immutable before update or delete or truncate on role_settings_private.audit
 for each statement execute function role_settings_private.audit_immutable();

create function public.save_role_access_config(
 p_role text,p_expected_revision text,p_request_key uuid,p_mode text,
 p_modules jsonb,p_capabilities jsonb,p_reason text,p_actions jsonb default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid; v_payload jsonb; v_cached role_settings_private.requests;
 v_before jsonb; v_after jsonb; v_audit uuid; v_result jsonb;
begin
 if p_role is null or p_role not in ('ADMIN','FINANCE','STAFF','DOCTOR') then raise exception 'ROLE_SCOPE_INVALID'; end if;
 -- Cheap active-OWNER refusal precedes every potentially expensive lock.
 if auth.role() is distinct from 'authenticated' or not exists(select 1 from public.profiles where id=auth.uid() and role='OWNER' and is_active) then raise exception 'ROLE_OWNER_REQUIRED'; end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'ROLE_RETRY_READ_COMMITTED'; end if;
 if p_expected_revision is null or p_expected_revision !~ '^[0-9a-f]{32}$' or p_request_key is null
 or p_mode is null or p_mode not in ('custom','reset') or p_reason is null or length(trim(p_reason))<3 or length(p_reason)>1000
 or p_modules is null or jsonb_typeof(p_modules)<>'array' then raise exception 'ROLE_INPUT_INVALID'; end if;
 if p_mode='custom' then
   if p_capabilities is null or jsonb_typeof(p_capabilities)<>'object'
   or not (p_capabilities ?& array['all_branches','create_accounts'])
   or p_capabilities-array['all_branches','create_accounts'] <> '{}'::jsonb
   or jsonb_typeof(p_capabilities->'all_branches')<>'boolean'
   or jsonb_typeof(p_capabilities->'create_accounts')<>'boolean'
   or exists(select 1 from jsonb_array_elements(p_modules) m where jsonb_typeof(m)<>'string'
      or m#>>'{}' not in ('dashboard','klinik','crm','hris','pengaturan','perusahaan','buku-besar','kas-bank','penjualan','pembelian','pos','aset-tetap','pajak','laporan','kasir','quest-staff','pos-shift'))
   or (select count(*)<>count(distinct m) from jsonb_array_elements(p_modules) m)
   then raise exception 'ROLE_INPUT_INVALID'; end if;
 elsif (p_actions is not null and p_actions<>'null'::jsonb) or p_modules<>'[]'::jsonb or (p_capabilities is not null and p_capabilities<>'null'::jsonb) then
   raise exception 'ROLE_RESET_INVALID';
 end if;
 -- Always-present epoch UPDATE precedes config/profile locks. Action readers
 -- take SHARE, and fresh READ COMMITTED commands follow every wait.
 perform 1 from role_settings_private.epochs where role::text=p_role for update;
 if p_mode='custom' and p_actions is not null then
   if jsonb_typeof(p_actions)<>'array' then raise exception 'ROLE_ACTION_INVALID'; end if;
   if exists(select 1 from jsonb_array_elements(p_actions) x where jsonb_typeof(x)<>'string' or not exists(select 1 from role_settings_private.action_catalog c where c.id=x#>>'{}' and c.enforced))
   or (select count(*)<>count(distinct x) from jsonb_array_elements(p_actions) x) then raise exception 'ROLE_ACTION_INVALID'; end if;
 end if;
 -- Role before global request key, never profile-row before role wait.
 perform pg_advisory_xact_lock(724061,case p_role when 'ADMIN' then 1 when 'FINANCE' then 2 when 'STAFF' then 3 else 4 end);
 perform pg_advisory_xact_lock(hashtextextended('role-settings-request:'||p_request_key::text,0));
 -- Serialize privileged maintenance/table-level waits BEFORE the authorization fence.
 lock table public.role_modules, public.role_capabilities in share row exclusive mode;
 -- Absence/active/role decisions stay true through final effects. NOWAIT avoids
 -- inversion with existing profile/account writers. Contention fails closed;
 -- retry is safe. READ COMMITTED rechecks committed revocation after every wait.
 lock table public.profiles in share mode nowait;
 v_actor:=auth.uid();
 if auth.role() is distinct from 'authenticated' or not exists(
   select 1 from public.profiles where id=v_actor and role='OWNER' and is_active)
 then raise exception 'ROLE_OWNER_REQUIRED'; end if;
 v_payload:=jsonb_build_object('role',p_role,'expected_revision',p_expected_revision,'mode',p_mode,
 'modules',p_modules,'capabilities',p_capabilities,'reason',p_reason,'actions',p_actions);
 select * into v_cached from role_settings_private.requests where request_key=p_request_key;
 if found then
   if v_cached.actor<>v_actor or v_cached.payload<>v_payload then raise exception 'ROLE_REQUEST_KEY_REUSED'; end if;
   return v_cached.result || jsonb_build_object('already_applied',true);
 end if;
 v_before:=role_settings_private.snapshot(p_role);
 if v_before->>'revision'<>p_expected_revision then raise exception 'ROLE_REVISION_CONFLICT'; end if;
 insert into role_settings_private.permits(xid,actor,role) values(txid_current(),v_actor,p_role::public.user_role);
 delete from public.role_modules where role::text=p_role;
 delete from public.role_capabilities where role::text=p_role;
 if p_mode='custom' then
   insert into public.role_modules(role,module_id) values(p_role::public.user_role,'__role_v2__');
   insert into public.role_modules(role,module_id)
   select p_role::public.user_role,m from jsonb_array_elements_text(p_modules) m;
   insert into public.role_capabilities(role,all_branches,create_accounts)
   values(p_role::public.user_role,(p_capabilities->>'all_branches')::boolean,(p_capabilities->>'create_accounts')::boolean);
 end if;
 if p_mode='reset' then
   delete from role_settings_private.action_policies where role::text=p_role;
 elsif p_actions is not null then
   insert into role_settings_private.action_policies(role,allowed)
   values(p_role::public.user_role,array(select jsonb_array_elements_text(p_actions) order by 1))
   on conflict(role) do update set allowed=excluded.allowed;
 end if;
 update role_settings_private.epochs set epoch=epoch+1 where role::text=p_role;
 v_after:=role_settings_private.snapshot(p_role);
 insert into role_settings_private.audit(role,created_by,reason,before,after)
 values(p_role::public.user_role,v_actor,p_reason,v_before,v_after) returning id into v_audit;
 v_result:=jsonb_build_object('role',p_role,'revision',v_after->>'revision','audit_id',v_audit,
 'request_key',p_request_key,'already_applied',false);
 insert into role_settings_private.requests(request_key,actor,payload,result) values(p_request_key,v_actor,v_payload,v_result);
 delete from role_settings_private.permits where xid=txid_current() and actor=v_actor and role::text=p_role;
 return v_result;
end $$;
revoke all on function public.save_role_access_config(text,text,uuid,text,jsonb,jsonb,text,jsonb) from public,anon,service_role;
grant execute on function public.save_role_access_config(text,text,uuid,text,jsonb,jsonb,text,jsonb) to authenticated;

-- Explicit dependencies derived from frozen source paths, not a generic module helper.
-- Private so domain migrations may refine supported alternate-ingress dependencies.
create table role_settings_private.action_modules (
 id text primary key references role_settings_private.action_catalog(id), module_id text not null
);
insert into role_settings_private.action_modules(id,module_id) values
('bank.cash_dashboard.view_balance_history','kas-bank'),
('bank.cash_accounts.view_balance_history','kas-bank'),
('bank.payment_mapping.view_balance_history','kas-bank'),
('bank.cash_transfer.view_balance_history','kas-bank'),
('bank.cash_ledger.view_balance_history','kas-bank'),
('bank.cash_entry.view_history','kas-bank'),
('bank.ap.view_aging','kas-bank'),
('bank.ap.view_subledger','kas-bank'),
('bank.ar.view_aging','kas-bank'),
('bank.ar.view_subledger','kas-bank'),
('bank.bank_reconciliation.view_history','kas-bank'),
('bank.cash_accounts.create','kas-bank'),
('bank.cash_accounts.activate_deactivate','kas-bank'),
('bank.cash_accounts.rename_via_coa','kas-bank'),
('bank.payment_mapping.set_global','kas-bank'),
('bank.payment_mapping.set_branch','kas-bank'),
('bank.payment_mapping.delete','kas-bank'),
('bank.cash_entry_masuk.create_and_post','kas-bank'),
('bank.cash_entry_keluar.create_and_post','kas-bank'),
('bank.cash_entry.void','kas-bank'),
('bank.cash_entry.edit','kas-bank'),
('bank.cash_transfer.create','kas-bank'),
('bank.cash_transfer.edit','kas-bank'),
('bank.cash_transfer.void','kas-bank'),
('bank.cash_transfer.recover','kas-bank'),
('bank.monetary_opening.preview','kas-bank'),
('bank.monetary_opening.correct_and_post','kas-bank'),
('bank.bank_reconciliation.create','kas-bank'),
('bank.bank_reconciliation.edit','kas-bank'),
('bank.bank_reconciliation.void','kas-bank'),
('bank.bank_reconciliation.recover','kas-bank'),
('bank.ar_clinic.receive_payment','kas-bank'),
('bank.ar_wholesale.receive_payment','kas-bank'),
('bank.ar_wholesale.cancel_receipt','kas-bank'),
('bank.ap.pay_invoice','kas-bank'),
('bank.ap.cancel_payment','kas-bank'),
('bank.ap_payment_order.create','kas-bank'),
('bank.ap_payment_order.approve','kas-bank'),
('bank.ap_payment_order.cancel','kas-bank'),
('bank.ap_payment_order.pay','kas-bank'),
('bank.refund_sales.claim','kas-bank'),
('bank.refund_sales.complete','kas-bank'),
('bank.refund_sales.cancel','kas-bank'),
('bank.refund_clinic.claim','kas-bank'),
('bank.refund_clinic.complete','kas-bank'),
('bank.refund_clinic.cancel','kas-bank'),
('bank.refund_queue.view_office','kas-bank'),
('bank.expense_cash.create_and_post','pos'),
('bank.expense_cash.edit','pos'),
('bank.expense_cash.void','pos'),
('bank.expense_cash.recover','pos'),
('bank.cash_ledger.print','kas-bank'),
('bank.cash_flow_report.export_csv','laporan'),
('bank.cash_flow_report.export_xlsx','laporan'),
('bank.cash_flow_report.print_pdf','laporan'),
('bank.cash_approval.approve','pengaturan'),
('bank.cash_approval.reject','pengaturan'),
('bank.cash_approval.configure_rules','pengaturan'),
('bank.ar_subledger.export_csv','kas-bank'),
('bank.ar_subledger.export_xlsx','kas-bank'),
('bank.ar_subledger.print_pdf','kas-bank'),
('bank.ap_subledger.export_csv','kas-bank'),
('bank.ap_subledger.export_xlsx','kas-bank'),
('bank.ap_subledger.print_pdf','kas-bank'),
('people.simpanAbsensi','hris'),
('people.ajukanCuti','hris'),
('people.updateLeaveStatus','hris'),
('people.simpanJadwal','hris'),
('people.simpanKaryawan','hris'),
('people.simpanPenugasanCabang','hris'),
('people.akhiriPenugasanCabang','hris'),
('people.setCabangUtamaMassal','hris'),
('people.editKaryawan','hris'),
('people.imporKaryawanExcel','hris'),
('people.simpanKomponen','hris'),
('people.toggleKomponen','hris'),
('people.pasangKomponen','hris'),
('people.lepasKomponen','hris'),
('people.simpanTemplateSlip','hris'),
('people.pasangKomponenTemplate','hris'),
('people.lepasKomponenTemplate','hris'),
('people.pasangTemplateKaryawan','hris'),
('people.simpanKpi','hris'),
('people.setujuiLembur','hris'),
('people.tolakLembur','hris'),
('people.setujuiReimburse','hris'),
('people.tolakReimburse','hris'),
('people.tolakKasbon','hris'),
('people.setujuiKasbon','hris'),
('people.hitungPenggajian','hris'),
('people.simpanKoreksi','hris'),
('people.sahkanPenggajian','hris'),
('people.simpanShift','hris'),
('people.toggleShift','hris'),
('people.simpanAturanGaji','pengaturan'),
('people.buatPengguna','pengaturan'),
('people.togglePengguna','pengaturan'),
('people.tautkanPengguna','pengaturan'),
('people.simpanEditPengguna','pengaturan'),
('people.employee_directory_read','hris'),
('people.employee_detail_read','hris'),
('people.salary_read','hris'),
('people.employee_base_salary_write','hris'),
('people.employee_activate','hris'),
('people.employee_deactivate','hris'),
('people.employee_trash','hris'),
('people.employee_restore','hris'),
('people.login_accounts_list','pengaturan'),
('people.account_edit_read_audit','pengaturan'),
('people.account_branch_direct_assign','perusahaan'),
('people.hris_absensi_read','hris'),
('people.hris_jadwal_read','hris'),
('people.hris_shift_read','hris'),
('people.hris_cuti_read','hris'),
('people.hris_kpi_read','hris'),
('people.hris_pengajuan_read','hris');
revoke all on role_settings_private.action_modules from public,anon,authenticated,service_role;
alter table role_settings_private.action_modules enable row level security;

-- Lock-order contract for domain writers:
-- * preserve original sorted actor+target profile row locks BEFORE invoking this
--   final fence in account writers; never introduce an actor-first row lock.
-- * original financial helpers may lock the actor FOR SHARE again. This fence
--   retains that same actor row lock, without globally blocking profiles UPDATE.
-- * actor SHARE NOWAIT fails closed/retry if an original sorted account writer
--   already owns the actor while waiting on another target. Never wait for that
--   actor or take a global profiles fence: either can invert the original writer.
-- * all role epochs SHARE are obtained in role order BEFORE the actor fence;
--   save obtains target epoch UPDATE before its config/profile locks.
create function public.role_action_allowed(p_action text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare v_role public.user_role; v_allowed text[]; v_module text;
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null then return false; end if;
 if current_setting('transaction_isolation')<>'read committed' then return false; end if;
 if not exists(select 1 from public.profiles where id=auth.uid() and is_active) then return false; end if;
 if not exists(select 1 from role_settings_private.action_catalog where id=p_action and enforced) then return false; end if;
 -- No statement-snapshot authorization after waits: each command in this
 -- VOLATILE function gets fresh READ COMMITTED state.
 perform 1 from role_settings_private.epochs order by role for share;
 select role into v_role from public.profiles where id=auth.uid() and is_active for share nowait;
 if v_role is null or not exists(select 1 from role_settings_private.action_catalog where id=p_action and enforced) then return false; end if;
 if v_role='OWNER' then return true; end if;
 select module_id into v_module from role_settings_private.action_modules where id=p_action;
 if v_module is null then return false; end if;
 if exists(select 1 from public.role_modules where role=v_role and module_id='__role_v2__')
 and not exists(select 1 from public.role_modules where role=v_role and module_id=v_module) then return false; end if;
 select allowed into v_allowed from role_settings_private.action_policies where role=v_role;
 -- This is only an additional conjunct. Legacy true is NOT an intrinsic role,
 -- branch, clinical, financial or state grant; original ceilings remain mandatory.
 return not found or p_action=any(v_allowed);
end $$;
create function public.require_role_action(p_action text) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 if not public.role_action_allowed(p_action) then
   raise exception using errcode='42501',message='ROLE_ACTION_DENIED: tindakan tidak diizinkan';
 end if;
end $$;
revoke all on function public.role_action_allowed(text),public.require_role_action(text) from public,anon,service_role;
grant execute on function public.role_action_allowed(text),public.require_role_action(text) to authenticated;
