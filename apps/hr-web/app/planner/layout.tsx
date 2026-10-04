import HrModuleShell from '@/components/HrModuleShell';

export const dynamic = 'force-dynamic';

// The planner is part of attendance, so it follows the attendance module gate.
export default function PlannerLayout({ children }: { children: React.ReactNode }) {
  return <HrModuleShell module="attendance">{children}</HrModuleShell>;
}
