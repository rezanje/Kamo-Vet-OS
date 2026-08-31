-- Saldo awal Accurate: satu perintah database untuk stok, FIFO, kartu stok,
-- dan status audit batch.
alter table stock_layers add column if not exists batch_no varchar(80);
create index if not exists stock_layers_batch_idx
  on stock_layers (warehouse_id, item_id, batch_no, exp_date)
  where qty_left > 0;

create or replace function public.post_accurate_initial_stock(p_run_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_run import_runs%rowtype;
  v_row record;
  v_valid_count integer;
  v_posted_count integer := 0;
begin
  select * into v_run
  from import_runs
  where id = p_run_id
  for update;

  if not found or v_run.status <> 'previewed' or v_run.kind <> 'initial_stock'
     or v_run.branch_id is null or v_run.warehouse_id is null then
    raise exception 'Batch saldo awal tidak dapat diposting';
  end if;

  if not public.user_can_access_branch(v_run.branch_id) then
    raise exception 'Tidak punya akses cabang';
  end if;

  if exists (
    select 1 from stock_moves
    where source = 'saldo-awal-accurate' and source_ref = p_run_id::text
  ) then
    raise exception 'Batch saldo awal sudah pernah diposting';
  end if;

  select count(*) into v_valid_count
  from import_run_rows
  where run_id = p_run_id and status = 'valid';
  if v_valid_count = 0 then
    raise exception 'Batch saldo awal tidak punya baris valid';
  end if;

  if exists (
    select 1
    from import_run_rows r
    where r.run_id = p_run_id
      and r.status = 'valid'
      and (r.payload->>'warehouse_id')::uuid <> v_run.warehouse_id
  ) then
    raise exception 'Gudang baris tidak cocok dengan batch';
  end if;

  if exists (
    select 1
    from import_run_rows r
    join items i on i.id = (r.payload->>'item_id')::uuid
    where r.run_id = p_run_id and r.status = 'valid'
      and i.item_type <> 'Persediaan'
  ) or exists (
    select 1
    from import_run_rows r
    where r.run_id = p_run_id and r.status = 'valid'
      and not exists (select 1 from items i where i.id = (r.payload->>'item_id')::uuid)
  ) then
    raise exception 'Barang saldo awal tidak valid';
  end if;

  if exists (
    select 1
    from stock s
    where s.warehouse_id = v_run.warehouse_id
      and s.item_id in (
        select (r.payload->>'item_id')::uuid
        from import_run_rows r where r.run_id = p_run_id and r.status = 'valid'
      )
      and s.qty <> 0
  ) or exists (
    select 1
    from stock_moves sm
    where sm.warehouse_id = v_run.warehouse_id
      and sm.item_id in (
        select (r.payload->>'item_id')::uuid
        from import_run_rows r where r.run_id = p_run_id and r.status = 'valid'
      )
  ) then
    raise exception 'Saldo awal hanya boleh untuk barang tanpa riwayat stok';
  end if;

  for v_row in
    select payload
    from import_run_rows
    where run_id = p_run_id and status = 'valid'
    order by source_row
    for update
  loop
    insert into stock (warehouse_id, item_id, qty, updated_at)
    values (
      v_run.warehouse_id,
      (v_row.payload->>'item_id')::uuid,
      (v_row.payload->>'base_qty')::numeric,
      now()
    )
    on conflict (warehouse_id, item_id) do update
      set qty = stock.qty + excluded.qty, updated_at = excluded.updated_at;

    if (v_row.payload->>'base_qty')::numeric > 0 then
      insert into stock_layers (
        warehouse_id, item_id, tanggal, qty_in, qty_left, unit_cost,
        source, source_ref, exp_date, batch_no
      ) values (
        v_run.warehouse_id,
        (v_row.payload->>'item_id')::uuid,
        (v_row.payload->>'as_of')::date,
        (v_row.payload->>'base_qty')::numeric,
        (v_row.payload->>'base_qty')::numeric,
        (v_row.payload->>'base_unit_cost')::numeric,
        'saldo-awal-accurate',
        p_run_id::text,
        nullif(v_row.payload->>'exp_date', '')::date,
        nullif(v_row.payload->>'batch_no', '')
      );
    end if;

    insert into stock_moves (
      tanggal, warehouse_id, item_id, qty, unit_cost, source, source_ref
    ) values (
      (v_row.payload->>'as_of')::date,
      v_run.warehouse_id,
      (v_row.payload->>'item_id')::uuid,
      (v_row.payload->>'base_qty')::numeric,
      (v_row.payload->>'base_unit_cost')::numeric,
      'saldo-awal-accurate',
      p_run_id::text
    );
    v_posted_count := v_posted_count + 1;
  end loop;

  update import_run_rows
  set status = 'posted'
  where run_id = p_run_id and status = 'valid';

  update import_runs
  set status = 'posted', posted_at = now()
  where id = p_run_id;

  return jsonb_build_object('run_id', p_run_id, 'posted_rows', v_posted_count);
end;
$$;

revoke all on function public.post_accurate_initial_stock(uuid) from public;
grant execute on function public.post_accurate_initial_stock(uuid) to authenticated;
