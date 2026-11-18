-- Dokter pemeriksa di antrian (Andri 17-18 Nov 2026: "antrian poli grooming gaada buat masukin sales dokter yang ngecek").
-- Antrian = baris visits. Pada poli Grooming kolom visits.doctor_id/dokter berisi GROOMER, jadi dokter yang memeriksa tidak punya tempat.
-- Kolom baru visits.pemeriksa_id (opsional) menampung dokter itu; doctor_id/dokter TIDAK berubah artinya ("Ubah dokter PJ" tidak disentuh).
-- Hanya mencatat: tidak menulis baris tagihan, komisi, atau kunjungan lama.

alter table public.visits add column pemeriksa_id uuid references public.employees(id) on delete set null;
comment on column public.visits.pemeriksa_id is 'Dokter pemeriksa yang dipilih saat pendaftaran antrian (opsional; dipakai poli Grooming, yang kolom doctor_id-nya berisi groomer). Tidak mengubah visits.doctor_id/dokter.';
create index visits_pemeriksa_id_idx on public.visits(pemeriksa_id) where pemeriksa_id is not null;

-- Pemeriksa harus karyawan aktif, berjabatan dokter (bukan paramedis; aturan yang sama dengan clinicalRoles('doctor') di aplikasi),
-- dan bertugas di cabang kunjungan (cabang utama atau penugasan yang sedang berlaku). Setelah kunjungan ditagih atau diarsipkan
-- pemeriksa tidak boleh diganti ke orang lain; mengosongkan (karyawan dihapus lewat FK) tetap boleh.
create function clinic_private.guard_visit_pemeriksa() returns trigger
language plpgsql security definer set search_path='' as $$
declare e record; today date:=(now() at time zone 'Asia/Jakarta')::date;
begin
 if new.pemeriksa_id is null then return new; end if;
 if tg_op='UPDATE' and new.pemeriksa_id is not distinct from old.pemeriksa_id then return new; end if;
 if tg_op='UPDATE' then
  if old.archived_at is not null then
   raise exception using errcode='P0001',message='PEMERIKSA_TERKUNCI: kunjungan sudah diarsipkan; dokter pemeriksa tidak dapat diganti';
  end if;
  if exists(select 1 from public.invoices i where i.visit_id=new.id and i.voided_at is null) then
   raise exception using errcode='P0001',message='PEMERIKSA_TERKUNCI: kunjungan sudah memiliki tagihan; dokter pemeriksa tidak dapat diganti';
  end if;
 end if;
 select id,status,jabatan,branch_id,trashed_at into e from public.employees where id=new.pemeriksa_id;
 if not found or e.status is distinct from 'Aktif' or e.trashed_at is not null then
  raise exception using errcode='P0001',message='PEMERIKSA_TIDAK_VALID: dokter pemeriksa harus karyawan aktif';
 end if;
 if coalesce(e.jabatan,'') !~* '(dokter|doctor|drh|\ydr\s+hewan\y)'
  or coalesce(e.jabatan,'') ~* '(paramedis|perawat|nurse|asisten.*(dokter|doctor)|vet.*technician)' then
  raise exception using errcode='P0001',message='PEMERIKSA_BUKAN_DOKTER: dokter pemeriksa harus berjabatan dokter';
 end if;
 if e.branch_id is distinct from new.branch_id and not exists(
   select 1 from public.employee_branch_assignments a
   where a.employee_id=e.id and a.branch_id=new.branch_id and a.effective_date<=today and (a.end_date is null or a.end_date>=today)) then
  raise exception using errcode='P0001',message='PEMERIKSA_BUKAN_CABANG: dokter pemeriksa harus bertugas di cabang kunjungan';
 end if;
 return new;
end $$;
revoke all on function clinic_private.guard_visit_pemeriksa() from public,anon,authenticated,service_role;
create trigger b2_guard_visit_pemeriksa before insert or update of pemeriksa_id on public.visits
 for each row execute function clinic_private.guard_visit_pemeriksa();

-- Karyawan di Sampah tidak boleh dijadikan referensi baru (sama dengan doctor_id/service_provider_id).
create trigger master_ref_employees_pemeriksa_id before insert or update on public.visits
 for each row execute function public.guard_trashed_master_reference('employees','pemeriksa_id');

-- Pagar Admin Online (#549): fungsi SECURITY DEFINER baru diberi penjaga deny_admin_online(). Idempotent.
select admin_online_private.guard_all();
select admin_online_private.fence_all();
