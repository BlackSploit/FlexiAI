import Link from "next/link";
import Image from "next/image";
import { ArrowLeftIcon, CompassIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col bg-background bg-brand-grid px-4 py-8 sm:px-6">
      <Link href="/" className="flex w-fit items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Image src="/logo.svg" alt="" width={32} height={32} />
        <span className="text-base font-semibold tracking-tight">PhysioCoach</span>
      </Link>
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-md rounded-xl border bg-card p-8 text-center shadow-sm">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-primary/10">
            <CompassIcon className="size-7 text-primary" aria-hidden />
          </div>
          <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-primary">Error 404</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">We couldn&apos;t find that page</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The link may be mistyped or no longer active. Patients joining a session should open the
            latest link their physiotherapist sent.
          </p>
          <p lang="ml" className="font-ml mt-2 text-sm text-muted-foreground">
            ഈ പേജ് കണ്ടെത്താനായില്ല. ഫിസിയോതെറാപ്പിസ്റ്റ് അയച്ച പുതിയ ലിങ്ക് തുറക്കുക.
          </p>
          <Button asChild className="mt-6 h-11 w-full sm:w-auto">
            <Link href="/">
              <ArrowLeftIcon className="size-4" aria-hidden />
              Back to PhysioCoach
            </Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
