import Link from "next/link";
import { requireCtx } from "@/server/auth/session";
import { can, ROLE_LABELS } from "@/server/rbac/permissions";
import { getSettings } from "@/server/modules/settings";
import { NAV } from "@/components/nav";
import { Icon } from "@/components/icon";
import { SidebarLink, MobileNavToggle } from "./sidebar-link";
import { GlobalSearch } from "./global-search";
import { logoutAction } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  const settings = await getSettings();
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => can(ctx.user.role, i.module, "read")) })).filter((g) => g.items.length);

  const sidebar = (
    <nav className="flex h-full flex-col gap-4 overflow-y-auto px-3 py-4">
      <Link href="/dashboard" className="flex items-center gap-2 px-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand text-sm font-bold text-brand-fg">IT</span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-white">ITDocs</span>
          <span className="block truncate text-xs text-sidebar-fg/80">{settings.orgName}</span>
        </span>
      </Link>
      {groups.map((g) => (
        <div key={g.label}>
          <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-fg/60">{g.label}</p>
          <ul className="space-y-0.5">
            {g.items.map((i) => (
              <li key={i.href}>
                <SidebarLink href={i.href}>
                  <Icon name={i.icon} />
                  <span className="flex-1">{i.label}</span>
                </SidebarLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="no-print hidden bg-sidebar lg:sticky lg:top-0 lg:block lg:h-screen">{sidebar}</aside>
      <div className="min-w-0">
        <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur">
          <MobileNavToggle>{sidebar}</MobileNavToggle>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-3">
            <Link href="/profile" className="hidden text-right sm:block">
              <span className="block text-sm font-medium leading-tight">{ctx.user.displayName}</span>
              <span className="block text-xs text-muted">{ROLE_LABELS[ctx.user.role]}</span>
            </Link>
            <form action={logoutAction}>
              <button className="rounded-md border border-line px-2.5 py-1.5 text-xs hover:bg-surface-2">Sign out</button>
            </form>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
