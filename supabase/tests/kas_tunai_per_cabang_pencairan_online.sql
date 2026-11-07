-- Fictional fixtures only; never execute on a production database.
-- Runs after scripts/test-kas-cabang-pencairan-online-postgres.py seeded branches and re-applied
-- 20261107010000_kas_tunai_per_cabang_pencairan_online.sql.
begin;

-- ---------------------------------------------------------------- 1. Kas tunai per cabang
do $$ begin
  -- Each Kas Toko account became a Kas rekening owned by its branch.
  if (select count(*) from cash_accounts c join branches b on b.id = c.branch_id
      where c.jenis = 'Kas' and c.coa_code between '110004' and '110021') <> 16 then
    raise exception 'expected 16 branch kas rekening, got %',
      (select count(*) from cash_accounts where coa_code between '110004' and '110021');
  end if;
  if (select b.code from cash_accounts c join branches b on b.id = c.branch_id where c.coa_code = '110007') <> 'CMGG' then
    raise exception '110007 must belong to CMGG';
  end if;
  if (select b.code from cash_accounts c join branches b on b.id = c.branch_id where c.coa_code = '110005') <> 'CIAW' then
    raise exception '110005 Kas Toko CIAWI must belong to branch code CIAW';
  end if;
  if (select b.code from cash_accounts c join branches b on b.id = c.branch_id where c.coa_code = '110018') <> 'VET_GRDA' then
    raise exception '110018 must belong to VET_GRDA';
  end if;
  -- Branch without its own kas (LOJI) and an account without a branch (110021 VET_GRND) are skipped.
  if exists (select 1 from cash_accounts where coa_code = '110021') then raise exception '110021 must be skipped (no VET_GRND branch)'; end if;
  -- Tunai now resolves to the branch kas in every posting helper.
  if public.unit_posting_cash('Tunai', (select id from branches where code = 'CMGG')) <> '110007' then
    raise exception 'CMGG cash must go to 110007, got %', public.unit_posting_cash('Tunai', (select id from branches where code = 'CMGG'));
  end if;
  if public.unit_posting_cash('Tunai', (select id from branches where code = 'VET_CMGG')) <> '110014' then
    raise exception 'VET_CMGG cash must go to 110014';
  end if;
  if public.unit_posting_cash('Tunai', (select id from branches where code = 'LOJI')) <> '110003' then
    raise exception 'LOJI keeps the default Kas Kecil';
  end if;
  -- Non-cash methods are untouched.
  if public.unit_posting_cash('QRIS', (select id from branches where code = 'CMGG')) <> '120002' then
    raise exception 'QRIS must keep the default bank';
  end if;
  -- A Tunai rule finance set by hand is never overwritten.
  if public.unit_posting_cash('Tunai', (select id from branches where code = 'TKI')) <> '110001' then
    raise exception 'manual TKI rule must survive, got %', public.unit_posting_cash('Tunai', (select id from branches where code = 'TKI'));
  end if;
  -- Pre-existing unowned rekening for 110006 is claimed for CMS (not duplicated).
  if (select count(*) from cash_accounts where coa_code = '110006') <> 1
     or (select b.code from cash_accounts c join branches b on b.id = c.branch_id where c.coa_code = '110006') <> 'CMS' then
    raise exception '110006 rekening must be reused and bound to CMS';
  end if;
  -- Inactive rekening is respected: not reactivated, not mapped.
  if (select is_active from cash_accounts where coa_code = '110008') or
     exists (select 1 from payment_account_map m join branches b on b.id = m.branch_id where b.code = 'MUAR' and m.metode = 'Tunai') then
    raise exception 'inactive 110008 must stay inactive and unmapped';
  end if;
  if (select count(*) from payment_account_map where metode = 'Tunai' and branch_id is not null) <> 16 then
    raise exception 'expected 16 branch Tunai rules (15 new + manual TKI), got %',
      (select count(*) from payment_account_map where metode = 'Tunai' and branch_id is not null);
  end if;
end $$;

-- ---------------------------------------------------------------- 2. Pencairan sekaligus
insert into auth.users(id, raw_user_meta_data) values
  ('c1000000-0000-4000-8000-000000000001', '{"full_name":"Finance test"}'),
  ('c1000000-0000-4000-8000-000000000002', '{"full_name":"Outsider"}');
