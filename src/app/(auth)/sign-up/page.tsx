import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

import { SignUpView } from "@/modules/auth/ui/views/sign-up-view";

const Page = async () => {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  // Only physios are bounced home; any other signed-in role would loop via the role router.
  if (session?.user.role === "physio") {
    redirect("/");
  }

  return <SignUpView />
}
 
export default Page;
