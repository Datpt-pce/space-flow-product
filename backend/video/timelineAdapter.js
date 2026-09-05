// 08-B (specs/ai-creative-operations-platform/08-v2/08-b-composition-document-and-versioning.md,
// work packages B2/B3) + ADR 0030 (docs/decisions/0030-composition-document-canonical-model-and-
// legacy-migration.md): pure projection of a legacy `video_projects` row (plus its currently-
// recovered CompositionDocument, per backend/routes/video-projects.js's recoverProjectState()) into
// the canonical TimelineCollection/Timeline/TimelineVersion shape 08-B §2 defines.
//
// Deliberately does NOT create any new SQL row for existing v1 data (ADR 0030 decision 2: "No bulk/
// eager rewrite"). Every legacy project maps to exactly one single-timeline collection; the
// "version" is derived from the latest committed command seq, not persisted — the legacy command
// log (video_project_commands) already IS the durable history, so duplicating it into a stored
// immutable TimelineVersion row per command is out of scope for this slice. 08-D's real durable
// command/version envelope is a separate, additive mechanism for native (non-legacy) timelines
// (ADR 0030 decision 3) — this module only ever wraps the existing legacy path.
//
// No DB access here — callers (backend/routes/video-projects.js) fetch the row/state and pass it
// in, keeping this module pure and independently testable, same shape as backend/video/
// renderPlanner.js's "pure builder, no fs/process access" pattern (ADR 0031).

const LEGACY_COLLECTION_PREFIX = 'legacy-collection:';
const LEGACY_VERSION_PREFIX = 'legacy-version:';

function buildLegacyVersionId(projectId, seq) {
  return `${LEGACY_VERSION_PREFIX}${projectId}:${seq}`;
}

function buildLegacyCollection(projectRow) {
  return {
    id: `${LEGACY_COLLECTION_PREFIX}${projectRow.id}`,
    workspaceId: projectRow.owner_id,
    name: projectRow.name,
    timelineIds: [projectRow.id],
    activeTimelineId: projectRow.id,
    metadata: { legacy: true, sourceProjectId: projectRow.id },
  };
}

function buildLegacyTimeline(projectRow, latestSeq) {
  return {
    id: projectRow.id,
    collectionId: `${LEGACY_COLLECTION_PREFIX}${projectRow.id}`,
    name: projectRow.name,
    activeVersionId: buildLegacyVersionId(projectRow.id, latestSeq),
    lifecycleState: 'active',
  };
}

function buildLegacyTimelineVersion(projectRow, latestSeq, previousSeq, document) {
  return {
    id: buildLegacyVersionId(projectRow.id, latestSeq),
    timelineId: projectRow.id,
    parentVersionId: previousSeq === null ? null : buildLegacyVersionId(projectRow.id, previousSeq),
    documentRef: document,
    createdBy: projectRow.owner_id,
    createdAt: projectRow.updated_at,
  };
}

// buildLegacyProjection(projectRow, { latestSeq, previousSeq, document }) -> { collection, timeline,
// version } — the single call backend/routes/video-projects.js's GET /:id/timeline-collection makes
// after fetching the row and recovering+migrating the document.
function buildLegacyProjection(projectRow, { latestSeq, previousSeq, document }) {
  return {
    collection: buildLegacyCollection(projectRow),
    timeline: buildLegacyTimeline(projectRow, latestSeq),
    version: buildLegacyTimelineVersion(projectRow, latestSeq, previousSeq, document),
  };
}

module.exports = {
  buildLegacyCollection,
  buildLegacyTimeline,
  buildLegacyTimelineVersion,
  buildLegacyProjection,
  buildLegacyVersionId,
};
