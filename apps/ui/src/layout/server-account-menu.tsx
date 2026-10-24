import { LogOut, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppStore } from "@/store/app";
import { cn } from "@/utils";

interface Props {
  compact: boolean;
}

export function ServerAccountMenu({ compact }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setAppStore = useAppStore((state) => state.setAppStore);

  const handleSignOut = () => {
    setAppStore({ apiKey: "" });
    navigate("/signin", { replace: true });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            title={t("administrator")}
            aria-label={t("administrator")}
            className={cn(
              "flex h-9 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 text-left text-sm text-muted-foreground outline-none transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-[1079px]:mx-auto max-[1079px]:size-9 max-[1079px]:justify-center max-[1079px]:px-0",
              compact && "mx-auto size-9 justify-center px-0",
            )}
          />
        }
      >
        <Avatar className="size-8 border bg-primary/10">
          <AvatarFallback className="bg-primary/10 text-primary">
            <UserRound className="size-4" strokeWidth={1.75} />
          </AvatarFallback>
        </Avatar>
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-medium text-foreground max-[1079px]:hidden",
            compact && "hidden",
          )}
        >
          {t("administrator")}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={8}
        className="min-w-44"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("administrator")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={handleSignOut}>
            <LogOut />
            {t("signout")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
