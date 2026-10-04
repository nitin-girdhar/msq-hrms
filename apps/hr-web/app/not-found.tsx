import Link from 'next/link';
import { ErrorState } from '@platform/ui-kit';

// 404 surface. Without this, an unknown path rendered Next's default black-and-
// white "404 | This page could not be found" — off-brand, and with no route back
// into the app.
export default function NotFound() {
  return (
    <ErrorState
      title="Page not found"
      description="This page does not exist, or you may not have access to it."
      actions={
        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-primary/90"
        >
          Back to home
        </Link>
      }
    />
  );
}
