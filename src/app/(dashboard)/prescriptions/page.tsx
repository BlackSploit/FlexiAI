import { Suspense } from "react";
import type { SearchParams } from "nuqs";
import { ErrorBoundary } from "react-error-boundary";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { getQueryClient, trpc } from "@/trpc/server";

import { loadSearchParams } from "@/modules/prescriptions/params";
import { PrescriptionsListHeader } from "@/modules/prescriptions/ui/components/prescriptions-list-header";
import {
  PrescriptionsView, PrescriptionsViewError, PrescriptionsViewLoading,
} from "@/modules/prescriptions/ui/views/prescriptions-view";

interface Props {
  searchParams: Promise<SearchParams>;
};

const Page = async ({ searchParams }: Props) => {
  const filters = await loadSearchParams(searchParams);

  const queryClient = getQueryClient();
  void queryClient.prefetchQuery(trpc.prescriptions.getMany.queryOptions({ ...filters }));

  return (
    <>
      <PrescriptionsListHeader />
      <HydrationBoundary state={dehydrate(queryClient)}>
        <Suspense fallback={<PrescriptionsViewLoading />}>
          <ErrorBoundary fallback={<PrescriptionsViewError />}>
            <PrescriptionsView />
          </ErrorBoundary>
        </Suspense>
      </HydrationBoundary>
    </>
  );
};

export default Page;
