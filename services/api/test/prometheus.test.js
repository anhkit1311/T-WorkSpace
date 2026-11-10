import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMetrics } from "../../../dist/api/infrastructure/operations/prometheus.js";

test("Prometheus text format: HELP/TYPE lines, escaped labels, no NaN", () => {
  const text = renderMetrics([
    { name: "tws_x_total", help: "Things.", type: "counter", samples: [{ value: 3 }] },
    {
      name: "tws_y",
      help: "By label.",
      type: "gauge",
      samples: [{ labels: { department: 'Phòng "A"\n' }, value: Number.NaN }],
    },
  ]);
  assert.equal(
    text,
    '# HELP tws_x_total Things.\n# TYPE tws_x_total counter\ntws_x_total 3\n# HELP tws_y By label.\n# TYPE tws_y gauge\ntws_y{department="Phòng \\"A\\"\\n"} 0\n',
  );
});
