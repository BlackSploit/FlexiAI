import { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "@/trpc/routers/_app";

export type ExercisesGetMany = inferRouterOutputs<AppRouter>["exercises"]["getMany"];
export type ExerciseGetOne = inferRouterOutputs<AppRouter>["exercises"]["getOne"];
