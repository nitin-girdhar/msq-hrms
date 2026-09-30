import HrModuleShell from '@/components/HrModuleShell';

export const dynamic = 'force-dynamic';

// Reports are attendance reports today, so they follow the attendance module gate.
export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return <HrModuleShell module="attendance">{children}</HrModuleShell>;
}
