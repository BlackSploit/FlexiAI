import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { getQueryClient, trpc } from "@/trpc/server";
import { SessionIdView, SessionIdViewError, SessionIdViewLoading } from "@/modules/sessions/ui/views/session-id-view";

interface Props {
  params: Promise<{ sessionId: string }>;
};

const Page = async ({ params }: Props) => {
  const { sessionId } = await params;

  const queryClient = getQueryClient();
  void queryClient.prefetchQuery(trpc.sessions.getOne.queryOptions({ id: sessionId }));
  void queryClient.prefetchQuery(trpc.sessions.getResults.queryOptions({ id: sessionId }));

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<SessionIdViewLoading />}>
        <ErrorBoundary fallback={<SessionIdViewError />}>
          <SessionIdView sessionId={sessionId} />
        </ErrorBoundary>
      </Suspense>
    </HydrationBoundary>
  );
};

export default Page;
