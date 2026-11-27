const QR = require('qrcode');
const jsQR = require('jsqr');
const {createSender,SegmentReceiver,RateMeter,PROFILES}=require('./segmented.cjs');
const $=id=>document.getElementById(id);
const status=t=>{$('status').textContent=t};
const human=(n,rate=false)=>{
  if(n==null)return '—';
  const units=['B','KiB','MiB','GiB','TiB','PiB'];let i=0;
  while(n>=1024&&i<units.length-1){n/=1024;i++}
  return (i||rate?n.toFixed(1):Math.round(n))+' '+units[i]+(rate?'/s':'');
};
const mode=document.body.dataset.mode;
if(mode==='sender'){
  let enc=null,repair=null,timer=null,frame=0,busy=false,generation=0,profile=PROFILES.balanced,startedAt=0,repairCamera=null,repairRAF=0;
  const temp=document.createElement('canvas');
  const stop=()=>{generation++;clearTimeout(timer);timer=null;$('pause').textContent='继续播放'};
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
      $('qr-empty').hidden=true;$('qr').hidden=false;
    }catch(e){stop();status(e.message)}
    finally{busy=false;if(g===generation)timer=setTimeout(()=>tick(g),Math.max(0,1000/(repair?Math.min(profile.fps,6):profile.fps)-(performance.now()-begin)))}
  }
  function play(){if(!enc)return;stop();startedAt=performance.now();frame=0;$('pause').textContent='暂停播放';const g=generation;timer=setTimeout(()=>tick(g),0)}
  $('start').onclick=async()=>{
    stopRepairCamera();stop();enc=null;repair=null;frame=0;$('pause').disabled=true;repairUI();
    const g=generation;
    try{
      const isFile=$('tab-file').getAttribute('aria-selected')==='true';
      const f=isFile?$('file').files[0]:null,text=isFile?'':$('text').value;
      if(!f&&!text)throw Error('请输入文本或选择文件');
      const data=f||new Blob([text],{type:'text/plain'});
      profile=PROFILES[$('speed').value]||PROFILES.balanced;
      $('start').disabled=true;status('正在计算文件 SHA-256…');
      const prepared=await createSender(data,f?f.name:'text.txt',f?'file':'text',(done,total)=>{
        if(g===generation)status('计算 SHA-256 · '+Math.floor(done/total*100)+'%');
      },{fragment:profile.fragment,compress:$('compress').checked});
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
  $('clear').onclick=()=>{stopRepairCamera();stop();enc=null;repair=null;repairUI();$('repair-input').value='';$('repair-message').textContent='';$('file').value='';$('text').value='';$('file-name').textContent='点击选择文件';$('pause').disabled=true;$('qr').hidden=true;$('qr-empty').hidden=false;$('frame').textContent='0 帧';$('block').textContent='—';$('source-size').textContent='—';$('actual-fps').textContent='—';status('等待发送')};
  repairUI();
}else{
  const r=new SegmentReceiver(),meter=new RateMeter();let stream=null,raf=0,run=0,objectURL=null,rateTimer=null,worker=null,detector=null,decodeBusy=false,attempt=0,videoTime=-1,lastDecode=0;
  const video=$('video'),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
  let selectedBlock=1,blockPage=0,manualBlock=false,lastRepairRender=0;
  const PAGE=48;
  function repairCell(label,state,button=false){
    const el=document.createElement(button?'button':'span');el.className='repair-cell '+state;el.textContent=label;
    if(button)el.type='button';
    return el;
  }
  function renderRepair(force=false){
    $('repair-panel').hidden=!r.meta||!r.totalBlocks;
    if(!r.meta||!r.totalBlocks)return;
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
    $('repair-code').value=plan.code;$('repair-code-box').hidden=false;
    $('repair-code-info').textContent='本批 '+plan.entries.length+' 个数据块；补发后如仍有缺失，可重新生成。';
    $('repair-qr').hidden=true;
    try{
      const c=document.createElement('canvas');
      await QR.toCanvas(c,plan.code,{errorCorrectionLevel:'M',scale:5,margin:4});
      if($('repair-code').value!==plan.code||$('repair-code-box').hidden)return;
      const out=$('repair-qr');out.width=c.width;out.height=c.height;out.getContext('2d').drawImage(c,0,0);out.hidden=false;
    }catch{$('repair-code-info').textContent+=' 清单较长，请复制或手动输入补帧码。'}
  }
  $('repair-build').onclick=()=>showRepair();
  $('repair-one').onclick=()=>showRepair(selectedBlock);
  $('repair-copy').onclick=async()=>{
    try{await navigator.clipboard.writeText($('repair-code').value);$('repair-code-info').textContent='已复制补帧码；请在发送端输入或扫码。'}
    catch{$('repair-code').focus();$('repair-code').select()}
  };
  function stop(){run++;if(video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(raf);else cancelAnimationFrame(raf);clearInterval(rateTimer);rateTimer=null;if(worker){worker.terminate();worker=null}decodeBusy=false;detector=null;if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}video.srcObject=null;$('scan').disabled=false;$('stop').disabled=true;$('camera').classList.remove('active');meter.reset();$('rate').textContent=human(0,true)}
  function updateRate(){
    $('rate').textContent=human(meter.sample(r.recoveredBytes),true);
    renderRepair();
  }
  function render(){
    const pct=r.result?100:Math.min(99.9,Math.floor(r.progress()*1000)/10);
    $('progress').value=pct;$('pct').textContent=pct.toFixed(1)+'%';
    $('frames').textContent=r.frames.toLocaleString();
    $('received').textContent=human(r.recoveredBytes)+' / '+human(r.totalBytes);
    $('blocks').textContent=r.totalBlocks==null?'—':r.completedBlocks+' / '+r.totalBlocks;
    $('incoming').textContent=r.meta?.name||r.result?.name||'等待文件信息';
    renderRepair();
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
    render();
    if(res==='complete')finish();
    else if(res==='error'){stop();renderRepair(true);status('校验失败：'+r.error+'。请重置后重试')}
    else if(res==='other')status('检测到其他会话，已忽略；如需切换请重置');
    else if(res==='accepted')status('正在接收，漏帧会由后续二维码补偿');
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
          const code=codes.find(c=>/^QRT[12]:/i.test(c.rawValue));
          if(code){decodeBusy=false;deliver(code.rawValue,g)}
          else softwareDecode(g);
        }).catch(()=>{if(g===run){detector=null;softwareDecode(g)}});
      }else softwareDecode(g);
    }
    queue(g);
  }
  $('scan').onclick=async()=>{
    if(r.result||r.error){status('请先重置再开始新任务');return}
    stop();const g=run;$('scan').disabled=true;
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
      meter.reset();updateRate();rateTimer=setInterval(updateRate,500);
      queue(g);
    }catch(e){if(g===run){stop();status('摄像头启动失败：'+e.message)}}
  };
  $('stop').onclick=()=>{stop();renderRepair(true);status('已暂停，已接收分片保留在当前页面')};
  $('reset').onclick=()=>{stop();r.reset();selectedBlock=1;blockPage=0;manualBlock=false;lastRepairRender=0;$('repair-code-box').hidden=true;$('repair-code').value='';render();if(objectURL)URL.revokeObjectURL(objectURL);objectURL=null;$('save').removeAttribute('href');$('result').hidden=true;$('preview').hidden=true;$('preview').value='';$('copy').hidden=true;$('digest').textContent='';status('等待扫描')};
  $('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('preview').value);status('已复制')}catch{status('无法自动复制，请手动选中文本')}};
  window.addEventListener('pagehide',stop);
  if('serviceWorker' in navigator){
    const wasControlled=!!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange',()=>{if(wasControlled)$('update').hidden=false});
    $('update').onclick=()=>{if(!stream&&(!r.session||r.result||confirm('更新会清空当前接收进度，继续？')))location.reload();else if(stream&&confirm('更新会停止扫描并清空进度，继续？'))location.reload()};
    navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(reg=>{reg.update().catch(()=>{});return navigator.serviceWorker.ready}).then(()=>{$('offline').textContent='离线可用'}).catch(e=>{$('offline').textContent='离线缓存未就绪'});
  }else $('offline').textContent='浏览器不支持离线缓存';
}
