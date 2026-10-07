export type DisplaySection = { name: string; rows: string[][] };
const text = (node: HTMLElement) => (node.innerText ?? node.textContent ?? "").trim();

/** Expand merged table cells so totals keep the same columns in spreadsheets. */
export function displayTable(table: HTMLTableElement): string[][] {
  const rows: string[][] = [];
  const occupied = new Map<string, string>();
  [...table.rows].forEach((row, y) => {
    const cells: string[] = [];
    let x = 0;
    [...row.cells].forEach(cell => {
      while (occupied.has(`${y}:${x}`)) cells[x++] = occupied.get(`${y}:${x - 1}`)!;
      const value = text(cell);
      for (let dy = 0; dy < cell.rowSpan; dy++) for (let dx = 0; dx < cell.colSpan; dx++) {
        occupied.set(`${y + dy}:${x + dx}`, dy === 0 && dx === 0 ? value : "");
      }
      for (let dx = 0; dx < cell.colSpan; dx++) cells[x + dx] = dx === 0 ? value : "";
      x += cell.colSpan;
    });
    while (occupied.has(`${y}:${x}`)) cells[x++] = occupied.get(`${y}:${x - 1}`)!;
    rows.push(cells);
  });
  const width = Math.max(0, ...rows.map(row => row.length));
  return rows.map(row => Array.from({ length: width }, (_, x) => row[x] ?? ""));
}

export function displaySections(root: HTMLElement): DisplaySection[] {
  const sections: DisplaySection[] = [];
  const summary = [...root.querySelectorAll<HTMLElement>("[data-report-row]")]
    .map(row => [...row.children].map(cell => text(cell as HTMLElement)));
  if (summary.length) sections.push({ name: "Ringkasan", rows: summary });
  root.querySelectorAll<HTMLTableElement>("table").forEach((table, index) => {
    sections.push({ name: `Tabel ${index + 1}`, rows: displayTable(table) });
  });
  // Preserve warnings, headings and explanations that are not table cells.
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("table,[data-report-row],.no-print,button,form").forEach(node => node.remove());
  clone.querySelectorAll("div,p,section,h1,h2,h3,h4,li").forEach(node => node.append(document.createTextNode("\n")));
  const notes = text(clone).split(/\n/).map(line => line.trim()).filter(Boolean);
  if (notes.length) sections.push({ name: "Keterangan", rows: notes.map(line => [line]) });
  return sections;
}

/** Use submitted defaults, including report defaults, rather than unsaved filter edits. */
export function displayFilters(root: ParentNode): string[][] {
  return [...root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("form input[name],form select[name]")]
    .filter(input => !(input instanceof HTMLInputElement) || !["submit", "button"].includes(input.type))
    .map(input => {
      const label = input.parentElement?.querySelector("label")?.textContent?.trim() || input.name;
      const value = input instanceof HTMLSelectElement
        ? [...input.options].filter(option => option.defaultSelected).map(option => option.text).join(", ") || input.options[0]?.text || ""
        : input.defaultValue;
      return [label, value];
    });
}
