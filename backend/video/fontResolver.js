// Font resolution for drawtext — Video Editor Phase 4 (specs/space-flow-master-plan/
// 04-video-editor.md §5). renderPlanner.js's drawtext branch needs an explicit `fontfile=` path
// (docs/decisions/0016-video-render-spike.md: this dev machine has no fontconfig default config,
// and Docker product has NO fonts installed at all — relying on fontconfig system lookup fails on
// both). Same env-var-override-first, OS-detect-fallback pattern as
// nodes/capcut-generate/executor.py's `_detect_capcut_dir` (CLAUDE.md §10 cross-platform
// checklist) — separate fs access from renderPlanner.js's pure filter-string building on purpose.

const fs = require('fs');

// Debian bookworm's `fonts-dejavu-core` package (added to Dockerfile.backend alongside this
// file) always installs at this exact path — a real, checked-in dependency, not a guess.
const LINUX_DEFAULT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const WINDOWS_DEFAULT = 'C:\\Windows\\Fonts\\arial.ttf';

// resolveFontFile() -> absolute path to a real, existing TTF file usable as drawtext's
// fontfile=, or null if none could be found. Never throws — callers (preflight.js, videoJobs.js)
// decide what a missing font means for them.
function resolveFontFile() {
  const override = process.env.SPACE_FLOW_DRAWTEXT_FONT;
  if (override && fs.existsSync(override)) return override;

  const osDefault = process.platform === 'win32' ? WINDOWS_DEFAULT : LINUX_DEFAULT;
  if (fs.existsSync(osDefault)) return osDefault;

  return null;
}

module.exports = { resolveFontFile, LINUX_DEFAULT, WINDOWS_DEFAULT };
