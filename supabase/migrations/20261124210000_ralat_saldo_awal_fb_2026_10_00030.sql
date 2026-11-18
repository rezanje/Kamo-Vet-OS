-- Koreksi data (18 Nov 2026, ralat kedua dari finance klinik): saldo awal hutang per faktur
-- FB.2026.10.00030 (Loving Pet, no. asal PI.2026.10.00114) seharusnya 10.101.500 (ralat atas koreksi
-- 20261124200000 yang memakai 11.404.500; nilai impor asal 9.939.500). Belum ada pembayaran.
--
-- Sama dengan koreksi FB.2026.10.00079 (20261121300000): faktur saldo awal dikunci
-- (guard_opening_invoice) dan belum punya layar koreksi, jadi dikoreksi sekali di sini:
--   * purchase_invoices.total, opening_invoice_lines.outstanding/original_total → 10.101.500;
--   * opening_invoice_batches.ap_total (+ ringkasan result.hutang.total) turun 1.303.000;
--   * jurnal saldo awal batch: 410001 Debit dan 311001 Kredit turun 1.303.000
--     (tetap seimbang; periode belum ditutup).
-- Idempoten: hanya berjalan bila total faktur masih 11.404.500. Trigger penjaga faktur saldo awal
-- dimatikan hanya di dalam transaksi ini lalu dinyalakan lagi.
do $$
declare
  v_lama constant numeric := 11404500;
  v_baru constant numeric := 10101500;
  v_selisih constant numeric := -1303000;
  v_inv uuid; v_batch uuid; v_journal uuid; n integer;
begin
  select id, opening_batch_id into v_inv, v_batch
    from public.purchase_invoices
   where no_faktur = 'FB.2026.10.00030' and opening_batch_id is not null and total = v_lama
   for update;
  if v_inv is null then
    raise notice 'FB.2026.10.00030 sudah dikoreksi atau tidak ditemukan — dilewati';
    return;
  end if;

  select journal_id into v_journal from public.opening_invoice_batches where id = v_batch for update;

  alter table public.purchase_invoices disable trigger opening_invoice_guard;
  update public.purchase_invoices set total = v_baru where id = v_inv;
  alter table public.purchase_invoices enable trigger opening_invoice_guard;

  update public.opening_invoice_lines
     set outstanding = v_baru, original_total = v_baru,
         keterangan = concat_ws(' · ', nullif(keterangan, ''),
           'Ralat 18 Nov 2026: 11.404.500 → 10.101.500 (salah angka di permintaan sebelumnya)')
   where purchase_invoice_id = v_inv and outstanding = v_lama;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Baris impor saldo awal tidak ditemukan (%)', n; end if;

  update public.opening_invoice_batches
     set ap_total = ap_total + v_selisih,
         result = jsonb_set(result, '{hutang,total}', to_jsonb((result #>> '{hutang,total}')::numeric + v_selisih))
   where id = v_batch;

  -- Baris 410001 sisi debit (lawan hutang) dan 311001 sisi kredit; baris 410001 kredit (lawan piutang) tidak disentuh.
  update public.journal_lines l
     set debit  = case when a.code = '410001' then l.debit + v_selisih else l.debit end,
         credit = case when a.code = '311001' then l.credit + v_selisih else l.credit end
    from public.coa_accounts a
   where a.id = l.account_id and l.entry_id = v_journal
     and ((a.code = '410001' and l.debit > 0) or (a.code = '311001' and l.credit > 0));
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'Baris jurnal saldo awal tidak sesuai (%)', n; end if;

  if (select sum(debit) - sum(credit) from public.journal_lines where entry_id = v_journal) <> 0 then
    raise exception 'Jurnal saldo awal jadi tidak seimbang';
  end if;
end $$;
