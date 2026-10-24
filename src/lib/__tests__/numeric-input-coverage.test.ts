import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)])
    .filter(file => file.endsWith(".tsx") && !file.includes(".test."));
}
it("routes every native numeric field and decimal text editor through shared number protection", () => {
  const missed: string[] = [];
  let controls = 0;
  for (const file of files("src")) {
    if (file === "src/components/NumberInput.tsx") continue;
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function walk(node: ts.Node) {
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const tag = node.tagName.getText(source);
        if (tag === "NumberInput") controls++;
        if (tag === "input") {
          for (const prop of node.attributes.properties) {
            if (!ts.isJsxAttribute(prop)) continue;
            const name = prop.name.getText(source), value = prop.initializer;
            if (value && ts.isStringLiteral(value) && ((name === "type" && value.text === "number") || (name === "inputMode" && value.text === "decimal"))) {
              missed.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`);
            }
            // All dynamic type renderers must make an explicit numeric decision.
            if (name === "type" && value && ts.isJsxExpression(value)) missed.push(`${file}: dynamic native input type`);
          }
        }
      }
      ts.forEachChild(node, walk);
    }
    walk(source);
  }
  expect(missed).toEqual([]);
  expect(controls).toBeGreaterThanOrEqual(197);
});
