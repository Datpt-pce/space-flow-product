# Project rules

- Frontend is React/Vite JavaScript; backend and node executors use CommonJS. Follow adjacent
  code conventions instead of introducing TypeScript, another state library or new framework.
- `frontend/src/store.js` owns workflow state. UI lives in `frontend/src`, HTTP parsing in
  `backend/routes`, application behavior in `backend/services`, node manifests/executors in
  `nodes/<node-id>`, pure cross-layer helpers in `shared`.
- New behavior must work with native Windows development and Docker/Linux. Use configured
  state paths before OS defaults. Guard OS-only actions and offer a usable fallback.
- Reuse authentication, CSRF and ownership checks. Test at least owner, another user and
  unauthenticated access when an endpoint or resource permission changes.
- Update dependencies only when needed and request an owner baseline update for lockfiles,
  build recipes or control-plane policy. Do not bypass the contribution scope check.
- Read documentation indexes before opening individual docs. Add a short change note under
  `docs/changes/` for the PR; do not export private operational notes or actual user content.
- Run relevant regression checks and a frontend build for UI changes. Keep test inputs and
  outputs isolated. Passing static checks is not proof that a screen or pipeline works.
# UI work: read `docs/UI.md` and inspect existing theme/component patterns before editing.
