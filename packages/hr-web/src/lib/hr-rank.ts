// Resolves the caller's actual HR product role/rank (hr.member_roles) once
// per authenticated Server Component request — the same authority hr-service
// itself enforces for HR-admin-only actions. Never use SessionUser.rank for
// this: that's the platform/session rank (a different, only-coincidentally-
// overlapping scale — see GET /hr/me on hr-service for the full story).
// Mirrors @platform/ui-kit/server's getEnabledModules fetch pattern.

const GATEWAY_URL = process.env['API_GATEWAY_INTERNAL_URL'] ?? 'http://localhost:4000';

export interface HrRank {
  role: string | null;
  rank: number;
}

export async function getHrRank(cookieHeader: string): Promise<HrRank> {
  try {
    const res = await fetch(`${GATEWAY_URL}/hr/me`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (!res.ok) return { role: null, rank: -1 };
    const data = (await res.json()) as { data: HrRank };
    return data.data;
  } catch {
    return { role: null, rank: -1 };
  }
}