update profiles set role = 'OWNER' where id = 'c1000000-0000-4000-8000-000000000001';
update profiles set role = 'STAFF' where id = 'c1000000-0000-4000-8000-000000000002';
insert into user_branches(user_id, branch_id) select 'c1000000-0000-4000-8000-000000000001', id from branches where code in ('B2C', 'PDRY');
insert into user_branches(user_id, branch_id) select 'c1000000-0000-4000-8000-000000000002', id from branches where code = 'PDRY';
update accounting_locks set closed_until = null;
update coa_accounts set is_active = true, is_header = false where code in ('110003', '120002', '120003', '130009', '740020');
insert into cash_accounts(id, nama, jenis, coa_code, bank_nama)
  values ('c3000000-0000-4000-8000-000000000001', 'Bank BCA Toko', 'Bank', '120003', 'BCA') on conflict (coa_code) do nothing;

insert into sales(id, no_struk, branch_id, subtotal, total, metode_bayar, channel, marketplace_status)
select v.id::uuid, v.no, b.id, v.total, v.total, v.channel, v.channel, 'piutang'
from (values
  ('c2000000-0000-4000-8000-000000000001', 'ONL-T-0001', 100000, 'Shopee', 'B2C'),
  ('c2000000-0000-4000-8000-000000000002', 'ONL-T-0002', 50000, 'Shopee', 'B2C'),
  ('c2000000-0000-4000-8000-000000000003', 'ONL-T-0003', 33333, 'Shopee', 'B2C'),
  ('c2000000-0000-4000-8000-000000000004', 'ONL-T-0004', 70000, 'Tokopedia', 'B2C'),
  ('c2000000-0000-4000-8000-000000000005', 'ONL-T-0005', 20000, 'Shopee', 'PDRY'),
  ('c2000000-0000-4000-8000-000000000006', 'ONL-T-0006', 10000, 'Shopee', 'B2C')
) as v(id, no, total, channel, branch) join branches b on b.code = v.branch;

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', true);

do $$
declare r jsonb; again jsonb; jl record;
  ids uuid[] := array['c2000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000003']::uuid[];
