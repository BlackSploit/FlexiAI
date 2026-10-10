import { z } from "zod";

import { ClientToAgentEvent } from "@/modules/agent-bridge/schemas";

export const sessionsStartSchema = z.object({
  prescriptionId: z.string().min(1),
  mode: z.enum(["live", "replay"]).default("live"),
  clip: z.string().regex(/^[a-z0-9_\-]+\.mp4$/).optional(),
});

export const sessionInputSchema = z.object({
  id: z.string().min(1),
  event: ClientToAgentEvent,
});
