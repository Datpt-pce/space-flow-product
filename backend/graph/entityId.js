// Entity ID scheme for the Relationship Graph — see docs/decisions/0009-entity-id-scheme.md.
// `{type}:{localId}` where localId reuses the resource's existing key (no new UUIDs minted here).

const ENTITY_TYPES = Object.freeze({
  WORKFLOW: 'workflow',
  NODE_INSTANCE: 'node_instance',
  NODE_PACKAGE: 'node_package',
  USER: 'user',
  ASSET: 'asset', // placeholder — no Asset Service yet
  SHEET: 'sheet', // placeholder — no Spreadsheet module yet
  VIDEO_PROJECT: 'video_project', // placeholder — no Video Editor module yet
  NOTE: 'note', // placeholder — no Note/Document module yet
  TAG: 'tag', // placeholder — no Tag service yet
});

// Entity types with a real data source today (safe for the indexer to write now).
const LIVE_ENTITY_TYPES = Object.freeze([
  ENTITY_TYPES.WORKFLOW,
  ENTITY_TYPES.NODE_INSTANCE,
  ENTITY_TYPES.NODE_PACKAGE,
  ENTITY_TYPES.USER,
]);

const RELATIONS = Object.freeze({
  CONTAINS: 'contains',
  USES: 'uses',
  PRODUCES: 'produces',
  DERIVED_FROM: 'derived_from',
  LINKS_TO: 'links_to',
  REFERENCES: 'references',
  CREATED_BY: 'created_by',
  VERSION_OF: 'version_of',
  SYNCED_FROM: 'synced_from',
});

function workflowEntityId(workflowId) {
  return `${ENTITY_TYPES.WORKFLOW}:${workflowId}`;
}

function nodeInstanceEntityId(workflowId, nodeId) {
  return `${ENTITY_TYPES.NODE_INSTANCE}:${workflowId}:${nodeId}`;
}

function nodePackageEntityId(nodeType) {
  return `${ENTITY_TYPES.NODE_PACKAGE}:${nodeType}`;
}

function userEntityId(userId) {
  return `${ENTITY_TYPES.USER}:${userId}`;
}

// Splits an entity ID back into { type, localId }. localId may itself contain ':'
// (e.g. node_instance ids), so only the first segment is treated as the type.
function parseEntityId(entityId) {
  const sep = entityId.indexOf(':');
  if (sep === -1) throw new Error(`Invalid entity id (missing type prefix): ${entityId}`);
  return { type: entityId.slice(0, sep), localId: entityId.slice(sep + 1) };
}

module.exports = {
  ENTITY_TYPES,
  LIVE_ENTITY_TYPES,
  RELATIONS,
  workflowEntityId,
  nodeInstanceEntityId,
  nodePackageEntityId,
  userEntityId,
  parseEntityId,
};
