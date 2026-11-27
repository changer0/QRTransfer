// Reproducible browser acceptance check. Run npm run build first.
// PLAYWRIGHT_MODULE may point to an existing Playwright installation.
const fs=require('fs'),http=require('http'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const QR=require('qrcode'),{createSender,BLOCK_BYTES}=require('../src/segmented.cjs');
const root=path.resolve(__dirname,'../dist');
const image=f=>QR.toDataURL(f,{errorCorrectionLevel:'M',width:700,margin:4});
async function camera(page,frames){
  const imgs=await Promise.all(frames.map(image));
  await page.evaluate(async imgs=>{
    const c=document.createElement('canvas');c.width=960;c.height=960;
    const ctx=c.getContext('2d');
    const ims=await Promise.all(imgs.map(src=>new Promise((r,j)=>{const im=new Image();im.onload=()=>r(im);im.onerror=j;im.src=src})));
    let i=0;const draw=()=>{ctx.fillStyle='white';ctx.fillRect(0,0,960,960);ctx.drawImage(ims[i++%ims.length],130,130,700,700)};
    draw();setInterval(draw,230);
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>c.captureStream(30),configurable:true});
  },imgs);
}
async function main(){
  const server=http.createServer((req,res)=>{
    const name=new URL(req.url,'http://localhost').pathname.replace(/^\//,'')||'index.html';
    try{const data=fs.readFileSync(path.join(root,name));res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.png')?'image/png':'application/json');res.end(data)}catch{res.writeHead(404);res.end()}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+server.address().port;
  let browser;
  try{
    browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
    const desk=await browser.newContext({viewport:{width:1280,height:900}}),mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    for(const context of [desk,mobile])await context.addInitScript(()=>{
      window.wakeEvents=[];
      Object.defineProperty(navigator,'wakeLock',{configurable:true,value:{request:async()=>{
        window.wakeEvents.push('request');
        const lock=new EventTarget();lock.release=async()=>{window.wakeEvents.push('release');lock.dispatchEvent(new Event('release'))};
        return lock;
      }}});
    });
    const recv=await mobile.newPage(),send=await desk.newPage(),errors=[];
    for(const p of [recv,send])p.on('pageerror',e=>errors.push(e.message));
    await send.goto(origin+'/sender.html');
    assert.equal(await send.locator('#send-tools').isVisible(),false);
    await send.locator('#text').fill('P0 sender test '.repeat(50));await send.locator('#start').click();
    await send.locator('#qr').waitFor({state:'visible'});
    assert.equal(await send.locator('#prepare-panel').isVisible(),false);
    await send.locator('#live-fps').fill('3');assert.equal(await send.locator('#live-fps-value').innerText(),'3 fps');
    await send.locator('#fullscreen').click();assert.ok((await send.locator('#send-stage').getAttribute('class')).includes('fullscreen'));
    await send.locator('#fullscreen').click();assert.ok(!(await send.locator('#send-stage').getAttribute('class')).includes('fullscreen'));
    await send.waitForFunction(()=>document.querySelector('#first-label').textContent.includes('首轮已完成'));
    await send.waitForFunction(()=>window.wakeEvents.includes('request'));
    await send.locator('#pause').click();await send.waitForFunction(()=>window.wakeEvents.includes('release'));
    assert.equal(await send.locator('#pause').innerText(),'继续播放');
    console.log('PASS sender state, live fps, fullscreen, first round, wake lock lifecycle');
    const data=Buffer.concat([Buffer.alloc(BLOCK_BYTES,7),crypto.randomBytes(7000)]);
    const s=await createSender(new Blob([data]),'p0.bin','file',()=>{},{fragment:850,compress:true,roundSignals:true});
    const initial=[],wanted=[2,5,6];
    for(let i=0;i<200;i++){
      const f=await s.next();
      if(f.startsWith('QRT2END:')){initial.push(f);break}
      const m=/^QRT2:[^:]+:(\d+):UR:BYTES\/(?:(\d+)-(\d+)\/)?/.exec(f);
      if(+m[1]!==2||+m[2]<=+m[3]&&!wanted.includes(+m[2]))initial.push(f);
    }
    await recv.goto(origin+'/');await recv.waitForFunction(()=>document.querySelector('#resume-state').textContent.includes('已就绪'));
    const other=await mobile.newPage();await other.goto(origin+'/');
    await other.waitForFunction(()=>document.querySelector('#resume-state').textContent.includes('另一接收页'));
    assert.equal(await other.locator('#scan').isDisabled(),true);await other.close();
    console.log('PASS competing receive tab blocked');
    await camera(recv,initial);await recv.locator('#scan').click();
    await recv.waitForFunction(()=>!document.querySelector('#repair-tip').hidden&&document.querySelector('#receive-round').textContent.includes('首轮'),{},{timeout:25000});
    await recv.locator('#repair-details').click();
    await recv.waitForFunction(()=>document.querySelector('#repair-missing').textContent.includes('仍缺 3 / 9 帧'));
    await recv.locator('#quick-repair').click();await recv.locator('#repair-qr').waitFor({state:'visible'});
    const code=await recv.locator('#repair-code').inputValue();
    assert.equal(code,'QRF1:'+s.session.slice(0,8).toUpperCase()+':2/2,5-6');
    await recv.waitForFunction(()=>document.querySelector('#resume-state').textContent.includes('进度已保存'));
    const pct=await recv.locator('#pct').innerText();
    assert.equal(await recv.locator('#blocks').innerText(),'1 / 2');
    await recv.waitForFunction(()=>window.wakeEvents.includes('release'));
    console.log('PASS round reminder, exact missing frames, quick repair, receiver wake lock');
    await mobile.setOffline(true);await recv.reload();
    await recv.waitForFunction(()=>document.querySelector('#resume-state').textContent.includes('进度已保存'));
    assert.equal(await recv.locator('#pct').innerText(),pct);assert.equal(await recv.locator('#blocks').innerText(),'1 / 2');
    await recv.locator('#quick-repair').click();assert.equal(await recv.locator('#repair-code').inputValue(),code);
    console.log('PASS offline reload preserved completed block, partial frames and exact repair code');
    const repair=await s.createRepair(code);
    await camera(recv,Array.from({length:repair.count},()=>repair.next()));
    await recv.locator('#resume-scan').click();await recv.locator('#result').waitFor({state:'visible',timeout:20000});
    assert.equal(await recv.locator('#digest').textContent(),crypto.createHash('sha256').update(data).digest('hex'));
    assert.equal(await recv.locator('#camera-panel').isVisible(),false);
    await recv.waitForFunction(()=>document.querySelector('#resume-state').textContent.includes('进度已保存'));
    await recv.reload();await recv.locator('#result').waitFor({state:'visible'});
    assert.equal(await recv.locator('#digest').textContent(),crypto.createHash('sha256').update(data).digest('hex'));
    console.log('PASS repaired file SHA-256, completed-task offline reload');
    recv.once('dialog',d=>d.accept());await recv.locator('#reset').click();
    await recv.waitForFunction(()=>document.querySelector('#resume-state').textContent.includes('已就绪'));
    await recv.reload();await recv.waitForFunction(()=>document.querySelector('#resume-state').textContent.includes('已就绪'));
    assert.equal(await recv.locator('#result').isVisible(),false);assert.equal(await recv.locator('#pct').innerText(),'0.0%');
    for(const p of [send,recv])for(const width of [320,390,768,1280]){
      await p.setViewportSize({width,height:844});
      assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow at '+width);
    }
    assert.deepEqual(errors,[]);
    console.log('PASS reset cache, 320/390/768/1280px layout and no browser exceptions');
  }finally{if(browser)await browser.close();server.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
