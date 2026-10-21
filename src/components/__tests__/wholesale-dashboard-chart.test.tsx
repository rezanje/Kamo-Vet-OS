import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { LineChart } from "@/components/Charts";
it("keeps a negative cancellation day inside the sales chart and labels its signed axis", () => {
  const html = renderToStaticMarkup(<LineChart points={[100, -20, 0]} labels={["31/12", "1/1", "2/1"]} />);
  const circles = [...html.matchAll(/<circle[^>]*cy="([^"]+)"/g)].map(match => Number(match[1]));
  expect(circles).toHaveLength(3);
  expect(circles.every(y => y >= 12 && y <= 158)).toBe(true);
  expect(html).toContain("-20");
});
