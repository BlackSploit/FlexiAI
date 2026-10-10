import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { getQueryClient, trpc } from "@/trpc/server";
import { PatientIdView, PatientIdViewError, PatientIdViewLoading } from "@/modules/patients/ui/views/patient-id-view";

interface Props {
  params: Promise<{ patientId: string }>;
};

const includeReplay = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

const Page = async ({ params }: Props) => {
  const { patientId } = await params;

  const queryClient = getQueryClient();
  void queryClient.prefetchQuery(trpc.patients.getOne.queryOptions({ id: patientId }));
  void queryClient.prefetchQuery(trpc.prescriptions.getMany.queryOptions({ patientId, pageSize: 50 }));
  void queryClient.prefetchQuery(trpc.sessions.getMany.queryOptions({ patientId, pageSize: 10 }));
  void queryClient.prefetchQuery(trpc.analytics.romTrend.queryOptions({ patientId, includeReplay }));
  void queryClient.prefetchQuery(trpc.analytics.weeklySummary.queryOptions({ patientId, includeReplay }));
  void queryClient.prefetchQuery(trpc.notes.getMany.queryOptions({ patientId }));

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<PatientIdViewLoading />}>
        <ErrorBoundary fallback={<PatientIdViewError />}>
          <PatientIdView patientId={patientId} />
        </ErrorBoundary>
      </Suspense>
    </HydrationBoundary>
  );
};

export default Page;
