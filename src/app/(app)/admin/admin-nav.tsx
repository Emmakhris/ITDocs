import Link from "next/link";

const TABS = [
  { href: "/admin", label: "General" },
  { href: "/admin/types", label: "Asset types & fields" },
  { href: "/admin/users", label: "Users & directory" },
  { href: "/admin/alerts", label: "Alerts" },
];

export function AdminNav({ current }: { current: string }) {
  return (
    <nav className="mb-5 flex gap-1 border-b border-line">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={`-mb-px border-b-2 px-3 py-2 text-sm ${current === t.href ? "border-brand font-medium text-fg" : "border-transparent text-muted hover:text-fg"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
