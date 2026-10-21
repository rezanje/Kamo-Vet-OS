-- Activation precondition only. No automatic activation, journals or revaluation.
-- Preserve PR80's costing, physical FEFO, closing and already-active retry.
create function public.inventory_assert_average_activation_accounting() returns void
language plpgsql security definer set search_path='' as $$
declare inventory_account uuid;cutover_date date:=(clock_timestamp() at time zone 'Asia/Jakarta')::date;
begin
 -- Caller already owns PR80's exclusive inventory advisory lock. Ordinary GL
 -- writers do not all take that lock, and some lock journals before inventory.
 -- Never wait here with the exclusive inventory lock: an in-flight writer gets
 -- to finish, then a new activation request rechecks the complete current state.
 lock table public.stock,public.stock_layers,public.stock_moves,
  public.journal_entries,public.journal_lines,public.coa_accounts,
  public.warehouses,public.items,public.branches,public.user_branches,
  public.role_modules,public.role_capabilities in share mode nowait;
 perform 1 from public.profiles where id=auth.uid() for share nowait;
 perform public.inventory_assert_finance_actor();
 -- Also avoid waiting on an earlier SELECT FOR UPDATE that has not written yet.
 perform 1 from public.stock order by warehouse_id,item_id for update nowait;
 select id into inventory_account from public.coa_accounts
 where code='1301' and is_active and not is_header and type='ASET' and normal_balance='D';
 if inventory_account is null then
  raise exception 'Akun persediaan 1301 belum sah; rekonsiliasi sebelum aktivasi average' using errcode='23514';
 end if;
 -- There is no audited signed physical layer value for a negative opening pool.
 -- This guard changes cutover eligibility only, never postactivation oversales.
 if exists(select 1 from public.stock where qty<0) then
  raise exception 'Saldo awal negatif memerlukan rekonsiliasi qty/nilai sebelum aktivasi average' using errcode='23514';
 end if;
 if exists(select 1 from public.stock where qty::text in('NaN','Infinity','-Infinity'))
 or exists(select 1 from public.stock_layers where qty_left::text in('NaN','Infinity','-Infinity') or unit_cost::text in('NaN','Infinity','-Infinity') or unit_cost<0)
 or exists(
  select 1 from public.stock s full join
   (select warehouse_id,item_id,sum(qty_left) qty from public.stock_layers group by 1,2) l using(warehouse_id,item_id)
  where coalesce(s.qty,0)<>coalesce(l.qty,0)
 ) then
  raise exception 'Qty/nilai lapisan stok belum lengkap atau sah; rekonsiliasi sebelum aktivasi average' using errcode='23514';
 end if;
 if exists(select 1 from public.journal_lines l join public.journal_entries e on e.id=l.entry_id where l.account_id=inventory_account and e.tanggal>cutover_date) then
  raise exception 'GL persediaan bertanggal masa depan; rekonsiliasi sebelum aktivasi average' using errcode='23514';
 end if;
 -- Validate the whole journal, including its counterpart, without selecting or
 -- inventing a counterpart account. A matching one-sided debit is not evidence.
 if exists(select 1 from public.journal_lines l where l.entry_id in(select entry_id from public.journal_lines where account_id=inventory_account)
  and (l.debit<0 or l.credit<0 or (l.debit>0 and l.credit>0) or l.debit::text in('NaN','Infinity','-Infinity') or l.credit::text in('NaN','Infinity','-Infinity'))) then
  raise exception 'Nilai jurnal persediaan tidak sah; rekonsiliasi sebelum aktivasi average' using errcode='23514';
 end if;
 if exists(select 1 from public.journal_lines l where l.entry_id in(select entry_id from public.journal_lines where account_id=inventory_account)
  group by l.entry_id having abs(sum(l.debit-l.credit))>0.00000001) then
  raise exception 'Jurnal persediaan belum seimbang; rekonsiliasi sebelum aktivasi average' using errcode='23514';
 end if;
 -- Compare every branch, including inactive warehouses and legacy unallocated
 -- GL. Equal global totals cannot conceal a different branch allocation. The
 -- 1e-8 Rupiah tolerance covers numeric division noise, not cent rounding.
 if exists(
  with physical as (
   select w.branch_id,sum(l.qty_left*l.unit_cost) value from public.stock_layers l
   join public.warehouses w on w.id=l.warehouse_id group by w.branch_id
  ),ledger as (
   select e.branch_id,sum(l.debit-l.credit) value from public.journal_lines l
   join public.journal_entries e on e.id=l.entry_id where l.account_id=inventory_account group by e.branch_id
  )
  select 1 from physical p full join ledger g using(branch_id)
  where abs(coalesce(p.value,0)-coalesce(g.value,0))>0.00000001
 ) then
  raise exception 'Nilai persediaan belum cocok dengan GL 1301 per cabang; aktivasi diblokir. Selesaikan rekonsiliasi saldo/jurnal historis secara terpisah; akun lawan harus ditinjau, bukan ditebak.' using errcode='23514';
 end if;
exception when lock_not_available then
 raise exception 'Ada transaksi atau perubahan akses yang masih berjalan. Tunggu selesai, muat ulang status, lalu coba aktivasi lagi.' using errcode='55P03';
end $$;
revoke all on function public.inventory_assert_average_activation_accounting() from public,anon,authenticated,service_role;

-- Fail installation if the independently released activation changed shape.
-- Keep its OID, ACL, actor check, FIFO default and idempotent active-state return.
do $$declare definition text;anchor text:=' if exists(select 1 from public.stock_moves where tanggal>(stamp at time zone ''Asia/Jakarta'')::date) then';
begin
 select pg_get_functiondef('public.activate_moving_average()'::regprocedure) into definition;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
  raise exception 'Unexpected average activation baseline; review accounting guard integration';
 end if;
 execute replace(definition,anchor,E' perform public.inventory_assert_average_activation_accounting();\n'||anchor);
end $$;
