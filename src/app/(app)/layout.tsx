import AppHeader from "@/components/AppHeader";
import { requireViewer } from "@/server/auth/session";

/**
 * Shell for every signed-in page. Layouts don't re-render on client
 * navigation, so this is not the security boundary: each page and server
 * action checks the session and role again.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const viewer = await requireViewer({ allowPasswordChange: true });
  return (
    <div className="flex min-h-full flex-1 flex-col bg-slate-50">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:ring-1 focus:ring-slate-300"
      >
        Skip to content
      </a>
      <AppHeader viewer={viewer} minimal={viewer.mustChangePassword} />
      <main id="main" className="flex-1">
        {children}
      </main>
    </div>
  );
}
