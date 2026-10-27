import { redirect } from "next/navigation";
import { requireViewer } from "@/server/auth/session";

export default async function Home() {
  await requireViewer();
  redirect("/leads");
}
