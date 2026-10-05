import { redirect } from 'next/navigation';
import { NotificationProvider, productOrigins, authOrigin, adminWebOrigin, adminOrigin, usableProducts, landingFor } from '@platform/ui-kit';
import { AppShell } from '@platform/ui-kit/shell';
import { requireSession, getEnabledModules, type PlatformModule } from '@platform/ui-kit/server';
import { can } from '@platform/rbac';
import { HrHeaderSearch, HrAttentionBell, HrWorkCards } from '@hr/web';
import { HR_NAV, HR_MOBILE_TABS } from '@/src/config/navigation';

type HrModule = Extract<PlatformModule, 'leave' | 'attendance'>;

interface Props {
  // Which HR section this subtree serves, for the per-tenant module gate. A list
  // opens when ANY of them is enabled — Employees serves leave and attendance alike.
  module: HrModule | readonly HrModule[];
  children: React.ReactNode;
}

// Authenticated HR chrome (hr.app.com). Same session gating + shared navbar/
// sidebar as the other product apps, plus a check that the tenant has this HR
// module (leave/attendance) enabled AND that this user can actually use the `hr`
// product. A disabled/unlicensed/uncapable module bounces rather than 404-ing.
export default async function HrModuleShell({ module, children }: Props) {
  const modules: readonly HrModule[] = typeof module === 'string' ? [module] : module;
  const { session, cookieHeader, licensedProducts } = await requireSession(`/${modules[0]}`);
  const enabledModules = await getEnabledModules(cookieHeader);
  const origins = productOrigins();
  const usable = usableProducts(licensedProducts, session);

  if (!modules.some((m) => enabledModules.includes(m)) || !usable.includes('hr')) {
    // No HR access. Send them to a product they CAN use — never a hardcoded LMS,
    // which an HRMS-only tenant would just get 403'd on. Nothing usable at all is
    // an entitlement problem, not a routing one, so say so explicitly.
    const elsewhere = landingFor(
      usable.filter((p) => p !== 'hr'),
      origins,
    );
    if (elsewhere) redirect(elsewhere);
    const auth = authOrigin();
    redirect(auth ? `${auth}/no-access` : '/no-access');
  }

  return (
    <NotificationProvider>
      <AppShell
        nav={HR_NAV}
        mobileTabs={HR_MOBILE_TABS}
        productLine="People & Attendance"
        productKey="hr"
        user={session}
        licensedProducts={licensedProducts}
        productOrigins={origins}
        activeProduct="hr"
        homeHref="/dashboard"
        // Keyed: an element handed from a Server Component to a Client one needs a key (see the LMS layout).
        searchSlot={<HrHeaderSearch key="hr-search" actor={session} pages={HR_NAV.filter((n) => can(session, n.capability)).map((n) => ({ id: n.id, label: n.label, href: n.href }))} />}
        notificationSlot={<HrAttentionBell key="hr-bell" actor={session} />}
        sidebarFooter={<HrWorkCards key="hr-work-cards" actor={session} />}
        title="Fitclass - People & Attendance"
        adminWebUrl={adminWebOrigin()}
        lookupAdminUrl={adminOrigin()}
      >
        {children}
      </AppShell>
    </NotificationProvider>
  );
}
