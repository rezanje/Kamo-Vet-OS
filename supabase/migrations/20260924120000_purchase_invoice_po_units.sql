-- Keep each PO invoice line attached to the exact received PO row and its unit.
-- Existing PO invoices stay NULL; no historical backfill is attempted.

alter table public.purchase_invoice_items
  add column po_item_id uuid references public.purchase_order_items(id) on delete restrict;

create index purchase_invoice_items_po_item_idx
  on public.purchase_invoice_items(po_item_id)
  where po_item_id is not null;

comment on column public.purchase_invoice_items.po_item_id is
  'PO line fulfilled by this invoice line; NULL for direct purchases and legacy PO invoices.';
