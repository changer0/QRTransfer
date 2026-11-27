const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),browserify=require('browserify');
const root=path.resolve(__dirname,'..'),out=path.join(root,'dist');
const {css,sender,receiver}=require('./ui.cjs');
function page(mode,body,js,manifest='',worker=''){return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#eef2f5"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' \'self\'; style-src \'unsafe-inline\'; img-src \'self\' data: blob:; media-src \'self\' blob:; connect-src \'self\'; worker-src \'self\'; manifest-src \'self\'; base-uri \'none\'; form-action \'none\'"><title>QRTransfer</title>'+manifest+'<style>'+css+'</style></head><body data-mode="'+mode+'" data-worker="'+worker+'"><main class="shell">'+body+'</main>'+js+'</body></html>'}
const bundle=file=>new Promise((resolve,reject)=>browserify(path.join(root,file)).bundle((err,buf)=>err?reject(err):resolve(buf)));
Promise.all([bundle('src/app.cjs'),bundle('src/scan-worker.cjs')]).then(([buf,worker])=>{
  fs.mkdirSync(out,{recursive:true});
  for(const f of fs.readdirSync(out))if(/^(app|scan)-[a-f0-9]+\.js$/.test(f))fs.unlinkSync(path.join(out,f));
  const ver=crypto.createHash('sha256').update(buf).update(worker).update(css).update(sender).update(receiver).update(fs.readFileSync(__filename)).digest('hex').slice(0,16);
  const appFile='app-'+ver+'.js',workerFile='scan-'+ver+'.js';
  const code=buf.toString().replace(/<\/script/gi,'<\\/script');
  const tag='<script>'+code+'</script>';
  fs.writeFileSync(path.join(out,'sender.html'),page('sender',sender,tag));
  fs.writeFileSync(path.join(out,'index.html'),page('receiver',receiver,'<script src="./'+appFile+'"></script>','<link rel="manifest" href="./manifest.webmanifest"><link rel="apple-touch-icon" href="./icon.png">','./'+workerFile));
  fs.writeFileSync(path.join(out,'app.js'),buf);
  fs.writeFileSync(path.join(out,appFile),buf);
  fs.writeFileSync(path.join(out,workerFile),worker);
  const sw=`const NAME='qrt-${ver}';const FILES=['./','./index.html','./${appFile}','./${workerFile}','./sender.html','./manifest.webmanifest','./icon.png'];self.addEventListener('install',e=>e.waitUntil(caches.open(NAME).then(c=>c.addAll(FILES.map(p=>new Request(new URL(p,self.registration.scope),{cache:'reload'})))).then(()=>self.skipWaiting())));self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('qrt-')&&k!==NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));self.addEventListener('fetch',e=>{const u=new URL(e.request.url),base=new URL(self.registration.scope);if(e.request.method!=='GET'||u.origin!==base.origin||!u.pathname.startsWith(base.pathname))return;const path=u.pathname.slice(base.pathname.length);if(path===''||path==='index.html'||path==='sender.html'){e.respondWith(fetch(e.request,{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error('network');return r}).catch(()=>caches.open(NAME).then(c=>c.match(new URL(path==='sender.html'?'./sender.html':'./index.html',base).href))));return}if(FILES.some(p=>new URL(p,base).href===u.href))e.respondWith(caches.open(NAME).then(c=>c.match(e.request)).then(r=>r||fetch(e.request)))})`;
  fs.writeFileSync(path.join(out,'sw.js'),sw);
  fs.writeFileSync(path.join(out,'manifest.webmanifest'),JSON.stringify({name:'QRTransfer',short_name:'QRTransfer',start_url:'./',scope:'./',display:'standalone',background_color:'#f4f6fa',theme_color:'#f4f6fa',icons:[{src:'./icon.png',sizes:'192x192',type:'image/png'}]}));
  require('qrcode').toFile(path.join(out,'icon.png'),'QRTransfer',{width:192,margin:4},e=>{if(e)throw e});
  fs.writeFileSync(path.join(out,'.nojekyll'),'');
}).catch(e=>{console.error(e);process.exitCode=1});
