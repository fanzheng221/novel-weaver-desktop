import {
  Activity,
  BookOpen,
  BookOpenCheck,
  CalendarClock,
  ChartNoAxesCombined,
  FileText,
  Globe2,
  History,
  Library,
  ListTree,
  MapPin,
  Network,
  Palette,
  ScrollText,
  ShieldCheck,
  Spline,
  Users,
  UserRound,
  Gem,
  Landmark,
  WandSparkles,
  PawPrint,
  type LucideIcon,
} from "lucide-react";
import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

export const ICON_SIZE = { control: 16, navigation: 14, avatar: 22, empty: 28 } as const;
const ICON_STROKE = 1.8;

/** Keep legacy presentation keys compatible while rendering actual vector icons. */
const GLYPH_ICONS: Record<string, LucideIcon> = {
  律: ShieldCheck,
  纲: ListTree,
  审: BookOpenCheck,
  刊: BookOpen,
  诺: Spline,
  时: History,
  更: CalendarClock,
  书: Library,
  界: Globe2,
  世: Globe2,
  人: UserRound,
  网: Network,
  系: Network,
  设: ScrollText,
  pacing: Activity,
  style: Palette,
  usage: ChartNoAxesCombined,
  versions: History,
};
const ENTITY_ICONS: Record<string, LucideIcon> = {
  character: UserRound,
  location: MapPin,
  organization: Landmark,
  faction: Users,
  item: Gem,
  concept: ScrollText,
  term: ScrollText,
  region: MapPin,
  realm: Globe2,
  institution: Landmark,
  creature: PawPrint,
  ability: WandSparkles,
};
const WORKSPACE_ICONS: Record<string, LucideIcon> = {
  outline: ListTree,
  foreshadow: Spline,
  timeline: History,
  pacing: Activity,
  rules: ShieldCheck,
  characters: Users,
  lore: Globe2,
  relations: Network,
  flow: BookOpenCheck,
  board: CalendarClock,
};

export function AppMark({ size = 32 }: { size?: number }) {
  return (
    <img
      src="/app-icon.svg"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      className="block flex-none"
      draggable={false}
    />
  );
}

export function GlyphIcon({ glyph, size = ICON_SIZE.empty }: { glyph: string; size?: number }) {
  const Icon = GLYPH_ICONS[glyph] ?? FileText;
  return <Icon size={size} strokeWidth={ICON_STROKE} aria-hidden="true" className="flex-none" />;
}

export function EntityIcon({ type, size = ICON_SIZE.avatar }: { type: string; size?: number }) {
  const Icon = ENTITY_ICONS[type] ?? ScrollText;
  return <Icon size={size} strokeWidth={ICON_STROKE} aria-hidden="true" className="flex-none" />;
}

export function WorkspaceIcon({ name }: { name: string }) {
  const Icon = WORKSPACE_ICONS[name] ?? FileText;
  return (
    <Icon
      size={ICON_SIZE.navigation}
      strokeWidth={ICON_STROKE}
      aria-hidden="true"
      className="flex-none"
    />
  );
}

interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> {
  label: string;
  icon: LucideIcon;
}

export function IconButton({ label, icon: Icon, className, ...props }: IconButtonProps) {
  return (
    <button
      {...props}
      type={props.type ?? "button"}
      aria-label={label}
      title={props.title ?? label}
      className={cx(
        "ui-plain t-fast inline-flex size-8 flex-none items-center justify-center rounded-sm border border-line text-ink-mid cursor-pointer hover:bg-rail-active hover:text-ink-hi disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      <Icon size={ICON_SIZE.control} strokeWidth={ICON_STROKE} aria-hidden="true" />
    </button>
  );
}
