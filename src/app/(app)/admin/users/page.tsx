import type { Metadata } from "next";
import { requireRole } from "@/server/auth/session";
import { listUsers, type UserDTO } from "@/server/dal/users";
import { getDb } from "@/server/db/client";

import CreateUserForm from "./CreateUserForm";
import UserRow from "./UserRow";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const viewer = await requireRole("admin");
  const users = (await listUsers(getDb(), viewer)) ?? [];
  const active = users.filter((u) => u.isActive);
  const inactive = users.filter((u) => !u.isActive);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header>
        <h1 className="text-2xl font-semibold text-slate-800">Users</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Callers work the leads assigned to them. Supervisors see every lead and leave feedback. Admins also import,
          assign and manage accounts. New users get a one-time password and choose their own when they first sign in.
        </p>
      </header>

      <section aria-labelledby="add-user" className="rounded-lg bg-white p-6 ring-1 ring-slate-200">
        <h2 id="add-user" className="mb-4 text-base font-semibold text-slate-800">
          Add a user
        </h2>
        <CreateUserForm />
      </section>

      <UserList title={`Active (${active.length})`} users={active} selfId={viewer.id} />
      {inactive.length > 0 && <UserList title={`Deactivated (${inactive.length})`} users={inactive} selfId={viewer.id} />}
    </div>
  );
}

function UserList({ title, users, selfId }: { title: string; users: UserDTO[]; selfId: string }) {
  const id = title.toLowerCase().replace(/\W+/g, "-");
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-base font-semibold text-slate-800">
        {title}
      </h2>
      <ul className="divide-y divide-slate-100 rounded-lg bg-white ring-1 ring-slate-200">
        {users.map((u) => (
          <UserRow key={u.id} user={u} isSelf={u.id === selfId} />
        ))}
      </ul>
    </section>
  );
}
