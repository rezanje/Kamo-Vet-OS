-- Demo: longgarkan gate cabang untuk buka shift kasir (staff boleh pilih cabang mana saja).
-- ponytail: prototype/demo. Untuk produksi, kembalikan ke user_can_access_branch(branch_id).
drop policy if exists shifts_all on cashier_shifts;
create policy shifts_all on cashier_shifts for all to authenticated using (true) with check (true);
