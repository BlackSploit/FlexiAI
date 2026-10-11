"use client";

import { useRouter } from "next/navigation";
import { ChevronsUpDownIcon, LogOutIcon } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { useIsMobile } from "@/hooks/use-mobile";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarImage } from "@/components/ui/avatar";
import { GeneratedAvatar } from "@/components/generated-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";

const triggerClass =
  "group rounded-xl border border-sidebar-foreground/10 bg-sidebar-accent/30 p-2.5 w-full flex items-center gap-x-3 text-left overflow-hidden transition-colors hover:bg-sidebar-accent/70 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring";

const UserSummary = ({ name, email, image }: { name: string; email: string; image?: string | null }) => (
  <>
    {image ? (
      <Avatar className="size-9">
        <AvatarImage src={image} alt="" />
      </Avatar>
    ) : (
      <GeneratedAvatar seed={name} variant="initials" className="size-9" />
    )}
    <div className="flex flex-col gap-0.5 overflow-hidden flex-1 min-w-0">
      <p className="text-sm font-medium truncate text-sidebar-accent-foreground">{name}</p>
      <p className="text-xs truncate text-sidebar-foreground/70">{email}</p>
    </div>
    <ChevronsUpDownIcon className="size-4 shrink-0 text-sidebar-foreground/60" />
  </>
);

export const DashboardUserButton = () => {
  const router = useRouter();
  const isMobile = useIsMobile();
  const { data, isPending } = authClient.useSession();

  const onLogout = () => {
    authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push("/sign-in");
        }
      }
    });
  };

  if (isPending) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-sidebar-foreground/10 p-2.5">
        <Skeleton className="size-9 rounded-full bg-sidebar-accent" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3 w-24 bg-sidebar-accent" />
          <Skeleton className="h-3 w-32 bg-sidebar-accent" />
        </div>
      </div>
    );
  }

  if (!data?.user) {
    return null;
  }

  const { name, email, image } = data.user;

  if (isMobile) {
    return (
      <Drawer>
        <DrawerTrigger className={triggerClass} aria-label="Account menu">
          <UserSummary name={name} email={email} image={image} />
        </DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{name}</DrawerTitle>
            <DrawerDescription>{email}</DrawerDescription>
          </DrawerHeader>
          <DrawerFooter>
            <Button variant="outline" className="h-11" onClick={onLogout}>
              <LogOutIcon className="size-4" />
              Log out
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={triggerClass} aria-label="Account menu">
        <UserSummary name={name} email={email} image={image} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="right" sideOffset={8} className="w-64">
        <DropdownMenuLabel>
          <div className="flex flex-col gap-1">
            <span className="font-medium truncate">{name}</span>
            <span className="text-sm font-normal text-muted-foreground truncate">{email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onLogout} className="cursor-pointer flex items-center justify-between">
          Log out
          <LogOutIcon className="size-4" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
