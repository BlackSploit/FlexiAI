import { Suspense } from "react";
import { headers } from "next/headers";
import { ErrorBoundary } from "react-error-boundary";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { auth } from "@/lib/auth";
import { getQueryClient, trpc } from "@/trpc/server";
import { CallSessionStatus } from "@/modules/sessions/types";
import {
  OverviewView,
  OverviewViewError,
  OverviewViewLoading,
  RECENT_SESSIONS_INPUT,
} from "@/modules/overview/ui/views/overview-view";

const includeReplay = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

const Page = async () => {
  const session = await auth.api.getSession({ headers: await headers() });

  const queryClient = getQueryClient();
  void queryClient.prefetchQuery(trpc.analytics.overview.queryOptions());
  void queryClient.prefetchQuery(trpc.sessions.getMany.queryOptions({ status: CallSessionStatus.Live, pageSize: 20 }));
  void queryClient.prefetchQuery(trpc.sessions.getMany.queryOptions(RECENT_SESSIONS_INPUT));
  void queryClient.prefetchQuery(trpc.analytics.adherence.queryOptions({ includeReplay }));
  void queryClient.prefetchQuery(trpc.analytics.painFlags.queryOptions({ days: 7 }));

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<OverviewViewLoading />}>
        <ErrorBoundary fallback={<OverviewViewError />}>
          <OverviewView physioName={session?.user.name ?? ""} />
        </ErrorBoundary>
      </Suspense>
    </HydrationBoundary>
  );
};

export default Page;
