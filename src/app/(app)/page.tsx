import Dashboard from "@/components/Dashboard";
import { requireViewer } from "@/server/auth/session";

export default async function Home() {
  await requireViewer();
  return <Dashboard />;
}
