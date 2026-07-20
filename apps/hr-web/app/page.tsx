import { redirect } from 'next/navigation';

// HR app landing → attendance (the daily-use screen). Middleware gates it, so
// an unauthenticated hit bounces to the auth origin first.
export default function HrHome() {
  redirect('/attendance');
}
