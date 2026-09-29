-- Invoice klinik yang diterbitkan RPC tidak boleh diubah/di-void lewat jalur
-- lama yang memecah stok, HPP, dan jurnal menjadi request terpisah.
-- Invoice historis tanpa request_key tetap diperlakukan oleh jalur lama.
-- Pelunasan piutang masih boleh memperbarui paid_status / paid_at; lifecycle
-- atomik untuk edit/void/reissue harus dibuat sebelum tombol itu dibuka kembali.
create function public.guard_posted_clinic_invoice() returns trigger
language plpgsql security definer set search_path = '' as $function$
declare
  v_posted boolean;
begin
  if tg_table_name = 'invoices' then
    if tg_op = 'DELETE' then
      if old.request_key is not null then
        raise exception using errcode='P0001', message='INVOICE_POSTED: invoice klinik perlu pembalikan atomik';
      end if;
      return old;
    end if;
    if old.request_key is not null and (
      old.visit_id is distinct from new.visit_id
      or old.invoice_no is distinct from new.invoice_no
      or old.subtotal is distinct from new.subtotal
      or old.discount is distinct from new.discount
      or old.tax is distinct from new.tax
      or old.total is distinct from new.total
      or old.dp_amount is distinct from new.dp_amount
      or old.dp_date is distinct from new.dp_date
      or old.metode_bayar is distinct from new.metode_bayar
      or old.shift_id is distinct from new.shift_id
      or old.voucher_code is distinct from new.voucher_code
      or old.salesperson_id is distinct from new.salesperson_id
      or old.voided_at is distinct from new.voided_at
      or old.reissued_from is distinct from new.reissued_from
      or old.request_key is distinct from new.request_key
      or old.request_hash is distinct from new.request_hash
    ) then
      raise exception using errcode='P0001', message='INVOICE_POSTED: invoice klinik perlu pembalikan atomik';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    select i.request_key is not null into v_posted from public.invoices i where i.id = old.invoice_id;
    if v_posted then
      raise exception using errcode='P0001', message='INVOICE_POSTED: baris invoice sudah diposting';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    select coalesce(bool_or(i.request_key is not null), false) into v_posted from public.invoices i
    where i.id = old.invoice_id or i.id = new.invoice_id;
  else
    select i.request_key is not null into v_posted from public.invoices i where i.id = new.invoice_id;
  end if;
  if v_posted then
    raise exception using errcode='P0001', message='INVOICE_POSTED: baris invoice sudah diposting';
  end if;
  return new;
end;
$function$;

create trigger guard_posted_clinic_invoice_row before update or delete on public.invoices
  for each row execute function public.guard_posted_clinic_invoice();
create trigger guard_posted_clinic_invoice_items before insert or update or delete on public.invoice_items
  for each row execute function public.guard_posted_clinic_invoice();
revoke all on function public.guard_posted_clinic_invoice() from public, anon, authenticated, service_role;
