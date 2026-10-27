// Hitungan komisi penjual (migrasi 0091) — murni, dites di __tests__/komisi.test.ts.
//
// Masukan: baris penjualan satu periode (retur ikut, bernilai negatif) + aturan komisi.
// Keluaran: per karyawan — omzet, laba, komisi, dan rincian per aturan supaya angkanya
// bisa ditelusuri, bukan cuma satu total yang harus dipercaya begitu saja.

/**
 * kasir = struk POS & penjualan online · klinik = tagihan kunjungan yang sudah lunas ·
 * reseller = faktur penjualan B2B dari rantai dokumen (migrasi 0098).
 * visit_ranap = visit dokter rawat inap yang dikerjakan (H06) — bukan penjualan: omzet 0,
 * dan hanya aturan bersumber visit_ranap yang boleh membayarnya.
 */
export type SumberJual = "kasir" | "klinik" | "reseller" | "visit_ranap";

export type BarisJual = {
  /** Recorded service evidence stays one revenue row even when two people worked. */
  servicePerformers?: import("./service-performers").ServicePerformersSnapshot;
  sourceLineId?: string;
  sourceDocumentId?: string;
  sourceDocumentNumber?: string;
  sourceDocumentHref?: string;
  commissionPending?: boolean;
  /** A chosen policy is evidence on the original source row, never another sale. */
  commissionPolicy?: "personal_rules" | "both_full" | "split";
  commissionPolicyWarning?: string;
  /** Returns use the original sale date to select the same two-person policy. */
  commissionPolicyDate?: string;
  /** Calculation-only actor row: a personal rule must name this employee. */
  personalRulesOnly?: boolean;
  /** Posted DEMO allocation replaces legacy commission while retaining target revenue. */
  fixedCommission?: boolean;
  /**
   * H05: component line sold as part of a package. Such a line is never a normal SKU
   * sale; `ringkasPaket` folds it into one package row (item = package, qty = package qty).
   */
  paketAsal?: { itemId: string; qty: number; kategoriIds: string[] };
  /** H05 evidence on a folded package row: number of component lines it replaced. */
  paketKomponen?: number;
  /** H06 evidence: visit date (Asia/Jakarta) and inpatient stay of a counted doctor visit. */
  visitTanggal?: string;
  visitRawatInapId?: string;
  tanggal: string;              // YYYY-MM-DD
  sumber: SumberJual;
  // null = struknya tidak terhubung ke karyawan mana pun. Barisnya tetap dibawa
  // supaya realisasi target per cabang/kategori tidak kehilangan omzet, tapi
  // tidak ikut dihitung komisinya.
  employeeId: string | null;
  branchId: string | null;
  itemId: string | null;
  kategoriIds: string[];        // kategori barang + induknya
  qty: number;                  // negatif untuk baris retur
  omzet: number;                // negatif untuk baris retur
  laba: number | null;          // null = HPP tidak diketahui
};

export type AturanKomisi = {
  id: string;
  nama: string;
  tipe: "persen" | "nominal";
  basis: "omzet" | "laba";
  sumber: SumberJual | "semua";
  persen: number;
  nominal: number;              // rupiah per unit terjual
  employeeId: string | null;
  branchId: string | null;
  categoryId: string | null;
  itemId: string | null;
  minOmzet: number;
  dari: string | null;
  sampai: string | null;
  /** Optional configured grade/group; null leaves the legacy rule unrestricted. */
  commissionGroup?: string | null;
  /** Individual rule explicitly replaces this group rule on intersecting lines. */
  overrideGroupRuleId?: string | null;
};

/** employeeId → configured commission group/grade (H04). */
export type KelompokKaryawan = ReadonlyMap<string, string | null>;

export type RincianAturan = {
  aturanId: string;
  nama: string;
  dasar: number;                // omzet/laba yang kena aturan ini, atau qty untuk tipe nominal
  komisi: number;               // 0 kalau ambang belum terlewati
  cair: boolean;
};

