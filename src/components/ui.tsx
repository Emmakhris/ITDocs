import Link from "next/link";
import clsx from "clsx";
import type { AssetStatus } from "@prisma/client";

export const cx = clsx;

const btnBase =
  "inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap";
const btnVariants = {
  primary: "bg-brand text-brand-fg hover:opacity-90",
  secondary: "bg-surface text-fg border border-line hover:bg-surface-2",
  ghost: "text-fg hover:bg-surface-2",
  danger: "bg-danger text-white hover:opacity-90",
};
const btnSizes = { sm: "h-8 px-2.5", md: "h-9 px-3.5" };
type BtnProps = { variant?: keyof typeof btnVariants; size?: keyof typeof btnSizes };

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & BtnProps) {
  return <button className={cx(btnBase, btnVariants[variant], btnSizes[size], className)} {...p} />;
}

export function LinkButton({
  variant = "secondary",
  size = "md",
  className,
  ...p
}: React.ComponentProps<typeof Link> & BtnProps) {
  return <Link className={cx(btnBase, btnVariants[variant], btnSizes[size], className)} {...p} />;
}

const fieldCls =
  "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted focus:outline-2 focus:outline-brand focus:border-transparent";

export function Input({ className, ...p }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(fieldCls, "h-9 py-0", className)} {...p} />;
}
export function Textarea({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(fieldCls, "min-h-24", className)} {...p} />;
}
export function Select({ className, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(fieldCls, "h-9 py-0 pr-8", className)} {...p} />;
}

export function Card({ className, title, actions, children }: { className?: string; title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={cx("rounded-lg border border-line bg-surface", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, crumbs }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; crumbs?: { href: string; label: string }[] }) {
  return (
    <div className="mb-5">
      {crumbs && (
        <nav className="mb-1 flex flex-wrap items-center gap-1 text-xs text-muted">
          {crumbs.map((c, i) => (
            <span key={c.href} className="flex items-center gap-1">
              {i > 0 && <span>/</span>}
              <Link href={c.href} className="hover:text-fg hover:underline">{c.label}</Link>
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

const tones = {
  gray: "bg-surface-2 text-muted",
  blue: "bg-brand-soft text-brand",
  green: "bg-ok-soft text-ok",
  amber: "bg-warn-soft text-warn",
  red: "bg-danger-soft text-danger",
};
export function Badge({ tone = "gray", children, className }: { tone?: keyof typeof tones; children: React.ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

export const STATUS_META: Record<AssetStatus, { label: string; tone: keyof typeof tones }> = {
  ORDERED: { label: "Ordered", tone: "gray" },
  IN_STOCK: { label: "In stock", tone: "blue" },
  DEPLOYED: { label: "Deployed", tone: "green" },
  IN_REPAIR: { label: "In repair", tone: "amber" },
  LOANED: { label: "Loaned", tone: "amber" },
  RETIRED: { label: "Retired", tone: "gray" },
  DISPOSED: { label: "Disposed", tone: "gray" },
  LOST: { label: "Lost", tone: "red" },
};
export function StatusBadge({ status }: { status: AssetStatus }) {
  const m = STATUS_META[status];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto rounded-lg border border-line bg-surface", className)}>
      <table className="w-full text-sm [&_th]:bg-surface-2 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted [&_td]:border-t [&_td]:border-line [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_tbody_tr:hover]:bg-surface-2/60">
        {children}
      </table>
    </div>
  );
}

export function DL({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="break-words text-sm">{v === null || v === undefined || v === "" ? <span className="text-muted">—</span> : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Pagination({ page, pageSize, total, href }: { page: number; pageSize: number; total: number; href: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return <p className="mt-3 text-xs text-muted">{total} result{total === 1 ? "" : "s"}</p>;
  return (
    <div className="mt-3 flex items-center justify-between text-sm">
      <span className="text-xs text-muted">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex gap-2">
        {page > 1 && <LinkButton size="sm" href={href(page - 1)}>Previous</LinkButton>}
        {page < pages && <LinkButton size="sm" href={href(page + 1)}>Next</LinkButton>}
      </div>
    </div>
  );
}

export function fmtDate(d: Date | string | null | undefined) {
  if (!d) return null;
  return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
export function fmtDateTime(d: Date | string | null | undefined) {
  if (!d) return null;
  return new Date(d).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
export function toDateInput(d: Date | string | null | undefined) {
  return d ? new Date(d).toISOString().slice(0, 10) : "";
}
