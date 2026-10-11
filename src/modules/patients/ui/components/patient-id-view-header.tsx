import Link from "next/link";
import { format } from "date-fns";
import {
  CalendarIcon,
  ChevronRightIcon,
  ClipboardPlusIcon,
  MailIcon,
  MoreVerticalIcon,
  PencilIcon,
  PhoneIcon,
  TrashIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { GeneratedAvatar } from "@/components/generated-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { isPlaceholderEmail } from "../../schemas";
import { LanguageBadge, PainChip } from "./ui-kit";

interface Props {
  patient: {
    id: string;
    name: string;
    phone: string | null;
    email: string;
    preferredLanguage: string | null;
    createdAt: Date | string;
    latestPain: number | null;
  };
  onEdit: () => void;
  onNewPrescription: () => void;
  onRemove: () => void;
  isRemoving?: boolean;
}

/** Breadcrumb + profile header card for the patient detail page. */
export const PatientIdViewHeader = ({ patient, onEdit, onNewPrescription, onRemove, isRemoving }: Props) => {
  const email = patient.email && !isPlaceholderEmail(patient.email) ? patient.email : null;

  return (
    <div className="flex flex-col gap-y-4">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link href="/patients" className="rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Patients
        </Link>
        <ChevronRightIcon className="size-3.5" aria-hidden />
        <span className="truncate font-medium text-foreground" aria-current="page">{patient.name}</span>
      </nav>

      <div className="rounded-xl border bg-card p-5 shadow-sm md:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <GeneratedAvatar variant="initials" seed={patient.name} className="size-16 border-2 border-background ring-2 ring-primary/20" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{patient.name}</h1>
              <LanguageBadge lang={patient.preferredLanguage} />
              <PainChip pain={patient.latestPain} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
              {patient.phone ? (
                <a href={`tel:${patient.phone}`} className="flex items-center gap-1.5 hover:text-foreground">
                  <PhoneIcon className="size-3.5" aria-hidden />
                  {patient.phone}
                </a>
              ) : (
                <span className="flex items-center gap-1.5"><PhoneIcon className="size-3.5" aria-hidden />No phone</span>
              )}
              {email && (
                <a href={`mailto:${email}`} className="flex items-center gap-1.5 hover:text-foreground">
                  <MailIcon className="size-3.5" aria-hidden />
                  {email}
                </a>
              )}
              <span className="flex items-center gap-1.5">
                <CalendarIcon className="size-3.5" aria-hidden />
                Patient since {format(new Date(patient.createdAt), "MMM yyyy")}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={onNewPrescription} className="flex-1 sm:flex-none">
              <ClipboardPlusIcon />
              New prescription
            </Button>
            <Button variant="outline" onClick={onEdit} className="hidden sm:inline-flex">
              <PencilIcon />
              Edit
            </Button>
            {/* Without modal={false}, the dialog that this dropdown opens cause the website to get unclickable */}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More actions">
                  <MoreVerticalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={onEdit}>
                  <PencilIcon className="size-4" />
                  Edit details
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onNewPrescription}>
                  <ClipboardPlusIcon className="size-4" />
                  New prescription
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onRemove} disabled={isRemoving} variant="destructive">
                  <TrashIcon className="size-4" />
                  Delete patient
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  );
};
