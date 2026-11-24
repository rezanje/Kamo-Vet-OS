import Link from "next/link";
import { KartuMasuk } from "../KartuMasuk";
import { LupaPasswordForm } from "./LupaPasswordForm";

export const metadata = { title: "Lupa password · VetOS" };

export default function LupaPasswordPage() {
  return (
    <KartuMasuk subjudul="Lupa password">
      <p style={{ fontSize: 12, margin: 0, color: "var(--tm)" }}>
        Tulis email yang kamu pakai untuk masuk. Kami kirim link untuk membuat password baru ke email itu.
      </p>
      <LupaPasswordForm />
      <Link href="/login" style={{ fontSize: 11.5, textAlign: "center" }}>
        <i className="ti ti-arrow-left" /> Kembali ke halaman masuk
      </Link>
    </KartuMasuk>
  );
}
