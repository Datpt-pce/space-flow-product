// Explicit business endpoints only. No query/body, polling, autosave or raw URL enters telemetry.
export function analyticsCommand(url, method) {
  if (!['POST','PUT','PATCH'].includes(method)) return null;
  const path=String(url).split('?')[0];
  const rules=[
    [/^\/api\/video-batch\/[^/]+\/(?:prepare|preflight|speech)$/, 'batch','prepare'],
    [/^\/api\/video-batch\/[^/]+\/(?:runs|capcut)$/, 'batch','generate'],
    [/^\/api\/video-batch\/.*\/deliveries(?:\/[^/]+)?$/, 'batch','delivery'],
    [/^\/api\/video-batch\/.*\/render$/, 'batch','render'],
    [/^\/api\/video-render\/[^/]+\/(?:render|retry)$/, 'video','render'],
    [/^\/api\/video-batch\/.*\/download$/, 'batch','export'],
    [/^\/api\/video-assets\/.*(?:import|upload)$/, 'video','import'],
    [/^\/api\/creative-assistant\/(?:materialize|analyze|normalize|demo)$/, 'assistant','generate'],
    [/^\/api\/sheets\/.*(?:refresh-now|import-google|link-google)$/, 'sheet','sync'],
    [/^\/api\/saved-graph-views$/, 'graph','save'],
    [/^\/api\/system\/update-deps$/, 'admin','update'],
  ];
  const match=rules.find(([pattern])=>pattern.test(path));
  return match?{feature:match[1],command:match[2]}:null;
}
