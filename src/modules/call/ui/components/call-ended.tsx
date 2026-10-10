import Link from "next/link";

import { Button } from "@/components/ui/button";

import type { CallInfo } from "../../types";
import { S } from "../../strings";

export const CallEnded = ({ info }: { info: CallInfo }) => (
  <div className="flex flex-col items-center justify-center h-full bg-radial from-sidebar-accent to-sidebar">
    <div className="py-4 px-4 md:px-8 flex flex-1 items-center justify-center">
      <div className="flex flex-col items-center justify-center gap-y-6 bg-background rounded-lg p-10 shadow-sm">
        {info.viewer === "patient" ? (
          <div className="flex flex-col gap-y-2 text-center">
            <h6 lang="ml" className="text-lg font-medium font-ml">{S.thanks.ml}</h6>
            <p className="text-sm">{S.thanks.en}</p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-y-2 text-center">
              <h6 className="text-lg font-medium">You have left the call</h6>
              <p className="text-sm">Set results appear on the session page as they arrive.</p>
            </div>
            <Button asChild><Link href={`/sessions/${info.sessionId}`}>Back to session</Link></Button>
          </>
        )}
      </div>
    </div>
  </div>
);
