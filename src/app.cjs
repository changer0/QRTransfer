const QR = require('qrcode');
const jsQR = require('jsqr');
const {Buffer}=require('buffer');
const {MAX,sender,Receiver}=require('./protocol.cjs');
const $=id=>document.getElementById(id);
const status=t=>{$('status').textContent=t};
const mode=document.body.dataset.mode;
if(mode==='sender'){
  let enc=null,timer=null,frame=0,busy=false,generation=0;
  const stop=()=>{generation++;clearTimeout(timer);timer=null;$('pause').textContent='继续播放'};
  async function tick(g){
    if(g!==generation||!enc)return;
    if(busy){timer=setTimeout(()=>tick(g),30);return}
    busy=true;
    try{
      const text=enc.next();
      const temp=document.createElement('canvas');
      await QR.toCanvas(temp,text,{errorCorrectionLevel:'M',scale:6,margin:4});
      if(g!==generation)return;
      const c=$('qr');c.width=temp.width;c.height=temp.height;c.getContext('2d').drawImage(temp,0,0);
      $('frame').textContent='已发送 '+(++frame)+' 帧';
    }catch(e){stop();status(e.message)}
    finally{busy=false;if(g===generation)timer=setTimeout(()=>tick(g),Number($('speed').value))}
  }
  function play(){if(!enc)return;stop();$('pause').textContent='暂停播放';const g=generation;timer=setTimeout(()=>tick(g),0)}
  $('start').onclick=async()=>{
    stop();enc=null;frame=0;$('pause').disabled=true;
    const g=generation;
    try{
      const f=$('file').files[0],text=$('text').value;
      if(!f&&!text)throw Error('请输入文本或选择文件');
      if(f&&f.size>MAX)throw Error('首版单文件最大 512 KiB');
      const data=f?new Uint8Array(await f.arrayBuffer()):Buffer.from(text,'utf8');
      if(g!==generation)return;
      enc=sender(data,f?f.name:'text.txt',f?'file':'text');
      status('已生成 · '+data.length+' 字节 · 请用手机扫描，确认接收成功后停止');
      $('pause').disabled=false;play();
    }catch(e){status(e.message)}
  };
  $('pause').onclick=()=>{if(timer!==null){stop();status('已暂停，可继续播放')}else{play();status('正在播放，请扫描')}};
  $('file').onchange=()=>{$('text').disabled=!!$('file').files[0]};
  $('clear').onclick=()=>{stop();enc=null;$('file').value='';$('text').value='';$('text').disabled=false;$('pause').disabled=true;$('qr').getContext('2d').clearRect(0,0,$('qr').width,$('qr').height);$('frame').textContent='';status('等待发送')};
}else{
  const r=new Receiver();let stream=null,raf=0,run=0,last=0,objectURL=null;
  const video=$('video'),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
  function stop(){run++;cancelAnimationFrame(raf);if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}video.srcObject=null;$('scan').disabled=false;$('stop').disabled=true}
  function render(){
    const pct=Math.floor(r.progress()*100);$('progress').value=pct;$('pct').textContent=pct+'%（估算）';
    $('frames').textContent='有效帧 '+r.frames;
  }
  function finish(){
    stop();render();$('pct').textContent='100% · SHA-256 校验通过';
    const f=r.result;status('接收成功：'+f.name+' · '+f.size+' 字节');
    $('digest').textContent=f.sha256;
    if(objectURL)URL.revokeObjectURL(objectURL);
    objectURL=URL.createObjectURL(new Blob([f.data],{type:'application/octet-stream'}));
    $('save').href=objectURL;$('save').download=f.name;$('result').hidden=false;
    if(f.kind==='text'){$('preview').hidden=false;$('preview').value=f.data.toString('utf8');$('copy').hidden=false}
  }
  function receive(value){
    const res=r.receive(value);render();
    if(res==='complete')finish();
    else if(res==='error'){stop();status('校验失败：'+r.error+'。请重置后重试')}
    else if(res==='other')status('检测到其他会话，已忽略；如需切换请重置');
    else if(res==='accepted')status('正在接收，漏帧会由后续二维码补偿');
  }
  function scan(t,g){
    if(g!==run)return;
    if(t-last>85&&video.readyState>=2&&video.videoWidth){
      last=t;const scale=Math.min(1,960/video.videoWidth);
      canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
      ctx.drawImage(video,0,0,canvas.width,canvas.height);
      const im=ctx.getImageData(0,0,canvas.width,canvas.height);
      const code=jsQR(im.data,im.width,im.height,{inversionAttempts:'dontInvert'});
      if(code)receive(code.data);
    }
    if(g===run)raf=requestAnimationFrame(t=>scan(t,g));
  }
  $('scan').onclick=async()=>{
    if(r.result||r.error){status('请先重置再开始新任务');return}
    stop();const g=run;$('scan').disabled=true;
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw Error('请使用 HTTPS 页面并允许摄像头');
      const s=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
      if(g!==run){s.getTracks().forEach(t=>t.stop());return}
      stream=s;video.srcObject=s;await video.play();if(g!==run)return;
      $('stop').disabled=false;status('正在扫描');raf=requestAnimationFrame(t=>scan(t,g));
    }catch(e){if(g===run){stop();status('摄像头启动失败：'+e.message)}}
  };
  $('stop').onclick=()=>{stop();status('已暂停，已接收分片保留在当前页面')};
  $('reset').onclick=()=>{stop();r.reset();render();if(objectURL)URL.revokeObjectURL(objectURL);objectURL=null;$('save').removeAttribute('href');$('result').hidden=true;$('preview').hidden=true;$('preview').value='';$('copy').hidden=true;$('digest').textContent='';status('等待扫描')};
  $('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('preview').value);status('已复制')}catch{status('无法自动复制，请手动选中文本')}};
  window.addEventListener('pagehide',stop);
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./sw.js').then(()=>navigator.serviceWorker.ready).then(()=>{$('offline').textContent='离线资源已就绪；可添加到主屏幕'}).catch(e=>{$('offline').textContent='离线缓存失败：'+e.message});
  }else $('offline').textContent='浏览器不支持离线缓存';
}
