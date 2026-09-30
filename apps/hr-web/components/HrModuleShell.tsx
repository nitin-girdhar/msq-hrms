import { redirect } from 'next/navigation';
import { NotificationProvider, productOrigins, authOrigin, adminWebOrigin, adminOrigin, usableProducts, landingFor } from '@platform/ui-kit';
import { AppNavbar, AppSidebar, MobileSidebar } from '@platform/ui-kit/shell';
import { requireSession, getEnabledModules, type PlatformModule } from '@platform/ui-kit/server';
import { HR_NAV } from '@/src/config/navigation';

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
      <div className="flex min-h-screen w-full flex-col bg-[#F8FAFC] lg:h-full lg:min-h-0 lg:overflow-hidden">
        <AppNavbar
          user={session}
          licensedProducts={licensedProducts}
          productOrigins={origins}
          activeProduct="hr"
          homeHref="/attendance"
          title="Fitclass - People & Attendance"
          adminWebUrl={adminWebOrigin()}
          lookupAdminUrl={adminOrigin()}
        />
        <MobileSidebar actor={session} items={HR_NAV} />
        <div className="flex w-full flex-1 lg:min-h-0 lg:overflow-hidden">
          <AppSidebar actor={session} items={HR_NAV} />
          <main className="flex w-full min-w-0 flex-1 flex-col lg:overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </NotificationProvider>
  );
}
