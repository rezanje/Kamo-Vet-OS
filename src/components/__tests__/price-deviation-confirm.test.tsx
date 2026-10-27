import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PriceDeviationConfirm } from "@/components/PriceDeviationConfirm";
import { PRICE_CONFIRM_FIELD } from "@/lib/purchase-price-check";

it("P04: offers the confirmation only after the server returned a warning", () => {
  expect(renderToStaticMarkup(<PriceDeviationConfirm />)).toBe("");
  const html = renderToStaticMarkup(<PriceDeviationConfirm warning="Harga jauh berbeda: Vaksin A" />);
  expect(html).toContain("Harga jauh berbeda: Vaksin A");
  expect(html).toContain(`name="${PRICE_CONFIRM_FIELD}"`);
  expect(html).toContain('value="1"');
});
