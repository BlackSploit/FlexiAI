import { analyticsRouter } from '@/modules/analytics/server/procedures';
import { exercisesRouter } from '@/modules/exercises/server/procedures';
import { joinRouter } from '@/modules/join/server/procedures';
import { notesRouter } from '@/modules/notes/server/procedures';
import { patientsRouter } from '@/modules/patients/server/procedures';
import { prescriptionsRouter } from '@/modules/prescriptions/server/procedures';
import { sessionsRouter } from '@/modules/sessions/server/procedures';

import { createTRPCRouter } from '../init';

export const appRouter = createTRPCRouter({
  patients: patientsRouter,
  exercises: exercisesRouter,
  prescriptions: prescriptionsRouter,
  sessions: sessionsRouter,
  join: joinRouter,
  analytics: analyticsRouter,
  notes: notesRouter,
});
// export type definition of API
export type AppRouter = typeof appRouter;
