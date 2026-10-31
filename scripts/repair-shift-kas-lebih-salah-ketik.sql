-- Pembalik 5 jurnal "Kelebihan kas tutup shift" hasil salah ketik uang fisik, 2026-10-31.
-- Persetujuan pemilik (Reza, opsi A). Rincian: docs/TEMUAN-DASHBOARD-PENDAPATAN-TRILIUNAN-2026-10-31.md
--
-- Meniru revise_manual_journal(action='void'): jurnal pembalik bertanggal sama
-- (source 'manual-reversal', source_ref = id audit), jejak di journal_revisions, lalu
-- jurnal asal ditandai voided. Jalur layar tidak bisa dipakai karena baris JRN-202610-0314
-- melebihi batas 1e12 yang diperiksa fungsi itu.
--
-- Terbatas: semua target harus persis sama (nomor, sumber, shift, akun, nominal, belum
-- dibatalkan). Ada yang beda → seluruh perbaikan batal. Baris cashier_shifts tidak diubah
-- (tetap jadi bukti angka yang diketik). Jalankan lewat koneksi pemeliharaan berhak penuh.
-- Uji tanpa menyimpan: awali dengan `set repair.dry_run = 'true';` (diakhiri exception, semua batal).
do $$
declare
  v_owner constant uuid := 'f34a14f2-12ca-4263-b379-908369034d60';
  v_reason constant text := 'Salah ketik uang fisik saat tutup shift (uji coba akun Owner) — kas lebih tidak nyata. Disetujui Reza 31 Okt 2026.';
  t record;
  v_entry public.journal_entries;
  v_reversal uuid;
  v_audit uuid;
  v_before jsonb;
  v_count integer := 0;
begin
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  if not exists(select 1 from public.profiles where id = v_owner and role = 'OWNER') then
    raise exception 'Profil Owner tidak ditemukan';
  end if;

  for t in
    select * from (values
      ('56a2374c-db0d-4249-8998-25aefc517a85'::uuid, 'JRN-202610-0314',      'c9a3dad3-f941-4c17-b117-29d37ceb632d', 8098098960809::numeric),
      ('11c84c5d-c027-406d-bc52-e6ffaa5f8e10'::uuid, 'JRN-202610-0099',      '5b097b3b-85d0-440b-9981-6e7f81e4d46d', 12232342452::numeric),
      (null::uuid,                                   'JRN-202610-0166-J6YM', '5d6242ec-dfe3-4c24-a7ed-fb97d014b209', 999974889::numeric),
      (null::uuid,                                   'JRN-202610-0096',      'd1a95777-75ee-4694-9d8f-ae336dc98431', 999799000::numeric),
      (null::uuid,                                   'JRN-202610-0001-3OJ7', 'f2ee2549-a21c-465c-8950-b1da448badab', 879867887::numeric)
    ) as x(id, no_jurnal, shift_id, amount)
  loop
    select * into v_entry from public.journal_entries e
      where e.no_jurnal = t.no_jurnal and (t.id is null or e.id = t.id)
      for update;
    if not found or v_entry.source <> 'shift' or v_entry.source_ref <> t.shift_id
       or v_entry.voided_at is not null or v_entry.deskripsi <> 'Kelebihan kas tutup shift' then
      raise exception 'Jurnal % berubah atau sudah dibatalkan — periksa ulang', t.no_jurnal;
    end if;
    if (select count(*) from public.journal_lines l where l.entry_id = v_entry.id) <> 2
       or not exists(select 1 from public.journal_lines l join public.coa_accounts a on a.id = l.account_id
                     where l.entry_id = v_entry.id and a.code = '4303' and l.credit = t.amount and l.debit = 0)
       or not exists(select 1 from public.journal_lines l
                     where l.entry_id = v_entry.id and l.debit = t.amount and l.credit = 0)
       or not exists(select 1 from public.cashier_shifts s where s.id = t.shift_id::uuid and s.selisih = t.amount and s.status = 'closed') then
      raise exception 'Isi jurnal % tidak sesuai temuan — periksa ulang', t.no_jurnal;
    end if;

    v_reversal := gen_random_uuid();
    v_audit := gen_random_uuid();
    v_before := jsonb_build_object('entry', to_jsonb(v_entry),
      'lines', (select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) from public.journal_lines l where l.entry_id = v_entry.id));

    insert into public.journal_entries(id, no_jurnal, tanggal, deskripsi, source, source_ref, branch_id)
      values (v_reversal, public.sales_next_number('JRN', v_entry.tanggal), v_entry.tanggal,
              'Pembalik: ' || v_entry.deskripsi || ' (salah ketik ' || v_entry.no_jurnal || ')',
              'manual-reversal', v_audit::text, v_entry.branch_id);
    insert into public.journal_lines(entry_id, account_id, debit, credit)
      select v_reversal, account_id, credit, debit from public.journal_lines where entry_id = v_entry.id;

    insert into public.journal_revisions(id, entry_id, branch_id, action, reason, before_value, after_value, reversal_journal_id, created_by)
      values (v_audit, v_entry.id, v_entry.branch_id, 'void', v_reason, v_before, '{}'::jsonb, v_reversal, v_owner);

    update public.journal_entries
      set voided_at = now(), voided_by = v_owner, void_reason = v_reason, revision = revision + 1
      where id = v_entry.id;
    update public.journal_revisions
      set after_value = jsonb_build_object('entry', (select to_jsonb(e) from public.journal_entries e where e.id = v_entry.id))
      where id = v_audit;
    v_count := v_count + 1;
  end loop;

  if v_count <> 5 then raise exception 'Hanya % dari 5 jurnal yang diproses', v_count; end if;
  if coalesce(current_setting('repair.dry_run', true), 'false') = 'true' then
    raise exception 'DRY RUN OK — 5 jurnal siap dibalik, tidak ada yang disimpan';
  end if;
end $$;
