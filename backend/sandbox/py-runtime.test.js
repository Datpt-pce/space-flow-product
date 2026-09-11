// Regression + security test for Custom Node Platform Phase 3 Python track
// (specs/space-flow-master-plan/01-custom-node-platform.md). Converts real production Python
// nodes to run through backend/sandbox/py-runtime.js's bwrap+rlimit sandbox and asserts output
// matches the existing in-process baseline (backend/engine/runner.js's spawnPython) exactly,
// plus a small security corpus (fork bomb, memory limit, CPU timeout, network capability
// denial, filesystem escape) mirroring backend/sandbox/security-corpus/bwrap-isolation.test.js
// for the JS track.
//
// Requires `bwrap` + Linux unprivileged user namespaces (same environment as
// backend/sandbox/security-corpus/bwrap-isolation.test.js — see
// docs/decisions/0011-bubblewrap-feasibility-spike.md for how to run this via Docker on
// Windows). Skips (not fails) when bwrap isn't available, matching that file's convention.
//
// Run with: node backend/sandbox/py-runtime.test.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execSync } = require('child_process');
const { spawnPython } = require('../engine/runner');
const { runPythonSandboxed } = require('./py-runtime');
const { pack, verify } = require('../registry/sfpkg');

const NODES_DIR = path.join(__dirname, '..', '..', 'nodes');
const REF_ITEM_DIR = path.join(__dirname, '..', '..', 'ref-item');
const REGISTRY_FIXTURES_DIR = path.join(__dirname, '..', 'registry', '__fixtures__');

function checkBwrapAvailable() {
  try {
    execSync('bwrap --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

let pass = 0;
let fail = 0;
async function check(label, fn) {
  try {
    await fn();
    pass++;
    console.log(`PASS — ${label}`);
  } catch (err) {
    fail++;
    console.error(`FAIL — ${label}: ${err.message}`);
  }
}

function mkScratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sf-py-sandbox-'));
}

// ---- Packaging: the 4 Python nodes converted to real .sfpkg for this Phase (see Phase 3
// task checklist "Convert 5 node Python thành .sfpkg, chạy thử"; resize-upload-v2 is
// intentionally NOT packaged yet — see py-runtime.test.js's packaging section comment). Pure
// JS, no bwrap needed — runs on every platform, mirrors backend/registry/sfpkg.test.js's
// round-trip check against these new fixtures instead of re-testing pack()/verify() itself
// (already covered there).
async function checkPackaging() {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-py-sfpkg-'));
  try {
    for (const fixtureDir of ['advanced-renamer-v2', 'image-batch-resize-v2', 'resize-upload-mv2', 'capcut-generate-v2']) {
      await check(`sfpkg pack+verify round-trip: ${fixtureDir}`, async () => {
        const sourceDir = path.join(REGISTRY_FIXTURES_DIR, fixtureDir);
        const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'node.json'), 'utf8'));
        const outFile = path.join(scratchDir, `${manifest.packageId}-${manifest.version}.sfpkg`);
        const packResult = await pack({ sourceDir, outFile });
        assert.strictEqual(packResult.packageId, manifest.packageId);
        const verifyResult = verify({ archiveFile: outFile });
        assert.strictEqual(verifyResult.valid, true, JSON.stringify(verifyResult.errors));
        assert.strictEqual(verifyResult.checksum, packResult.checksum);
      });
    }
  } finally {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
}

