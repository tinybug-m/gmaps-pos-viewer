import Link from "next/link";

import { logoutAction } from "@/app/(app)/actions";
import NavLinks, { type NavItem } from "@/components/NavLinks";
import { ROLE_LABEL, type Role } from "@/lib/workflow";

/** Links each role sees. Hiding a link is only convenience; every page checks the role itself. */
export function navFor(role: Role): NavItem[] {
  const items: (NavItem & { roles: Role[] })[] = [
    { href: "/queue", label: "Queue", roles: ["admin", "supervisor", "caller"] },
    { href: "/leads", label: "Leads", roles: ["admin", "supervisor", "caller"] },
    { href: "/dashboard", label: "Dashboard", roles: ["admin", "supervisor", "caller"] },
    { href: "/admin/import", label: "Import", roles: ["admin"] },
    { href: "/admin/assign-file", label: "Assign file", roles: ["admin"] },
    { href: "/admin/users", label: "Users", roles: ["admin"] },
    { href: "/admin/audit", label: "Audit", roles: ["admin"] },
  ];
  return items.filter((i) => i.roles.includes(role));
}

export default function AppHeader({
  viewer,
  minimal = false,
}: {
  viewer: { name: string; role: Role };
  minimal?: boolean;
}) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-6 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="text-sm font-semibold text-slate-800">
            Chinvat Bridge Leads
          </Link>
        </div>
        {!minimal && <NavLinks items={navFor(viewer.role)} />}
        <div className="flex items-center gap-3 sm:ml-auto">
          <span className="text-sm text-slate-600">
            {viewer.name}{" "}
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
              {ROLE_LABEL[viewer.role]}
            </span>
          </span>
          <Link href="/account/password" className="text-sm text-slate-500 hover:text-slate-800">
            Change password
          </Link>
          <form action={logoutAction}>
            <button type="submit" className="text-sm font-medium text-slate-500 hover:text-slate-800">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
