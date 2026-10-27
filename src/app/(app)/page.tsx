import { redirect } from "next/navigation";
import { requireViewer } from "@/server/auth/session";

export default async function Home() {
  const viewer = await requireViewer();
  redirect(viewer.role === "caller" ? "/queue" : "/leads");
}
