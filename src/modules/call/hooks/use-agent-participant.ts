"use client";

import { useCallStateHooks } from "@stream-io/video-react-sdk";

import { AGENT_USER_ID } from "@/constants";

/**
 * Identify participants by user id, never by roles: the agent by AGENT_USER_ID (latest join wins while a
 * restart briefly overlaps), the patient by the call's patientId.
 */
export function useCallPeople(patientId: string) {
  const { useParticipants } = useCallStateHooks();
  const participants = useParticipants();
  const agents = participants.filter((p) => p.userId === AGENT_USER_ID);
  const joined = (p: (typeof participants)[number]) => Number(p.joinedAt?.seconds ?? 0) * 1000 + (p.joinedAt?.nanos ?? 0) / 1e6;
  const agent = agents.sort((a, b) => joined(b) - joined(a))[0];
  const patient = participants.find((p) => p.userId === patientId);
  const others = participants.filter((p) => p.userId !== AGENT_USER_ID && p.userId !== patientId);
  return { agent, patient, others, participants };
}
