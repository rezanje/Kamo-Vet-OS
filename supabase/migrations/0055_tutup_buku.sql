-- Tutup Buku & Kunci Periode — ala Accurate
-- Kunci: jurnal bertanggal <= closed_until tidak bisa ditambah/diubah/dihapus (DB trigger,
-- berlaku ke SEMUA jalur kode). Tutup buku: jurnal penutup P&L -> 3201 Laba Ditahan.

-- Singleton pengaturan kunci periode.
create table accounting_locks (
  id boolean primary key default true check (id),
  closed_until date,
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into accounting_locks (id) values (true);

alter table accounting_locks enable row level security;
create policy alock_all on accounting_locks for all to authenticated using (true) with check (true);

-- Guard jurnal: tolak mutasi entri di periode terkunci.
create or replace function public.check_period_lock() returns trigger
language plpgsql as $$
declare v_closed date;
begin
  select closed_until into v_closed from accounting_locks where id;
  if v_closed is null then
    return coalesce(new, old);
  end if;
  if (tg_op in ('INSERT','UPDATE') and new.tanggal <= v_closed)
     or (tg_op in ('UPDATE','DELETE') and old.tanggal <= v_closed) then
    raise exception 'Periode s/d % sudah ditutup — jurnal terkunci', v_closed;
  end if;
  return coalesce(new, old);
end $$;

create trigger journal_entries_period_lock
before insert or update or delete on journal_entries
for each row execute function public.check_period_lock();

-- Guard baris jurnal (ubah baris entri lama juga ditolak).
create or replace function public.check_period_lock_lines() returns trigger
language plpgsql as $$
declare v_closed date; v_tanggal date;
begin
  select closed_until into v_closed from accounting_locks where id;
  if v_closed is null then
    return coalesce(new, old);
  end if;
  select tanggal into v_tanggal from journal_entries where id = coalesce(new.entry_id, old.entry_id);
  if v_tanggal is not null and v_tanggal <= v_closed then
    raise exception 'Periode s/d % sudah ditutup — baris jurnal terkunci', v_closed;
  end if;
  return coalesce(new, old);
end $$;

create trigger journal_lines_period_lock
before insert or update or delete on journal_lines
for each row execute function public.check_period_lock_lines();
