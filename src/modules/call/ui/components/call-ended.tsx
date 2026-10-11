import Link from "next/link";
import { ArrowRightIcon, CheckCircle2Icon, PhoneOffIcon, ShieldCheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { CallInfo } from "../../types";
import { S } from "../../strings";
import { StatusCard } from "./call-brand";

export const CallEnded = ({ info }: { info: CallInfo }) =>
  info.viewer === "patient" ? (
    <StatusCard
      icon={CheckCircle2Icon}
      tone="success"
      title={<><span lang="ml" className="font-ml block text-2xl leading-snug">{S.thanks.ml}</span><span className="mt-1 block text-base font-normal text-muted-foreground">{S.thanks.en}</span></>}
      description={<><span lang="ml" className="font-ml block text-base">{S.closePage.ml}</span>{S.closePage.en}</>}
    >
      <p className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground">
        <ShieldCheckIcon className="size-3.5 text-emerald-600" aria-hidden />
        <span lang="ml" className="font-ml">{S.noVideoStored.ml}</span> · {S.noVideoStored.en}
      </p>
    </StatusCard>
  ) : (
    <StatusCard
      icon={PhoneOffIcon}
      title="You have left the call"
      description={`${info.label}. Set results appear on the session page as they arrive.`}
    >
      <Button asChild size="lg" className="w-full sm:w-auto">
        <Link href={`/sessions/${info.sessionId}`}>View session results <ArrowRightIcon /></Link>
      </Button>
    </StatusCard>
  );
