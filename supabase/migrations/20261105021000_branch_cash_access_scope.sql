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
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active and p.role in ('OWNER','ADMIN'))
);
create policy cash_accounts_owner_update on public.cash_accounts for update to authenticated using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active and p.role in ('OWNER','ADMIN'))
) with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active and p.role in ('OWNER','ADMIN'))
);
create policy cash_accounts_owner_delete on public.cash_accounts for delete to authenticated using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active and p.role in ('OWNER','ADMIN'))
);

-- The existing coa_read/coa_write policies are permissive. A restrictive
-- SELECT policy hides other branches' Kas Toko names and IDs from the Data API,
-- including direct Buku Besar requests. Central/general cash (110001-110003)
-- remains visible until its ownership policy is explicitly decided.
create policy coa_branch_cash_scope on public.coa_accounts as restrictive
for select to authenticated using (
  not (code ~ '^110(00[4-9]|01[0-9]|02[01])$')
  or public.has_role_capability('all_branches')
  or exists (
    select 1 from public.cash_accounts c
    where c.coa_code = coa_accounts.code and c.branch_id is not null
      and public.user_can_access_branch(c.branch_id)
  )
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
  public.has_role_capability('all_branches')
  or (branch_id is not null and public.user_can_access_branch(branch_id))
);
create policy journal_entries_scoped_insert on public.journal_entries for insert to authenticated with check (
  public.has_role_capability('all_branches')
  or (branch_id is not null and public.user_can_access_branch(branch_id))
);
create policy journal_entries_global_update on public.journal_entries for update to authenticated using (
  public.has_role_capability('all_branches')
) with check (public.has_role_capability('all_branches'));
-- postJournal removes an empty header when its single bulk line INSERT fails.
create policy journal_entries_empty_delete on public.journal_entries for delete to authenticated using (
  public.has_role_capability('all_branches')
  or (branch_id is not null and public.user_can_access_branch(branch_id)
      and not exists (select 1 from public.journal_lines l where l.entry_id = journal_entries.id))
);

-- A user assigned to two branches must not move a posted journal header after
-- its cash lines were checked against the original branch.
create function public.guard_posted_journal_branch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.branch_id is distinct from new.branch_id
    and exists (select 1 from public.journal_lines l where l.entry_id = old.id) then
    raise exception 'JOURNAL_BRANCH_FIXED: cabang jurnal yang sudah berisi baris tidak dapat diganti'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_posted_journal_branch() from public, anon, authenticated, service_role;
create trigger journal_entries_posted_branch_guard
before update of branch_id on public.journal_entries
for each row execute function public.guard_posted_journal_branch();

drop policy if exists jl_all on public.journal_lines;
create policy journal_lines_scoped_read on public.journal_lines for select to authenticated using (
  exists (select 1 from public.journal_entries e where e.id = entry_id)
);
-- The header alone cannot authorize a cash line: a branch user could submit
-- another branch's COA UUID directly through the Data API.
create function public.journal_line_cash_write_allowed(p_entry uuid, p_account uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_role_capability('all_branches') or exists (
    select 1 from public.journal_entries e
    join public.coa_accounts c on c.id = p_account
    where e.id = p_entry and e.branch_id is not null
      and public.user_can_access_branch(e.branch_id)
      and (
        c.code !~ '^110[0-9]{3}$'
        or exists (
          select 1 from public.cash_accounts a
          where a.coa_code = c.code and a.branch_id = e.branch_id
            and a.jenis = 'Kas' and a.is_active
            and public.branch_cash_matches(a.coa_code, e.branch_id)
        )
      )
  );
$$;
revoke all on function public.journal_line_cash_write_allowed(uuid, uuid) from public, anon, service_role;
grant execute on function public.journal_line_cash_write_allowed(uuid, uuid) to authenticated;
create policy journal_lines_scoped_insert on public.journal_lines for insert to authenticated with check (
  exists (select 1 from public.journal_entries e where e.id = entry_id)
  and public.journal_line_cash_write_allowed(entry_id, account_id)
);
create policy journal_lines_global_update on public.journal_lines for update to authenticated using (
  public.has_role_capability('all_branches')
) with check (public.has_role_capability('all_branches'));
create policy journal_lines_global_delete on public.journal_lines for delete to authenticated using (
  public.has_role_capability('all_branches')
);
