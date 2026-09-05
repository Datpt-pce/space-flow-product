// 08-B (specs/ai-creative-operations-platform/08-v2/08-b-composition-document-and-versioning.md,
// work package B1) + ADR 0030 (docs/decisions/0030-composition-document-canonical-model-and-legacy-
// migration.md): the one shared place a CompositionDocument's schemaVersion migration chain lives,
// per 0020-document-schema-version-migration-policy.md ("Every document type... owns a small
// migrations array... chain-apply migrations one step at a time"). video_projects' payload already
// carries a top-level schemaVersion field (see backend/routes/video-projects.js's
// DEFAULT_TIMELINE_PAYLOAD_BASE and frontend/src/video/defaultProject.js) — this module is where the
// first real v1->v2 migration function will register when a breaking shape change ships; empty today
// because only schemaVersion 1 exists.

const CURRENT_SCHEMA_VERSION = 1;

// migrations[N] = (doc) => doc at schemaVersion N+1. Never a direct multi-version jump — 0020's
// explicit reasoning is each step stays small and independently testable.
const migrations = {
  // 1: (doc) => ({ ...doc, schemaVersion: 2, /* ... */ }),
};

// migrateCompositionDocument(doc) -> doc at CURRENT_SCHEMA_VERSION, chain-applying registered
// migrations one step at a time. Absence of schemaVersion is treated as implicit v1 (0020's own
// precedent for workflows.payload). Throws — rather than silently no-op — if doc claims a version
// newer than this code knows about (running older code against newer data) or older than current
// with no registered migration path, so a missing migration function fails loudly at read time
// instead of returning a half-migrated shape.
function migrateCompositionDocument(doc) {
  if (!doc || typeof doc !== 'object') {
    throw new Error('migrateCompositionDocument: document phải là object');
  }
  let version = doc.schemaVersion ?? 1;
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `migrateCompositionDocument: document có schemaVersion ${version}, mới hơn CURRENT_SCHEMA_VERSION ${CURRENT_SCHEMA_VERSION} mà code hiện tại biết`
    );
  }

  let current = doc;
  while (version < CURRENT_SCHEMA_VERSION) {
    const step = migrations[version];
    if (!step) {
      throw new Error(`migrateCompositionDocument: không có migration từ schemaVersion ${version} lên ${version + 1}`);
    }
    current = step(current);
    if ((current.schemaVersion ?? version) <= version) {
      throw new Error(`migrateCompositionDocument: migration từ schemaVersion ${version} không tăng version — dừng để tránh vòng lặp vô hạn`);
    }
    version = current.schemaVersion;
  }
  return current;
}

module.exports = { CURRENT_SCHEMA_VERSION, migrateCompositionDocument };
