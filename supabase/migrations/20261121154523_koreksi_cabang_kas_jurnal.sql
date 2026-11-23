-- Koreksi Kas Masuk/Keluar & Jurnal Manual boleh mengganti cabang (21 Nov 2026).
-- Live: versi 20261121154523 koreksi_cabang_kas_jurnal (dipasang via apply_migration, diuji dulu dalam transaksi yang dibatalkan).
--
-- Pelapor: Mba Anisa (grup Kamo ERP Dev, 20 Nov): "Untuk jurnal dan pengeluaran itu untuk koreksi
-- dia gada pilihan edit cabang. Minta tolong dimunculin ya mas ubah cabang."
--
-- Sebelumnya revise_cash_entry dan revise_manual_journal selalu memakai cabang catatan asli.
-- Sesudah:
--  * p_header.branch_id (opsional). Key ada → dipakai ('' = Pusat/tanpa cabang); key tidak ada → cabang asli
--    (pemanggil lama tetap berperilaku sama).
--  * Cabang baru wajib aktif dan bisa diakses pengguna. Pindah ke Pusat pada jurnal manual butuh
--    kemampuan all_branches (sama dengan aturan buat jurnal manual baru).
--  * Rekening kas milik cabang tertentu harus cocok dengan cabang BARU.
--  * Jurnal pembalik tetap di cabang asli; jurnal pengganti dan dokumen kas pindah ke cabang baru.
--  * Hasil RPC memuat branch_id supaya aplikasi bisa memastikan perubahan cabang benar-benar terpasang.
--
-- Fungsi live sudah dipatch berlapis (mis. deny_admin_online, akses edit kas 12 Nov), jadi diubah lewat
-- penggantian teks pada definisi yang sedang berjalan. Tiap potongan wajib ditemukan tepat satu kali;
-- bila fungsi sudah memuat penanda migrasi ini, langkah dilewati (idempoten).

do $migrate$
declare
 v_def text; v_old text; v_new text; v_count integer; i integer;
 v_pairs text[][] := array[
  [$q$v_debit numeric; v_credit numeric; v_lines integer; v_code text;$q$,
   $q$v_debit numeric; v_credit numeric; v_lines integer; v_code text; v_branch uuid;$q$],
  [$q$select * into v_rek from public.cash_accounts where id=coalesce($q$,
   $q$-- koreksi-cabang-kas: cabang boleh dikoreksi (permintaan Anisa, 20 Nov 2026); key tidak ada = cabang asli.
   v_branch:=case when p_header ? 'branch_id' then nullif(btrim(p_header->>'branch_id'),'')::uuid else v_cash.branch_id end;
   if v_branch is distinct from v_cash.branch_id and v_branch is not null
      and (not public.user_can_access_branch(v_branch) or not exists(select 1 from public.branches where id=v_branch and is_active)) then
     raise exception 'Cabang koreksi tidak ditemukan atau tidak dapat diakses' using errcode='42501';
   end if;
   select * into v_rek from public.cash_accounts where id=coalesce($q$],
  [$q$(v_rek.branch_id is not null and v_rek.branch_id is distinct from v_cash.branch_id)$q$,
   $q$(v_rek.branch_id is not null and v_rek.branch_id is distinct from v_branch)$q$],
  [$q$'kas-entry-correction',v_audit::text,v_cash.branch_id);$q$,
   $q$'kas-entry-correction',v_audit::text,v_branch);$q$],
  [$q$keterangan=v_desc,journal_entry_id=v_replacement,$q$,
   $q$keterangan=v_desc,branch_id=v_branch,journal_entry_id=v_replacement,$q$],
  [$q$'replacement_journal_id',v_replacement);$q$,
   $q$'replacement_journal_id',v_replacement,'branch_id',case when p_action='edit' then v_branch else v_cash.branch_id end);$q$]
 ];
begin
 v_def := pg_get_functiondef('public.revise_cash_entry(text,uuid,integer,text,jsonb,text)'::regprocedure);
 if position('koreksi-cabang-kas' in v_def) > 0 then return; end if;
 for i in 1..array_length(v_pairs,1) loop
  v_old := v_pairs[i][1]; v_new := v_pairs[i][2];
  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_count <> 1 then raise exception 'revise_cash_entry: potongan % ditemukan % kali', i, v_count; end if;
  v_def := replace(v_def, v_old, v_new);
 end loop;
 execute v_def;
end
$migrate$;

do $migrate$
declare
 v_def text; v_old text; v_new text; v_count integer; i integer;
 v_pairs text[][] := array[
  [$q$v_profile public.profiles%rowtype;$q$,
   $q$v_profile public.profiles%rowtype;
  v_branch uuid;$q$],
  [$q$perform 1 from public.journal_lines where entry_id=v_entry.id for update;$q$,
   $q$-- koreksi-cabang-jurnal: cabang boleh dikoreksi (permintaan Anisa, 20 Nov 2026); key tidak ada = cabang asli.
  v_branch:=case when p_action='edit' and p_header ? 'branch_id' then nullif(btrim(p_header->>'branch_id'),'')::uuid else v_entry.branch_id end;
  if v_branch is distinct from v_entry.branch_id then
    if v_branch is null then
      if not public.has_role_capability('all_branches') then raise exception 'Cabang jurnal wajib dipilih' using errcode='42501'; end if;
    elsif not public.user_can_access_branch(v_branch) or not exists(select 1 from public.branches where id=v_branch and is_active) then
      raise exception 'Cabang koreksi tidak ditemukan atau tidak dapat diakses' using errcode='42501';
    end if;
  end if;
  perform 1 from public.journal_lines where entry_id=v_entry.id for update;$q$],
  [$q$'manual-correction',v_audit::text,v_entry.branch_id);$q$,
   $q$'manual-correction',v_audit::text,v_branch);$q$],
  [$q$'replacement_journal_id',v_replacement);$q$,
   $q$'replacement_journal_id',v_replacement,'branch_id',v_branch);$q$]
 ];
begin
 v_def := pg_get_functiondef('public.revise_manual_journal(text,uuid,integer,text,jsonb,jsonb,text)'::regprocedure);
 if position('koreksi-cabang-jurnal' in v_def) > 0 then return; end if;
 for i in 1..array_length(v_pairs,1) loop
  v_old := v_pairs[i][1]; v_new := v_pairs[i][2];
  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_count <> 1 then raise exception 'revise_manual_journal: potongan % ditemukan % kali', i, v_count; end if;
  v_def := replace(v_def, v_old, v_new);
 end loop;
 execute v_def;
end
$migrate$;