export type HasilKomisi = {
  employeeId: string;
  omzet: number;
  laba: number;                 // hanya dari baris yang HPP-nya diketahui
  barisTanpaHpp: number;
  komisi: number;
  rincian: RincianAturan[];
};

export type TargetPenjualan = {
  id: string;
  employeeId: string | null;
  branchId: string | null;
  categoryId: string | null;
  basis: "omzet" | "laba";
  target: number;
};

/**
 * Realisasi satu target dari baris penjualan periode itu. Cakupan yang null =
 * semua, sama seperti aturan komisi. Baris tanpa penjual tetap dihitung untuk
 * target cabang/kategori — omzetnya nyata, cuma belum bisa dinisbahkan ke orang.
 */
export function realisasiTarget(baris: BarisJual[], t: TargetPenjualan): { realisasi: number; persen: number } {
  const kena = baris.filter((b) =>
    (!t.employeeId || t.employeeId === b.employeeId) &&
    (!t.branchId || t.branchId === b.branchId) &&
    (!t.categoryId || b.kategoriIds.includes(t.categoryId)));

  const realisasi = Math.round(
    t.basis === "laba"
      ? kena.reduce((s, b) => s + (b.laba ?? 0), 0)
      : kena.reduce((s, b) => s + b.omzet, 0),
  );
  return { realisasi, persen: t.target > 0 ? Math.round((realisasi / t.target) * 100) : 0 };
}

export function cocokAturanKomisi(b: BarisJual, a: AturanKomisi, groups?: KelompokKaryawan): boolean {
  if (b.fixedCommission) return false;
  // A component line still tagged with its package is never a normal SKU sale (H05).
  if (b.paketAsal) return false;
  // Inpatient visits are paid only by visit rules; a sales rule never pays a visit,
  // and a visit rule never pays a sale (H06).
  if ((a.sumber === "visit_ranap") !== (b.sumber === "visit_ranap")) return false;
  if (a.commissionGroup && (!b.employeeId || groups?.get(b.employeeId) !== a.commissionGroup)) return false;
  if (b.personalRulesOnly && a.employeeId !== b.employeeId) return false;
  // Tanpa saringan sumber, aturan "insentif dokter" ikut membayar penjualan petshop
  // begitu dokternya sekali saja menutup struk kasir.
  if (a.sumber !== "semua" && a.sumber !== b.sumber) return false;
  if (a.employeeId && a.employeeId !== b.employeeId) return false;
  if (a.branchId && a.branchId !== b.branchId) return false;
  if (a.itemId && a.itemId !== b.itemId) return false;
  // Kategori induk ikut menjaring produk di kategori anaknya — kategoriIds sudah
  // berisi rantai kategori barang itu.
  if (a.categoryId && !b.kategoriIds.includes(a.categoryId)) return false;
  if (a.dari && b.tanggal < a.dari) return false;
  if (a.sampai && b.tanggal > a.sampai) return false;
  return true;
}

