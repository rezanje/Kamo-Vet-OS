-- Prepared for owner review: restrict branch staff to their own cash and
-- journals. Do not apply until branch cash mappings and access policy are approved.
-- OWNER, ADMIN and FINANCE retain their existing all_branches capability.

drop policy if exists cash_accounts_all on public.cash_accounts;
create policy cash_accounts_scoped_read on public.cash_accounts for select to authenticated using (
  public.has_role_capability('all_branches')
  or (branch_id is not null and public.user_can_access_branch(branch_id))
  or (jenis = 'Bank' and branch_id is null)
);
create policy cash_accounts_owner_insert on public.cash_accounts for insert to authenticated with check (
  public.has_role_capability('create_accounts')
);
create policy cash_accounts_owner_update on public.cash_accounts for update to authenticated using (
  public.has_role_capability('create_accounts')
) with check (public.has_role_capability('create_accounts'));
create policy cash_accounts_owner_delete on public.cash_accounts for delete to authenticated using (
  public.has_role_capability('create_accounts')
);

drop policy if exists payment_account_map_all on public.payment_account_map;
create policy payment_account_map_scoped_read on public.payment_account_map for select to authenticated using (
  public.has_role_capability('all_branches')
  or (branch_id is not null and public.user_can_access_branch(branch_id))
  or (branch_id is null and metode <> 'Tunai')
);
create policy payment_account_map_global_write on public.payment_account_map for all to authenticated using (
  public.has_role_capability('all_branches')
) with check (public.has_role_capability('all_branches'));

-- The existing opening journal has branch_id NULL and contains every branch's
-- cash. Branch users must not read its lines directly through the API.
drop policy if exists je_all on public.journal_entries;
create policy journal_entries_scoped_read on public.journal_entries for select to authenticated using (
  (branch_id is not null and public.user_can_access_branch(branch_id))
  or (branch_id is null and public.has_role_capability('all_branches'))
);
create policy journal_entries_scoped_write on public.journal_entries for all to authenticated using (
  (branch_id is not null and public.user_can_access_branch(branch_id))
  or (branch_id is null and public.has_role_capability('all_branches'))
) with check (
  (branch_id is not null and public.user_can_access_branch(branch_id))
  or (branch_id is null and public.has_role_capability('all_branches'))
);

drop policy if exists jl_all on public.journal_lines;
create policy journal_lines_scoped_read on public.journal_lines for select to authenticated using (
  exists (select 1 from public.journal_entries e where e.id = entry_id)
);
create policy journal_lines_scoped_write on public.journal_lines for all to authenticated using (
  exists (select 1 from public.journal_entries e where e.id = entry_id)
) with check (
  exists (select 1 from public.journal_entries e where e.id = entry_id)
);
