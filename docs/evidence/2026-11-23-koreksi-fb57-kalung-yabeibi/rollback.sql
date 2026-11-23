-- Hanya aman sebelum ada mutasi baru Kalung Yabeibi Lonceng Besar di DC LOJI / dari layer rantai FB57.
do $$
declare inv constant uuid:='9542d12f-361d-4e86-b7dc-ac18787f0713'; kal constant uuid:='02fe7c16-1a79-4294-9906-9e08f507c5bf';
begin
 update purchase_invoice_items set qty=30,harga=13334 where id='74d0aaf0-9fa8-44aa-a8fa-7d70232d74aa';
 update purchase_invoice_items set harga=10 where id='51482871-198b-4310-95a6-f1009af1e45b';
 update purchase_invoices set revision=revision-1 where id=inv;
 update stock_layers set qty_in=30,qty_left=0,unit_cost=13334 where id='f805f7df-d73e-4ae6-8b8b-64543f0f614f' and qty_left=30;
 update stock_layers set unit_cost=13334 where item_id=kal and unit_cost=6666 and source in ('kirim-permintaan','terima-permintaan');
 update stock_moves set qty=30,unit_cost=13334 where id='aff8a6dc-06a3-4c6d-8131-d1a7dce57ec3';
 update stock_moves set unit_cost=13334 where item_id=kal and unit_cost=6666 and source in ('kirim-permintaan','terima-permintaan');
 update stock set qty=qty-30,updated_at=now() where warehouse_id='80377b05-74a0-4890-8b61-9b4328eb1902' and item_id=kal;
 update stock_layers set unit_cost=10 where id='450faa8d-dddd-4465-b870-9e560aa13163';
 update stock_moves set unit_cost=10 where id='802cd0a9-9a2d-4434-8782-9c33fa6c4221';
 update purchase_invoice_postings set stock_moves=(select jsonb_agg(case e->>'id'
   when 'aff8a6dc-06a3-4c6d-8131-d1a7dce57ec3' then e||'{"qty":30,"unit_cost":13334}'::jsonb
   when '802cd0a9-9a2d-4434-8782-9c33fa6c4221' then e||'{"unit_cost":10}'::jsonb else e end order by o)
   from jsonb_array_elements(stock_moves) with ordinality x(e,o)) where invoice_id=inv;
 update purchase_invoice_layer_proofs set after_state=after_state||'{"qty_in":30,"qty_left":30,"unit_cost":13334}'::jsonb where invoice_id=inv and layer_id='f805f7df-d73e-4ae6-8b8b-64543f0f614f';
 update purchase_invoice_layer_proofs set after_state=after_state||'{"unit_cost":10}'::jsonb where invoice_id=inv and layer_id='450faa8d-dddd-4465-b870-9e560aa13163';
end $$;
