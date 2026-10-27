import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PriceDeviationConfirm, PriceDeviationHint } from "@/components/PriceDeviationConfirm";

it("P04: requires an explicit confirmation only while a line deviates", () => {
  expect(renderToStaticMarkup(<PriceDeviationConfirm count={0} />)).toBe("");
  const html = renderToStaticMarkup(<PriceDeviationConfirm count={2} />);
  expect(html).toContain('type="checkbox"');
  expect(html).toContain("required");
  expect(html).toContain("2 baris");
  expect(renderToStaticMarkup(<PriceDeviationHint warning={null} />)).toBe("");
  expect(renderToStaticMarkup(<PriceDeviationHint warning="Harga 80% lebih mahal" />)).toContain("80% lebih mahal");
});
