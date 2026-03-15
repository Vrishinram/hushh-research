import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/navigation/routes";

export default async function RiaRequestsAliasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = await searchParams;
  const query = new URLSearchParams();
  query.set("view", "pending");

  for (const [key, value] of Object.entries(resolved)) {
    if (key === "actor" || key === "view") continue;
    if (typeof value === "string") {
      query.set(key, value);
    }
  }

  redirect(`${ROUTES.CONSENTS}?${query.toString()}`);
}
