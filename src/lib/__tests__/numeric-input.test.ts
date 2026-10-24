import { expect, it } from "vitest";
import { formatNumericDisplay, numericPaste } from "../numeric-input";

it.each([
  ["", ""], ["0", "0"], ["-0", "-0"], ["15000", "15.000"], ["1000000", "1.000.000"],
  ["-1234567.0012300", "-1.234.567,0012300"], ["0.000001", "0,000001"],
  ["1e-7", "0,0000001"], ["1e21", "1.000.000.000.000.000.000.000"],
  ["9007199254740993.1234567890123456789", "9.007.199.254.740.993,1234567890123456789"],
  ["1e-9999999999", "1e-9999999999"], ["1e9999999999", "1e9999999999"],
])("formats %s without rounding", (value, expected) => expect(formatNumericDisplay(value)).toBe(expected));

it.each([
  ["15000", "15000"], ["15000.25", "15000.25"], ["-0.000001", "-0.000001"],
  ["1.000.000", "1000000"], ["15.000,125", "15000.125"], ["-1.234,50", "-1234.50"],
  ["12,345", "12.345"], ["Rp 15.000", "15000"], ["1e-7", "1e-7"],
  ["0.001", "0.001"], ["-0.001", "-0.001"],
])("normalizes unambiguous clipboard %s", (text, value) => expect(numericPaste(text)).toEqual({ value }));

it.each(["1.234", "15.000", "NaN", "Infinity", "1.2.3", "1,234.56", "hello", "1.000garbage"])("rejects ambiguous or invalid clipboard %s", text => {
  expect(numericPaste(text)).toHaveProperty("error");
});
it("preserves same-app native decimal copies that would otherwise be ambiguous", () => {
  expect(numericPaste("1.234", true)).toEqual({value:"1.234"});
  expect(numericPaste("15.000", true)).toEqual({value:"15.000"});
  expect(numericPaste("1.2.3", true)).toHaveProperty("error");
});
