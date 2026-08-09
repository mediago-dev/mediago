import { Link } from "react-router-dom";
import { cn } from "@/utils";
import { useNavItems } from "./nav";

/** Mobile bottom navigation (replaces the sidebar below 720px). */
export function AppBottomNav() {
  const items = useNavItems();
  return (
    <nav className="z-20 flex h-16 shrink-0 select-none items-stretch border-t border-mg-line bg-mg-surface px-[6px]">
      {items.map(({ key, to, label, Icon, active }) => (
        <Link
          key={key}
          to={to}
          className={cn(
            "flex flex-1 flex-col items-center justify-center gap-[3px] transition-colors",
            active ? "text-mg-primary" : "text-mg-fg3",
          )}
        >
          <Icon size={22} strokeWidth={2} />
          <span className="max-w-full truncate px-1 text-[10px] font-bold">
            {label}
          </span>
        </Link>
      ))}
    </nav>
  );
}
