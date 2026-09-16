export function infoHalaman(rawPage: unknown, totalRows: number, pageSize: number) {
  const size = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 100;
  const totalPages = Math.max(1, Math.ceil(Math.max(0, totalRows) / size));
  const parsed = Number.parseInt(String(rawPage ?? "1"), 10);
  const requested = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  const page = requested <= totalPages ? requested : 1;
  const from = (page - 1) * size;
  return { page, from, to: from + size - 1, totalPages };
}
