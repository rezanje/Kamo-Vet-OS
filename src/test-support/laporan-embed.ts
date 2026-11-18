// Pembantu uji: fixture laporan menyimpan baris item dengan induknya tertanam (invoices / sales / sales_invoices).
// Pemuat laporan membaca induk sekali lalu item per kelompok id induk; fake ini menurunkan keduanya dari fixture yang sama.
type Baris = Record<string, unknown>;
type Tabel = Record<string, unknown[]>;

const PASANGAN: Record<string, { item: string; induk: string; fk: string }> = {
  invoices: { item: "invoice_items", induk: "invoices", fk: "invoice_id" },
  sales: { item: "sale_items", induk: "sales", fk: "sale_id" },
  sales_invoices: { item: "sales_invoice_items", induk: "sales_invoices", fk: "invoice_id" },
};

function indukDariItem(tables: Tabel, jenis: string): Baris[] {
  const { item, induk } = PASANGAN[jenis];
  const unik = new Map<string, Baris>();
  for (const baris of (tables[item] ?? []) as Baris[]) {
    const nilai = baris[induk] as Baris | undefined;
    if (nilai && typeof nilai.id === "string" && !unik.has(nilai.id)) unik.set(nilai.id, nilai);
  }
  return [...unik.values()];
}

/** Baris yang dikembalikan fake untuk satu query: tabel induk diturunkan dari item bila tabelnya tidak diisi / dibaca sebagai induk laporan. */
export function barisFixture(tables: Tabel, table: string, kolom: string): unknown[] {
  const jenis = Object.keys(PASANGAN).find(k => PASANGAN[k].induk === table);
  if (jenis) {
    const bacaSebagaiInduk = table !== "sales_invoices" || kolom.includes("branches(name)");
    if (bacaSebagaiInduk && (tables[table] === undefined || table === "sales_invoices")) return indukDariItem(tables, jenis);
    return tables[table] ?? [];
  }
  const asal = Object.values(PASANGAN).find(p => p.item === table);
  if (asal && (tables[table] ?? []).some(baris => (baris as Baris)[asal.induk] !== undefined)) {
    return (tables[table] as Baris[]).map(baris => {
      const { [asal.induk]: induk, ...sisa } = baris;
      return { ...sisa, [asal.fk]: (induk as Baris).id };
    });
  }
  return tables[table] ?? [];
}
