import { Suspense } from "react";
import type { SearchParams } from "nuqs";
import { ErrorBoundary } from "react-error-boundary";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { getQueryClient, trpc } from "@/trpc/server";

import { loadSearchParams } from "@/modules/patients/params";
import { PatientsListHeader } from "@/modules/patients/ui/components/patients-list-header";
import { PatientsView, PatientsViewError, PatientsViewLoading } from "@/modules/patients/ui/views/patients-view";

interface Props {
  searchParams: Promise<SearchParams>;
};

const Page = async ({ searchParams }: Props) => {
  const filters = await loadSearchParams(searchParams);

  const queryClient = getQueryClient();
  void queryClient.prefetchQuery(trpc.patients.getMany.queryOptions({ ...filters }));

  return (
    <>
      <PatientsListHeader />
      <HydrationBoundary state={dehydrate(queryClient)}>
        <Suspense fallback={<PatientsViewLoading />}>
          <ErrorBoundary fallback={<PatientsViewError />}>
            <PatientsView />
          </ErrorBoundary>
        </Suspense>
      </HydrationBoundary>
    </>
  );
};

export default Page;
