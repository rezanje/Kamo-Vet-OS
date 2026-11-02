-- Racikan rawat inap yang dibatalkan keluar dari tagihan berjalan (Anisa, 2 Nov 2026 22.23).
--
-- clinic_return_compound mengembalikan bahan ke stok dan menandai racikan 'void', tetapi baris
-- resepnya tetap tertagih: inpatient_payment_quote memasukkan semua resep yang belum ditarik,
-- lalu posting invoice menolak racikan void (RECIPE_ID_MISSING). Keranjang rawat inap juga
-- melarang menghapus baris racikan (COMPOUND_LOCKED). Akibatnya tagihan macet permanen.
--
-- Perbaikan aditif: saat racikan berubah menjadi 'void', baris resep racikan itu pada kunjungan
-- rawat inap yang belum ditagih ditarik dari tagihan (kolom penarikan yang sama dengan revisi
-- kasir rawat inap). Racikan yang sudah ditagih tidak disentuh (jalur koreksi invoice tetap).
-- Fungsi/trigger lain tidak berubah.

create function clinic_private.withdraw_void_compound_billing() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'void' and old.status is distinct from 'void' then
    update public.prescription_items pi
       set billing_withdrawn_at = clock_timestamp(),
           billing_withdrawn_by = auth.uid(),
           billing_withdrawal_reason = 'Racikan dibatalkan; bahan dikembalikan ke stok'
     where pi.compound_recipe_id = new.id
       and pi.billing_withdrawn_at is null
       and exists (select 1 from public.medical_records mr join public.inpatient_records ir on ir.visit_id = mr.visit_id
                   where mr.id = pi.medical_record_id)
       and not exists (select 1 from public.invoice_items ii join public.invoices i on i.id = ii.invoice_id
                       where ii.prescription_item_id = pi.id and i.voided_at is null);
  end if;
  return new;
end $$;
revoke all on function clinic_private.withdraw_void_compound_billing() from public, anon, authenticated, service_role;

create trigger zz_void_compound_withdraw_billing
after update of status on public.compounding_recipes
for each row execute function clinic_private.withdraw_void_compound_billing();
