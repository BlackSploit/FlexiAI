import { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "@/trpc/routers/_app";

export type PatientsGetMany = inferRouterOutputs<AppRouter>["patients"]["getMany"]["items"];
export type PatientGetOne = inferRouterOutputs<AppRouter>["patients"]["getOne"];
