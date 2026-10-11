"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { QRCodeSVG } from "qrcode.react";
import { CheckIcon, CopyIcon, MailIcon, MessageCircleIcon, MessageSquareIcon, ShieldCheckIcon, VideoIcon } from "lucide-react";

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
  const [copied, setCopied] = useState(false);
  const message = `PhysioCoach: നിങ്ങളുടെ വ്യായാമ സെഷൻ തുടങ്ങാൻ ഈ ലിങ്ക് തുറക്കുക / Open this link to start your exercise session\n${joinUrl}`;
  const digits = patient.phone?.replace(/[^0-9]/g, "") ?? "";
  const email = patient.email && !isPlaceholderEmail(patient.email) ? patient.email : null;
  const whatsapp = `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy. Select the link and copy it manually.");
    }
  };

  return (
    <ResponsiveDialog
      title="Send the patient link"
      description={`Share this link with ${patient.name}. It opens on a phone, tablet or laptop with no account needed.`}
      open={open}
      onOpenChange={onOpenChange}
    >
      <div className="flex flex-col gap-y-5">
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-white p-5">
          <QRCodeSVG value={joinUrl} size={176} marginSize={1} aria-label="QR code for the patient link" />
          <p className="text-xs text-neutral-500">Scan with the patient&apos;s phone camera</p>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="patient-join-link" className="text-sm font-medium">Patient link</label>
          <div className="flex gap-2">
            <Input id="patient-join-link" readOnly value={joinUrl} onFocus={(e) => e.target.select()} className="h-10 font-mono text-xs" />
            <Button variant="outline" className="h-10 shrink-0" onClick={copy} aria-label="Copy link">
              {copied ? <CheckIcon className="text-emerald-600" /> : <CopyIcon />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          {expiresAt && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheckIcon className="size-3.5" aria-hidden />
              Works for this session only, until {format(new Date(expiresAt), "d MMM, h:mm a")}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Button asChild className="h-11 bg-emerald-600 text-white hover:bg-emerald-700 sm:col-span-3">
            <a href={whatsapp} target="_blank" rel="noreferrer"><MessageCircleIcon />Share on WhatsApp</a>
          </Button>
          {patient.phone && (
            <Button asChild variant="outline" className="h-10">
              <a href={`sms:${patient.phone}?&body=${encodeURIComponent(message)}`}><MessageSquareIcon />SMS</a>
            </Button>
          )}
          {email && (
            <Button asChild variant="outline" className="h-10">
              <a href={`mailto:${email}?subject=${encodeURIComponent("PhysioCoach session link")}&body=${encodeURIComponent(message)}`}>
                <MailIcon />Email
              </a>
            </Button>
          )}
          <Button asChild variant="outline" className="h-10">
            <Link href={`/call/${sessionId}`}><VideoIcon />Join call</Link>
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
};
