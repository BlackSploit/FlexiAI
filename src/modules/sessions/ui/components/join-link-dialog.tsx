"use client";

import Link from "next/link";
import { toast } from "sonner";
import { format } from "date-fns";
import { QRCodeSVG } from "qrcode.react";
import { CopyIcon, MailIcon, MessageCircleIcon, MessageSquareIcon, VideoIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import { isPlaceholderEmail } from "@/modules/patients/schemas";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  joinUrl: string;
  expiresAt?: Date | string | null;
  patient: { name: string; phone?: string | null; email?: string | null };
}

/**
 * Opened only with a FRESH link from sessions.start / regenerateJoinLink: the raw URL is never stored.
 * All sharing is client-side links (no server-side sending in v1).
 */
export const JoinLinkDialog = ({ open, onOpenChange, sessionId, joinUrl, expiresAt, patient }: Props) => {
  const message = `PhysioCoach: നിങ്ങളുടെ വ്യായാമ സെഷൻ / your exercise session\n${joinUrl}`;
  const digits = patient.phone?.replace(/[^0-9]/g, "");
  const email = patient.email && !isPlaceholderEmail(patient.email) ? patient.email : null;

  return (
    <ResponsiveDialog
      title="Patient link"
      description={`Send this link to ${patient.name}. It works on a phone, tablet or laptop.`}
      open={open}
      onOpenChange={onOpenChange}
    >
      <div className="flex flex-col gap-y-4">
        <div className="flex gap-x-2">
          <Input readOnly value={joinUrl} onFocus={(e) => e.target.select()} />
          <Button variant="outline" size="icon" aria-label="Copy link"
            onClick={() => navigator.clipboard.writeText(joinUrl).then(() => toast.success("Link copied"))}>
            <CopyIcon />
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <a href={`https://wa.me/${digits ?? ""}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
              <MessageCircleIcon /> WhatsApp
            </a>
          </Button>
          {patient.phone && (
            <Button asChild variant="outline">
              <a href={`sms:${patient.phone}?&body=${encodeURIComponent(message)}`}><MessageSquareIcon /> SMS</a>
            </Button>
          )}
          {email && (
            <Button asChild variant="outline">
              <a href={`mailto:${email}?subject=${encodeURIComponent("PhysioCoach session link")}&body=${encodeURIComponent(message)}`}>
                <MailIcon /> Email
              </a>
            </Button>
          )}
        </div>
        <div className="flex flex-col items-center gap-y-2 rounded-lg border p-4 bg-white">
          <QRCodeSVG value={joinUrl} size={192} />
          <p className="text-xs text-muted-foreground">Scan with the patient&apos;s device</p>
        </div>
        {expiresAt && (
          <p className="text-xs text-muted-foreground">Valid until {format(new Date(expiresAt), "MMM d, HH:mm")}</p>
        )}
        <Button asChild>
          <Link href={`/call/${sessionId}`}><VideoIcon /> Join as physio</Link>
        </Button>
      </div>
    </ResponsiveDialog>
  );
};
