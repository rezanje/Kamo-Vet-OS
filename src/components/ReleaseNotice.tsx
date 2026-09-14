"use client";

import { useEffect, useState } from "react";

// Never reload a working form automatically. Poll only visible browser tabs.
export function ReleaseNotice({ version }: { version: string }) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (version === "local") return;
    let stopped = false;
    let busy = false;
    let lastCheck = 0;
    async function check() {
      if (document.visibilityState !== "visible" || busy || Date.now() - lastCheck < 60000) return;
      busy = true;
      lastCheck = Date.now();
      try {
        const response = await fetch("/api/version", { cache: "no-store", signal: AbortSignal.timeout(8000) });
        if (!response.ok) return;
        const result = await response.json();
        if (!stopped && typeof result.version === "string" && result.version !== "local" && result.version !== version) setAvailable(true);
      } catch { /* Offline: keep working on the current page. */ }
      finally { busy = false; }
    }
    void check();
    const timer = setInterval(() => void check(), 120000);
    document.addEventListener("visibilitychange", check);
    return () => { stopped = true; clearInterval(timer); document.removeEventListener("visibilitychange", check); };
  }, [version]);
  if (!available) return null;
  return <div className="p2ban no-print" role="status" style={{ margin: 8, display: "flex", gap: 12, alignItems: "center" }}>
    <span>Versi baru tersedia. Simpan pekerjaan sebelum memperbarui halaman.</span>
    <button type="button" className="btn-def" onClick={() => {
      if (window.confirm("Pekerjaan yang belum disimpan akan hilang. Sudah disimpan dan siap memperbarui?")) window.location.reload();
    }}>Perbarui halaman</button>
  </div>;
}
