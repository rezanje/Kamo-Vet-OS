import { describe, expect, it } from "vitest";
import { parseEmployeeBranches } from "./employee-branch-input";
const employee = "a1000000-0000-4000-8000-000000000001";
const branchA = "a2000000-0000-4000-8000-000000000001";
const branchB = "a2000000-0000-4000-8000-000000000002";
function form(ids = [branchA, branchB], date = "2026-10-05") {
  const data = new FormData(); data.set("employee_id", employee); data.set("effective_date", date);
  ids.forEach(id => data.append("branch_ids", id)); return data;
}
describe("multi-branch assignment input", () => {
  it("accepts multiple branches and removes duplicate selections", () => {
    expect(parseEmployeeBranches(form([branchA, branchB, branchA]), "2026-10-06")).toEqual({ employeeId: employee, branchIds: [branchA, branchB], effectiveDate: "2026-10-05" });
  });
  it("supports older forms with one branch and defaults to the supplied Jakarta date", () => {
    const data=form([], "");data.set("branch_id",branchA);
    expect(parseEmployeeBranches(data,"2026-10-06").effectiveDate).toBe("2026-10-06");
    expect(parseEmployeeBranches(data,"2026-10-06").branchIds).toEqual([branchA]);
  });
  it.each([[], ["not-a-uuid"], [branchA, ""], Array.from({length:51},()=>branchA)].map(ids => ({ ids })))("rejects empty, invalid or excessive selections $ids", ({ ids }) => {
    expect(()=>parseEmployeeBranches(form(ids), "2026-10-06")).toThrow();
  });
  it.each(["2026-02-30", "2026-13-01", "2026-10-05T12:00:00Z"])("rejects an invalid date %s", date => {
    expect(()=>parseEmployeeBranches(form(undefined,date), "2026-10-06")).toThrow();
  });
  it("rejects invalid employee IDs and forged primary assignment", () => {
    const data=form();data.set("employee_id","bad");expect(()=>parseEmployeeBranches(data,"2026-10-06")).toThrow();
    data.set("employee_id",employee);data.set("role","PRIMARY");expect(()=>parseEmployeeBranches(data,"2026-10-06")).toThrow();
  });
});