export function hitungKomisi(baris: BarisJual[], aturan: AturanKomisi[], groupPerEmployee: KelompokKaryawan = new Map()): HasilKomisi[] {
  const ruleById = new Map(aturan.map(rule => [rule.id, rule]));
  const overridesByParent = new Map<string, AturanKomisi[]>();
  for (const rule of aturan) {
    if (!rule.overrideGroupRuleId) continue;
    const list = overridesByParent.get(rule.overrideGroupRuleId) ?? [];
    list.push(rule);
    overridesByParent.set(rule.overrideGroupRuleId, list);
  }
  const perOrang = new Map<string, BarisJual[]>();
  for (const b of baris) {
    if (!b.employeeId) continue;
    const arr = perOrang.get(b.employeeId) ?? [];
    arr.push(b);
    perOrang.set(b.employeeId, arr);
  }

  const hasil: HasilKomisi[] = [];

  for (const [employeeId, milikDia] of perOrang) {
    const omzet = milikDia.reduce((a, b) => a + b.omzet, 0);
    const laba = milikDia.reduce((a, b) => a + (b.laba ?? 0), 0);
    const barisTanpaHpp = milikDia.filter((b) => b.laba === null).length;

    const rincian: RincianAturan[] = [];

    for (const a of aturan) {
      const base = a.overrideGroupRuleId ? ruleById.get(a.overrideGroupRuleId) : null;
      // A stale/deactivated group rule must not leave a standalone individual payout.
      if (a.overrideGroupRuleId && (!base?.commissionGroup || groupPerEmployee.get(employeeId) !== base.commissionGroup)) continue;
      const kena = milikDia.filter((b) => {
        if (!cocokAturanKomisi(b, a, groupPerEmployee)) return false;
        if (base && !cocokAturanKomisi(b, base, groupPerEmployee)) return false;
        if (!a.commissionGroup) return true;
        // An explicit individual exception replaces this group rule on the lines it covers.
        return !(overridesByParent.get(a.id) ?? []).some(individual =>
          individual.employeeId === employeeId && cocokAturanKomisi(b, individual, groupPerEmployee));
      });
      if (kena.length === 0) continue;

      let dasar = 0;
      let komisi = 0;

      if (a.tipe === "nominal") {
        // Rupiah tetap per unit — tidak butuh HPP, jadi basisnya tidak dipakai.
        dasar = kena.reduce((s, b) => s + b.qty, 0);
        komisi = dasar * a.nominal;
      } else if (a.basis === "laba") {
        // Baris tanpa HPP dilewati, bukan dianggap laba penuh — itu akan melebihkan komisi.
        const berHpp = kena.filter((b) => b.laba !== null);
        dasar = berHpp.reduce((s, b) => s + (b.laba as number), 0);
        komisi = (dasar * a.persen) / 100;
      } else {
        dasar = kena.reduce((s, b) => s + b.omzet, 0);
        komisi = (dasar * a.persen) / 100;
      }

      // Ambang diukur dari realisasi karyawan sebulan, bukan dari baris yang kena aturan —
      // "komisi cair kalau bulan ini tembus sekian" memang maksudnya begitu.
      const realisasi = a.basis === "laba" ? laba : omzet;
      const parentRealisasi = base?.basis === "laba" ? laba : omzet;
      const cair = (a.minOmzet <= 0 || realisasi >= a.minOmzet)
        && (!base || base.minOmzet <= 0 || parentRealisasi >= base.minOmzet);

      // Komisi negatif (retur melebihi penjualan) ditahan di nol: gaji orang tidak
      // dipotong gara-gara komisi, potongan retur diurus terpisah kalau memang perlu.
      const nilai = cair ? Math.max(0, Math.round(komisi)) : 0;
      // Qty may be fractional (for example a half-unit service). Rounding it in
      // the evidence while calculating payout from the original qty misstates the rate.
      rincian.push({ aturanId: a.id, nama: a.nama, dasar: a.tipe === "nominal" ? dasar : Math.round(dasar), komisi: nilai, cair });
    }

    hasil.push({
      employeeId,
      omzet: Math.round(omzet),
      laba: Math.round(laba),
      barisTanpaHpp,
      komisi: rincian.reduce((s, r) => s + r.komisi, 0),
      rincian,
    });
  }

  return hasil;
}

