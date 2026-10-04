import HrModuleShell from '@/components/HrModuleShell';

export const dynamic = 'force-dynamic';

// The org chart serves both HR products, like the employee directory it links from.
export default function OrgChartLayout({ children }: { children: React.ReactNode }) {
  return <HrModuleShell module={['leave', 'attendance']}>{children}</HrModuleShell>;
}
