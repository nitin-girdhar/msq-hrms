import { redirect } from 'next/navigation';

// HR app landing → the home dashboard. Middleware gates it, so an
// unauthenticated hit bounces to the auth origin first.
export default function HrHome() {
  redirect('/dashboard');
}
