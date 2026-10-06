import { describe, expect, it } from "vitest";
import { parseSplitPaymentDraft, validateSplitPaymentTotal } from "../clinic-split-payment";

const split = [{ method: "Tunai", amount: 500000 }, { method: "Transfer", amount: 500000 }];
describe("mixed clinic payment", () => {
  it("accepts two methods for one million rupiah", () => {
    expect(parseSplitPaymentDraft(JSON.stringify(split))).toEqual(split);
    expect(() => validateSplitPaymentTotal(split, 1000000)).not.toThrow();
  });
  it.each([999999, 1000001, NaN, Infinity, -1])("rejects a mismatched or invalid total %s", total => {
    expect(() => validateSplitPaymentTotal(split, total)).toThrow();
  });
  it.each(["oops", "null", "{}", "[]", JSON.stringify([split[0]]), JSON.stringify(Array(7).fill(split[0])),
    JSON.stringify([{ method: "Fake", amount: 1 }, split[1]]),
    JSON.stringify([{ method: "Tunai", amount: 0 }, split[1]]),
    JSON.stringify([{ method: "Tunai", amount: -1 }, split[1]]),
    JSON.stringify([{ method: "Tunai", amount: 1.5 }, split[1]]),
    JSON.stringify([{ method: "Tunai", amount: "500000" }, split[1]])])("rejects malformed parts %s", raw => {
    expect(() => parseSplitPaymentDraft(raw)).toThrow();
  });
  it("rejects unsafe integer sums", () => {
    expect(() => validateSplitPaymentTotal([{amount: Number.MAX_SAFE_INTEGER}, {amount: 1}], Number.MAX_SAFE_INTEGER)).toThrow();
  });
});
