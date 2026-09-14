import { useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LayoutDashboard,
  Server,
  FileText,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Key,
  AlertTriangle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settingsStore'
import { useNavigationStore } from '@/stores/navigationStore'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface NavItem {
  titleKey: string
  href: string
  icon: React.ComponentType<{ className?: string }>
}

// Keep secondary/legacy routes accessible by URL for now, but remove them from
// the primary navigation. They will be folded into the relevant sections in
// later phases of the information-architecture refactor.
const navItems: NavItem[] = [
  { titleKey: 'overview.title', href: '/', icon: LayoutDashboard },
  { titleKey: 'nav.providers', href: '/providers', icon: Server },
  { titleKey: 'nav.apiKeys', href: '/api-keys', icon: Key },
  { titleKey: 'nav.logs', href: '/logs', icon: FileText },
  { titleKey: 'nav.settings', href: '/settings', icon: Settings },
]

export function Sidebar() {
  const { t } = useTranslation()
  const { sidebarCollapsed, toggleSidebar } = useSettingsStore()
  const { blockers, isDialogOpen, confirmNavigation, cancelNavigation } = useNavigationStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [pendingHref, setPendingHref] = useState<string | null>(null)

  const hasBlockers = blockers.length > 0

  const handleNavigation = (href: string) => {
    if (hasBlockers && location.pathname !== href) {
      setPendingHref(href)
    } else {
      navigate(href)
    }
  }

  const handleConfirmNavigation = () => {
    if (pendingHref) {
      navigate(pendingHref)
      setPendingHref(null)
    }
    confirmNavigation()
  }

  const handleCancelNavigation = () => {
    setPendingHref(null)
    cancelNavigation()
  }

  const NavButton = ({ item }: { item: NavItem }) => {
    const title = t(item.titleKey)
    const buttonContent = (
      <div
        onClick={(e) => {
          if (hasBlockers && location.pathname !== item.href) {
            e.preventDefault()
            handleNavigation(item.href)
          }
        }}
        className="block"
      >
        <NavLink
          to={item.href}
          onClick={(e) => {
            if (hasBlockers && location.pathname !== item.href) {
              e.preventDefault()
            }
          }}
          className={({ isActive }) =>
            cn(
              'sidebar-nav-item',
              sidebarCollapsed ? 'collapsed' : 'expanded',
              isActive ? 'active' : 'inactive'
            )
          }
        >
          <item.icon className="h-5 w-5 flex-shrink-0" />
          <span
            className={cn(
              'whitespace-nowrap transition-all duration-300',
              sidebarCollapsed ? 'w-0 opacity-0 overflow-hidden' : 'w-auto opacity-100'
            )}
          >
            {title}
          </span>
        </NavLink>
      </div>
    )

    if (sidebarCollapsed) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>{buttonContent}</TooltipTrigger>
          <TooltipContent side="right">{title}</TooltipContent>
        </Tooltip>
      )
    }
    return buttonContent
  }

  return (
    <TooltipProvider>
      <>
        <aside
          className={cn(
            'glass-sidebar flex flex-col transition-all duration-300 ease-in-out',
            sidebarCollapsed ? 'w-[72px]' : 'w-64'
          )}
        >
          <nav className="flex-1 p-3 space-y-1 overflow-x-hidden overflow-y-auto pt-5">
            {navItems.map((item) => (
              <NavButton key={item.href} item={item} />
            ))}
          </nav>

          <div className="mx-4 border-t border-[var(--glass-border)] opacity-50" />

          <div className="p-3 overflow-hidden flex justify-center">
            <button
              className="sidebar-collapse-btn"
              onClick={toggleSidebar}
              aria-label={t('settings.sidebarCollapsedHelp')}
              title={t('settings.sidebarCollapsedHelp')}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="h-5 w-5" />
              ) : (
                <PanelLeftClose className="h-5 w-5" />
              )}
            </button>
          </div>
        </aside>

        <Dialog open={isDialogOpen} onOpenChange={(open) => !open && handleCancelNavigation()}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                {t('proxy.unsavedChangesTitle')}
              </DialogTitle>
              <DialogDescription>
                {blockers[0]?.message || t('proxy.unsavedChangesDescription')}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={handleCancelNavigation}>
                {t('common.cancel')}
              </Button>
              <Button variant="destructive" onClick={handleConfirmNavigation}>
                {t('proxy.discardAndLeave')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    </TooltipProvider>
  )
}
