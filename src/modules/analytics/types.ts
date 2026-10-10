import { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "@/trpc/routers/_app";

type Out = inferRouterOutputs<AppRouter>["analytics"];
export type AnalyticsOverview = Out["overview"];
export type RomTrend = Out["romTrend"];
export type Adherence = Out["adherence"];
export type PainFlags = Out["painFlags"];
export type WeeklySummary = Out["weeklySummary"];
