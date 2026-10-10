import { describe, expect, it, vi } from "vitest";

import { lazy } from "@/lib/lazy";

describe("lazy", () => {
  it("builds the client only on first use, then reuses it", () => {
    const make = vi.fn(() => ({ n: 1, inc() { return ++this.n; } }));
    const client = lazy(make);

    expect(make).not.toHaveBeenCalled();
    expect(client.inc()).toBe(2);
    expect(client.inc()).toBe(3);
    expect(make).toHaveBeenCalledTimes(1);
  });
});

describe("server-only stub", () => {
  it("imports a server-only module without env and without building its client", async () => {
    const { streamVideo } = await import("@/lib/stream-video");
    expect(streamVideo).toBeDefined();
  });
});
