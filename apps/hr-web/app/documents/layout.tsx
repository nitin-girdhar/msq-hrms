import HrModuleShell from '@/components/HrModuleShell';

export const dynamic = 'force-dynamic';

// Documents serve every HR user, so either module opens the page.
export default function DocumentsLayout({ children }: { children: React.ReactNode }) {
  return <HrModuleShell module={['leave', 'attendance']}>{children}</HrModuleShell>;
}
