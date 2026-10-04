import HrModuleShell from '@/components/HrModuleShell';

export const dynamic = 'force-dynamic';

// My profile serves every HR user, so either module opens it.
export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return <HrModuleShell module={['leave', 'attendance']}>{children}</HrModuleShell>;
}
