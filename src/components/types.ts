import type { LucideIcon } from "lucide-react";

export type SectionId =
  | "home"
  | "workspace"
  | "interview"
  | "training"
  | "reports"
  | "settings";

export interface NavigationItem {
  id: SectionId;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
}
