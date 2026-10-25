import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ServicePerformersField } from "../ServicePerformersField";

const staff = [
  { id: "doctor", nama: "Dokter Fiksi", jabatan: "Dokter Hewan" },
  { id: "groomer", nama: "Groomer Fiksi", jabatan: "Groomer" },
  { id: "paramedic", nama: "Perawat Fiksi", jabatan: "Paramedis" },
];

it("shows only a groomer in the staff slot and requires both roles in a clinic", () => {
  const html = renderToStaticMarkup(<ServicePerformersField label="Grooming" staff={staff} grooming doctorRequired onChange={() => {}} />);
  expect(html).toContain("Groomer *");
  expect(html).toContain("Dokter *");
  expect(html.match(/required=""/g)).toHaveLength(2);
  expect(html).not.toContain("Perawat Fiksi");
});

it("requires only the groomer for a petshop branch", () => {
  const html = renderToStaticMarkup(<ServicePerformersField label="Grooming" staff={staff} grooming onChange={() => {}} />);
  expect(html.match(/required=""/g)).toHaveLength(1);
  expect(html).toContain("Groomer *");
  expect(html).not.toContain("Dokter *");
});
