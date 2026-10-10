import { Suspense } from "react";
import type { SearchParams } from "nuqs";
import { ErrorBoundary } from "react-error-boundary";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { getQueryClient, trpc } from "@/trpc/server";

import { loadSearchParams } from "@/modules/sessions/params";
import { SessionsListHeader } from "@/modules/sessions/ui/components/sessions-list-header";
import { SessionsView, SessionsViewError, SessionsViewLoading } from "@/modules/sessions/ui/views/sessions-view";

interface Props {
  searchParams: Promise<SearchParams>;
};

const Page = async ({ searchParams }: Props) => {
  const filters = await loadSearchParams(searchParams);

  const queryClient = getQueryClient();
  void queryClient.prefetchQuery(trpc.sessions.getMany.queryOptions({ ...filters }));

  return (
    <>
      <SessionsListHeader />
      <HydrationBoundary state={dehydrate(queryClient)}>
        <Suspense fallback={<SessionsViewLoading />}>
          <ErrorBoundary fallback={<SessionsViewError />}>
            <SessionsView />
          </ErrorBoundary>
        </Suspense>
      </HydrationBoundary>
    </>
  );
};

export default Page;
