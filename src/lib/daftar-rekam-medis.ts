export type BarisDaftarRekamMedis = {
  ownerName: string;
  petName: string;
  phone: string;
};

function normalisasi(value: string) {
  return value.trim().toLocaleLowerCase("id-ID");
}

export function saringDaftarRekamMedis<T extends BarisDaftarRekamMedis>(rows: T[], query: string) {
  const cari = normalisasi(query);
  if (!cari) return rows;

  return rows.filter((row) => [row.ownerName, row.petName, row.phone]
    .some((value) => normalisasi(value).includes(cari)));
}
