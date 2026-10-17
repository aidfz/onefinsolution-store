import { currentUser } from '@/lib/session';
import { readPreferences } from '@/lib/account-service';
import { defaultPreferences } from '@/lib/account-preferences';

export async function GET() {
  try {
    const user = await currentUser();
    const preferences = user ? await readPreferences(user.id) : defaultPreferences;
    return Response.json(
      {
        isAuthenticated: Boolean(user),
        user: user
          ? {
              id: user.id,
              email: user.email,
              emailVerified: Boolean(user.email_verified_at),
              name: user.name || null,
              createdAt: user.created_at || null,
            }
          : null,
        preferences,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch {
    return Response.json(
      {
        isAuthenticated: false,
        user: null,
        preferences: defaultPreferences,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
