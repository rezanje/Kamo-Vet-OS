-- Pengeluaran tunai keluar dari laci kasir → harus jadi pengurang "kas seharusnya"
-- saat tutup shift. Tanpa shift_id, pengeluaran cuma bisa dicocokkan lewat window
-- waktu — salah kalau 1 cabang punya >1 shift per hari (pagi/sore).
alter table expenses add column shift_id uuid references cashier_shifts(id) on delete set null;
create index on expenses(shift_id);
