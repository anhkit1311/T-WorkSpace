// Q5: Prometheus text exposition format (version 0.0.4), enough for counters and gauges.

export type Metric = {
  name: string;
  help: string;
  type: "counter" | "gauge";
  samples: { labels?: Record<string, string>; value: number }[];
};

const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');

export function renderMetrics(metrics: Metric[]): string {
  const lines: string[] = [];
  for (const metric of metrics) {
    lines.push(`# HELP ${metric.name} ${metric.help}`, `# TYPE ${metric.name} ${metric.type}`);
    for (const sample of metric.samples) {
      const labels = Object.entries(sample.labels ?? {});
      const suffix = labels.length ? `{${labels.map(([key, value]) => `${key}="${escape(value)}"`).join(",")}}` : "";
      lines.push(`${metric.name}${suffix} ${Number.isFinite(sample.value) ? sample.value : 0}`);
    }
  }
  return lines.join("\n") + "\n";
}