export type SharedIncentive = {employeeId: string;invoiceId: string;amount: number;basis: number};
export function mergeSharedIncentives(hasil: HasilKomisi[], allocations: readonly SharedIncentive[]): HasilKomisi[] {
  const rows = new Map(hasil.map(row=>[row.employeeId,{...row,rincian:[...row.rincian]}]));
  const seen = new Set<string>();
  for (const allocation of allocations) {
    const key = `${allocation.invoiceId}:${allocation.employeeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = rows.get(allocation.employeeId) ?? {employeeId:allocation.employeeId,omzet:0,laba:0,barisTanpaHpp:0,komisi:0,rincian:[]};
    row.komisi += allocation.amount;
    row.rincian.push({aturanId:`demo:${allocation.invoiceId}`,nama:"Pool jasa DEMO",dasar:allocation.basis,komisi:allocation.amount,cair:true});
    rows.set(row.employeeId,row);
  }
  return [...rows.values()];
}

/**
 * H05: fold package component lines into one package row per document and package.
 * Omzet/laba of the package = sum of its component lines; qty = package qty, so a rule
 * on the package item counts packages and a rule on the component SKU never sees them.
 * Example: 3 bundles + 1 normal vaccine → SKU rule qty 1, package rule qty 3.
 */
export function ringkasPaket(rows: readonly BarisJual[]): BarisJual[] {
  const out: BarisJual[] = [];
  const groups = new Map<string, BarisJual>();
  for (const row of rows) {
    const asal = row.paketAsal;
    if (!asal) { out.push(row); continue; }
    const key = `${row.sumber}:${row.sourceDocumentId ?? ""}:${row.tanggal}:${asal.itemId}`;
    const existing = groups.get(key);
    if (!existing) {
      const folded: BarisJual = {
        tanggal: row.tanggal, sumber: row.sumber, employeeId: row.employeeId, branchId: row.branchId,
        itemId: asal.itemId, kategoriIds: asal.kategoriIds, qty: row.qty < 0 ? -asal.qty : asal.qty,
        omzet: row.omzet, laba: row.laba, paketKomponen: 1, fixedCommission: row.fixedCommission,
        sourceDocumentId: row.sourceDocumentId, sourceDocumentNumber: row.sourceDocumentNumber,
        sourceDocumentHref: row.sourceDocumentHref,
      };
      groups.set(key, folded);
      out.push(folded);
      continue;
    }
    existing.omzet += row.omzet;
    existing.laba = existing.laba === null || row.laba === null ? null : existing.laba + row.laba;
    existing.paketKomponen = (existing.paketKomponen ?? 0) + 1;
    // Component lines of one package keep the same package qty; a disagreement keeps the larger.
    if (Math.abs(asal.qty) > Math.abs(existing.qty)) existing.qty = row.qty < 0 ? -asal.qty : asal.qty;
    // Different sellers on one package cannot be split by guesswork: it stays unassigned.
    if (existing.employeeId !== row.employeeId) existing.employeeId = null;
  }
  return out;
}

export type LogVisitDokter = {
  id: string;
  inpatientRecordId: string;
  doctorId: string | null;
  branchId: string | null;
  createdAt: string;
};

export type VisitDobel = LogVisitDokter & { tanggal: string; dihitungLogId: string };

/**
 * H06: doctor visits actually done on inpatient stays. At most one visit counts per doctor,
 * per stay, per calendar date in Asia/Jakarta; the earliest log is the counted evidence.
 * A log without a doctor never counts (nobody to pay).
 */
export function barisVisitRanap(logs: readonly LogVisitDokter[]): { baris: BarisJual[]; dobel: VisitDobel[] } {
  const sorted = [...logs].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const counted = new Map<string, string>();
  const baris: BarisJual[] = [];
  const dobel: VisitDobel[] = [];
  for (const log of sorted) {
    if (!log.doctorId) continue;
    const tanggal = tanggalJakarta(log.createdAt);
    const key = `${log.doctorId}:${log.inpatientRecordId}:${tanggal}`;
    const first = counted.get(key);
    if (first) { dobel.push({ ...log, tanggal, dihitungLogId: first }); continue; }
    counted.set(key, log.id);
    baris.push({
      tanggal, sumber: "visit_ranap", employeeId: log.doctorId, branchId: log.branchId,
      itemId: null, kategoriIds: [], qty: 1, omzet: 0, laba: 0,
      sourceLineId: log.id, sourceDocumentId: log.inpatientRecordId,
      sourceDocumentHref: `/klinik/rawat-inap/${log.inpatientRecordId}`,
      visitTanggal: tanggal, visitRawatInapId: log.inpatientRecordId,
    });
  }
  return { baris, dobel };
}

/** Asia/Jakarta has no daylight saving: UTC+7 all year. */
function tanggalJakarta(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}
