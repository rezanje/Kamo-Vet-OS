-- Dua pembersihan data yang diputuskan bos 2026-08-01.
--
-- (1) "Aldi" & "Aldiansyah Trisaputra" adalah orang yang sama, terpecah karena
--     kartu kedua dibuat dengan no. HP "0" sehingga pencarian pelanggan lama
--     tidak menemukannya. Keputusan bos: pakai nama lengkap.
--     Nomor HP yang dipertahankan adalah nomor ASLI (bukan "0") — kalau tidak,
--     kartu ini tidak akan pernah ketemu lagi saat registrasi berikutnya dan
--     masalah yang sama terulang.
--
-- (2) Barang berjenis Jasa punya baris stok. Jasa tidak punya stok sama sekali,
--     jadi barisnya sisa dari jalur lama yang sudah diperbaiki (lihat e97445d
--     "retur jasa tidak menambah stok"). Nilai bukunya nol — tidak ada lapisan
--     biaya (stock_layers) sama sekali — jadi menghapusnya tidak menyentuh jurnal.

-- ── 1. Gabungkan dua kartu pelanggan ───────────────────────────────────────
do $$
declare
  induk uuid;   -- kartu yang dipertahankan: nama lengkap
  lebur uuid;   -- kartu yang dilebur: "Aldi", pembawa hampir semua riwayat
  hp    varchar(30);
begin
  select id into induk from customers where name = 'Aldiansyah Trisaputra';
  select id, phone into lebur, hp from customers where name = 'Aldi';

  -- Migrasi ini spesifik untuk dua kartu itu. Kalau salah satunya sudah tidak
  -- ada (mis. dijalankan dua kali), lewati diam-diam — jangan menebak.
  if induk is null or lebur is null then
    raise notice 'Kartu pelanggan target tidak lengkap, penggabungan dilewati.';
    return;
  end if;

  -- Riwayat dipindah ke kartu induk. Semua tabel yang menunjuk customers
  -- (dicek lewat foreign key): follow_ups, pets, point_ledger, sale_drafts,
  -- sales, visits.
  update follow_ups  set customer_id = induk where customer_id = lebur;
  update pets        set customer_id = induk where customer_id = lebur;
  update point_ledger set customer_id = induk where customer_id = lebur;
  update sale_drafts set customer_id = induk where customer_id = lebur;
  update sales       set customer_id = induk where customer_id = lebur;
  update visits      set customer_id = induk where customer_id = lebur;

  -- Poin & total belanja dijumlah, bukan diambil salah satu: keduanya hasil
  -- transaksi nyata yang sekarang berdiri di bawah satu nama.
  update customers c set
    phone          = hp,                      -- nomor asli menang atas "0"
    points         = c.points + l.points,
    total_spending = c.total_spending + l.total_spending,
    -- Kolom identitas diisi dari kartu yang dilebur hanya kalau induk kosong.
    email      = coalesce(c.email, l.email),
    address    = coalesce(c.address, l.address),
    dob        = coalesce(c.dob, l.dob),
    pekerjaan  = coalesce(c.pekerjaan, l.pekerjaan),
    sumber_info = coalesce(c.sumber_info, l.sumber_info)
  from customers l
  where c.id = induk and l.id = lebur;

  delete from customers where id = lebur;
end $$;

-- ── 2. Jasa tidak boleh punya stok ─────────────────────────────────────────
delete from stock s
using items i
where i.id = s.item_id and i.item_type <> 'Persediaan';

-- Sisa stok minus pada barang Persediaan TIDAK disentuh di sini: itu selisih
-- nyata yang jalurnya adalah Stok Opname, bukan diam-diam dinolkan lewat migrasi.
