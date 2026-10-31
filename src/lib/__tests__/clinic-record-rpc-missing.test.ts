import { describe, expect, it } from "vitest";
import { isMissingRecordWrapper } from "../rekam-medis-susulan";

const wrappers = ["clinic_post_invoice_with_record", "clinic_edit_invoice_with_record"] as const;
const commonParams = { p_lines: [], p_invoice: {}, p_request_key: "dummy" };

describe.each(wrappers)("exact schema-cache absence: %s", (wrapper) => {
  const params = { ...commonParams, [wrapper === "clinic_post_invoice_with_record" ? "p_visit_id" : "p_invoice_id"]: "dummy" };
  const signature = Object.keys(params).sort().join(", ");
  const missing = `Could not find the function public.${wrapper}(${signature}) in the schema cache`;
  it("accepts only the exact requested wrapper and parameter set", () => {
    expect(isMissingRecordWrapper({ code: "PGRST202", message: missing }, wrapper, params)).toBe(true);
  });
  it("matches only parameter keys actually serialized into the RPC body", () => {
    expect(isMissingRecordWrapper({ code: "PGRST202", message: missing }, wrapper, { ...params, p_payments: undefined })).toBe(true);
  });
  it("rejects SQLSTATE 42883 even if its message names the requested wrapper", () => {
    expect(isMissingRecordWrapper({ code: "42883", message: missing }, wrapper, params)).toBe(false);
  });
  it("rejects an internal dependency error", () => {
    expect(isMissingRecordWrapper({ code: "42883", message: "function clinic_private.link_unrecorded_lines(uuid, text, jsonb, text) does not exist" }, wrapper, params)).toBe(false);
  });
  it("rejects another wrapper, another schema, a different signature and a generic message", () => {
    for (const message of [
      "Could not find the function public.unrelated_function(p_lines) in the schema cache",
      `Could not find the function clinic_private.${wrapper}(${signature}) in the schema cache`,
      `Could not find the function public.${wrapper}(p_other) in the schema cache`,
      `Could not find the function public.${wrapper}_extra(${signature}) in the schema cache`,
      missing + " and another internal error",
      "function unavailable",
    ]) expect(isMissingRecordWrapper({ code: "PGRST202", message }, wrapper, params)).toBe(false);
  });
  it("fails closed without a verifiable error", () => {
    expect(isMissingRecordWrapper(null, wrapper, params)).toBe(false);
    expect(isMissingRecordWrapper({ code: "PGRST202" }, wrapper, params)).toBe(false);
    expect(isMissingRecordWrapper({ message: missing }, wrapper, params)).toBe(false);
  });
});
