import { describe, expect, it } from "vitest";
import { bolehPostingRun, runKey } from "../impor-run";

describe("import run", () => {
  it("hash sama pada jenis sama menjadi key sama", () => {
    expect(runKey("master_accurate", "ABC")).toBe(runKey("master_accurate", "abc"));
  });

  it("hanya previewed boleh diposting", () => {
    expect(bolehPostingRun("previewed")).toBe(true);
    expect(bolehPostingRun("posted")).toBe(false);
    expect(bolehPostingRun("failed")).toBe(false);
  });
});
