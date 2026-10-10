import { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "@/trpc/routers/_app";

export type PrescriptionsGetMany = inferRouterOutputs<AppRouter>["prescriptions"]["getMany"]["items"];
export type PrescriptionGetOne = inferRouterOutputs<AppRouter>["prescriptions"]["getOne"];