begin
  -- Three Shopee orders, 183.333 total, bank received 170.000 → komisi 13.333.
  r := public.online_disburse_batch('cair-1', ids, 170000, (now() at time zone 'Asia/Jakarta')::date, 'c3000000-0000-4000-8000-000000000001');
  if (r->>'orders')::int <> 3 or (r->>'total')::numeric <> 183333 or (r->>'komisi')::numeric <> 13333 then raise exception 'bad result %', r; end if;
  if (select count(*) from sales where id = any(ids) and marketplace_status = 'cair' and disbursed_at is not null) <> 3 then raise exception 'orders not marked cair'; end if;
  if (select sum(komisi) from sales where id = any(ids)) <> 13333 then raise exception 'komisi split must sum to 13333, got %', (select sum(komisi) from sales where id = any(ids)); end if;
  if exists (select 1 from sales where id = any(ids) and (komisi < 0 or komisi > total)) then raise exception 'komisi share out of range'; end if;
  -- Proportional: 100000/183333 × 13333 ≈ 7273 (+ rounding remainder on the biggest order).
  if abs((select komisi from sales where id = ids[1]) - 7273) > 2 then raise exception 'biggest order share wrong: %', (select komisi from sales where id = ids[1]); end if;

  select sum(l.debit) d, sum(l.credit) c,
         sum(l.debit) filter (where a.code = '120003') bank,
         sum(l.debit) filter (where a.code = '740020') fee,
         sum(l.credit) filter (where a.code = '130009') ar,
         count(distinct e.id) n, min(e.source_ref) ref
    into jl
  from journal_entries e join journal_lines l on l.entry_id = e.id join coa_accounts a on a.id = l.account_id
  where e.source = 'sale-online-cair';
  if jl.n <> 1 or jl.d <> jl.c or jl.bank <> 170000 or jl.fee <> 13333 or jl.ar <> 183333 then raise exception 'bad journal %', row_to_json(jl); end if;
  if jl.ref <> r->>'reference' or jl.ref !~ '^CAIR-[0-9]{8}-001$' then raise exception 'bad reference %', jl.ref; end if;

  -- Same request replays the same result without posting twice.
  again := public.online_disburse_batch('cair-1', ids, 170000, (now() at time zone 'Asia/Jakarta')::date, 'c3000000-0000-4000-8000-000000000001');
  if again <> r or (select count(*) from journal_entries where source = 'sale-online-cair') <> 1 then raise exception 'replay must be idempotent'; end if;

  -- Same key, different detail → refused.
  begin
    perform public.online_disburse_batch('cair-1', ids, 160000, (now() at time zone 'Asia/Jakarta')::date, null);
    raise exception 'expected refusal';
  exception when others then if sqlerrm not like 'Permintaan sudah digunakan%' then raise; end if; end;

  -- Already disbursed → refused.
  begin
    perform public.online_disburse_batch('cair-2', ids, 100, (now() at time zone 'Asia/Jakarta')::date, null);
    raise exception 'expected refusal';
  exception when others then if sqlerrm not like 'Ada order yang sudah dicairkan%' then raise; end if; end;

  -- Mixed marketplace → refused.
  begin
    perform public.online_disburse_batch('cair-3', array['c2000000-0000-4000-8000-000000000004', 'c2000000-0000-4000-8000-000000000006']::uuid[], 100, (now() at time zone 'Asia/Jakarta')::date, null);
    raise exception 'expected refusal';
  exception when others then if sqlerrm not like 'Satu pencairan hanya untuk satu marketplace%' then raise; end if; end;

  -- Mixed branch → refused.
  begin
    perform public.online_disburse_batch('cair-4', array['c2000000-0000-4000-8000-000000000005', 'c2000000-0000-4000-8000-000000000006']::uuid[], 100, (now() at time zone 'Asia/Jakarta')::date, null);
    raise exception 'expected refusal';
  exception when others then if sqlerrm not like 'Satu pencairan hanya untuk satu cabang%' then raise; end if; end;

  -- More money than the orders → refused (likely a typo).
  begin
    perform public.online_disburse_batch('cair-5', array['c2000000-0000-4000-8000-000000000006']::uuid[], 10001, (now() at time zone 'Asia/Jakarta')::date, null);
    raise exception 'expected refusal';
  exception when others then if sqlerrm not like 'Dana masuk%melebihi%' then raise; end if; end;

  -- Future date → refused.
  begin
    perform public.online_disburse_batch('cair-6', array['c2000000-0000-4000-8000-000000000006']::uuid[], 100, (now() at time zone 'Asia/Jakarta')::date + 1, null);
    raise exception 'expected refusal';
  exception when others then if sqlerrm not like 'Tanggal dana masuk tidak valid%' then raise; end if; end;

  -- Full amount, default rekening (peta Transfer → bawaan bank), no komisi line.
  r := public.online_disburse_batch('cair-7', array['c2000000-0000-4000-8000-000000000006']::uuid[], 10000, (now() at time zone 'Asia/Jakarta')::date, null);
  if (r->>'komisi')::numeric <> 0 or r->>'reference' !~ '-002$' then raise exception 'bad full disbursement %', r; end if;
  if not exists (select 1 from journal_entries e join journal_lines l on l.entry_id = e.id join coa_accounts a on a.id = l.account_id
                 where e.source_ref = r->>'reference' and a.code = '120002' and l.debit = 10000) then
    raise exception 'default rekening must follow the Transfer map';
  end if;
  if exists (select 1 from journal_entries e join journal_lines l on l.entry_id = e.id join coa_accounts a on a.id = l.account_id
             where e.source_ref = r->>'reference' and a.code = '740020') then
    raise exception 'zero komisi must not write a fee line';
  end if;

  -- Closed period → refused.
  reset role;
  update accounting_locks set closed_until = (now() at time zone 'Asia/Jakarta')::date;
  set local role authenticated;
  begin
    perform public.online_disburse_batch('cair-8', array['c2000000-0000-4000-8000-000000000004']::uuid[], 100, (now() at time zone 'Asia/Jakarta')::date, null);
    raise exception 'expected refusal';
  exception when others then if sqlerrm not like 'Periode akuntansi sudah ditutup%' then raise; end if; end;
  reset role;
  update accounting_locks set closed_until = null;
  set local role authenticated;
end $$;

-- A user without access to the branch cannot disburse it.
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000002', true);
do $$ begin
  begin
    perform public.online_disburse_batch('cair-x', array['c2000000-0000-4000-8000-000000000004']::uuid[], 100, (now() at time zone 'Asia/Jakarta')::date, null);
    raise exception 'expected refusal';
  exception when others then if sqlerrm not like 'Dokumen penjualan tidak ditemukan%' then raise; end if; end;
  if (select marketplace_status from public.sales where id = 'c2000000-0000-4000-8000-000000000004') <> 'piutang' then
    raise exception 'refused call must not change the order';
  end if;
end $$;

-- anon cannot call it at all.
reset role;
do $$ begin
  if has_function_privilege('anon', 'public.online_disburse_batch(text,uuid[],numeric,date,uuid)', 'execute') then
    raise exception 'anon must not execute online_disburse_batch';
  end if;
end $$;

rollback;
