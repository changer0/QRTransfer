const QR = require('qrcode');
const jsQR = require('jsqr');
const {createSender,SegmentReceiver,RateMeter,PROFILES}=require('./segmented.cjs');
const {ResumeStore}=require('./resume.cjs');
const {createWakeLock}=require('./wake.cjs');
const $=id=>document.getElementById(id);
const status=t=>{$('status').textContent=t};
const human=(n,rate=false)=>{
  if(n==null)return '—';
  const units=['B','KiB','MiB','GiB','TiB','PiB'];let i=0;
  while(n>=1024&&i<units.length-1){n/=1024;i++}
  return (i||rate?n.toFixed(1):Math.round(n))+' '+units[i]+(rate?'/s':'');
};
const mode=document.body.dataset.mode;
const wake=createWakeLock(active=>{$('wake-state').textContent=active?'屏幕常亮':'常亮未启用'});
function remember(key,value){try{localStorage.setItem('qrt-'+key,value)}catch{}}
function recall(key){try{return localStorage.getItem('qrt-'+key)}catch{return null}}
if(mode==='sender'){
  let enc=null,repair=null,timer=null,frame=0,busy=false,generation=0,profile=PROFILES.balanced,startedAt=0,repairCamera=null,repairRAF=0,fps=12;
  const temp=document.createElement('canvas');
  const stop=()=>{generation++;clearTimeout(timer);timer=null;$('pause').textContent='继续播放';wake.set(false)};
  function setFPS(value){
    fps=Math.max(1,Math.min(24,Math.round(Number(value)||12)));
    $('live-fps').value=fps;$('live-fps-value').textContent=fps+' fps';
    $('live-fps').setAttribute('aria-valuetext',fps+' 帧每秒');
  }
  function setFullscreen(active){
    $('send-stage').classList.toggle('fullscreen',active);
    document.body.classList.toggle('qr-fullscreen',active);
    $('fullscreen').textContent=active?'退出全屏':'全屏';
    $('fullscreen').setAttribute('aria-pressed',String(active));
    if(!active&&document.fullscreenElement&&document.exitFullscreen)document.exitFullscreen().catch(()=>{});
  }
  $('fullscreen').onclick=()=>{
    const active=!$('send-stage').classList.contains('fullscreen');
    setFullscreen(active);
    if(active&&$('send-stage').requestFullscreen)$('send-stage').requestFullscreen().catch(()=>{});
  };
  document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)setFullscreen(false)});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')setFullscreen(false)});
  const oldSpeed=recall('profile');if(oldSpeed&&PROFILES[oldSpeed])$('speed').value=oldSpeed;
  if(recall('compress')!==null)$('compress').checked=recall('compress')==='true';
  $('speed').onchange=()=>{remember('profile',$('speed').value);if(!enc)setFPS(PROFILES[$('speed').value].fps)};
  $('compress').onchange=()=>remember('compress',String($('compress').checked));
  $('live-fps').oninput=()=>setFPS($('live-fps').value);
  setFPS(PROFILES[$('speed').value].fps);
  async function tick(g){
    if(g!==generation||!enc)return;
    if(busy){timer=setTimeout(()=>tick(g),30);return}
    busy=true;
    const begin=performance.now();
    try{
      const active=repair||enc;
      const text=await active.next();
      if(g!==generation||active!==(repair||enc))return;
      await QR.toCanvas(temp,[{data:text,mode:'alphanumeric'}],{errorCorrectionLevel:'M',scale:5,margin:4});
      if(g!==generation)return;
      const c=$('qr');c.width=temp.width;c.height=temp.height;c.getContext('2d').drawImage(temp,0,0);
      $('frame').textContent=(++frame)+' 帧';
      $('actual-fps').textContent=(frame/Math.max(1,(performance.now()-startedAt)/1000)).toFixed(1)+' fps';
      $('block').textContent=repair?'补帧 '+((repair.position+repair.count-1)%repair.count+1)+'/'+repair.count:'第 '+active.cycle+' 轮';
      const first=enc.firstProgress;
      $('first-progress').value=first*100;
      $('first-label').textContent=first===1?'首轮已完成 · 循环补偿中':'首轮播放 '+Math.floor(first*100)+'%';
      $('qr-empty').hidden=true;$('qr').hidden=false;
    }catch(e){stop();status(e.message)}
    finally{busy=false;if(g===generation)timer=setTimeout(()=>tick(g),Math.max(0,1000/(repair?Math.min(fps,6):fps)-(performance.now()-begin)))}
  }
  function play(){if(!enc)return;stop();wake.set(true);startedAt=performance.now();frame=0;$('pause').textContent='暂停播放';const g=generation;timer=setTimeout(()=>tick(g),0)}
  $('start').onclick=async()=>{
    stopRepairCamera();stop();enc=null;repair=null;frame=0;$('pause').disabled=true;repairUI();
    const g=generation;
    try{
      const isFile=$('tab-file').getAttribute('aria-selected')==='true';
      const f=isFile?$('file').files[0]:null,text=isFile?'':$('text').value;
      if(!f&&!text)throw Error('请输入文本或选择文件');
      const data=f||new Blob([text],{type:'text/plain'});
      profile=PROFILES[$('speed').value]||PROFILES.balanced;
      setFPS(profile.fps);
      $('start').disabled=true;status('正在计算文件 SHA-256…');
      const prepared=await createSender(data,f?f.name:'text.txt',f?'file':'text',(done,total)=>{
        if(g===generation)status('计算 SHA-256 · '+Math.floor(done/total*100)+'%');
      },{fragment:profile.fragment,compress:$('compress').checked,roundSignals:true});
      if(g!==generation)return;
      enc=prepared;
      repairUI();
      $('source-size').textContent=human(data.size);
      status('正在播放，请用手机扫描');
      $('pause').disabled=false;play();
    }catch(e){if(g===generation)status(e.message)}
    finally{$('start').disabled=false}
  };
  $('pause').onclick=()=>{if(timer!==null){stop();status('已暂停，可继续播放')}else{play();status(repair?'正在定向补帧':'正在播放，请扫描')}};
  function repairUI(){
    $('repair-input').disabled=!enc;$('repair-start').disabled=!enc;
    $('repair-scan').disabled=!enc;$('repair-normal').hidden=!repair;
    $('repair-session').textContent=enc?'会话 '+enc.session.slice(0,8).toUpperCase():'请先生成原始文件的二维码';
    $('prepare-panel').hidden=!!enc;
    $('send-layout').classList.toggle('sending',!!enc);
    $('send-tools').hidden=!enc;$('send-progress').hidden=!enc;
    $('send-repair-panel').hidden=!enc;
    $('new-send').hidden=!enc;
  }
  async function startRepair(){
    if(!enc)return;
    stopRepairCamera();
    const active=enc,request=$('repair-input').value;
    $('repair-start').disabled=true;$('repair-message').textContent='正在准备缺失数据…';
    try{
      const next=await active.createRepair(request);
      if(enc!==active)return;
      stop();repair=next;repairUI();
      $('repair-message').textContent='只循环补发 '+repair.count+' 帧 · '+repair.blocks+' 个数据块 · 最高 6 fps';
      status('正在定向补帧，保持手机扫描');play();
    }catch(e){$('repair-message').textContent=e.message}
    finally{$('repair-start').disabled=!enc}
  }
  function stopRepairCamera(){
    cancelAnimationFrame(repairRAF);
    if(repairCamera){repairCamera.getTracks().forEach(t=>t.stop());repairCamera=null}
    $('repair-video').srcObject=null;$('repair-camera').hidden=true;
  }
  $('repair-start').onclick=startRepair;
  $('quick-send-repair').onclick=()=>{setFullscreen(false);$('send-repair-panel').scrollIntoView({behavior:'smooth',block:'start'});$('repair-input').focus({preventScroll:true})};
  $('repair-normal').onclick=()=>{stop();repair=null;repairUI();$('repair-message').textContent='已返回正常循环播放';status('正在播放，请扫描');play()};
  $('repair-camera-close').onclick=stopRepairCamera;
  $('repair-scan').onclick=async()=>{
    if(!enc||repairCamera)return;
    const active=enc;
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw Error('当前环境无法使用相机，请手动输入补帧码');
      const stream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});
      if(enc!==active){stream.getTracks().forEach(t=>t.stop());return}
      repairCamera=stream;
      const video=$('repair-video'),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
      $('repair-camera').hidden=false;video.srcObject=stream;await video.play();
      let last=0;
      function scan(t){
        if(repairCamera!==stream)return;
        if(t-last>=100&&video.readyState>=2&&video.videoWidth){
          last=t;const scale=Math.min(1,960/video.videoWidth);
          canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
          ctx.drawImage(video,0,0,canvas.width,canvas.height);
          const image=ctx.getImageData(0,0,canvas.width,canvas.height);
          const code=jsQR(image.data,canvas.width,canvas.height,{inversionAttempts:'dontInvert'});
          if(code&&/^QRF1:/i.test(code.data)){
            $('repair-input').value=code.data;stopRepairCamera();startRepair();return;
          }
        }
        repairRAF=requestAnimationFrame(scan);
      }
      repairRAF=requestAnimationFrame(scan);
    }catch(e){stopRepairCamera();$('repair-message').textContent='无法扫描补帧码：'+e.message+'；可手动输入'}
  };
  window.addEventListener('pagehide',stopRepairCamera);
  function selectMode(mode){
    const file=mode==='file';
    $('file-panel').hidden=!file;$('text-panel').hidden=file;
    $('tab-file').setAttribute('aria-selected',String(file));$('tab-text').setAttribute('aria-selected',String(!file));
    if(!file){$('file').value='';$('file-name').textContent='点击选择文件'}
  }
  $('tab-file').onclick=()=>selectMode('file');$('tab-text').onclick=()=>selectMode('text');
  $('file').onchange=()=>{const f=$('file').files[0];$('file-name').textContent=f?f.name+' · '+human(f.size):'点击选择文件'};
  $('clear').onclick=()=>{stopRepairCamera();stop();setFullscreen(false);enc=null;repair=null;repairUI();$('repair-input').value='';$('repair-message').textContent='';$('file').value='';$('text').value='';$('file-name').textContent='点击选择文件';$('pause').disabled=true;$('qr').hidden=true;$('qr-empty').hidden=false;$('frame').textContent='0 帧';$('block').textContent='—';$('source-size').textContent='—';$('actual-fps').textContent='—';$('first-progress').value=0;status('等待发送')};
  $('new-send').onclick=()=>{if(confirm('结束当前发送任务并选择新文件？'))$('clear').click()};
  window.addEventListener('pagehide',()=>{stop();setFullscreen(false)});
  repairUI();
}else{
  const r=new SegmentReceiver(),meter=new RateMeter();let stream=null,raf=0,run=0,objectURL=null,rateTimer=null,worker=null,detector=null,decodeBusy=false,attempt=0,videoTime=-1,lastDecode=0;
  let store=null,storageFailed=false,restoring=true,resetting=false,writePending=0,lastProgressAt=0,previousBytes=0,started=false,repairOpened=false,otherTab=false,releaseResumeLock=null;
  const video=$('video'),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
  let selectedBlock=1,blockPage=0,manualBlock=false,lastRepairRender=0;
  const PAGE=48;
  function storageStatus(){
    $('resume-state').textContent=restoring?'正在恢复本地任务…':otherTab?'另一接收页正在运行，请关闭后刷新本页':r.legacy?.session?'旧协议仅支持本次页面接收':storageFailed?'本地缓存不可用 · 请勿关闭页面':writePending?'正在保存进度…':store?(r.session?'进度已保存到本机':'本地自动保存已就绪'):'仅本次页面有效';
  }
  function persist(value){
    if(!store||storageFailed)return;
    writePending++;storageStatus();
    store.save(value,r).catch(()=>{storageFailed=true}).finally(()=>{writePending--;storageStatus()});
  }
  function receiveUI(){
    const hasTask=!!(r.meta||r.legacy?.session),done=!!r.result;
    $('scan').hidden=!!stream||done;$('stop').hidden=!stream||done;
    $('scan').textContent=hasTask?'继续扫描':'开始扫描';
    $('reset').hidden=!hasTask&&!r.error;
    $('reset').textContent=done?'接收新文件':'重置任务';
    $('camera-panel').hidden=done;
    $('receiver-layout').classList.toggle('received',done);
    $('quick-repair').hidden=!r.meta||done||!!r.error;
    $('repair-details').hidden=!r.meta||done||!!r.error;
    $('repair-panel').hidden=!repairOpened||!r.meta||!r.totalBlocks||done;
    $('repair-tip').hidden=done||!!r.error||!r.meta||(!r.round&&(!stream||!lastProgressAt||performance.now()-lastProgressAt<8000));
    if(!$('repair-tip').hidden)$('repair-tip').textContent=r.round?'首轮已完成，仍有缺失数据；可以快速补帧。':'接收进度停滞超过 8 秒，可尝试快速补帧。';
    $('receive-round').textContent=r.round?'首轮已完成':hasTask?'正在恢复数据':'等待文件';
    storageStatus();
  }
  function repairCell(label,state,button=false){
    const el=document.createElement(button?'button':'span');el.className='repair-cell '+state;el.textContent=label;
    if(button)el.type='button';
    return el;
  }
  function renderRepair(force=false){
    $('repair-panel').hidden=!repairOpened||!r.meta||!r.totalBlocks||!!r.result;
    if(!r.meta||!r.totalBlocks||!repairOpened||r.result)return;
    if(!force&&performance.now()-lastRepairRender<150)return;
    lastRepairRender=performance.now();
    if(!manualBlock&&r.lastBlock){selectedBlock=r.lastBlock;blockPage=Math.floor((selectedBlock-1)/PAGE)}
    const pages=Math.ceil(r.totalBlocks/PAGE),first=blockPage*PAGE+1,end=Math.min(r.totalBlocks,first+PAGE-1);
    $('repair-summary').textContent=r.completedBlocks+' / '+r.totalBlocks+' 块已完成 · '+(r.totalBlocks-r.completedBlocks)+' 块待完成';
    $('repair-page').textContent=(blockPage+1)+' / '+pages;
    $('repair-prev').disabled=blockPage===0;$('repair-next').disabled=blockPage+1>=pages;
    $('repair-build').disabled=!!r.result||!!r.error;
    const grid=$('repair-block-grid');grid.replaceChildren();
    for(let i=first;i<=end;i++){
      const state=r.blockStatus(i).state,cell=repairCell(i,state,true);
      cell.setAttribute('aria-label','数据块 '+i+' '+({complete:'已完成',partial:'未完整',unseen:'尚未识别'}[state]||state));
      cell.setAttribute('aria-pressed',String(i===selectedBlock));
      cell.onclick=()=>{selectedBlock=i;manualBlock=true;renderRepair(true)};
      grid.appendChild(cell);
    }
    const detail=r.blockStatus(selectedBlock),frames=$('repair-frame-grid');
    $('repair-detail').textContent='数据块 '+selectedBlock;
    frames.replaceChildren();
    if(detail.state==='complete')$('repair-missing').textContent='已完整恢复，无需补帧';
    else if(detail.state==='unseen')$('repair-missing').textContent='尚未识别该块，具体帧数未知；可以补发整个块';
    else if(detail.state==='partial'){
      $('repair-missing').textContent='仍缺 '+detail.missing.length+' / '+detail.count+' 帧：'+(detail.missing.join('、')||'无');
      detail.frames.forEach((state,i)=>{const cell=repairCell(i+1,state);cell.title='第 '+(i+1)+' 帧 · '+({direct:'直接接收',recovered:'冗余恢复',missing:'待接收'}[state]);frames.appendChild(cell)});
    }
    $('repair-one').disabled=!!r.error||!!r.result||detail.state==='complete';
    if(r.result||r.error){$('repair-code-box').hidden=true;$('repair-code').value=''}
  }
  $('repair-prev').onclick=()=>{if(blockPage>0){manualBlock=true;selectedBlock=--blockPage*PAGE+1;renderRepair(true)}};
  $('repair-next').onclick=()=>{if((blockPage+1)*PAGE<r.totalBlocks){manualBlock=true;selectedBlock=++blockPage*PAGE+1;renderRepair(true)}};
  $('repair-follow').onclick=()=>{manualBlock=false;renderRepair(true)};
  async function showRepair(only){
    const plan=r.repairPlan(only);
    if(!plan){$('repair-code-box').hidden=true;return}
    stop();status('已暂停扫描，发送端开始补帧后继续扫描');repairOpened=true;receiveUI();renderRepair(true);
    $('repair-code').value=plan.code;$('repair-code-box').hidden=false;
    $('repair-code-info').textContent='本批 '+plan.entries.length+' 个数据块；补发后如仍有缺失，可重新生成。';
    $('repair-qr').hidden=true;
    try{
      const c=document.createElement('canvas');
      await QR.toCanvas(c,plan.code,{errorCorrectionLevel:'M',scale:5,margin:4});
      if($('repair-code').value!==plan.code||$('repair-code-box').hidden)return;
      const out=$('repair-qr');out.width=c.width;out.height=c.height;out.getContext('2d').drawImage(c,0,0);out.hidden=false;
    }catch{$('repair-code-info').textContent+=' 清单较长，请复制或手动输入补帧码。'}
    $('repair-code-box').scrollIntoView({behavior:'smooth',block:'start'});
  }
  $('repair-build').onclick=()=>showRepair();
  $('repair-one').onclick=()=>showRepair(selectedBlock);
  $('quick-repair').onclick=()=>showRepair();
  $('repair-details').onclick=()=>{repairOpened=!repairOpened;receiveUI();renderRepair(true);if(repairOpened)$('repair-panel').scrollIntoView({behavior:'smooth',block:'start'})};
  $('resume-scan').onclick=()=>{$('repair-code-box').hidden=true;$('scan').click();$('camera-panel').scrollIntoView({behavior:'smooth',block:'start'})};
  $('repair-copy').onclick=async()=>{
    try{await navigator.clipboard.writeText($('repair-code').value);$('repair-code-info').textContent='已复制补帧码；请在发送端输入或扫码。'}
    catch{$('repair-code').focus();$('repair-code').select()}
  };
  function stop(){run++;if(video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(raf);else cancelAnimationFrame(raf);clearInterval(rateTimer);rateTimer=null;if(worker){worker.terminate();worker=null}decodeBusy=false;detector=null;if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}video.srcObject=null;$('scan').disabled=restoring||resetting;$('stop').disabled=true;$('camera').classList.remove('active');meter.reset();$('rate').textContent=human(0,true);wake.set(false);receiveUI()}
  function updateRate(){
    $('rate').textContent=human(meter.sample(r.recoveredBytes),true);
    renderRepair();
    receiveUI();
  }
  function render(){
    const pct=r.result?100:Math.min(99.9,Math.floor(r.progress()*1000)/10);
    $('progress').value=pct;$('pct').textContent=pct.toFixed(1)+'%';
    $('frames').textContent=r.frames.toLocaleString();
    $('received').textContent=human(r.recoveredBytes)+' / '+human(r.totalBytes);
    $('blocks').textContent=r.totalBlocks==null?'—':r.completedBlocks+' / '+r.totalBlocks;
    $('incoming').textContent=r.meta?.name||r.result?.name||'等待文件信息';
    renderRepair();
    receiveUI();
  }
  function finish(){
    stop();render();renderRepair(true);$('pct').textContent='100% · SHA-256 校验通过';
    const f=r.result;status('接收成功：'+f.name+' · '+f.size+' 字节');
    $('digest').textContent=f.sha256;
    if(objectURL)URL.revokeObjectURL(objectURL);
    const blob=new Blob(f.parts,{type:'application/octet-stream'});
    objectURL=URL.createObjectURL(blob);
    $('save').href=objectURL;$('save').download=f.name;$('result').hidden=false;
    if(f.kind==='text'&&f.size<=1024*1024){const url=objectURL;blob.text().then(text=>{if(objectURL===url){$('preview').hidden=false;$('preview').value=text;$('copy').hidden=false}}).catch(()=>{})}
  }
  function receive(value){
    const res=r.receive(value);
    if(res==='ignored'||res==='invalid'||res==='finished')return;
    if(['accepted','complete','round'].includes(res))persist(value);
    if(r.recoveredBytes>previousBytes||!lastProgressAt){previousBytes=r.recoveredBytes;lastProgressAt=performance.now()}
    render();
    if(res==='complete')finish();
    else if(res==='error'){stop();renderRepair(true);status('校验失败：'+r.error+'。请重置后重试')}
    else if(res==='other')status('检测到其他会话，已忽略；如需切换请重置');
    else if(res==='accepted')status('正在接收，漏帧会由后续二维码补偿');
    else if(res==='round')status('首轮已完成，可快速补帧');
  }
  function deliver(value,g){if(g!==run)return;if(value){try{receive(value)}catch(e){stop();status('接收中断：'+e.message)}}}
  function softwareDecode(g){
    const vw=video.videoWidth,vh=video.videoHeight;
    const full=++attempt%4===0,side=Math.min(vw,vh);
    const sw=full?vw:side,sh=full?vh:side,sx=(vw-sw)/2,sy=(vh-sh)/2;
    const scale=Math.min(1,1280/Math.max(sw,sh));
    const width=Math.round(sw*scale),height=Math.round(sh*scale);
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height}
    ctx.drawImage(video,sx,sy,sw,sh,0,0,width,height);
    const im=ctx.getImageData(0,0,width,height);
    if(worker){worker.postMessage({pixels:im.data.buffer,width,height},[im.data.buffer]);return}
    const code=jsQR(im.data,width,height,{inversionAttempts:'dontInvert'});
    decodeBusy=false;deliver(code?code.data:null,g);
  }
  function queue(g){if(g!==run)return;raf=video.requestVideoFrameCallback?video.requestVideoFrameCallback(t=>scan(t,g)):requestAnimationFrame(t=>scan(t,g))}
  function scan(t,g){
    if(g!==run)return;
    if(!decodeBusy&&t-lastDecode>=28&&video.readyState>=2&&video.videoWidth&&video.currentTime!==videoTime){
      lastDecode=t;videoTime=video.currentTime;decodeBusy=true;
      if(detector){
        detector.detect(video).then(codes=>{
          if(g!==run)return;
          const code=codes.find(c=>/^QRT(?:[12]|2END):/i.test(c.rawValue));
          if(code){decodeBusy=false;deliver(code.rawValue,g)}
          else softwareDecode(g);
        }).catch(()=>{if(g===run){detector=null;softwareDecode(g)}});
      }else softwareDecode(g);
    }
    queue(g);
  }
  $('scan').onclick=async()=>{
    if(restoring||resetting||otherTab)return;
    if(r.result||r.error){status('请先重置再开始新任务');return}
    stop();const g=run;$('scan').disabled=true;$('repair-code-box').hidden=true;
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw Error('请使用 HTTPS 页面并允许摄像头');
      const s=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30,max:60}},audio:false});
      if(g!==run){s.getTracks().forEach(t=>t.stop());return}
      stream=s;video.srcObject=s;await video.play();if(g!==run)return;
      attempt=0;videoTime=-1;lastDecode=0;
      if(typeof Worker!=='undefined'&&document.body.dataset.worker){
        try{worker=new Worker(document.body.dataset.worker);worker.onmessage=e=>{if(g===run){decodeBusy=false;deliver(e.data,g)}};worker.onerror=()=>{if(g===run){worker.terminate();worker=null;decodeBusy=false}}}catch{worker=null}
      }
      if(typeof BarcodeDetector!=='undefined'){
        try{const formats=await BarcodeDetector.getSupportedFormats();if(g===run&&formats.includes('qr_code'))detector=new BarcodeDetector({formats:['qr_code']})}catch{}
      }
      if(g!==run)return;
      $('stop').disabled=false;$('camera').classList.add('active');status('正在扫描');
      started=true;lastProgressAt=performance.now();previousBytes=r.recoveredBytes;wake.set(true);receiveUI();
      meter.reset();updateRate();rateTimer=setInterval(updateRate,500);
      queue(g);
    }catch(e){if(g===run){stop();status('摄像头启动失败：'+e.message)}}
  };
  $('stop').onclick=()=>{stop();renderRepair(true);status('已暂停，已接收分片保留在当前页面')};
  $('reset').onclick=async()=>{
    if(resetting||restoring)return;
    if((r.session||r.legacy?.session)&&!confirm('清除当前任务及本地缓存，开始新任务？'))return;
    resetting=true;stop();$('reset').disabled=true;
    try{
      if(store)await store.clear();
      storageFailed=!store;
      r.reset();selectedBlock=1;blockPage=0;manualBlock=false;lastRepairRender=0;repairOpened=false;lastProgressAt=0;previousBytes=0;started=false;
      $('repair-code-box').hidden=true;$('repair-code').value='';
      if(objectURL)URL.revokeObjectURL(objectURL);objectURL=null;$('save').removeAttribute('href');$('result').hidden=true;$('preview').hidden=true;$('preview').value='';$('copy').hidden=true;$('digest').textContent='';status('等待扫描');
    }catch(e){storageFailed=true;status('无法清除本地缓存：'+e.message)}
    finally{resetting=false;$('reset').disabled=false;$('scan').disabled=false;render()}
  };
  $('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('preview').value);status('已复制')}catch{status('无法自动复制，请手动选中文本')}};
  window.addEventListener('pagehide',()=>{stop();if(releaseResumeLock){releaseResumeLock();releaseResumeLock=null}});
  window.addEventListener('pageshow',e=>{if(e.persisted)location.reload()});
  function lockResume(){
    if(!navigator.locks)return Promise.resolve(true);
    return new Promise(resolve=>{
      navigator.locks.request('qrt-receive-active',{ifAvailable:true},lock=>{
        if(!lock){resolve(false);return}
        return new Promise(release=>{releaseResumeLock=release;resolve(true)});
      }).catch(()=>resolve(false));
    });
  }
  async function restoreTask(){
    $('scan').disabled=true;storageStatus();
    try{
      if(!await lockResume()){
        otherTab=true;status('请关闭其他接收页面后刷新');return;
      }
      store=await ResumeStore.open();
      const count=await store.restore(r);
      if(r.result)finish();
      else if(count&&r.session){previousBytes=r.recoveredBytes;status('已恢复上次任务，点击继续扫描');render()}
    }catch(e){
      storageFailed=true;
      if(store){r.fail(Error('本地恢复失败，请重置任务'));status('本地恢复失败：'+e.message)}
      else status('本地缓存不可用，本次可继续扫码');
    }finally{restoring=false;$('scan').disabled=!!r.error||otherTab;render()}
    if(!r.result&&!r.error&&navigator.permissions){
      try{const permission=await navigator.permissions.query({name:'camera'});if(permission.state==='granted'&&!started&&!stream&&!restoring)$('scan').click()}catch{}
    }
  }
  restoreTask();
  if('serviceWorker' in navigator){
    const wasControlled=!!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange',()=>{if(wasControlled)$('update').hidden=false});
    $('update').onclick=()=>{if(!writePending&&(!r.session||!storageFailed||confirm('本地缓存未就绪，更新可能清空进度，继续？'))){stop();location.reload()}else if(writePending)status('正在保存进度，请稍后再更新')};
    navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(reg=>{reg.update().catch(()=>{});return navigator.serviceWorker.ready}).then(()=>{$('offline').textContent='离线可用'}).catch(e=>{$('offline').textContent='离线缓存未就绪'});
  }else $('offline').textContent='浏览器不支持离线缓存';
}
