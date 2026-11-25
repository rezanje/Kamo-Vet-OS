import { Clock } from "./Clock";
import Link from "next/link";

// Header biru berlogo untuk staff klinik (ala referensi KAMO CLINIC).
// Hanya dirender di (app)/layout untuk role STAFF; admin tetap breadcrumb polos.
export function KlinikTopbar({ fullName, branchName }: { fullName: string; branchName: string }) {
  const initial = (fullName.trim()[0] ?? "S").toUpperCase();
  return (
    <div className="klinik-topbar no-print">
      <div className="kt-brand">
        <div className="kt-logo"><i className="ti ti-paw" /></div>
        <div>
          <div className="kt-name">KAMO CLINIC</div>
          <div className="kt-sub">Sistem Informasi Klinik Hewan · {branchName}</div>
        </div>
      </div>
      <div className="kt-right">
        <i className="ti ti-calendar" style={{ fontSize: 14, opacity: .9 }} />
        <Clock light />
        <span className="kt-divider" />
        <span className="kt-avatar">{initial}</span>
        <Link href="/crm/komplain" className="kt-user" title="Catat atau lihat komplain pelanggan" prefetch={false}><i className="ti ti-message-report" /> Komplain</Link>
        <span className="kt-divider" />
        <Link href="/me" className="kt-user" title="Profil dan password">{fullName}</Link>
      </div>
    </div>
  );
}
