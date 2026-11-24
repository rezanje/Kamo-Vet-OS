import { KartuMasuk } from "../KartuMasuk";
import { PasswordBaruForm } from "./PasswordBaruForm";

export const metadata = { title: "Buat password baru · VetOS" };

// Dibuka dari link di email "lupa password". Token ada di bagian # alamat, jadi hanya dibaca di browser.
export default function PasswordBaruPage() {
  return (
    <KartuMasuk subjudul="Buat password baru">
      <PasswordBaruForm />
    </KartuMasuk>
  );
}
