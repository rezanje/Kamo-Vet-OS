-- Demo: longgarkan branch-gate pada rantai transaksi klinik (visits → medical_records/
-- invoices/compounding), konsisten dgn 0024/0025 di sisi POS — shift klinik udah boleh
-- dibuka di cabang mana pun (0024), tapi visits_write dkk masih strict
-- user_can_access_branch() sehingga staff kena "row violates row-level security policy"
-- pas registrasi pasien di cabang yang bukan assignment user_branches-nya.
-- ponytail: PROTOTYPE ONLY — produksi kembalikan ke user_can_access_branch(v.branch_id).

drop policy if exists visits_select on visits;
drop policy if exists visits_write on visits;
create policy visits_all on visits for all to authenticated using (true) with check (true);

drop policy if exists mr_all on medical_records;
create policy mr_all on medical_records for all to authenticated using (true) with check (true);

drop policy if exists pi_all on prescription_items;
create policy pi_all on prescription_items for all to authenticated using (true) with check (true);

drop policy if exists inv_all on invoices;
create policy inv_all on invoices for all to authenticated using (true) with check (true);

drop policy if exists invit_all on invoice_items;
create policy invit_all on invoice_items for all to authenticated using (true) with check (true);

drop policy if exists cr_all on compounding_recipes;
create policy cr_all on compounding_recipes for all to authenticated using (true) with check (true);

drop policy if exists ci_all on compounding_ingredients;
create policy ci_all on compounding_ingredients for all to authenticated using (true) with check (true);
