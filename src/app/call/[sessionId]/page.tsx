import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ErrorBoundary } from "react-error-boundary";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { auth } from "@/lib/auth";
import { getQueryClient, trpc } from "@/trpc/server";

import { Loading } from "@/modules/call/ui/components/call-connect";
import { PhysioCallErrorState, PhysioCallView } from "@/modules/call/ui/views/call-view";

interface Props {
  params: Promise<{ sessionId: string }>;
};

/** Physio side of a guided call. Patients never use this route; they join by /join/[token]. */
const Page = async ({ params }: Props) => {
  const { sessionId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "physio") redirect("/sign-in");

  const queryClient = getQueryClient();
  void queryClient.prefetchQuery(trpc.sessions.getOne.queryOptions({ id: sessionId }));

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<Loading />}>
        <ErrorBoundary fallback={<PhysioCallErrorState title="Session not found" description="It may have been removed, or it belongs to another physiotherapist." />}>
          <PhysioCallView sessionId={sessionId} />
        </ErrorBoundary>
      </Suspense>
    </HydrationBoundary>
  );
};

export default Page;
