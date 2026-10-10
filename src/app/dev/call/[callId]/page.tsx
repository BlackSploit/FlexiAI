import { notFound } from "next/navigation";

import {
  AGENT_USER_ID,
  CALL_TYPE,
  createPatientCallToken,
  createPhysioUserToken,
} from "@/lib/stream-video";

import { DevCall } from "./dev-call";

// Dev-only Spike A page (Milestone 2): join a dev call as the dev patient or dev physio, see the
// agent's tile, send pc.* events from the browser and log what the agent sends back.
// Removed (or kept behind the same guard) once the real call UI exists in Milestone 5.
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ callId: string }>;
  searchParams: Promise<{ as?: string }>;
}

const Page = async ({ params, searchParams }: Props) => {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  const { callId } = await params;
  const role = (await searchParams).as === "physio" ? "physio" : "patient";
  const user = role === "physio"
    ? { id: "dev-physio", name: "Dev Physio" }
    : { id: "dev-patient", name: "Dev Patient" };
  const token = role === "physio"
    ? createPhysioUserToken(user.id)
    : createPatientCallToken(user.id, callId);

  return (
    <DevCall
      apiKey={process.env.NEXT_PUBLIC_STREAM_VIDEO_API_KEY!}
      callType={CALL_TYPE}
      callId={callId}
      user={user}
      token={token}
      agentUserId={AGENT_USER_ID}
    />
  );
};

export default Page;
