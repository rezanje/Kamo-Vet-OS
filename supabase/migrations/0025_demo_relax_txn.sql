-- Demo: longgarkan branch-gate pada seluruh tabel transaksi POS supaya alur kasir
-- jalan penuh (jual, item, stok, expense, permintaan) di cabang mana pun untuk
-- presentasi. ponytail: PROTOTYPE ONLY — produksi kembalikan ke user_can_access_branch.
drop policy if exists sales_all on sales;
create policy sales_all on sales for all to authenticated using (true) with check (true);

drop policy if exists sale_items_all on sale_items;
create policy sale_items_all on sale_items for all to authenticated using (true) with check (true);

drop policy if exists expenses_all on expenses;
create policy expenses_all on expenses for all to authenticated using (true) with check (true);

drop policy if exists stock_all on stock;
create policy stock_all on stock for all to authenticated using (true) with check (true);

drop policy if exists sr_all on stock_requests;
create policy sr_all on stock_requests for all to authenticated using (true) with check (true);

drop policy if exists sri_all on stock_request_items;
create policy sri_all on stock_request_items for all to authenticated using (true) with check (true);
