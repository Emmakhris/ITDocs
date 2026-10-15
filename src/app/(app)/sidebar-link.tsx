"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { cx } from "@/components/ui";

export function SidebarLink({ href, planned, children }: { href: string; planned?: boolean; children: React.ReactNode }) {
  const path = usePathname();
  const active = path === href || path.startsWith(href + "/");
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
        active ? "bg-sidebar-active text-white" : "text-sidebar-fg hover:bg-sidebar-active/60 hover:text-white",
        planned && !active && "opacity-60",
      )}
    >
      {children}
    </Link>
  );
}

export function MobileNavToggle({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  return (
    <>
      <button className="rounded-md p-1.5 hover:bg-surface-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64 bg-sidebar">
            <button className="absolute right-2 top-3 rounded p-1 text-sidebar-fg" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
            {children}
          </div>
        </div>
      )}
    </>
  );
}
