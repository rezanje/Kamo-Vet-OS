export type ImportRunKind = "master_accurate" | "group_components" | "initial_stock";
export type ImportRunStatus = "previewed" | "posted" | "failed";

export const runKey = (kind: string, hash: string) => `${kind}:${hash.trim().toLowerCase()}`;
export const bolehPostingRun = (status: ImportRunStatus) => status === "previewed";
