// Video Editor Phase 3 (specs/space-flow-master-plan/04-video-editor.md §5): the initial payload
// a brand-new project is created with — shape matches shared/video-commands/state.js's clip/track
// schema exactly (see shared/video-commands/index.test.js's baseState() fixture, the schema's
// canonical example). One empty video track + one empty audio track is enough for MVP's "single
// active clip" scope — the Timeline lets the user drop more clips onto these tracks.
export function createDefaultProjectPayload() {
  return {
    schemaVersion: 1,
    resolution: { width: 1920, height: 1080 },
    fps: 30,
    colorSpace: 'sRGB',
    audioRate: 48000,
    sequence: { markers: [] },
    tracks: [
      { id: 'track-v1', type: 'video', order: 0, locked: false, muted: false, visible: true, clips: [] },
      { id: 'track-a1', type: 'audio', order: 1, locked: false, muted: false, visible: true, clips: [] },
    ],
    transitions: [],
  };
}
