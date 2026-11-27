const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),browserify=require('browserify');
const root=path.resolve(__dirname,'..'),out=path.join(root,'dist');
const {css,sender,receiver}=require('./ui.cjs');
function page(mode,body,js,manifest=''){return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#f4f6fa"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' \'self\'; style-src \'unsafe-inline\'; img-src \'self\' data: blob:; media-src \'self\' blob:; connect-src \'self\'; worker-src \'self\'; manifest-src \'self\'; base-uri \'none\'; form-action \'none\'"><title>QRTransfer</title>'+manifest+'<style>'+css+'</style></head><body data-mode="'+mode+'"><main>'+body+'</main>'+js+'</body></html>'}
browserify(path.join(root,'src/app.cjs')).bundle((err,buf)=>{
  if(err)throw err;
  fs.mkdirSync(out,{recursive:true});
  const code=buf.toString().replace(/<\/script/gi,'<\\/script');
  const tag='<script>'+code+'</script>';
  fs.writeFileSync(path.join(out,'sender.html'),page('sender',sender,tag));
  fs.writeFileSync(path.join(out,'index.html'),page('receiver',receiver,'<script src="./app.js"></script>','<link rel="manifest" href="./manifest.webmanifest"><link rel="apple-touch-icon" href="./icon.png">'));
  fs.writeFileSync(path.join(out,'app.js'),buf);
  const ver=crypto.createHash('sha256').update(buf).update(css).update(sender).update(receiver).digest('hex').slice(0,16);
  const sw=`const NAME='qrt-${ver}';const FILES=['./','./index.html','./app.js','./sender.html','./manifest.webmanifest','./icon.png'];self.addEventListener('install',e=>e.waitUntil(caches.open(NAME).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())));self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('qrt-')&&k!==NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin||!FILES.some(p=>new URL(p,self.registration.scope).href===u.href))return;e.respondWith(caches.open(NAME).then(c=>c.match(e.request)).then(r=>r||fetch(e.request)))})`;
  fs.writeFileSync(path.join(out,'sw.js'),sw);
  fs.writeFileSync(path.join(out,'manifest.webmanifest'),JSON.stringify({name:'QRTransfer',short_name:'QRTransfer',start_url:'./',scope:'./',display:'standalone',background_color:'#f4f6fa',theme_color:'#f4f6fa',icons:[{src:'./icon.png',sizes:'192x192',type:'image/png'}]}));
  require('qrcode').toFile(path.join(out,'icon.png'),'QRTransfer',{width:192,margin:4},e=>{if(e)throw e});
  fs.writeFileSync(path.join(out,'.nojekyll'),'');
});
