# Space Flow contributor architecture

React/Vite renders the canvas and editor workspaces. Zustand in `frontend/src/store.js` owns
workflow state. `frontend/src/lib/transport.js` applies the browser's CSRF token on mutations.

Express in `backend/server.js` mounts authenticated routes. Routes parse requests and delegate
to services; services own workflow validation/persistence and durable execution. Specialized
domains retain their existing backend folders. SQLite uses configured data paths from
`backend/utils/dataPaths.js`; the contributor launcher isolates these under `.contributor-state`.

`nodes/<id>/node.json` defines inputs, outputs, configuration and executor. JavaScript executors
use CommonJS; Python executors run through the existing runner. Pure helpers shared with the
browser belong in `shared`; frontend code must not import backend modules.

Test auth and ownership at the HTTP boundary, not only in the UI. Keep session/cookie scopes
separate from the main application by using the contributor browser profile. Do not connect
local execution agents or test credentials to another environment without explicit authorization.

Deployment targets, private source history, machine credentials and release authority stay with
the owner. The review controller treats contributor source and instructions as untrusted input;
the contributor's local rules cannot grant capabilities to the trusted reviewer.
