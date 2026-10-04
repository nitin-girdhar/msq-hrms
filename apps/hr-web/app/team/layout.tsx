import HrModuleShell from '@/components/HrModuleShell';

export const dynamic = 'force-dynamic';

export default function TeamLayout({ children }: { children: React.ReactNode }) {
  return <HrModuleShell module="attendance">{children}</HrModuleShell>;
}
