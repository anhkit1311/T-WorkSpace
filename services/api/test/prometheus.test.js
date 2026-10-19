import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMetrics } from "../../../dist/api/infrastructure/operations/prometheus.js";

test("Prometheus text format: HELP/TYPE lines, escaped labels, no NaN", () => {
  const text = renderMetrics([
    { name: "nexo_x_total", help: "Things.", type: "counter", samples: [{ value: 3 }] },
    { name: "nexo_y", help: "By label.", type: "gauge", samples: [{ labels: { department: 'Phòng "A"\n' }, value: Number.NaN }] },
  ]);
  assert.equal(
    text,
    '# HELP nexo_x_total Things.\n# TYPE nexo_x_total counter\nnexo_x_total 3\n# HELP nexo_y By label.\n# TYPE nexo_y gauge\nnexo_y{department="Phòng \\"A\\"\\n"} 0\n',
  );
});
