import { describe, expect, it } from "vitest";
import { ringkasRekap, ringkasTahap } from "../tagihan-berjalan";

const inv = (id: string, total: number, dp_amount = 0, extra = {}) => ({
  id, total, dp_amount, invoice_no: id, created_at: `2026-10-0${id === 'a' ? 1 : 2}T00:00:00Z`,
  paid_status: 'DP', voided_at: null, ...extra,
});

describe('rekap tagihan gabungan satu kunjungan', () => {
  it.each([
    [1_000_000, 0, 500_000, 500_000, 250_000],
    [1_300_000, 0, 500_000, 800_000, 400_000],
    [1_300_000, 200_000, 500_000, 1_000_000, 500_000],
  ])('saran 50%% dari sisa total, bukan tambahan/gross/target kumulatif (%s+%s)', (booked, pending, paid, remaining, suggestion) => {
    const result = ringkasRekap(ringkasTahap([inv('a', booked, paid)], []), pending, 0);
    expect(result).toMatchObject({ total: booked + pending, dibayar: paid, sisa: remaining, dpOpsional: suggestion });
  });

  it('pakai total tersimpan setelah pajak/diskon, bukan harga klinis', () => {
    const tahap = ringkasTahap([inv('a', 999_000, 500_000, { subtotal: 1_100_000, discount: 200_000, tax: 99_000 })], []);
    expect(ringkasRekap(tahap, 0, 0)).toMatchObject({ tertagih: 999_000, total: 999_000, sisa: 499_000, dpOpsional: 249_500 });
  });

  it('invoice void tidak dijumlah ulang; salinan reissue dan pembalik dihitung bersih', () => {
    const tahap = ringkasTahap([
      inv('a', 1_000_000, 500_000, { voided_at: '2026-10-03' }),
      inv('b', 1_000_000, 0, { reissued_from: 'a' }),
    ], [{ invoice_id: 'a', amount: 100_000 }, { invoice_id: 'b', amount: 600_000 }, { invoice_id: 'b', amount: -100_000 }]);
    expect(ringkasRekap(tahap, 0, 0)).toMatchObject({ total: 1_000_000, dibayar: 500_000, sisa: 500_000 });
  });

  it('uang muka terpakai tidak dijumlah dua kali; hanya saldo belum terpakai ditambahkan', () => {
    const tahap = ringkasTahap([inv('a', 1_000_000, 0)], [{ invoice_id: 'a', amount: 300_000 }]);
    expect(ringkasRekap(tahap, 200_000, 200_000)).toMatchObject({ total: 1_200_000, dibayar: 500_000, sisa: 700_000, dpOpsional: 350_000 });
  });

  it('kelebihan pembayaran tidak menghasilkan saran negatif; pembulatan rupiah ke atas', () => {
    expect(ringkasRekap(ringkasTahap([inv('a', 1_000, 1_500)], []), 0, 0).dpOpsional).toBe(0);
    expect(ringkasRekap(ringkasTahap([inv('a', 1_001, 0)], []), 0, 0).dpOpsional).toBe(501);
  });
});
