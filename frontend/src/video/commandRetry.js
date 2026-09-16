// 08-D D2 (specs/ai-creative-operations-platform/08-v2/08-d-durable-editing-transactions.md):
// retries a command POST once after a network failure, reusing the SAME idempotencyKey across
// attempts — so if the first attempt actually landed server-side (only the response was lost, e.g.
// a dropped connection) the retry gets back the original CommandResult (idempotent:true, see
// backend/routes/video-projects.js's applyCommand()) instead of applying the command a second time.
//
// Pure — only `setTimeout`/`crypto.randomUUID`, no DOM/Zustand/fetch dependency — unlike the rest
// of store.js, which is entangled with Zustand get/set and can't be unit-tested directly with
// `node`. `postFn(idempotencyKey)` is supplied by the caller (store.js's execute()) so this module
// has zero knowledge of apiFetch/postVideoCommand.

// postCommandWithRetry(postFn, opts?) -> Promise<result> — calls postFn(idempotencyKey); on
// rejection, waits retryDelayMs then calls it again (same idempotencyKey) up to maxAttempts total.
// Rejects with the LAST error if every attempt fails.
//
// 08-D D5: a 409 base-revision conflict (postFn's Error carries `.conflict = true`, see
// frontend/lib/api.js's postVideoCommand) is NOT a transient failure worth retrying — the base
// revision it was rejected against won't change between now and the next attempt (nothing here
// re-reads a fresher one), so a retry would just burn the delay and hit the exact same conflict
// again. Fails fast instead, straight to the caller's conflict handling.
export async function postCommandWithRetry(postFn, { idempotencyKey, maxAttempts = 2, retryDelayMs = 500 } = {}) {
  const key = idempotencyKey ?? crypto.randomUUID();
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await postFn(key);
    } catch (err) {
      if (err.conflict) throw err;
      lastErr = err;
      if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw lastErr;
}
