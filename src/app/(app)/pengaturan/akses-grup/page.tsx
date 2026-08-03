import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { MODULES } from "@/lib/nav";
import {
  JALUR_TAMBAHAN, modulDiizinkan, pakaiAturanSendiri, SEMUA_PERAN, type AturanTersimpan,
} from "@/lib/akses";
import { kembalikanBawaan, mulaiAturSendiri, simpanAksesPeran } from "./actions";

const KETERANGAN_PERAN: Record<string, string> = {
  OWNER: "Pemilik — selalu penuh, tidak bisa dibatasi",
  ADMIN: "Admin kantor",
  FINANCE: "Keuangan",
  STAFF: "Kasir & staf operasional",
  DOCTOR: "Dokter hewan",
};

export default async function AksesGrupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; peran?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();

  const [{ data: { user } }, { data: aturanData }, { data: jumlahData }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("role_modules").select("role, module_id"),
    supabase.from("profiles").select("role"),
  ]);

  const { data: profil } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle()
    : { data: null };
  const akuOwner = profil?.role === "OWNER";

  const tersimpan = (aturanData ?? []) as AturanTersimpan;
  const jumlahPengguna = new Map<string, number>();
  for (const p of (jumlahData ?? []) as { role: string }[]) {
    jumlahPengguna.set(p.role, (jumlahPengguna.get(p.role) ?? 0) + 1);
  }

  const bisaDiatur = SEMUA_PERAN.filter((r) => r !== "OWNER");
  const dipilih = sp.peran && (bisaDiatur as readonly string[]).includes(sp.peran) ? sp.peran : bisaDiatur[0];
  const modulDipilih = modulDiizinkan(dipilih, tersimpan);
  const punyaAturanSendiri = pakaiAturanSendiri(dipilih, tersimpan);
  const dicentang = new Set(modulDipilih ?? MODULES.map((m) => m.id));

  return (
    <MasterPage
      back="/pengaturan" icon="ti-shield-lock" title="AKSES GRUP"
      desc="Atur sendiri modul apa yang boleh dibuka tiap peran"
      error={sp.error} success={sp.success} successMsg={sp.success ?? "Tersimpan."}
      bolehKelola={akuOwner}
      readOnlyNote="Hanya pemilik yang boleh mengubah hak akses. Kamu bisa melihat, tapi tidak bisa menyimpan."
    >
      <div className="crm-sec">
        <SecHeader num="01" title="RINGKASAN PERAN" desc="Peran yang belum pernah diatur memakai aturan bawaan sistem." />

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th style={{ width: 110 }}>Peran</th>
                <th>Keterangan</th>
                <th style={{ width: 90, textAlign: "right" }}>Pengguna</th>
                <th style={{ width: 120 }}>Modul</th>
                <th style={{ width: 150 }}>Sumber aturan</th>
              </tr>
            </thead>
            <tbody>
              {SEMUA_PERAN.map((r) => {
                const modul = modulDiizinkan(r, tersimpan);
                return (
                  <tr key={r} style={r === dipilih ? { background: "#eff6ff" } : undefined}>
                    <td style={{ fontSize: 11.5, fontWeight: 700 }}>{r}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{KETERANGAN_PERAN[r]}</td>
                    <td style={{ textAlign: "right", fontSize: 11 }}>{jumlahPengguna.get(r) ?? 0}</td>
                    <td style={{ fontSize: 11 }}>{modul === null ? "Semua" : `${modul.length} modul`}</td>
                    <td style={{ fontSize: 10.5 }}>
                      {r === "OWNER"
                        ? <span className="bge b">Selalu penuh</span>
                        : pakaiAturanSendiri(r, tersimpan)
                          ? <span className="bge g">Diatur sendiri</span>
                          : <span className="bge">Bawaan sistem</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <SecHeader
          num="02" title={`MODUL UNTUK ${dipilih}`}
          desc="Centang modul yang boleh dibuka. Yang tidak dicentang diblokir juga kalau URL-nya diketik langsung."
          action={
            <form method="get" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <select className="fi" name="peran" defaultValue={dipilih} style={{ fontSize: 11, height: 30, width: 150 }}>
                {bisaDiatur.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <button type="submit" className="btn-def" style={{ height: 30, fontSize: 11 }}>Lihat</button>
            </form>
          }
        />

        {!punyaAturanSendiri && (
          <div className="p2ban">
            <i className="ti ti-info-circle" /> {dipilih} masih memakai aturan bawaan sistem. Centang di bawah
            menunjukkan bawaannya; tekan &ldquo;Mulai atur sendiri&rdquo; kalau mau mengubahnya.
          </div>
        )}

        {(JALUR_TAMBAHAN[dipilih] ?? []).length > 0 && (
          <div style={{ fontSize: 10.5, color: "var(--tm)", marginBottom: 10 }}>
            Catatan: layar kasir &amp; shift tetap bisa dibuka peran ini di luar centang di bawah — tanpa itu
            mereka tidak bisa bekerja sama sekali.
          </div>
        )}

        <form action={simpanAksesPeran}>
          <input type="hidden" name="role" value={dipilih} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 8, marginBottom: 14 }}>
            {MODULES.map((m) => (
              <label key={m.id} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
                border: ".5px solid var(--bd)", borderRadius: 7, fontSize: 11.5,
                cursor: akuOwner ? "pointer" : "default", opacity: akuOwner ? 1 : 0.7,
              }}>
                <input type="checkbox" name={`mod_${m.id}`} defaultChecked={dicentang.has(m.id)} disabled={!akuOwner} />
                <i className={`ti ${m.icon}`} style={{ color: "#2563eb" }} />
                <span>{m.label}</span>
              </label>
            ))}
          </div>

          {akuOwner && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ background: "#2563eb" }}>
                Simpan hak akses {dipilih}
              </SubmitButton>
            </div>
          )}
        </form>

        {akuOwner && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            {!punyaAturanSendiri ? (
              <form action={mulaiAturSendiri}>
                <input type="hidden" name="role" value={dipilih} />
                <SubmitButton className="btn-def" icon="ti-edit" style={{ fontSize: 10.5 }} pendingText="…">
                  Mulai atur sendiri
                </SubmitButton>
              </form>
            ) : (
              <form action={kembalikanBawaan}>
                <input type="hidden" name="role" value={dipilih} />
                <SubmitButton className="btn-def" icon="ti-rotate" style={{ fontSize: 10.5 }} pendingText="…">
                  Kembalikan ke bawaan
                </SubmitButton>
              </form>
            )}
          </div>
        )}
      </div>
    </MasterPage>
  );
}
