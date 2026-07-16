-- Racikan BOM: master barang butuh bisa di-update (flag is_compound_material).
-- Sebelumnya items hanya punya policy SELECT (items_read) — UPDATE dari app kena RLS
-- (0 baris, tanpa error). Batasi write ke OWNER/ADMIN (master data admin-only,
-- selaras gate halaman /klinik/bahan-baku).
create policy items_write on items for update to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('OWNER','ADMIN')))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('OWNER','ADMIN')));
