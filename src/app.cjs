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
  let enc=null,timer=null,frame=0,busy=false,generation=0,profile=PROFILES.balanced,startedAt=0;
  const temp=document.createElement('canvas');
  const stop=()=>{generation++;clearTimeout(timer);timer=null;$('pause').textContent='继续播放'};
  async function tick(g){
    if(g!==generation||!enc)return;
    if(busy){timer=setTimeout(()=>tick(g),30);return}
    busy=true;
    const begin=performance.now();
    try{
      const active=enc;
      const text=await active.next();
      if(g!==generation||active!==enc)return;
      await QR.toCanvas(temp,[{data:text,mode:'alphanumeric'}],{errorCorrectionLevel:'M',scale:5,margin:4});
      if(g!==generation)return;
      const c=$('qr');c.width=temp.width;c.height=temp.height;c.getContext('2d').drawImage(temp,0,0);
      $('frame').textContent=(++frame)+' 帧';
      $('actual-fps').textContent=(frame/Math.max(1,(performance.now()-startedAt)/1000)).toFixed(1)+' fps';
      $('block').textContent='第 '+active.cycle+' 轮';
      $('qr-empty').hidden=true;$('qr').hidden=false;
    }catch(e){stop();status(e.message)}
    finally{busy=false;if(g===generation)timer=setTimeout(()=>tick(g),Math.max(0,1000/profile.fps-(performance.now()-begin)))}
  }
  function play(){if(!enc)return;stop();startedAt=performance.now();frame=0;$('pause').textContent='暂停播放';const g=generation;timer=setTimeout(()=>tick(g),0)}
  $('start').onclick=async()=>{
    stop();enc=null;frame=0;$('pause').disabled=true;
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
      $('source-size').textContent=human(data.size);
      status('正在播放，请用手机扫描');
      $('pause').disabled=false;play();
    }catch(e){if(g===generation)status(e.message)}
    finally{$('start').disabled=false}
  };
  $('pause').onclick=()=>{if(timer!==null){stop();status('已暂停，可继续播放')}else{play();status('正在播放，请扫描')}};
  function selectMode(mode){
    const file=mode==='file';
    $('file-panel').hidden=!file;$('text-panel').hidden=file;
    $('tab-file').setAttribute('aria-selected',String(file));$('tab-text').setAttribute('aria-selected',String(!file));
    if(!file){$('file').value='';$('file-name').textContent='点击选择文件'}
  }
  $('tab-file').onclick=()=>selectMode('file');$('tab-text').onclick=()=>selectMode('text');
  $('file').onchange=()=>{const f=$('file').files[0];$('file-name').textContent=f?f.name+' · '+human(f.size):'点击选择文件'};
  $('clear').onclick=()=>{stop();enc=null;$('file').value='';$('text').value='';$('file-name').textContent='点击选择文件';$('pause').disabled=true;$('qr').hidden=true;$('qr-empty').hidden=false;$('frame').textContent='0 帧';$('block').textContent='—';$('source-size').textContent='—';$('actual-fps').textContent='—';status('等待发送')};
}else{
  const r=new SegmentReceiver(),meter=new RateMeter();let stream=null,raf=0,run=0,objectURL=null,rateTimer=null,worker=null,detector=null,decodeBusy=false,attempt=0,videoTime=-1,lastDecode=0;
  const video=$('video'),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
  function stop(){run++;if(video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(raf);else cancelAnimationFrame(raf);clearInterval(rateTimer);rateTimer=null;if(worker){worker.terminate();worker=null}decodeBusy=false;detector=null;if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}video.srcObject=null;$('scan').disabled=false;$('stop').disabled=true;$('camera').classList.remove('active');meter.reset();$('rate').textContent=human(0,true)}
  function updateRate(){
    $('rate').textContent=human(meter.sample(r.recoveredBytes),true);
  }
  function render(){
    const pct=r.result?100:Math.min(99.9,Math.floor(r.progress()*1000)/10);
    $('progress').value=pct;$('pct').textContent=pct.toFixed(1)+'%';
    $('frames').textContent=r.frames.toLocaleString();
    $('received').textContent=human(r.recoveredBytes)+' / '+human(r.totalBytes);
    $('blocks').textContent=r.totalBlocks==null?'—':r.completedBlocks+' / '+r.totalBlocks;
    $('incoming').textContent=r.meta?.name||r.result?.name||'等待文件信息';
  }
  function finish(){
    stop();render();$('pct').textContent='100% · SHA-256 校验通过';
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
    else if(res==='error'){stop();status('校验失败：'+r.error+'。请重置后重试')}
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
  $('stop').onclick=()=>{stop();status('已暂停，已接收分片保留在当前页面')};
  $('reset').onclick=()=>{stop();r.reset();render();if(objectURL)URL.revokeObjectURL(objectURL);objectURL=null;$('save').removeAttribute('href');$('result').hidden=true;$('preview').hidden=true;$('preview').value='';$('copy').hidden=true;$('digest').textContent='';status('等待扫描')};
  $('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('preview').value);status('已复制')}catch{status('无法自动复制，请手动选中文本')}};
  window.addEventListener('pagehide',stop);
  if('serviceWorker' in navigator){
    const wasControlled=!!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange',()=>{if(wasControlled)$('update').hidden=false});
    $('update').onclick=()=>{if(!stream&&(!r.session||r.result||confirm('更新会清空当前接收进度，继续？')))location.reload();else if(stream&&confirm('更新会停止扫描并清空进度，继续？'))location.reload()};
    navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(reg=>{reg.update().catch(()=>{});return navigator.serviceWorker.ready}).then(()=>{$('offline').textContent='离线可用'}).catch(e=>{$('offline').textContent='离线缓存未就绪'});
  }else $('offline').textContent='浏览器不支持离线缓存';
}
