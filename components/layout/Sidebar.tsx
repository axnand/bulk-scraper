"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, Settings, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { useState, useEffect } from "react";
import { useSidebar } from "./SidebarContext";

const navItems = [
  { href: "/", label: "Jobs", icon: Briefcase },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { collapsed, setCollapsed } = useSidebar();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const NavLinks = ({ isMobile = false }: { isMobile?: boolean }) => (
    <nav className="flex-1 px-2 py-4 space-y-1">
      {navItems.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              collapsed && !isMobile ? "justify-center px-2" : "",
              active
                ? "bg-primary/10 text-primary dark:bg-primary/15"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            )}
            title={collapsed && !isMobile ? label : undefined}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {(!collapsed || isMobile) && <span>{label}</span>}
          </Link>
        );
      })}
    </nav>
  );

  const Header = ({ isMobile = false }: { isMobile?: boolean }) => (
    <div className="flex items-center justify-between px-3 py-4 border-b border-border gap-2">
      <div className={cn("flex items-center gap-2.5 min-w-0", collapsed && !isMobile ? "hidden" : "")}>
        <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center shrink-0">
          <span className="text-primary-foreground text-xs font-bold">H</span>
        </div>
        <div className="truncate">
          <p className="text-sm font-semibold text-foreground leading-tight">Hirro</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Recruitment Engine</p>
        </div>
      </div>

      {collapsed && !isMobile && (
        <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center mx-auto">
          <span className="text-primary-foreground text-xs font-bold">H</span>
        </div>
      )}

      <div className={cn("flex items-center gap-1 shrink-0", collapsed && !isMobile ? "hidden" : "")}>
        {isMobile ? (
          <button
            onClick={() => setMobileOpen(false)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Close sidebar"
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Collapse sidebar"
          >
            <Menu className="h-4 w-4" />
          </button>
        )}
      </div>

      {collapsed && !isMobile && (
        <button
          onClick={() => setCollapsed(false)}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors mx-auto"
          aria-label="Expand sidebar"
        >
          <Menu className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  return (
    <>
      {/* Mobile hamburger trigger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-4 left-4 z-50 p-2 rounded-md bg-card border border-border text-muted-foreground hover:text-foreground shadow-sm md:hidden"
        aria-label="Open sidebar"
      >
        <Menu className="h-4 w-4" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={cn(
          "fixed left-0 top-0 h-screen w-64 border-r border-border bg-card z-50 flex flex-col transition-transform duration-200 md:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <Header isMobile />
        <NavLinks isMobile />
        <div className="px-3 py-3 border-t border-border flex justify-end">
          <ThemeToggle />
        </div>
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden md:flex fixed left-0 top-0 h-screen border-r border-border bg-card flex-col z-30 transition-all duration-200",
          collapsed ? "w-16" : "w-56"
        )}
      >
        <Header />
        <NavLinks />
        <div className={cn("px-3 py-3 border-t border-border flex", collapsed ? "justify-center" : "justify-end")}>
          <ThemeToggle />
        </div>
      </aside>
    </>
  );
}
