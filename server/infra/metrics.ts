type Labels = Record<string, string | number | boolean | undefined>;

export interface MetricsSnapshot {
  counters: Array<{ name: string; labels: Labels; value: number }>;
  histograms: Array<{
    name: string;
    labels: Labels;
    count: number;
    min: number;
    max: number;
    avg: number;
    p95: number;
  }>;
}

interface HistogramStat {
  values: number[];
  count: number;
  total: number;
  min: number;
  max: number;
}

function labelsKey(labels: Labels): string {
  return Object.entries(labels)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${String(value)}`)
    .join("|");
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * quantile) - 1),
  );
  return sorted[index];
}

class InMemoryMetrics {
  private readonly counters = new Map<
    string,
    { labels: Labels; value: number }
  >();
  private readonly histograms = new Map<
    string,
    { labels: Labels; stat: HistogramStat }
  >();

  increment(name: string, value = 1, labels: Labels = {}) {
    const key = `${name}|${labelsKey(labels)}`;
    const current = this.counters.get(key);
    if (!current) {
      this.counters.set(key, { labels, value });
      return;
    }
    current.value += value;
  }

  observe(name: string, value: number, labels: Labels = {}) {
    const key = `${name}|${labelsKey(labels)}`;
    const current = this.histograms.get(key);
    if (!current) {
      this.histograms.set(key, {
        labels,
        stat: {
          values: [value],
          count: 1,
          total: value,
          min: value,
          max: value,
        },
      });
      return;
    }
    current.stat.values.push(value);
    current.stat.count += 1;
    current.stat.total += value;
    current.stat.min = Math.min(current.stat.min, value);
    current.stat.max = Math.max(current.stat.max, value);
  }

  snapshot(): MetricsSnapshot {
    return {
      counters: Array.from(this.counters.entries()).map(([key, entry]) => ({
        name: key.split("|")[0],
        labels: entry.labels,
        value: entry.value,
      })),
      histograms: Array.from(this.histograms.entries()).map(([key, entry]) => ({
        name: key.split("|")[0],
        labels: entry.labels,
        count: entry.stat.count,
        min: entry.stat.min,
        max: entry.stat.max,
        avg: entry.stat.count > 0 ? entry.stat.total / entry.stat.count : 0,
        p95: percentile(entry.stat.values, 0.95),
      })),
    };
  }

  reset() {
    this.counters.clear();
    this.histograms.clear();
  }
}

export const metrics = new InMemoryMetrics();
