import HrModuleShell from '@/components/HrModuleShell';

export const dynamic = 'force-dynamic';

export default function AttendanceLayout({ children }: { children: React.ReactNode }) {
  return <HrModuleShell module="attendance">{children}</HrModuleShell>;
}
