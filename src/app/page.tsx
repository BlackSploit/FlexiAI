import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

// Role router: physios to the overview, everyone else to sign-in (patients only ever use /join links).
const Page = async () => {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  redirect(session?.user.role === "physio" ? "/overview" : "/sign-in");
};

export default Page;
