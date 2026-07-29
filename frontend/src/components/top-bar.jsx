import { Moon, Sun, ChevronDown } from "lucide-react";
import { Link } from "react-router-dom";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function TopBar({ right }) {
  const { theme, toggle } = useTheme();
  const { user, logout } = useAuth();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-end border-b border-border bg-background/80 pl-14 pr-4 backdrop-blur-md sm:pl-6 lg:pl-8">
      <div className="flex items-center gap-2">
        {right}
        <button
          onClick={toggle}
          aria-label="Toggle theme"
          className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent">
            <Avatar className="h-7 w-7">
              {user?.avatarUrl ? <AvatarImage src={user.avatarUrl} /> : null}
              <AvatarFallback className="bg-primary text-xs text-primary-foreground">
                {(user?.name || "U").charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="hidden text-sm font-medium text-foreground sm:block">
              {user?.name || "User"}
            </span>
            <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground sm:block" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>{user?.email || ""}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/settings?tab=profile">Profile</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/settings?tab=billing">Billing</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout}>Log out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
