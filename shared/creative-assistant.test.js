const assert = require('node:assert/strict');
const { createDraft, planCreative, matchLines, BINDINGS } = require('./creative-assistant');
function fixture() {
  const draft = createDraft('Coffee morning'), assets = {};
  draft.overlayText = 'A slower morning';
  const sentences = { hook: ['Try again.', 'A warm cup.', 'A quiet morning.', 'Wrong ending.'], body: ['Enjoy your ritual.'], outro: ['Discover Luma.'] };
  for (const role of BINDINGS) {
    const contentHash = role + '-hash';
    assets[role] = { id: role, kind: role === 'logo' ? 'image' : ['sfx', 'music'].includes(role) ? 'audio' : 'video', status: 'ok', content_hash: contentHash, duration_ms: role === 'hook' ? 12000 : 6000 };
    const speech = sentences[role] && { sourceHash: contentHash, origin: 'test-fixture', cues: sentences[role].map((content, i) => {
      const startMs = 500 + i * 2500, tokens = content.split(' ');
      return { id: role + i, content, startMs, endMs: startMs + 1500, speaker: 'one', action: 'keep', words: tokens.map((word, k) => ({ word, startMs: startMs + k * 1500 / tokens.length, endMs: startMs + (k + 1) * 1500 / tokens.length })) };
    }) };
    draft.bindings[role] = { assetId: role, contentHash, ...(speech && { speech }) };
    if (sentences[role]) draft.script[role].lines = role === 'hook' ? sentences.hook.slice(1, 3) : sentences[role];
  }
  return { draft, assets };
}
function main() {
  const { draft, assets } = fixture(), plan = planCreative(draft, assets);
  assert.equal(plan.canCreate, true);
  assert.equal(plan.mappings.length, 4);
  assert.equal(plan.mappings[2].sourceInMs, 0);
  assert.equal(plan.mappings[2].sourceOutMs, 6000, 'body kept whole');
  assert.equal(plan.mappings[3].sourceOutMs, 6000, 'outro kept whole');
  const captions = plan.document.tracks.find(t => t.type === 'caption').clips;
  assert(!JSON.stringify(captions).includes('Wrong'));
  assert(!JSON.stringify(captions).includes('again'));
  assert.equal(captions[0].timelineInMs, 3000 - plan.mappings[0].sourceInMs);
  for (const c of captions) {
    const again = require('./video-speech').splitCaptionCues([{ id: c.id, content: c.text.content, startMs: c.timelineInMs, endMs: c.timelineOutMs }], { ...plan.document.resolution, fps: 30 }, c.text);
    assert.equal(again.length, 1, 'renderer must not split already-wrapped subtitle timing again');
    assert.equal(again[0].content, c.text.content);
  }
  assert(plan.document.transitions.every(t => t.durationMs < 500 && t.timingMode === 'centered-v1'));
  assert.deepEqual(plan.document.tracks.map(t => t.id), ['logo', 'overlay', 'captions', 'main', 'sfx', 'music']);
  for (const mutate of [d => { d.script.hook.lines = ['Missing words']; }, d => { d.settings.timing = 'fixed-hook'; }, d => { d.bindings.hook.speech.cues[0].words.reverse(); }, d => { d.bindings.body.speech.cues[0].words.pop(); }]) {
    const bad = structuredClone(draft); mutate(bad); assert.equal(planCreative(bad, assets).canCreate, false);
  }
  const repeated = structuredClone(draft.bindings.hook.speech.cues); repeated.push(...repeated);
  assert(matchLines(draft.script.hook.lines, repeated).issues.some(e => e.includes('lần')));
  const stale = structuredClone(draft); stale.bindings.hook.speech.sourceHash = 'changed';
  assert.throws(() => planCreative(stale, assets), /hash/);
  console.log('creative-assistant: alignment, layers, fixed timing, ambiguity and transcript validation passed');
}
if (require.main === module) main();
module.exports = { fixture };
