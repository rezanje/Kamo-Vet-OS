import { expect, it } from "vitest";
import { validateServicePerformerRows } from "../service-performers-server";

const staff = [
  { id: "doctor", nama: "Dokter Fiksi", jabatan: "Dokter Hewan", status: "Aktif", branch_id: "branch" },
  { id: "groomer", nama: "Groomer Fiksi", jabatan: "Groomer", status: "Aktif", branch_id: "branch" },
  { id: "paramedic", nama: "Perawat Fiksi", jabatan: "Paramedis", status: "Aktif", branch_id: "branch" },
];

function db(type: string, override: boolean | null) {
  const reads: string[] = [];
  return {
    reads,
    from(table: string) {
      reads.push(table);
      let from = 0, to = 499;
      const q = {
        select: () => q, eq: () => q, lte: () => q, order: () => q, in: () => q, or: () => q,
        range: (start: number, end: number) => { from = start; to = end; return q; },
        maybeSingle: async () => ({ data: table === "branches" ? { type } : table === "branch_grooming_rules" && override !== null ? { doctor_required: override } : null, error: null }),
        then: (resolve: (result: unknown) => unknown) => {
          const rows = table === "employees" ? staff : [];
          return Promise.resolve({ data: rows.slice(from, to + 1), count: rows.length, error: null }).then(resolve);
        },
      };
      return q;
    },
  };
}

const grooming = (doctor_id: string | null, staff_id: string | null) => [{
  item_type: "Jasa", tindakan_kategori: "Grooming", service_performers: { doctor_id, staff_id },
}];

it("requires a doctor and an actual groomer in a clinic branch", async () => {
  await expect(validateServicePerformerRows(db("KLINIK", null), "branch", grooming(null, "groomer"))).rejects.toThrow("Dokter wajib");
  await expect(validateServicePerformerRows(db("KLINIK", null), "branch", grooming("doctor", "paramedic"))).rejects.toThrow("Groomer aktif");
  await expect(validateServicePerformerRows(db("KLINIK", null), "branch", grooming("doctor", "groomer"))).resolves.toEqual([{ doctor_id: "doctor", staff_id: "groomer" }]);
});

it("lets a petshop save a groomer without a doctor and honors its explicit override", async () => {
  await expect(validateServicePerformerRows(db("PETSHOP", null), "branch", grooming(null, "groomer"))).resolves.toEqual([{ doctor_id: null, staff_id: "groomer" }]);
  await expect(validateServicePerformerRows(db("PETSHOP", true), "branch", grooming(null, "groomer"))).rejects.toThrow("Dokter wajib");
  await expect(validateServicePerformerRows(db("KLINIK", false), "branch", grooming(null, "groomer"))).resolves.toEqual([{ doctor_id: null, staff_id: "groomer" }]);
});

it("does not impose grooming rules on other services", async () => {
  const client = db("KLINIK", null);
  await expect(validateServicePerformerRows(client, "branch", [{ item_type: "Jasa", tindakan_kategori: "Konsultasi" }])).resolves.toEqual([{ doctor_id: null, staff_id: null }]);
  expect(client.reads).toEqual([]);
});

it("accepts a doctor and a non-doctor on an ordinary goods line, still checking branch membership", async () => {
  const goods = (doctor_id: string | null, staff_id: string | null) => [{
    item_type: "Persediaan", tindakan_kategori: null, service_performers: { doctor_id, staff_id },
  }];
  await expect(validateServicePerformerRows(db("KLINIK", null), "branch", goods("doctor", "groomer")))
    .resolves.toEqual([{ doctor_id: "doctor", staff_id: "groomer" }]);
  await expect(validateServicePerformerRows(db("KLINIK", null), "branch", goods("doctor", "outsider")))
    .rejects.toThrow("Non-dokter harus aktif dan ditugaskan di cabang transaksi");
  // Baris barang tanpa pelaksana tetap NULL, jadi dokumen lama tidak berubah artinya.
  const client = db("KLINIK", null);
  await expect(validateServicePerformerRows(client, "branch", goods(null, null))).resolves.toEqual([null]);
  expect(client.reads).toEqual([]);
});
