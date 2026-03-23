# ELARIS auth and privilege model

## 1. Session auth
- Main user login is a DB-backed session (`user_sessions`).
- Cookie: `elaris_session` (HttpOnly, SameSite=Lax, Secure in production).
- User roles from DB: `USER`, `ENGINEER`, `ADMIN`.

## 2. Engineer unlock
- Separate temporary engineer cookie unlock (`elaris_eng`).
- Used for licensed engineer tools / temporary unlock flow.
- This does **not** replace the main authenticated session.
- Effective engineer-like access can come from:
  - DB role `ENGINEER`
  - DB role `ADMIN`
  - valid engineer unlock cookie + active session

## 3. Effective access rules
- `USER`: dashboard/control/climate/scenes/user-safe module actions
- `ENGINEER`: mappings, modules, entities, overrides, commissioning tools
- `ADMIN`: all engineer powers + user/role management

## 4. Route policy
- `requireLogin`: valid session required
- `requireEngineerAccess`: session + (`ENGINEER` or `ADMIN` or engineer unlock)
- `requireAdmin`: session + DB role `ADMIN`

## 5. CSRF
- Authenticated unsafe requests now require `X-CSRF-Token`
- Token is derived from the session and mirrored in cookie `elaris_csrf`
- Frontend auto-attaches it via `public/csrf.js`

## 6. Required environment variables (production)

The following env vars **must** be set before going live. If they are missing, the server
falls back to insecure hardcoded defaults that are publicly known.

| Variable | Default (dev fallback) | Risk if missing |
|---|---|---|
| `ENGINEER_CODE` | `1234` | Anyone can unlock engineer mode |
| `ENGINEER_SECRET` | `dev-secret-change-me` | Engineer cookies can be forged |
| `APP_SECRET` | `elaris-csrf` | CSRF tokens can be forged |

**Minimum `.env` for production:**
```
ENGINEER_CODE=<long random string>
ENGINEER_SECRET=<long random string>
APP_SECRET=<long random string>
```

Generate safe values with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
