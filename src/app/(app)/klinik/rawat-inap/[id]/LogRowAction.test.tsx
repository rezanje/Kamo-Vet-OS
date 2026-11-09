import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LogRowAction } from "./LogRowAction";

describe("LogRowAction — tautan edit catatan harian di halaman detail", () => {
  it("pasien aktif: berlabel jelas 'Lihat / Edit' (teks terlihat + tooltip) ke halaman catatan", () => {
    const html = renderToStaticMarkup(<LogRowAction recordId="rec-1" logId="log-9" editable />);
    expect(html).toContain('href="/klinik/rawat-inap/rec-1/catatan/log-9"');
    expect(html).toContain('title="Lihat / Edit"');
    expect(html).toContain(">Lihat / Edit<");
    expect(html).toContain("ti-pencil");
    expect(html).not.toContain("Lihat detail");
  });

  it("pasien sudah pulang: hanya 'Lihat detail' (edit terkunci), tanpa menjanjikan Edit", () => {
    const html = renderToStaticMarkup(<LogRowAction recordId="rec-1" logId="log-9" editable={false} />);
    expect(html).toContain('href="/klinik/rawat-inap/rec-1/catatan/log-9"');
    expect(html).toContain("Lihat detail");
    expect(html).not.toContain("Edit");
  });
});
