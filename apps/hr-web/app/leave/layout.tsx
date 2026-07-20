import HrModuleShell from '@/components/HrModuleShell';

export const dynamic = 'force-dynamic';

export default function LeaveLayout({ children }: { children: React.ReactNode }) {
  return <HrModuleShell module="leave">{children}</HrModuleShell>;
}
