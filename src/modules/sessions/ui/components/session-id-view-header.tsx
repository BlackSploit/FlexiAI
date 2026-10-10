import Link from "next/link";
import {
  ChevronRightIcon, LinkIcon, MoreVerticalIcon, PhoneOffIcon, RotateCcwIcon, VideoIcon, XCircleIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator } from "@/components/ui/breadcrumb";

interface Props {
  sessionId: string;
  title: string;
  status: "scheduled" | "live" | "done" | "failed";
  onNewLink: () => void;
  onRestart: () => void;
  onEnd: () => void;
  onCancel: () => void;
}

/** There is no "copy patient link": only sha256(token) is stored, so a new link revokes the old one. */
export const SessionIdViewHeader = ({ sessionId, title, status, onNewLink, onRestart, onEnd, onCancel }: Props) => {
  const open = status === "scheduled" || status === "live";
  return (
    <div className="flex items-center justify-between">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild className="font-medium text-xl"><Link href="/sessions">Sessions</Link></BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="text-foreground text-xl font-medium [&>svg]:size-4"><ChevronRightIcon /></BreadcrumbSeparator>
          <BreadcrumbItem>
            <BreadcrumbLink asChild className="font-medium text-xl text-foreground">
              <Link href={`/sessions/${sessionId}`}>{title}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      {open && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild><Button variant="ghost"><MoreVerticalIcon /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onNewLink}><LinkIcon className="size-4 text-black" />New patient link</DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/call/${sessionId}`}><VideoIcon className="size-4 text-black" />Join as physio</Link>
            </DropdownMenuItem>
            {status === "live" && (
              <>
                <DropdownMenuItem onClick={onRestart}><RotateCcwIcon className="size-4 text-black" />Restart coach</DropdownMenuItem>
                <DropdownMenuItem onClick={onEnd}><PhoneOffIcon className="size-4 text-black" />End session</DropdownMenuItem>
              </>
            )}
            {status === "scheduled" && (
              <DropdownMenuItem onClick={onCancel}><XCircleIcon className="size-4 text-black" />Cancel</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
};
