import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { verifyJoinToken } from "@/lib/join-token";
import { getQueryClient, trpc } from "@/trpc/server";

import { Loading } from "@/modules/call/ui/components/call-connect";
import { JoinErrorState, PatientCallView } from "@/modules/call/ui/views/call-view";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ token: string }>;
};

/** Patient entry (§7.2): no account; the signed link is the credential. Every failure looks the same. */
const Page = async ({ params }: Props) => {
  const { token } = await params;
  // Cheap signature/expiry check first; join.resolve re-checks everything against the database.
  if (!verifyJoinToken(token)) return <JoinErrorState />;

  const queryClient = getQueryClient();
  void queryClient.prefetchQuery(trpc.join.resolve.queryOptions({ token }));

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<Loading />}>
        <ErrorBoundary fallback={<JoinErrorState />}>
          <PatientCallView token={token} />
        </ErrorBoundary>
      </Suspense>
    </HydrationBoundary>
  );
};

export default Page;