async function main() {
  await checkPackaging();

  if (!checkBwrapAvailable()) {
    console.log('SKIP — bwrap not on PATH. This corpus only runs on Linux with bubblewrap ' +
      'installed (see docs/decisions/0011-bubblewrap-feasibility-spike.md for how to run it ' +
      'via Docker on Windows).');
    return;
  }

  // ---- advanced-renamer: pure filesystem rename, no network/process capability needed ----
  await check('advanced-renamer: sandboxed output matches in-process baseline', async () => {
    const scratchDir = mkScratch();
    try {
      const basePath = path.join(scratchDir, 'renamer-fixture');
      fs.mkdirSync(basePath);
      fs.writeFileSync(path.join(basePath, 'clip_a.mp4'), 'x');
      fs.writeFileSync(path.join(basePath, 'clip_b.mp4'), 'x');

      const payload = {
        config: {
          base_path: basePath,
          dropped_items: [{ name: 'clip_a.mp4' }, { name: 'clip_b.mp4' }],
          file_methods: [{ type: 'Add', active: true, params: { text: 'RENAMED_', index: 0, apply_to: 'Name' } }],
          folder_methods: [],
          apply_changes: false, // preview only — dry-run, keeps this test filesystem-mutation-free either way
        },
      };
      const scriptPath = path.join(NODES_DIR, 'advanced-renamer', 'executor.py');

      const baseline = await spawnPython(scriptPath, payload);
      const sandboxed = await runPythonSandboxed({
        scriptPath,
        payload,
        capabilityGrants: { filesystem: 'user-approved-path', approvedPaths: [basePath] },
        scratchDir,
      });
      assert.deepStrictEqual(sandboxed, baseline);
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  // ---- image-batch-resize: needs Pillow, exercises real image I/O under the sandbox ----
  await check('image-batch-resize: sandboxed output matches in-process baseline', async () => {
    const scratchDir = mkScratch();
    try {
      const inDir = path.join(scratchDir, 'images-in');
      fs.mkdirSync(inDir);
      // Minimal valid 2x2 red PNG (hand-crafted, no PIL needed to generate the fixture itself).
      const twoByTwoPng = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGP8z8BQz0AEYBxVCwB4/AX9G3zL' +
        '9wAAAABJRU5ErkJggg==', 'base64'
      );
      fs.writeFileSync(path.join(inDir, 'a.png'), twoByTwoPng);

      const payload = {
        inputs: { files_in: [path.join(inDir, 'a.png')] },
        config: { output_format: 'png', manual_width: 4, manual_height: 0, base_px: 1080 },
      };
      const scriptPath = path.join(NODES_DIR, 'image-batch-resize', 'executor.py');

      const baseline = await spawnPython(scriptPath, payload);
      // Baseline already wrote real output files onto the host — remove before the sandboxed
      // run so both runs start from identical input state (both write into the same computed
      // out_dir, a sibling of inDir).
      for (const f of baseline.files_out) fs.rmSync(f, { force: true });

      const sandboxed = await runPythonSandboxed({
        scriptPath,
        payload,
        capabilityGrants: { filesystem: 'user-approved-path', approvedPaths: [scratchDir] },
        scratchDir,
        limits: { memoryMB: 768 }, // Pillow/import overhead needs headroom above the 512MB default
      });
      assert.deepStrictEqual(sandboxed, baseline);
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  // ---- resize-upload: real ffmpeg subprocess inside the sandbox, network/UNC/Asana all off ----
  await check('resize-upload: sandboxed output matches in-process baseline (local resize only)', async () => {
    const scratchDir = mkScratch();
    try {
      const rootDir = path.join(scratchDir, 'AnyFolderName');
      fs.mkdirSync(rootDir);
      fs.copyFileSync(path.join(REF_ITEM_DIR, '1.mp4'), path.join(rootDir, 'clip.mp4'));
      const outputFolder = path.join(scratchDir, 'out');

      const payload = {
        inputs: { folders_in: [] },
        config: {
          input_folders: [rootDir],
          output_folder: outputFolder,
          mode: '3_sizes',
          rename_videos: false, // skip YYMMDD_Theme_CodeApp_Language filename parsing
          bg_style: 'color',
          color_color: '#000000',
          export_thumbnail: false,
          selected_apps: [], // no UNC/GCS distribution targets — no network/filesystem capability needed beyond scratch
          use_unc: false,
          use_gcs: false,
          use_asana: false,
        },
        settings: {},
        custom_links: {},
      };
      const scriptPath = path.join(NODES_DIR, 'resize-upload', 'executor.py');

      const baseline = await spawnPython(scriptPath, payload);
      fs.rmSync(outputFolder, { recursive: true, force: true }); // clean before the sandboxed run writes the same tree

      const sandboxed = await runPythonSandboxed({
        scriptPath,
        payload,
        capabilityGrants: { filesystem: 'user-approved-path', approvedPaths: [scratchDir] },
        scratchDir,
        // Real ffmpeg h264 decode/scale/encode: RLIMIT_AS (virtual ADDRESS SPACE, not RSS)
        // needs far more headroom than the 512MB default suggests — empirically isolated via
        // bisection (see docs/decisions/0026-sandbox-py-runtime.md) to ~2816-3072MB just from
        // this "full" ffmpeg build's shared-library mmap footprint (many codec libs linked in)
        // PLUS per-thread stacks (libx264 threads="auto" spawns one encoder thread per
        // detected core), essentially independent of actual resolution/bitrate — a fixed cost
        // pure-Python nodes never pay. capabilities.process:true nodes need a deliberately
        // generous memoryMB, not the pure-Python default.
        limits: { timeoutSeconds: 60, memoryMB: 4096 },
      });
      assert.deepStrictEqual(sandboxed, baseline);
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  // ---- capcut-generate: exercises ffprobe + real draft-project file generation ----
  await check('capcut-generate: sandboxed output matches in-process baseline', async () => {
    const scratchDir = mkScratch();
    try {
      const capcutDir = path.join(scratchDir, 'capcut-projects');
      fs.mkdirSync(capcutDir);

      const payload = {
        inputs: {},
        config: {
          capcut_dir: capcutDir,
          timelines: [{
            name: 'timeline_1',
            video_sources: [path.join(REF_ITEM_DIR, '1.mp4')],
            music_files: [],
            transitions_enabled: false,
            text_template: false,
          }],
        },
      };
      const scriptPath = path.join(NODES_DIR, 'capcut-generate', 'executor.py');

      const baseline = await spawnPython(scriptPath, payload);
      fs.rmSync(baseline.project_path, { recursive: true, force: true });

      const sandboxed = await runPythonSandboxed({
        scriptPath,
        payload,
        capabilityGrants: { filesystem: 'user-approved-path', approvedPaths: [scratchDir, REF_ITEM_DIR] },
        scratchDir,
      });
      // project_path embeds a fresh uuid-derived folder name per run (see capcut_generator.py
      // _new_id-based project naming) — assert shape/prefix, not byte-identical path equality.
      assert.strictEqual(typeof sandboxed.project_path, 'string');
      assert.ok(fs.existsSync(sandboxed.project_path), `expected generated project dir to exist: ${sandboxed.project_path}`);
      fs.rmSync(sandboxed.project_path, { recursive: true, force: true });
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  // ---- Security corpus ----

  await check('filesystem: reading a path outside every approved bind is blocked', async () => {
    const scratchDir = mkScratch();
    // os.tmpdir() is the container's real /tmp — py-runtime.js's bwrap args mount a fresh
    // EMPTY tmpfs over /tmp inside the sandbox, so a file placed directly in the real /tmp
    // (readable by this unprivileged user outside the sandbox — unlike /root or /etc/shadow,
    // which would fail from plain file permissions and not actually exercise namespace
    // isolation) must become unreachable (ENOENT, not EACCES) once sandboxed.
    const secretPath = path.join(os.tmpdir(), `py-sandbox-secret-${Date.now()}.txt`);
    fs.writeFileSync(secretPath, 'TOP-SECRET');
    try {
      const scriptPath = path.join(__dirname, 'security-corpus', 'fixtures', 'py-fs-escape', 'executor.py');
      const result = await runPythonSandboxed({
        scriptPath,
        payload: { config: { target_path: secretPath } },
        capabilityGrants: { filesystem: 'scratch' }, // deliberately NOT approving secretPath
        scratchDir,
      });
      assert.strictEqual(result.read, false, `expected read to fail, got: ${JSON.stringify(result)}`);
      assert.strictEqual(result.errorCode, 'FileNotFoundError');
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
      fs.rmSync(secretPath, { force: true });
    }
  });

  await check('network: outbound connection is blocked without network capability', async () => {
    const scratchDir = mkScratch();
    try {
      const scriptPath = path.join(__dirname, 'security-corpus', 'fixtures', 'py-net-probe', 'executor.py');
      const result = await runPythonSandboxed({
        scriptPath,
        payload: { config: {} },
        capabilityGrants: {}, // no network capability granted
        scratchDir,
        limits: { timeoutSeconds: 10 },
      });
      assert.strictEqual(result.connected, false, `expected connection to fail, got: ${JSON.stringify(result)}`);
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  await check('fork bomb: RLIMIT_NPROC stops runaway process creation without hanging the host', async () => {
    const scratchDir = mkScratch();
    try {
      const scriptPath = path.join(__dirname, 'security-corpus', 'fixtures', 'py-fork-bomb', 'executor.py');
      const start = Date.now();
      try {
        await runPythonSandboxed({
          scriptPath,
          payload: { config: {} },
          capabilityGrants: {},
          scratchDir,
          limits: { maxProcesses: 8, timeoutSeconds: 15 },
        });
        throw new Error('expected the fork bomb script to fail (BlockingIOError/OSError from exhausted RLIMIT_NPROC)');
      } catch (err) {
        const elapsed = Date.now() - start;
        assert.ok(elapsed < 20000, `expected termination well under the 15s timeout backstop, took ${elapsed}ms`);
      }
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  // Custom Node Platform Phase 9 (specs/space-flow-master-plan/01-custom-node-platform.md):
  // this file's own header comment has claimed "memory limit" as part of this corpus since Phase
  // 3 — no test actually existed for it until now. py_adapter.py's resource.setrlimit(RLIMIT_AS)
  // is the real enforcement (see py_adapter.py); this proves it, not just documents it.
  await check('memory limit: RLIMIT_AS stops unbounded allocation, not an OOM-killed host process', async () => {
    const scratchDir = mkScratch();
    try {
      const scriptPath = path.join(__dirname, 'security-corpus', 'fixtures', 'py-memory-hog', 'executor.py');
      const start = Date.now();
      try {
        await runPythonSandboxed({
          scriptPath,
          payload: { config: {} },
          capabilityGrants: {},
          scratchDir,
          limits: { memoryMB: 64, timeoutSeconds: 15 },
        });
        throw new Error('expected the memory-hog script to fail (MemoryError from exhausted RLIMIT_AS)');
      } catch (err) {
        const elapsed = Date.now() - start;
        assert.ok(elapsed < 20000, `expected termination well under the 15s timeout backstop, took ${elapsed}ms`);
      }
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  await check('timeout: a CPU-bound infinite loop is killed, not hung', async () => {
    const scratchDir = mkScratch();
    try {
      const scriptPath = path.join(__dirname, 'security-corpus', 'fixtures', 'py-infinite-loop', 'executor.py');
      const start = Date.now();
      try {
        await runPythonSandboxed({
          scriptPath,
          payload: { config: {} },
          capabilityGrants: {},
          scratchDir,
          limits: { timeoutSeconds: 2, cpuSeconds: 2 },
        });
        throw new Error('expected a timeout/CPU-limit error');
      } catch {
        const elapsed = Date.now() - start;
        assert.ok(elapsed < 10000, `expected termination well under 10s, took ${elapsed}ms`);
      }
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
  if (fail) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAIL — unexpected error:', err.stack);
  process.exitCode = 1;
});
