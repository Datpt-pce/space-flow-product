var w=Object.defineProperty;var b=(a,r)=>w(a,"name",{value:r,configurable:!0});const fs=require("fs"),path=require("path"),crypto=require("crypto"),{sourceFiles,writeFiles,manifestFor,verifyManifest}=require("./source"),{runProcess,within,removeWorkspace}=require("./process"),{hash}=require("./policy"),{requireValue}=require("./errors"),{toolkitFiles}=require("./toolkit");function contributorFiles(a=path.resolve(__dirname,"../..")){const r={name:"space-flow-contributor",version:"1.0.0",private:!0,engines:{node:">=24.16.0"},scripts:{setup:"node scripts/contributor-dev.cjs setup",dev:"node scripts/contributor-dev.cjs dev",build:"npm run build --prefix frontend",test:"node --test backend/contributions/domain.test.js","tools:setup":"node scripts/contributor-tools.cjs setup","tools:doctor":"node scripts/contributor-tools.cjs doctor",graph:"node scripts/contributor-tools.cjs graph","review:doctor":"node scripts/review-console.js doctor","review:open":"node scripts/review-console-start.js","review:install":"node scripts/install-review-console.js","review:worker":"node scripts/review-console.js worker"}},n=`# Space Flow Contributor

Kho ph\xE1t tri\u1EC3n ri\xEAng d\xE0nh cho ng\u01B0\u1EDDi \u0111\xF3ng g\xF3p. M\u1ED7i \u0111\u1EC1 xu\u1EA5t \u0111i qua PR v\xE0 owner review.

## C\xE0i v\xE0 ch\u1EA1y tr\xEAn m\xE1y c\u1EE7a b\u1EA1n

C\xE0i Git v\xE0 Node.js 24.16 tr\u1EDF l\xEAn (nh\xE1nh 24 LTS). Clone repo n\xE0y, m\u1EDF Git Bash r\u1ED3i ch\u1EA1y:

\`\`\`bash
npm run setup
npm run dev
\`\`\`

M\u1EDF http://127.0.0.1:4174/api/auth/dev-login \u0111\u1EC3 \u0111\u0103ng nh\u1EADp b\u1EA3n local. D\xF9ng m\u1ED9t browser profile ri\xEAng; cookie kh\xF4ng t\xE1ch theo port.
D\u1EEF li\u1EC7u th\u1EED \u1EDF .contributor-state, backend 4101 v\xE0 frontend 4174. Kh\xF4ng gh\xE9p agent v\u1EDBi server chung v\xE0 kh\xF4ng d\xF9ng credential production.
C\xE1c node d\xF9ng Python/FFmpeg c\u1EA7n runtime t\u01B0\u01A1ng \u1EE9ng tr\xEAn m\xE1y; ch\u1EC9 c\xE0i ph\u1EA7n c\u1EA7n cho node b\u1EA1n \u0111ang s\u1EEDa.

## B\u1ED9 c\xF4ng c\u1EE5 cho Codex v\xE0 Claude

\u0110\u1ECDc AGENTS.md v\xE0 docs/TOOLS.md. Ch\u1EA1y npm run tools:setup, npm run tools:doctor \u0111\u1EC3 c\xE0i Harness v\xE0 Codegraph ri\xEAng trong repo n\xE0y.

## G\u1EEDi m\u1ED9t thay \u0111\u1ED5i

\`\`\`bash
git switch -c task/mo-ta-ngan
# S\u1EEDa source, ch\u1EA1y ki\u1EC3m tra ph\xF9 h\u1EE3p
npm test
npm run build
git add <file-da-sua>
git commit -m "feat: mo ta thay doi"
git push -u origin task/mo-ta-ngan
\`\`\`

T\u1EA1o Pull Request v\xE0o main, ghi m\u1EE5c ti\xEAu, tr\u01B0\u1EDBc/sau, ca \u0111\xE3 ki\u1EC3m v\xE0 \u1EA3nh UI n\u1EBFu c\xF3. Chuy\u1EC3n PR kh\u1ECFi Draft khi s\u1EB5n s\xE0ng review.
Owner xem b\xE1o c\xE1o ri\xEAng, g\u1EEDi ph\u1EA3n h\u1ED3i v\xE0o PR ho\u1EB7c trong \u1EE9ng d\u1EE5ng. PR m\u1EDBi c\u1EADp nh\u1EADt s\u1EBD l\xE0m m\u1EA5t hi\u1EC7u l\u1EF1c review v\xE0 duy\u1EC7t c\u0169.

## Ph\u1EA1m vi v\xE0 baseline

Gi\u1EEF thay \u0111\u1ED5i trong frontend/, backend/, nodes/, shared/; b\u1EB1ng ch\u1EE9ng \u1EDF docs/changes/<ten-ngan>.md (t\u1ED1i \u0111a 32 KB, kh\xF4ng \u0111\u01B0a v\xE0o runtime). Kh\xF4ng s\u1EEDa contributor-baseline.json ho\u1EB7c worker/control policy.
Thay dependency, build recipe ho\u1EB7c c\u1EA5u h\xECnh tri\u1EC3n khai c\u1EA7n owner c\u1EADp nh\u1EADt baseline tin c\u1EADy tr\u01B0\u1EDBc. Kh\xF4ng g\u1EEDi .env, token, DB, uploads ho\u1EB7c d\u1EEF li\u1EC7u ng\u01B0\u1EDDi d\xF9ng.
Commit ch\u1EC9 l\u01B0u code trong repo contributor; kh\xF4ng ph\u1EA3i l\u1EC7nh deploy. Kh\xF4ng s\u1EED d\u1EE5ng h\u01B0\u1EDBng d\u1EABn ri\xEAng ho\u1EB7c l\u1ECBch s\u1EED c\u1EE7a repo owner.
Khi owner ph\xE1t baseline m\u1EDBi, fetch main v\xE0 rebase nh\xE1nh c\u1EE7a b\u1EA1n; x\u1EED l\xFD conflict tr\u01B0\u1EDBc khi y\xEAu c\u1EA7u \u0111\xE1nh gi\xE1 l\u1EA1i.
`;return{"package.json":Buffer.from(JSON.stringify(r,null,2)+`
`),"README.md":Buffer.from(n),"CONTRIBUTING.md":Buffer.from(n),...toolkitFiles(a),".gitignore":Buffer.from(`node_modules/
dist/
.contributor-tools/
.code-review-graph/
scripts/bin/
harness.db*
.contributor-state/
.env
.env.*
*.log
*.sqlite*
*.db
__pycache__/
backend/uploads/
backend/workflows/
backend/config/review-console.json
backend/config/review-workspace/
`),"scripts/contributor-dev.cjs":Buffer.from(`const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const root = path.resolve(__dirname, '..');
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Ch\u1EA1y b\u1EB1ng npm run setup ho\u1EB7c npm run dev');
function run(file,args,env){return spawn(process.execPath,[file,...args],{cwd:root,env,stdio:'inherit',windowsHide:true});}
async function main(){
if(process.argv[2]==='setup'){for(const dir of ['backend','nodes','frontend']){const code=await new Promise((resolve,reject)=>{const child=run(npm,['ci','--prefix',dir],process.env);child.on('error',reject);child.on('close',resolve);});if(code!==0)process.exit(code||1);}return;}
const state=path.join(root,'.contributor-state');fs.mkdirSync(state,{recursive:true});
const env={...process.env,NODE_ENV:'development',DEV_LOGIN_ENABLED:'true',SF_REVIEW_OWNER_EMAIL:'dev@space-flow.local',SF_REVIEW_WORKER_AUTOSTART:'0',SF_DATA_DIR:state,SF_IMPORT_LEGACY:'0',SPACE_FLOW_MODE:'agent',CENTRAL_SERVER_URL:'',SF_BIND_HOST:'127.0.0.1',PORT:'4101',BACKEND_HOST:'127.0.0.1',BACKEND_PORT:'4101',FRONTEND_PORT:'4174',CORS_ORIGINS:'http://127.0.0.1:4174'};
for(const name of ['SF_GITHUB_TOKEN','SF_REVIEW_WORKSPACE','SF_UPLOADS_DIR','SF_WORKFLOWS_DIR','AGENT_TOKEN'])delete env[name];
const children=[run('backend/server.js',[],env),run('frontend/node_modules/vite/bin/vite.js',['frontend','--host','127.0.0.1'],env)];
let stopping=false;function stop(){if(stopping)return;stopping=true;for(const child of children)child.kill();}
for(const child of children){child.on('error',error=>{console.error(error.message);stop();process.exitCode=1;});child.on('close',code=>{stop();process.exitCode=code||0;});}process.once('SIGINT',stop);process.once('SIGTERM',stop);
console.log('Contributor local: http://127.0.0.1:4174/api/auth/dev-login \u2014 d\xF9ng browser profile ri\xEAng.');}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
`),"OWNER-CONSOLE.md":Buffer.from("# Console tr\xEAn m\xE1y owner th\u1EE9 hai\n\nCh\u1EC9 owner c\xF3 quy\u1EC1n \u0111\u1ECDc kho control th\u1EF1c hi\u1EC7n c\xE1c b\u01B0\u1EDBc n\xE0y. Contributor ch\u1EC9 c\u1EA7n README.md.\n\nC\xE0i Git, Node.js 24.16+, Docker Desktop v\xE0 hai CLI Codex/Claude. \u0110\u0103ng nh\u1EADp GitHub b\u1EB1ng Git Credential Manager; \u0111\u0103ng nh\u1EADp t\u1EEBng CLI b\u1EB1ng t\xE0i kho\u1EA3n c\u1EE7a owner. Kh\xF4ng ch\xE9p token t\u1EEB m\xE1y kh\xE1c.\n\nClone repo contributor, ch\u1EA1y `npm run setup`, `npm run build`. T\u1EA1o `.env` local v\u1EDBi `SF_REVIEW_OWNER_EMAIL=dev@space-flow.local` (ph\u1EA3i tr\xF9ng owner trong control repo).\n\nCh\u1EA1y `node scripts/review-console.js connect`, `npm run review:doctor`, `node scripts/review-console.js sandbox-setup`, `node scripts/review-console.js staging-setup`, `npm run review:install`, r\u1ED3i `npm run review:open`.\n\nB\u1EADt worker trong M\xE1y & c\xE0i \u0111\u1EB7t. GitHub gi\u1EEF h\xE0ng \u0111\u1EE3i khi hai m\xE1y t\u1EAFt. Vi\u1EC7c model b\u1ECB ng\u1EAFt s\u1EBD ch\u1EDD owner ti\u1EBFp t\u1EE5c; kh\xF4ng t\u1EF1 g\u1ECDi l\u1EA1i l\xE0m t\u1ED1n quota. Candidate/preview/target thu\u1ED9c m\xE1y t\u1EA1o n\xF3; t\u1EA1o l\u1EA1i candidate tr\xEAn m\xE1y hi\u1EC7n t\u1EA1i khi c\u1EA7n.\n\nSau pull baseline m\u1EDBi, ch\u1EA1y l\u1EA1i setup/build v\xE0 t\u1EAFt/m\u1EDF console. Kh\xF4ng sao ch\xE9p controller-state, review-console.json ho\u1EB7c artifact gi\u1EEFa hai m\xE1y.\n")}}b(contributorFiles,"contributorFiles");async function git(a,r){const n=await runProcess("git",["-c","core.hooksPath=/dev/null","-c","core.autocrlf=false",...r],{cwd:a,env:{...require("./process").cleanEnv(),GIT_TERMINAL_PROMPT:"0",GCM_INTERACTIVE:"never"},timeoutMs:12e4,maxBytes:2e6});return requireValue(n.code===0,"DISTRIBUTION_GIT","Git ch\u01B0a ho\xE0n t\u1EA5t thao t\xE1c g\xF3i contributor. Ki\u1EC3m tra quy\u1EC1n, conflict v\xE0 k\u1EBFt n\u1ED1i."),n.output.trim()}b(git,"git");class ContributorDistribution{static{b(this,"ContributorDistribution")}constructor(r){this.service=r}directory(r){return requireValue(/^base-[a-f0-9-]{36}$/.test(r),"BASELINE_ID","Baseline kh\xF4ng h\u1EE3p l\u1EC7.",400),within(this.service.config.read().workspaceRoot,path.join(this.service.config.read().workspaceRoot,"baselines",r))}async prepare(r){this.service.requireOwner(r);const n=await this.service.effective(),i=await sourceFiles(n.sourceRoot),t=`base-${crypto.randomUUID()}`,h=this.directory(t),s={...i.files,...contributorFiles(n.sourceRoot)};for(const l of["review-console.js","review-console-start.js","install-review-console.js"])s[`scripts/${l}`]=fs.readFileSync(path.join(n.sourceRoot,"scripts",l));const u=manifestFor(i.files),e=manifestFor(s);s["contributor-baseline.json"]=Buffer.from(JSON.stringify({schemaVersion:1,id:t,files:e},null,2)+`
`),writeFiles(path.join(h,"source"),s);const c={id:t,createdAt:Date.now(),status:"prepared",repository:n.sourceRepo,ownerManifest:u,publicManifest:manifestFor(s),ownerDigest:hash(u),fileCount:Object.keys(s).length,excluded:i.excluded,publicHead:null};return await this.service.store().mutate("baselines",t,l=>(requireValue(!l,"BASELINE_EXISTS","Baseline b\u1ECB tr\xF9ng."),c)),{id:t,fileCount:c.fileCount,excludedCount:i.excluded.length,status:c.status,ownerDigest:c.ownerDigest}}async publish(r,n){this.service.requireOwner(r);const i=await this.service.effective(),t=await this.service.store().get("baselines",n);if(requireValue(t?.repository===i.sourceRepo,"BASELINE_REPOSITORY","Baseline kh\xF4ng thu\u1ED9c repository \u0111ang ch\u1ECDn."),t.status==="published")return{id:n,publicHead:t.publicHead,status:t.status};requireValue(t.status==="prepared","BASELINE_STATE","Baseline ch\u01B0a s\u1EB5n s\xE0ng.");const h=await this.service.github.repository(i.sourceRepo,!0);requireValue(h.private&&h.permissions?.push,"SOURCE_ACCESS","Repo contributor ph\u1EA3i Private v\xE0 c\xF3 quy\u1EC1n ghi.",403);const s=this.directory(n),u=path.join(s,"source");verifyManifest(u,t.publicManifest);const e=path.join(s,"publishing");if(t.publishAttempt){const{publicHead:o,baseHead:d}=t.publishAttempt;requireValue(await git(e,["rev-parse","HEAD"])===o,"PUBLISH_UNCERTAIN","Checkout xu\u1EA5t b\u1EA3n \u0111\xE3 \u0111\u1ED5i; c\u1EA7n owner \u0111\u1ED1i chi\u1EBFu.");const g=(await git(e,["ls-remote","--heads","origin","main"])).split(/\s/)[0];return g!==o&&(requireValue(g===d,"PUBLISH_CONFLICT","Main contributor \u0111\xE3 \u0111\u1ED5i; kh\xF4ng t\u1EF1 ghi \u0111\xE8."),await git(e,["push","-u","origin","main"])),requireValue((await git(e,["ls-remote","--heads","origin","main"])).startsWith(o),"PUBLISH_UNCERTAIN","Ch\u01B0a \u0111\u1ECDc l\u1EA1i \u0111\u01B0\u1EE3c head sau publish."),await this.service.store().mutate("baselines",n,m=>({...m,status:"published",publicHead:o,publishedAt:Date.now()})),{id:n,publicHead:o,status:"published",repository:i.sourceRepo,fileCount:t.fileCount}}fs.existsSync(e)&&removeWorkspace(s,e),fs.mkdirSync(e,{recursive:!0}),await git(e,["init","-b","main"]),await git(e,["remote","add","origin",`https://github.com/${i.sourceRepo}.git`]);const c=await git(e,["ls-remote","--heads","origin","main"]);if(c){await git(e,["fetch","--depth=1","origin","main"]),await git(e,["checkout","-B","main","FETCH_HEAD"]);const o=path.join(e,"contributor-baseline.json");requireValue(fs.existsSync(o),"SOURCE_NOT_MANAGED","Repo \u0111\xE3 c\xF3 n\u1ED9i dung ngo\xE0i g\xF3i contributor; kh\xF4ng t\u1EF1 ghi \u0111\xE8.");const d=JSON.parse(fs.readFileSync(o,"utf8"));requireValue(d.schemaVersion===1&&d.id,"SOURCE_NOT_MANAGED","Kh\xF4ng x\xE1c minh \u0111\u01B0\u1EE3c baseline hi\u1EC7n c\xF3.");const g=(await git(e,["ls-files","-z"])).split("\0").filter(Boolean);for(const m of g)if(!Object.hasOwn(t.publicManifest,m)){const f=within(e,path.join(e,m));requireValue(!fs.lstatSync(f).isSymbolicLink(),"SOURCE_LINK","Repo contributor c\xF3 symlink."),fs.unlinkSync(f)}}const l=Object.fromEntries(Object.keys(t.publicManifest).map(o=>[o,fs.readFileSync(within(u,path.join(u,o)))]));writeFiles(e,l),await git(e,["add","--all"]),await git(e,["-c","user.name=Space Flow Owner","-c",`user.email=${i.ownerEmail}`,"commit","-m",`chore: publish contributor baseline ${n}`]);const p=await git(e,["rev-parse","HEAD"]);await this.service.store().mutate("baselines",n,o=>({...o,publishAttempt:{publicHead:p,baseHead:c.split(/\s/)[0]||"",startedAt:Date.now()}})),await git(e,["push","-u","origin","main"]);const v=await git(e,["ls-remote","--heads","origin","main"]);return requireValue(v.startsWith(p),"PUBLISH_UNCERTAIN","Ch\u01B0a x\xE1c minh \u0111\u01B0\u1EE3c head sau khi publish."),await this.service.store().mutate("baselines",n,o=>({...o,status:"published",publicHead:p,publishedAt:Date.now()})),{id:n,publicHead:p,status:"published",repository:i.sourceRepo,fileCount:t.fileCount}}}module.exports={ContributorDistribution,contributorFiles,git};
