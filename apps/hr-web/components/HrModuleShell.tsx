import { redirect } from 'next/navigation';
import { NotificationProvider, productOrigins } from '@platform/ui-kit';
import { AppNavbar, AppSidebar, MobileSidebar } from '@platform/ui-kit/shell';
import { requireSession, getEnabledModules, type PlatformModule } from '@platform/ui-kit/server';
import { HR_NAV } from '@/src/config/navigation';

interface Props {
  // Which HR section this subtree serves, for the per-tenant module gate.
  module: Extract<PlatformModule, 'leave' | 'attendance'>;
  children: React.ReactNode;
}

// Authenticated HR chrome (hr.app.com). Same session gating + shared navbar/
// sidebar as the other product apps, plus a check that the tenant has this HR
// module (leave/attendance) enabled and is licensed for the `hr` product. A
// disabled/unlicensed module bounces to the HR home rather than 404-ing.
export default async function HrModuleShell({ module, children }: Props) {
  const { session, cookieHeader, licensedProducts } = await requireSession(`/${module}`);
  const enabledModules = await getEnabledModules(cookieHeader);

  if (!enabledModules.includes(module) || !licensedProducts.includes('hr')) {
    // No HR access — send to the lead product if licensed, else sign-in resolves it.
    const origins = productOrigins();
    redirect(origins.lms ? `${origins.lms}/dashboard/leads` : '/attendance');
  }

  const origins = productOrigins();

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
        />
        <MobileSidebar role={session.role} items={HR_NAV} />
        <div className="flex w-full flex-1 lg:min-h-0 lg:overflow-hidden">
          <AppSidebar role={session.role} items={HR_NAV} />
          <main className="flex w-full min-w-0 flex-1 flex-col lg:overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </NotificationProvider>
  );
}
