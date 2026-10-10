import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { getQueryClient, trpc } from "@/trpc/server";
import {
  PrescriptionIdView, PrescriptionIdViewError, PrescriptionIdViewLoading,
} from "@/modules/prescriptions/ui/views/prescription-id-view";

interface Props {
  params: Promise<{ prescriptionId: string }>;
};

const Page = async ({ params }: Props) => {
  const { prescriptionId } = await params;
  // "Start replay (demo)" only when the deployment allows a replay clip (AGENT_REPLAY_CLIPS, read server-side).
  const replayClip = (process.env.AGENT_REPLAY_CLIPS ?? "").split(",").map((c) => c.trim()).filter(Boolean)[0];

  const queryClient = getQueryClient();
  void queryClient.prefetchQuery(trpc.prescriptions.getOne.queryOptions({ id: prescriptionId }));
  void queryClient.prefetchQuery(trpc.sessions.getMany.queryOptions({ prescriptionId, pageSize: 20 }));

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<PrescriptionIdViewLoading />}>
        <ErrorBoundary fallback={<PrescriptionIdViewError />}>
          <PrescriptionIdView prescriptionId={prescriptionId} replayClip={replayClip} />
        </ErrorBoundary>
      </Suspense>
    </HydrationBoundary>
  );
};

export default Page;
