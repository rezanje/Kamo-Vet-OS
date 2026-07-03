-- Addendum §7: audit log edit invoice + void & reissue.
create table invoice_edit_log (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  edited_by uuid references profiles(id) on delete set null,
  field_changed text not null,
  old_value text,
  new_value text,
  reason text,
  edited_at timestamptz not null default now()
);
create index on invoice_edit_log(invoice_id);
alter table invoice_edit_log enable row level security;
create policy iel_sel on invoice_edit_log for select to authenticated using (true);
create policy iel_ins on invoice_edit_log for insert to authenticated with check (true);
-- append-only: sengaja tanpa policy update/delete (audit trail finansial).

alter table invoices
  add column voided_at timestamptz,
  add column reissued_from uuid references invoices(id) on delete set null;
-- void & reissue butuh >1 invoice per visit; unique hanya untuk invoice aktif.
alter table invoices drop constraint invoices_visit_id_key;
create unique index invoices_visit_active_key on invoices(visit_id) where voided_at is null;
