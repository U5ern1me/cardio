import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer, stopServer } from "./index";

let port = 0;

describe("operational endpoints", () => {
  beforeAll(async () => {
    port = await startServer(0);
  });

  afterAll(async () => {
    await stopServer();
  });

  it("serves health and readiness snapshots", async () => {
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    expect(health.status).toBe(200);
    const healthJson = (await health.json()) as Record<string, unknown>;
    expect(healthJson.ok).toBe(true);
    expect(typeof healthJson.sessionsLoaded).toBe("number");

    const ready = await fetch(`http://127.0.0.1:${port}/ready`);
    expect(ready.status).toBe(200);
    const readyJson = (await ready.json()) as Record<string, unknown>;
    expect(readyJson.ready).toBe(true);
    expect(readyJson.listening).toBe(true);
  });

  it("exposes protocol-aware metrics endpoint", async () => {
    const metrics = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(metrics.status).toBe(200);
    const metricsJson = (await metrics.json()) as Record<string, unknown>;
    expect(typeof metricsJson.protocol).toBe("object");
    expect(typeof metricsJson.metrics).toBe("object");
  });
});
