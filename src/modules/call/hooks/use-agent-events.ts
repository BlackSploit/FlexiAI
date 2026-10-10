"use client";

import { useEffect, useReducer } from "react";
import { useCall, type CustomVideoEvent } from "@stream-io/video-react-sdk";

import { AGENT_USER_ID } from "@/constants";

import { AgentToClientEvent } from "../contracts";

export type Caption = { id: string; ml: string; en: string; kind: string };
export type RepInfo = { n: number; peak: number; seconds: number; tooFast: boolean; target: number; repsPlanned: number; setIndex: number };

export type AgentFeed = {
  ready: boolean;
  phase: string;
  setIndex: number;
  setsPlanned: number;
  captions: Caption[];
  reps: RepInfo[];
  lastRep: RepInfo | null;
  awaitingPain: boolean;
  alert: { reason: string; score?: number; symptom?: string } | null;
};

export const initialFeed: AgentFeed = {
  ready: false, phase: "", setIndex: 0, setsPlanned: 1, captions: [], reps: [], lastRep: null, awaitingPain: false, alert: null,
};

export function feedReducer(state: AgentFeed, ev: AgentToClientEvent | { type: "local.dismiss_alert" }): AgentFeed {
  switch (ev.type) {
    case "pc.ready":
      return { ...state, ready: true };
    case "pc.state":
      return {
        ...state, ready: true, phase: ev.phase, setIndex: ev.setIndex, setsPlanned: ev.setsPlanned,
        awaitingPain: ev.phase === "await_pain" ? state.awaitingPain : false,
        reps: ev.phase === "countdown" ? [] : state.reps,
        lastRep: ev.phase === "countdown" ? null : state.lastRep,
      };
    case "pc.caption": {
      const captions = [...state.captions.filter((c) => c.id !== ev.id || c.ml !== ev.ml), { id: ev.id, ml: ev.ml, en: ev.en, kind: ev.kind }];
      return { ...state, captions: captions.slice(-30) };
    }
    case "pc.rep": {
      const rep = { n: ev.n, peak: ev.peak, seconds: ev.seconds, tooFast: ev.tooFast, target: ev.target, repsPlanned: ev.repsPlanned, setIndex: ev.setIndex };
      return { ...state, lastRep: rep, reps: [...state.reps, rep] };
    }
    case "pc.request_pain":
      return { ...state, awaitingPain: true, setIndex: ev.setIndex };
    case "pc.set_summary":
      return state;
    case "pc.safety_alert":
      return { ...state, alert: { reason: ev.reason, score: ev.score, symptom: ev.symptom }, awaitingPain: false };
    case "local.dismiss_alert":
      return { ...state, alert: null };
  }
}

/** Agent -> client custom events (§7.7). Only events from the agent's user id are trusted. */
export function useAgentEvents() {
  const call = useCall();
  const [state, dispatch] = useReducer(feedReducer, initialFeed);
  useEffect(() => {
    if (!call) return;
    return call.on("custom", (e) => {                       // on() returns an unsubscribe function
      const ev = e as CustomVideoEvent;
      if (ev.user?.id !== AGENT_USER_ID) return;
      const parsed = AgentToClientEvent.safeParse(ev.custom);
      if (parsed.success) dispatch(parsed.data);
    });
  }, [call]);
  return { feed: state, dismissAlert: () => dispatch({ type: "local.dismiss_alert" }) };
}
