const assert = require('node:assert/strict');
const { buildRenderPlan } = require('./renderPlanner');
const { fixture } = require('../../shared/creative-assistant.test');
const { planCreative } = require('../../shared/creative-assistant');
{
  const { draft, assets } = fixture();
  const doc = planCreative(draft, assets).document;
  const main = doc.tracks.find(t => t.id === 'main');
  const cuts = [[0, 2633.3333333333335], [2633.3333333333335, 5100], [5100, 12000], [12000, 15466.666666666668]];
  main.clips.forEach((clip, i) => Object.assign(clip, { timelineInMs: cuts[i][0], timelineOutMs: cuts[i][1], sourceInMs: 0, sourceOutMs: cuts[i][1] - cuts[i][0] }));
  doc.tracks = [main, { id: 'music', type: 'audio', order: 0, clips: [{ id: 'bed', assetId: 'music', timelineInMs: 0, timelineOutMs: cuts.at(-1)[1], sourceInMs: 0, sourceOutMs: cuts.at(-1)[1], speed: 1, volume: .1 }] }];
  const plan = buildRenderPlan(doc, { assetPaths: { hook: '/hook.mp4', body: '/body.mp4', outro: '/outro.mp4', music: '/music.wav' }, outputPath: '/out.mp4' });
  const graph = plan.args[plan.args.indexOf('-filter_complex') + 1];
  assert(!graph.includes('[vpad0]'), 'actual demo boundaries must not create a 1.78e-15s trailing gap');
  assert.equal(plan.totalDurationMs, 15467);
}
// Exercise real fractional-frame sums at several cut positions. Previously a
// 1.78e-15s rounding remainder became a color-source duration FFmpeg cannot parse.
for (const endMs of [1900, 1950, 2017, 2120, 2490]) {
  const { draft, assets } = fixture();
  const words = draft.bindings.hook.speech.cues[1].words;
  words.at(-1).endMs = 3000 + endMs;
  draft.bindings.hook.speech.cues[1].endMs = words.at(-1).endMs;
  const planned = planCreative(draft, assets); assert(planned.canCreate);
  const document = planned.document;
  document.tracks = document.tracks.filter(t => !['text', 'caption'].includes(t.type));
  const plan = buildRenderPlan(document, { assetPaths: Object.fromEntries(Object.keys(assets).map(id => [id, `/media/${id}`])),
    assetKinds: Object.fromEntries(Object.entries(assets).map(([id, a]) => [id, a.kind])), outputPath: '/out.mp4' });
  const graph = plan.args[plan.args.indexOf('-filter_complex') + 1];
  assert(!/color=[^;]*:d=[\d.]+e-/.test(graph), 'no infinitesimal synthesized padding');
  assert(Math.abs(plan.totalDurationMs - planned.durationMs) < 1);
}
console.log('creative-assistant render: fractional-frame transitions preserve duration');
