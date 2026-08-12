// Daftar metode bayar kasir — satu sumber untuk layar bayar per hewan dan
// bayar rombongan, supaya keduanya tidak pernah menawarkan pilihan berbeda.

export const METODE_BAYAR = [
  { m: "Tunai", ic: "ti-cash", desc: "Bayar dengan uang tunai" },
  { m: "Transfer", ic: "ti-building-bank", desc: "Bayar melalui transfer bank" },
  { m: "Kartu", ic: "ti-credit-card", desc: "Bayar dengan kartu debit atau kredit" },
  { m: "QRIS", ic: "ti-qrcode", desc: "Bayar menggunakan QRIS" },
  { m: "E-Wallet", ic: "ti-wallet", desc: "Bayar menggunakan e-wallet" },
] as const;
