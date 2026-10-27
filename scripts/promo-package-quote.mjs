#!/usr/bin/env node
// Quote cashier promo discounts with the app's own engine, from promo rows read out of a test database.
// stdin: {branchId, promos:[promo rows], targets:[{promo_id,item_id}], carts:[{ref, lines:[{item_id,qty,harga}]}]}
// stdout: [{ref, gross, net, lines:[{item_id,qty,harga,promo_discount,promo_id}]}]
// Used by scripts/test-promo-package-fifo-floor-postgres.py; fictional data only, no network.
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": path.join(root, "src") } });
const { loadPromoAktif } = await jiti.import(path.join(root, "src/lib/promo-hitung.ts"));
const { serviceLinePromos } = await jiti.import(path.join(root, "src/lib/service-line-promos.ts"));
const { lineDiscount, linePromoApplied } = await jiti.import(path.join(root, "src/lib/pos-calc.ts"));

let input = "";
for await (const chunk of process.stdin) input += chunk;
const { branchId, promos, targets, carts } = JSON.parse(input);

// Read-only stand-in for the Supabase query builder: the same filters, ordering, ranges and exact counts
// loadPromoAktif asks for, served from the rows the database returned.
function client() {
  return {
    from(table) {
      const eqs = {}; let ids = null; const orders = [];
      const rows = () => (table === "promos" ? promos : targets)
        .filter((r) => Object.entries(eqs).every(([k, v]) => r[k] === v) && (!ids || ids.includes(r.promo_id)))
        .sort((a, b) => orders.map((k) => String(a[k]).localeCompare(String(b[k]))).find((c) => c !== 0) ?? 0);
      const page = (from, to) => { const all = rows(); return { data: all.slice(from, to + 1), error: null, count: all.length }; };
      const q = {
        select() { return q; }, eq(k, v) { eqs[k] = v; return q; }, in(_k, v) { ids = v; return q; },
        order(k) { orders.push(k); return q; }, range(a, b) { return Promise.resolve(page(a, b)); },
        then(resolve) { return Promise.resolve(page(0, 999)).then(resolve); },
      };
      return q;
    },
  };
}

const rules = await loadPromoAktif(client(), branchId);
const out = [];
for (const cart of carts) {
  const rows = cart.lines.map((l) => ({ ...l, satuan: "pcs", item_type: "Persediaan" }));
  for (const hit of serviceLinePromos(rules, rows)) {
    rows[hit.lineIndex].promo_discount = hit.potongan;
    rows[hit.lineIndex].promo_id = hit.promoId;
  }
  const gross = rows.reduce((a, l) => a + l.qty * l.harga, 0);
  const net = gross - rows.reduce((a, l) => a + lineDiscount(l), 0);
  out.push({ ref: cart.ref, gross, net, lines: rows.map((l) => ({
    item_id: l.item_id, qty: l.qty, harga: l.harga, promo_discount: linePromoApplied(l), promo_id: l.promo_id ?? null,
  })) });
}
process.stdout.write(JSON.stringify(out));
