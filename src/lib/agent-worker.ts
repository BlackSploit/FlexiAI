import "server-only";

import type { ClientToAgentEvent, StartAgentRequest } from "@/modules/agent-bridge/schemas";

import { SIGNATURE_HEADER, signRequest } from "./signing";

/** HMAC-signed client for the agent-worker control API (§7.9). Internal network only. */
export class AgentWorkerError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export type AgentInfo = { pid: number; host: string; status: string; startedAt?: string; lastHeartbeatAt?: string | null };

const config = () => {
  const url = process.env.AGENT_WORKER_URL;
  const secret = process.env.AGENT_CONTROL_SECRET;
  if (!url || !secret) throw new AgentWorkerError("AGENT_WORKER_URL / AGENT_CONTROL_SECRET not configured");
  return { url: url.replace(/\/$/, ""), secret };
};

async function call(method: string, pathWithQuery: string, body?: unknown): Promise<Response> {
  const { url, secret } = config();
  const payload = body === undefined ? "" : JSON.stringify(body);
  try {
    return await fetch(`${url}${pathWithQuery}`, {
      method,
      body: payload || undefined,
      headers: {
        "content-type": "application/json",
        [SIGNATURE_HEADER]: signRequest(secret, method, pathWithQuery, payload),
      },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch (e) {
    throw new AgentWorkerError(`agent-worker unreachable: ${(e as Error).message}`);
  }
}

/** POST /sessions (idempotent on sessionId). */
export async function startAgent(payload: StartAgentRequest): Promise<{ pid: number; host: string }> {
  const res = await call("POST", "/sessions", payload);
  if (res.status !== 200 && res.status !== 201) {
    throw new AgentWorkerError(`start failed (${res.status})`, res.status);
  }
  return res.json();
}

/** DELETE /sessions/{id}. Returns false when the worker does not know the session (404). */
export async function stopAgent(sessionId: string, reason: "end" | "restart" = "end"): Promise<boolean> {
  const res = await call("DELETE", `/sessions/${encodeURIComponent(sessionId)}?reason=${reason}`);
  if (res.status === 404) return false;
  if (res.status !== 202) throw new AgentWorkerError(`stop failed (${res.status})`, res.status);
  return true;
}

/** GET /sessions/{id}: null when unknown (the agent is gone). */
export async function getAgent(sessionId: string): Promise<AgentInfo | null> {
  const res = await call("GET", `/sessions/${encodeURIComponent(sessionId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new AgentWorkerError(`status failed (${res.status})`, res.status);
  return res.json();
}

/** POST /sessions/{id}/input: the redundant input path (§7.8). */
export async function forwardInput(sessionId: string, senderId: string, event: ClientToAgentEvent): Promise<void> {
  const res = await call("POST", `/sessions/${encodeURIComponent(sessionId)}/input?sender=${encodeURIComponent(senderId)}`, event);
  if (res.status !== 202) throw new AgentWorkerError(`input failed (${res.status})`, res.status);
}
