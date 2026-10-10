import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";

import {
  AgentCallback,
  AgentToClientEvent,
  ClientToAgentEvent,
  StartAgentRequest,
} from "@/modules/agent-bridge/schemas";

// The same fixtures pytest parses (agent/tests/contracts/test_fixtures.py): drift fails both suites.
const ROOT = join(process.cwd(), "shared", "fixtures");
const AnyEvent = ClientToAgentEvent.or(AgentToClientEvent);
const groups: Record<string, ZodTypeAny> = {
  events: AnyEvent,
  "agent-callbacks": AgentCallback,
  control: StartAgentRequest,
};

const load = (group: string, kind: "valid" | "invalid") =>
  readdirSync(join(ROOT, group, kind))
    .filter((f) => f.endsWith(".json"))
    .map((f) => [f, JSON.parse(readFileSync(join(ROOT, group, kind, f), "utf8"))] as const);

describe.each(Object.entries(groups))("%s fixtures", (group, schema) => {
  it.each(load(group, "valid"))("valid/%s parses", (_name, data) => {
    const result = schema.safeParse(data);
    expect(result.error?.issues).toBeUndefined();
  });

  it.each(load(group, "invalid"))("invalid/%s is rejected", (_name, data) => {
    expect(schema.safeParse(data).success).toBe(false);
  });
});
