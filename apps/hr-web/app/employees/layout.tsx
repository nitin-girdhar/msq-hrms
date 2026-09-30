import HrModuleShell from '@/components/HrModuleShell';

export const dynamic = 'force-dynamic';

// Employee records serve both HR products, so either module opens the page.
export default function EmployeesLayout({ children }: { children: React.ReactNode }) {
  return <HrModuleShell module={['leave', 'attendance']}>{children}</HrModuleShell>;
}
