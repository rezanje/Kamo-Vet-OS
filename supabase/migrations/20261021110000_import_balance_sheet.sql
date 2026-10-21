-- Future Accurate opening-stock imports must reach the journal-backed balance
-- sheet in the same transaction as stock. Do not infer or backfill old openings:
-- some were reconciled through the separate manual opening-balance screen.
create unique index journal_entries_accurate_initial_stock_once
  on public.journal_entries (source_ref) where source = 'saldo-awal-accurate' and source_ref is not null;

create or replace function public.post_accurate_initial_stock(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.import_runs%rowtype;
  v_row record;
  v_valid_count integer;
  v_posted_count integer := 0;
  v_value numeric := 0;
  v_closed date;
  v_journal uuid;
  v_inventory uuid;
  v_capital uuid;
begin
  -- This RPC writes accounting as well as stock. Keep authorization explicit at
  -- the definer boundary and use the existing private global journal allocator.
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and is_active and role in ('OWNER', 'ADMIN')
  ) then
    raise exception 'Hanya OWNER/ADMIN aktif yang boleh mengimpor saldo awal' using errcode = '42501';
  end if;

  select * into v_run
  from public.import_runs
  where id = p_run_id
  for update;

  if not found or v_run.status <> 'previewed' or v_run.kind <> 'initial_stock'
     or v_run.branch_id is null or v_run.warehouse_id is null then
    raise exception 'Batch saldo awal tidak dapat diposting';
  end if;

  if not public.user_can_access_branch(v_run.branch_id) then
    raise exception 'Tidak punya akses cabang';
  end if;

  if v_run.as_of_date is null or not exists (
    select 1 from public.warehouses where id = v_run.warehouse_id and branch_id = v_run.branch_id
  ) then
    raise exception 'Gudang atau tanggal batch saldo awal tidak valid';
  end if;

  -- Hold the period row until commit: a concurrent close cannot slip between
  -- the eligibility check and the journal/stock writes, including zero values.
  select closed_until into v_closed from public.accounting_locks where id for share;
  if v_closed is not null and v_run.as_of_date <= v_closed then
    raise exception 'Periode akuntansi sudah ditutup';
  end if;

  if exists (
    select 1 from public.journal_entries where source = 'saldo-awal-accurate' and source_ref = p_run_id::text
  ) then
    raise exception 'Jurnal batch saldo awal sudah pernah diposting';
  end if;

  if exists (
    select 1 from public.stock_moves
    where source = 'saldo-awal-accurate' and source_ref = p_run_id::text
  ) then
    raise exception 'Batch saldo awal sudah pernah diposting';
  end if;

  -- Freeze accepted payloads before validating them and calculating value.
  perform 1 from public.import_run_rows where run_id = p_run_id for update;
  select count(*) into v_valid_count
  from public.import_run_rows
  where run_id = p_run_id and status = 'valid';
  if v_valid_count = 0 then
    raise exception 'Batch saldo awal tidak punya baris valid';
  end if;

  if exists (
    select 1 from public.import_run_rows r
    where r.run_id = p_run_id and r.status = 'valid'
      and ((r.payload->>'warehouse_id')::uuid is distinct from v_run.warehouse_id
        or (r.payload->>'as_of')::date is distinct from v_run.as_of_date
        or (r.payload->>'item_id')::uuid is null
        or (r.payload->>'base_qty')::numeric is null
        or (r.payload->>'base_unit_cost')::numeric is null
        or (r.payload->>'base_qty')::numeric < 0
        or (r.payload->>'base_unit_cost')::numeric < 0
        or (r.payload->>'base_qty')::numeric::text in ('NaN', 'Infinity', '-Infinity')
        or (r.payload->>'base_unit_cost')::numeric::text in ('NaN', 'Infinity', '-Infinity'))
  ) then
    raise exception 'Tanggal, gudang, kuantitas, atau nilai saldo awal tidak valid';
  end if;

  if exists (
    select 1
    from public.import_run_rows r
    join public.items i on i.id = (r.payload->>'item_id')::uuid
    where r.run_id = p_run_id and r.status = 'valid'
      and i.item_type <> 'Persediaan'
  ) or exists (
    select 1
    from public.import_run_rows r
    where r.run_id = p_run_id and r.status = 'valid'
      and not exists (select 1 from public.items i where i.id = (r.payload->>'item_id')::uuid)
  ) then
    raise exception 'Barang saldo awal tidak valid';
  end if;

  -- Different batches may contain the same SKU. Lock its aggregate before
  -- checking history so exactly one concurrent first import can succeed.
  insert into public.stock (warehouse_id, item_id, qty)
  select distinct v_run.warehouse_id, (r.payload->>'item_id')::uuid, 0
  from public.import_run_rows r where r.run_id = p_run_id and r.status = 'valid'
  order by (r.payload->>'item_id')::uuid
  on conflict (warehouse_id, item_id) do nothing;
  perform 1 from public.stock s where s.warehouse_id = v_run.warehouse_id
    and s.item_id in (select (payload->>'item_id')::uuid from public.import_run_rows where run_id = p_run_id and status = 'valid')
    order by s.item_id for update;

  if exists (
    select 1
    from public.stock s
    where s.warehouse_id = v_run.warehouse_id
      and s.item_id in (
        select (r.payload->>'item_id')::uuid
        from public.import_run_rows r where r.run_id = p_run_id and r.status = 'valid'
      )
      and s.qty <> 0
  ) or exists (
    select 1
    from public.stock_moves sm
    where sm.warehouse_id = v_run.warehouse_id
      and sm.item_id in (
        select (r.payload->>'item_id')::uuid
        from public.import_run_rows r where r.run_id = p_run_id and r.status = 'valid'
      )
  ) then
    raise exception 'Saldo awal hanya boleh untuk barang tanpa riwayat stok';
  end if;

  select sum((payload->>'base_qty')::numeric * (payload->>'base_unit_cost')::numeric)
  into v_value from public.import_run_rows where run_id = p_run_id and status = 'valid';

  -- A global/manual inventory opening cannot be attributed safely to a batch.
  -- Refuse a second opening rather than guessing how much was already included.
  if v_value > 0 and exists (
    select 1 from public.journal_entries e
    join public.journal_lines l on l.entry_id = e.id
    join public.coa_accounts a on a.id = l.account_id
    where e.source = 'saldo-awal' and a.code = '1301' and (l.debit <> 0 or l.credit <> 0)
      and (e.branch_id is null or e.branch_id = v_run.branch_id)
  ) then
    raise exception 'Saldo awal Persediaan manual sudah ada. Rekonsiliasi sebelum impor agar nilai tidak tercatat dua kali.';
  end if;

  if v_value > 0 then
    select id into v_inventory from public.coa_accounts where code = '1301' and is_active and not is_header
      and type = 'ASET' and normal_balance = 'D' for share;
    select id into v_capital from public.coa_accounts where code = '3101' and is_active and not is_header
      and type = 'EKUITAS' and normal_balance = 'K' for share;
    if v_inventory is null or v_capital is null then
      raise exception 'Akun Persediaan (1301) atau Modal Pemilik (3101) tidak tersedia sebagai akun detail aktif';
    end if;
  end if;

  for v_row in
    select payload
    from public.import_run_rows
    where run_id = p_run_id and status = 'valid'
    order by source_row
    for update
  loop
    insert into public.stock (warehouse_id, item_id, qty, updated_at)
    values (
      v_run.warehouse_id,
      (v_row.payload->>'item_id')::uuid,
      (v_row.payload->>'base_qty')::numeric,
      now()
    )
    on conflict (warehouse_id, item_id) do update
      set qty = public.stock.qty + excluded.qty, updated_at = excluded.updated_at;

    if (v_row.payload->>'base_qty')::numeric > 0 then
      insert into public.stock_layers (
        warehouse_id, item_id, tanggal, qty_in, qty_left, unit_cost,
        source, source_ref, exp_date, batch_no
      ) values (
        v_run.warehouse_id,
        (v_row.payload->>'item_id')::uuid,
        v_run.as_of_date,
        (v_row.payload->>'base_qty')::numeric,
        (v_row.payload->>'base_qty')::numeric,
        (v_row.payload->>'base_unit_cost')::numeric,
        'saldo-awal-accurate',
        p_run_id::text,
        nullif(v_row.payload->>'exp_date', '')::date,
        nullif(v_row.payload->>'batch_no', '')
      );
    end if;

    insert into public.stock_moves (
      tanggal, warehouse_id, item_id, qty, unit_cost, source, source_ref
    ) values (
      v_run.as_of_date,
      v_run.warehouse_id,
      (v_row.payload->>'item_id')::uuid,
      (v_row.payload->>'base_qty')::numeric,
      (v_row.payload->>'base_unit_cost')::numeric,
      'saldo-awal-accurate',
      p_run_id::text
    );
    v_posted_count := v_posted_count + 1;
  end loop;

  if v_value > 0 then
    v_journal := gen_random_uuid();
    insert into public.journal_entries (id, no_jurnal, tanggal, deskripsi, source, source_ref, branch_id)
    values (v_journal, public.sales_next_number('JRN', v_run.as_of_date), v_run.as_of_date,
      'Saldo awal persediaan Accurate — ' || v_run.source_name, 'saldo-awal-accurate', p_run_id::text, v_run.branch_id);
    insert into public.journal_lines (entry_id, account_id, debit, credit) values
      (v_journal, v_inventory, v_value, 0), (v_journal, v_capital, 0, v_value);
  end if;

  update public.import_run_rows
  set status = 'posted'
  where run_id = p_run_id and status = 'valid';

  update public.import_runs
  set status = 'posted', posted_at = now()
  where id = p_run_id;

  return jsonb_build_object('run_id', p_run_id, 'posted_rows', v_posted_count, 'journal_id', v_journal, 'inventory_value', v_value);
end;
$$;

revoke all on function public.post_accurate_initial_stock(uuid) from public, anon, authenticated, service_role;
grant execute on function public.post_accurate_initial_stock(uuid) to authenticated;
