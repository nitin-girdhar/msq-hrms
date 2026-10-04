import HrModuleShell from '@/components/HrModuleShell';

export const dynamic = 'force-dynamic';

// The home screen serves attendance and leave alike, so it opens when EITHER
// module is enabled for the tenant (a leave-only tenant must still land somewhere).
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <HrModuleShell module={['attendance', 'leave']}>{children}</HrModuleShell>;
}
