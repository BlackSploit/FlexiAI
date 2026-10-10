import { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "@/trpc/routers/_app";

export type SessionGetMany = inferRouterOutputs<AppRouter>["sessions"]["getMany"]["items"];
export type SessionGetOne = inferRouterOutputs<AppRouter>["sessions"]["getOne"];
export type SessionResults = inferRouterOutputs<AppRouter>["sessions"]["getResults"];

export enum CallSessionStatus {
  Scheduled = "scheduled",
  Live = "live",
  Done = "done",
  Failed = "failed",
}

export type PerRep = { peak: number; seconds: number; tooFast: boolean };
