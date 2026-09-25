// CSV UTF-8 with BOM for Indonesian spreadsheet users. Keep numeric cells numeric.
// Formula-like text from customer/item names must never execute when opened in Excel.
function safeCell(value: string | number): string {
  const text = String(value);
  const guarded = /^[\s\u0000-\u001f]*[=+@\-\t\r]/u.test(text) && typeof value !== "number" ? `'${text}` : text;
  return `"${guarded.replaceAll('"', '""')}"`;
}

export function reportCsv(headers: string[], rows: (string | number)[][]): string {
  return `\uFEFF${[headers, ...rows].map((row) => row.map(safeCell).join(",")).join("\r\n")}\r\n`;
}
