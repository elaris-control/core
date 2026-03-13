# ELARIS Route Access Matrix

This file documents the intended access model used by the current build.

## Roles

- `USER`: daily control only
- `ENGINEER`: installer / commissioning / advanced control
- `ADMIN`: all engineer access plus user and account administration
- `Engineer Unlock`: temporary elevated browser session layered on top of a logged-in account

## Auth model

- **Account role** comes from the user record in `users.role`
- **Engineer unlock** comes from the `elaris_eng` cookie and only elevates the current browser session
- **Effective UI/API role** is:
  - `ADMIN` if account role is admin
  - `ENGINEER` if account role is engineer or engineer unlock is active
  - `USER` otherwise

## Route groups

### Public

- `/login.html`
- `/auth/login`
- `/auth/register`
- `/auth/google`
- `/auth/github`
- `/auth/*/callback`
- `/api/health`

### Authenticated USER

- `/api/me`
- `/auth/me`
- `/api/scenes`
- `/api/scenes/:id/activate`
- `/api/automation/thermostat/:id/control`
- `/api/automation/lighting/:id/manual`
- `/api/automation/lighting/:id/level`
- `/api/automation/awning/:id/control`
- `/api/modules/instances` *(filtered to user-visible modules only)*
- `/api/modules/instances/:id` *(filtered to user-visible modules only)*

### ENGINEER / ADMIN

- `/api/engineer/unlock`
- `/api/engineer/lock`
- `/api/devices/:id/command`
- `/api/io/:io_id/override`
- `/api/io/overrides`
- `/api/modules/instances` *(create/patch/delete)*
- `/api/notifications/*` *(manage / test channels)*
- `/api/automation/custom/:id/test`
- `/api/automation/override/:id`
- `/settings.html`
- `/entities.html`
- `/modules.html`
- `/installer.html`

### ADMIN only

- `/api/admin/*`
- `/admin.html`

## Persistence policy

- user sessions: persisted in DB
- IO overrides: persisted in DB
- module pause overrides: persisted in DB
- smart lighting active scenario: runtime-only for now
- OAuth state map: runtime-only for now
