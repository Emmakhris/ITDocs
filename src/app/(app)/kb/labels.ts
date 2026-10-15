import type { ArticleStatus } from "@prisma/client";

export const STATUS: Record<ArticleStatus, { label: string; tone: "gray" | "blue" | "green" | "amber" }> = {
  DRAFT: { label: "Draft", tone: "blue" },
  PUBLISHED: { label: "Published", tone: "green" },
  ARCHIVED: { label: "Archived", tone: "gray" },
};
