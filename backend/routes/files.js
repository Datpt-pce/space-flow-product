var g=Object.defineProperty;var y=(t,e)=>g(t,"name",{value:e,configurable:!0});const express=require("express"),path=require("path"),fs=require("fs"),{execFile}=require("child_process"),{ZipArchive}=require("archiver"),router=express.Router(),UPLOADS_DIR=require("../utils/dataPaths").uploads,HOST_MOUNT_PREFIX="/host-fs/";function assertNotHostMounted(t){if(t.replace(/\\/g,"/").startsWith(HOST_MOUNT_PREFIX))throw new Error("Kh\xF4ng \u0111\u01B0\u1EE3c ph\xE9p xo\xE1 file trong th\u01B0 m\u1EE5c/\u1ED5 \u0111\u0129a \u0111\xE3 mount t\u1EEB m\xE1y host.")}y(assertNotHostMounted,"assertNotHostMounted"),router.post("/cleanup",(t,e,r)=>{try{e.json(require("../services/artifacts").cleanup(t.user.id))}catch(s){r(s)}});const WIN32_ONLY_ERROR="Ch\u1EE9c n\u0103ng n\xE0y ch\u1EC9 kh\u1EA3 d\u1EE5ng khi ch\u1EA1y tr\xEAn Windows, kh\xF4ng d\xF9ng \u0111\u01B0\u1EE3c trong container product. Vui l\xF2ng nh\u1EADp \u0111\u01B0\u1EDDng d\u1EABn th\u1EE7 c\xF4ng.",MEDIA_EXTS=[".jpg",".jpeg",".png",".webp",".gif",".bmp",".tiff",".mp4",".mov",".avi",".mkv",".webm",".m4v",".mp3",".wav",".aac",".flac",".m4a",".ogg",".opus",".aiff",".aif",".wma"],JSON_EXTS=[".json"];function matchesExt(t,e){return(e==="media"?MEDIA_EXTS:JSON_EXTS).includes(path.extname(t).toLowerCase())}y(matchesExt,"matchesExt");const DRIVE_LETTERS="DEFGHIJKLMNOPQRSTUVWXYZ".split(""),DRIVE_ROOTS=DRIVE_LETTERS.map(t=>({id:`drive-${t.toLowerCase()}`,label:`\u1ED4 \u0111\u0129a ${t}:`,dir:`/host-fs/drive-${t.toLowerCase()}`,requireEnv:`HOST_DRIVE_${t}`})),ROOT_CONFIG=[{id:"home",label:"Th\u01B0 m\u1EE5c ng\u01B0\u1EDDi d\xF9ng",dir:process.env.HOST_FS_HOME},...DRIVE_ROOTS,{id:"extra1",label:process.env.EXTRA_HOST_DIR_1,dir:"/host-fs/extra1",requireEnv:"EXTRA_HOST_DIR_1"},{id:"extra2",label:process.env.EXTRA_HOST_DIR_2,dir:"/host-fs/extra2",requireEnv:"EXTRA_HOST_DIR_2"},{id:"extra3",label:process.env.EXTRA_HOST_DIR_3,dir:"/host-fs/extra3",requireEnv:"EXTRA_HOST_DIR_3"}];function getBrowsableRoots(){return ROOT_CONFIG.filter(t=>t.dir&&(!t.requireEnv||process.env[t.requireEnv])&&fs.existsSync(t.dir))}y(getBrowsableRoots,"getBrowsableRoots");const SEARCH_MAX_DIRS=15e3,SEARCH_MAX_DEPTH=10,SEARCH_TIME_BUDGET_MS=8e3;function normalizeName(t){return t.normalize("NFC").toLowerCase()}y(normalizeName,"normalizeName");async function searchMountedRoots(t){const e=new Map;for(const c of t){if(!c||!c.name)continue;const l=normalizeName(c.name);e.has(l)||e.set(l,[]),e.get(l).push(c)}if(e.size===0)return[];const r=new Map,s=getBrowsableRoots(),o=Date.now()+SEARCH_TIME_BUDGET_MS;let n=0;for(const c of s){if(r.size>=e.size||n>=SEARCH_MAX_DIRS||Date.now()>o)break;let l;try{l=fs.realpathSync(c.dir)}catch{continue}const p=[{dir:l,depth:0}];for(;p.length&&!(r.size>=e.size||n>=SEARCH_MAX_DIRS||Date.now()>o);){const{dir:f,depth:d}=p.shift();let u;try{u=await fs.promises.readdir(f,{withFileTypes:!0})}catch{continue}n++,n%200===0&&await new Promise(i=>setImmediate(i));for(const i of u){const a=normalizeName(i.name),m=e.get(a),w=path.join(f,i.name);if(m&&!r.has(a))if(i.isDirectory())m.some(h=>h.isDir===!0)&&r.set(a,w);else{let h=m.some(S=>S.size==null);if(!h)try{const S=await fs.promises.stat(w);h=m.some($=>$.size===S.size)}catch{}h&&r.set(a,w)}i.isDirectory()&&d+1<=SEARCH_MAX_DEPTH&&p.push({dir:w,depth:d+1})}}}return[...r.values()]}y(searchMountedRoots,"searchMountedRoots");function resolveWithinRoot(t,e){let r;try{r=fs.realpathSync(t)}catch{return null}const s=path.resolve(r,e||".");if(!fs.existsSync(s))return null;const o=fs.realpathSync(s),n=path.relative(r,o);return n!==""&&(n===".."||n.startsWith(".."+path.sep)||path.isAbsolute(n))?null:o}y(resolveWithinRoot,"resolveWithinRoot"),router.post("/open-folder",(t,e)=>{const{filePath:r}=t.body;if(!r)return e.status(400).json({error:"filePath required"});if(process.platform!=="win32")return e.status(400).json({error:WIN32_ONLY_ERROR});const s=path.resolve(r);if(!fs.existsSync(s))return e.status(404).json({error:"File not found"});const o=fs.statSync(s).isDirectory();execFile("explorer.exe",o?[s]:["/select,",s],{windowsHide:!0},()=>{}),e.json({ok:!0})}),router.post("/browse-folder",(t,e)=>{if(process.platform!=="win32")return e.json({path:null,error:WIN32_ONLY_ERROR});execFile("powershell",["-NoProfile","-STA","-Command",`
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
    Add-Type -AssemblyName System.Windows.Forms
    $owner = New-Object System.Windows.Forms.Form
    $owner.TopMost = $true
    $owner.ShowInTaskbar = $false
    $owner.StartPosition = 'CenterScreen'
    $owner.Size = New-Object System.Drawing.Size(0,0)
    $owner.Show()
    $owner.Activate()
    $f = New-Object System.Windows.Forms.SaveFileDialog
    $f.Title = 'Chon thu muc'
    $f.CheckFileExists = $false
    $f.CheckPathExists = $true
    $f.OverwritePrompt = $false
    $f.ValidateNames = $false
    $f.Filter = 'Thu muc|no.files'
    $f.FileName = 'Chon thu muc nay'
    $result = $f.ShowDialog($owner)
    $owner.Close()
    if ($result -eq 'OK') { Write-Output (Split-Path $f.FileName -Parent) }
  `],{windowsHide:!0},(s,o)=>{e.json({path:(o||"").trim()||null})})}),router.post("/browse-file",(t,e)=>{if(process.platform!=="win32")return e.json({path:null,error:WIN32_ONLY_ERROR});const{filter:r}=t.body||{},o=`
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
    Add-Type -AssemblyName System.Windows.Forms
    $owner = New-Object System.Windows.Forms.Form
    $owner.TopMost = $true
    $owner.ShowInTaskbar = $false
    $owner.StartPosition = 'CenterScreen'
    $owner.Size = New-Object System.Drawing.Size(0,0)
    $owner.Show()
    $owner.Activate()
    $f = New-Object System.Windows.Forms.OpenFileDialog
    $f.Title = 'Chon file'
    $f.Filter = '${r==="media"?`Media Files|${MEDIA_EXTS.map(n=>"*"+n).join(";")}|All files|*.*`:`JSON|${JSON_EXTS.map(n=>"*"+n).join(";")}|All files|*.*`}'
    $f.CheckFileExists = $true
    $result = $f.ShowDialog($owner)
    $owner.Close()
    if ($result -eq 'OK') { Write-Output $f.FileName }
  `;execFile("powershell",["-NoProfile","-STA","-Command",o],{windowsHide:!0},(n,c)=>{e.json({path:(c||"").trim()||null})})}),router.get("/list-dir",(t,e)=>{const r=getBrowsableRoots(),{root:s,dir:o="",filter:n}=t.query;if(!s)return e.json({roots:r.map(({id:i,label:a})=>({id:i,label:a}))});const c=r.find(i=>i.id===s);if(!c)return e.status(400).json({error:"Root kh\xF4ng h\u1EE3p l\u1EC7"});const l=resolveWithinRoot(c.dir,o);if(!l)return e.status(403).json({error:"\u0110\u01B0\u1EDDng d\u1EABn n\u1EB1m ngo\xE0i ph\u1EA1m vi cho ph\xE9p"});let p;try{p=fs.statSync(l)}catch{return e.status(404).json({error:"Kh\xF4ng t\xECm th\u1EA5y"})}if(!p.isDirectory())return e.status(400).json({error:"Kh\xF4ng ph\u1EA3i th\u01B0 m\u1EE5c"});let f;try{f=fs.readdirSync(l,{withFileTypes:!0}).map(i=>{const a=i.isDirectory();let m=null,w=null;try{const h=fs.statSync(path.join(l,i.name));m=h.mtime.toISOString(),w=a?null:h.size}catch{}return{name:i.name,type:a?"dir":"file",dir:o?`${o}/${i.name}`:i.name,matchesFilter:a?!0:matchesExt(i.name,n),mtime:m,size:w}}).sort((i,a)=>i.type===a.type?i.name.localeCompare(a.name):i.type==="dir"?-1:1)}catch{return e.status(403).json({error:"Kh\xF4ng c\xF3 quy\u1EC1n \u0111\u1ECDc th\u01B0 m\u1EE5c n\xE0y"})}const d=o?o.split("/").filter(Boolean):[],u=[{name:c.label,dir:""},...d.map((i,a)=>({name:i,dir:d.slice(0,a+1).join("/")}))];e.json({root:s,dir:o,absPath:l,breadcrumb:u,entries:f})}),router.get("/preview",(t,e)=>{const{path:r}=t.query;if(!r)return e.status(400).json({error:"path required"});const s=path.resolve(r);if(!fs.existsSync(s))return e.status(404).json({error:"File not found"});const o=require("../services/artifacts"),n=path.relative(UPLOADS_DIR,s);if(!n.startsWith("..")&&!path.isAbsolute(n)&&!o.canRead(s,t.user.id))return e.status(403).json({error:"File access denied"});e.sendFile(s)}),router.post("/resolve-drop",async(t,e)=>{const{names:r=[],items:s=[]}=t.body;if(!Array.isArray(r)||r.length===0)return e.json({paths:[]});if(process.platform!=="win32"){if(!Array.isArray(s)||s.length===0)return e.json({paths:[]});try{const n=await searchMountedRoots(s);return e.json({paths:n})}catch{return e.json({paths:[]})}}execFile("powershell",["-NoProfile","-STA","-Command",`
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
    $shell = New-Object -ComObject Shell.Application
    foreach ($w in @($shell.Windows())) {
      try {
        $sel = $w.Document.SelectedItems()
        foreach ($item in @($sel)) { Write-Output $item.Path }
      } catch {}
    }
  `],{windowsHide:!0},(n,c)=>{const l=(c||"").split(/\r?\n/).map(u=>u.trim()).filter(Boolean),p=new Set(r.map(u=>u.toLowerCase())),f=new Set,d=[];for(const u of l){const i=path.basename(u).toLowerCase();p.has(i)&&!f.has(u)&&(f.add(u),d.push(u))}e.json({paths:d})})}),router.post("/download-zip",(t,e)=>{const{files:r}=t.body;if(!Array.isArray(r)||r.length===0)return e.status(400).json({error:"files array required"});if(r.some(o=>typeof o!="string"||!require("../services/artifacts").canRead(o,t.user.id)))return e.status(403).json({error:"File access denied"});e.setHeader("Content-Type","application/zip"),e.setHeader("Content-Disposition",'attachment; filename="space-flow-export.zip"');const s=new ZipArchive({zlib:{level:6}});s.pipe(e);for(const o of r){const n=path.resolve(o);fs.existsSync(n)&&s.file(n,{name:path.basename(n)})}s.finalize()}),module.exports=router;
