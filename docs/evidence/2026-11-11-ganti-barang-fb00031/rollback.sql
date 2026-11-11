-- Rollback apply.sql (FB.2026.11.00031: Pasir TOP 5ltr -> kembali ke Pasir Markotop 5L).
-- Hanya aman selama permintaan PRM-20261110-0011 belum diterima cabang dan Pasir TOP 5ltr belum punya mutasi lain.
do $$
declare
  v_old constant uuid := '935b1f59-2d73-4e11-bd49-4af689b83e30'; -- Pasir Markotop 5L
  v_new constant uuid := '0230e3a6-55dd-45a3-9ccd-ed12e458f096'; -- Pasir TOP 5ltr
  v_inv constant uuid := 'ede4529c-718d-457c-b17e-43b9646df147';
  v_req constant uuid := '416a4111-8fe4-4893-821b-95de2c0b93ec';
begin
  if (select count(*) from stock_moves where item_id=v_new)<>3 then raise exception 'Pasir TOP 5ltr sudah punya mutasi lain; rollback manual'; end if;
  update purchase_invoice_items set item_id=v_old, nama='Pasir Markotop 5L' where id='78857322-97e5-424a-824e-571e7c1a8e65' and item_id=v_new;
  update stock_moves set item_id=v_old where item_id=v_new and id in
   ('1716e5e1-60e0-4df0-850d-8c095c134fc8','68fcc0d6-7dc6-4d7c-8f63-663a3fd3c381','6a6b6e6e-eb4a-4217-aac8-f782e7f73c6b');
  update stock_layers set item_id=v_old where item_id=v_new and id in
   ('2fcfede5-462d-4bde-9a20-61550306f22d','57c1b6ff-7391-4c4c-8711-d41e7cf1bab8');
  update stock set item_id=v_old where item_id=v_new and id in
   ('8a517c1a-e7d7-48ae-9424-fd0ab5542869','decf1d06-7126-4071-8c33-b20e2563d665');
  update stock_request_items set item_id=v_old, nama='Pasir Markotop 5L' where id='3096dbf2-acb5-40b2-85be-76f76efa4de8' and item_id=v_new;
  update purchase_invoice_postings set stock_moves=replace(stock_moves::text, v_new::text, v_old::text)::jsonb where invoice_id=v_inv;
  update purchase_invoice_layer_proofs set after_state=replace(after_state::text, v_new::text, v_old::text)::jsonb
   where invoice_id=v_inv and layer_id='2fcfede5-462d-4bde-9a20-61550306f22d';
end $$;
