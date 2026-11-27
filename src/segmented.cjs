const {UR,UREncoder,URDecoder}=require('@ngraveio/bc-ur');
const {Buffer}=require('buffer');
const SHA=require('sha.js');
const {deflateSync,inflateSync}=require('fflate');
const {hash,Receiver:LegacyReceiver}=require('./protocol.cjs');
const BLOCK_BYTES=32*1024, FRAGMENT=450, HASH_CHUNK=1024*1024;
const safeName=n=>String(n||'download.bin').replace(/[\\/\x00-\x1f\x7f]/g,'_').slice(0,180)||'download.bin';
const countFor=size=>Math.ceil(size/BLOCK_BYTES);
const blockSize=(meta,i)=>Math.min(BLOCK_BYTES,meta.size-(i-1)*BLOCK_BYTES);
const encoder=(bytes,fragment=FRAGMENT,seq=0)=>new UREncoder(UR.fromBuffer(bytes),fragment,seq);
const PROFILES={
  stable:{fragment:450,fps:6,label:'兼容'},
  balanced:{fragment:850,fps:12,label:'均衡'},
  fast:{fragment:1200,fps:18,label:'高速'},
  max:{fragment:1450,fps:24,label:'极速'}
};
function packBlock(bytes){
  const compressed=deflateSync(bytes,{level:3});
  return compressed.length<bytes.length?Buffer.concat([Buffer.from([1]),Buffer.from(compressed)]):Buffer.concat([Buffer.from([0]),bytes]);
}
function unpackBlock(bytes,size){
  if(bytes[0]===0)return bytes.subarray(1);
  if(bytes[0]!==1)throw Error('不支持的压缩格式');
  return Buffer.from(inflateSync(bytes.subarray(1),{out:new Uint8Array(size+1)}));
}
const wrap=(id,i,p)=>('QRT2:'+id+':'+i+':'+p).toUpperCase();
async function createSender(blob,name,kind='file',onHash=()=>{},options={}){
  const fragment=options.fragment||FRAGMENT;
  if(!Number.isInteger(fragment)||fragment<FRAGMENT||fragment>1450)throw Error('二维码密度无效');
  if(!Number.isSafeInteger(blob.size)||blob.size<0||!['file','text'].includes(kind))throw Error('文件或类型无效');
  const digest=SHA('sha256');
  for(let pos=0;pos<blob.size;pos+=HASH_CHUNK){
    digest.update(Buffer.from(await blob.slice(pos,pos+HASH_CHUNK).arrayBuffer()));
    onHash(Math.min(blob.size,pos+HASH_CHUNK),blob.size);
  }
  const meta={v:2,name:safeName(name),kind,size:blob.size,block:BLOCK_BYTES,sha256:digest.digest('hex')};
  if(options.compress)meta.codec='deflate-block-v1';
  if(fragment!==FRAGMENT)meta.fragment=fragment;
  const manifest=Buffer.from(JSON.stringify(meta),'utf8'), id=hash(manifest).slice(0,24);
  let index=1,cycle=0,manifestQueue=[],current=null,sent=0,parity=null,limit=0;
  function manifestFrames(){
    const enc=encoder(manifest);
    return Array.from({length:enc.fragmentsLength===1?1:enc.fragmentsLength+2},()=>wrap(id,0,enc.nextPart()));
  }
  return {session:id,meta,get cycle(){return cycle+1},get block(){return Math.min(index,countFor(meta.size))},async next(){
    if(manifestQueue.length)return manifestQueue.shift();
    if(!current){
      manifestQueue=manifestFrames();
      if(!meta.size)return manifestQueue.shift();
      const start=(index-1)*BLOCK_BYTES;
      const raw=Buffer.from(await blob.slice(start,start+BLOCK_BYTES).arrayBuffer());
      const bytes=options.compress?packBlock(raw):raw;
      current=encoder(bytes,fragment);sent=0;
      const n=current.fragmentsLength;
      const extra=Math.max(2,Math.ceil(n*.35));
      parity=encoder(bytes,fragment,(n+cycle*extra)%4294967294);
      limit=n+extra;
      return manifestQueue.shift();
    }
    const frame=wrap(id,index,(sent<current.fragmentsLength?current:parity).nextPart());
    if(++sent>=limit){
      current=null;parity=null;
      if(++index>countFor(meta.size)){index=1;cycle++}
    }else if(sent%16===0)manifestQueue=manifestFrames();
    return frame;
  }};
}
class SegmentReceiver{
  constructor(){this.reset()}
  reset(){this.session=null;this.meta=null;this.manifest=new URDecoder();this.blocks=new Map();this.seen=new Map();this.parts=new Map();this.partial=new Map();this.recoveredBytes=0;this.result=null;this.error=null;this.frames=0;this.legacy=null}
  get totalBytes(){return this.meta?.size??this.result?.size??null}
  get completedBlocks(){return this.parts.size}
  get totalBlocks(){return this.meta?countFor(this.meta.size):null}
  progress(){return this.result?1:this.legacy?this.legacy.progress():this.totalBytes?Math.min(.999,this.recoveredBytes/this.totalBytes):0}
  fail(e){this.error=e.message||String(e);return 'error'}
  finish(){
    const digest=SHA('sha256'),parts=[];
    for(let i=1;i<=this.totalBlocks;i++){
      const p=this.parts.get(i);if(!p)throw Error('文件分块不完整');
      digest.update(p);parts.push(p);
    }
    if(this.recoveredBytes!==this.meta.size||digest.digest('hex')!==this.meta.sha256)throw Error('整文件 SHA-256 或长度校验失败');
    this.result={...this.meta,parts};return 'complete';
  }
  receive(frame){
    if(this.result||this.error)return 'finished';
    if(typeof frame!=='string'||frame.length>3500)return 'invalid';
    if(/^QRT1:/i.test(frame)){
      if(this.session)return 'other';
      if(!this.legacy)this.legacy=new LegacyReceiver();
      const state=this.legacy.receive(frame);this.frames=this.legacy.frames;
      if(state==='complete'){
        const {data,...meta}=this.legacy.result;
        this.result={...meta,parts:[data]};this.recoveredBytes=data.length;
      }else if(state==='error')this.error=this.legacy.error;
      return state;
    }
    if(this.legacy?.session)return 'other';
    const m=/^QRT2:([0-9A-F]{24}):(0|[1-9]\d{0,15}):(UR:BYTES\/(?:([1-9]\d{0,9})-([1-9]\d{0,2})\/)?[A-Z]+)$/i.exec(frame);
    if(!m||!Number.isSafeInteger(+m[2])||(m[5]&&(+m[5]>100||+m[4]>4294967295)))return 'invalid';
    const id=m[1].toLowerCase(),i=Number(m[2]),ur=m[3].toLowerCase();
    if(this.session&&id!==this.session)return 'other';
    if(!this.meta&&i!==0)return 'waiting';
    if(i===0){
      if(this.meta)return 'ignored';
      try{
        if(!this.manifest.receivePart(ur))return 'ignored';
        this.session=id;this.frames++;
        if(!this.manifest.isComplete())return 'accepted';
        if(!this.manifest.isSuccess())throw Error('文件信息损坏');
        const bytes=this.manifest.resultUR().decodeCBOR();
        if(bytes.length>4096||hash(bytes).slice(0,24)!==id)throw Error('文件信息校验失败');
        const meta=JSON.parse(bytes.toString('utf8'));
        if(meta.v!==2||meta.block!==BLOCK_BYTES||!Number.isSafeInteger(meta.size)||meta.size<0||typeof meta.name!=='string'||!['file','text'].includes(meta.kind)||typeof meta.sha256!=='string'||!/^[a-f0-9]{64}$/.test(meta.sha256))throw Error('文件信息不合法');
        if(meta.codec!==undefined&&meta.codec!=='deflate-block-v1')throw Error('不支持的压缩协议');
        this.meta={...meta,name:safeName(meta.name)};
        return meta.size===0?this.finish():'accepted';
      }catch(e){return this.manifest.isComplete()?this.fail(e):'invalid'}
    }
    if(i>this.totalBlocks)return 'invalid';
    if(this.parts.has(i))return 'ignored';
    let decoder=this.blocks.get(i);
    if(!decoder){decoder=new URDecoder();this.blocks.set(i,decoder);this.seen.set(i,new Set())}
    const seen=this.seen.get(i),seq=m[4]||'single';
    if(seen.has(seq))return 'ignored';
    try{
      if(!decoder.receivePart(ur))return 'ignored';
      seen.add(seq);
      this.frames++;
      const size=blockSize(this.meta,i);
      const old=this.partial.get(i)||0;
      if(decoder.isComplete()){
        if(!decoder.isSuccess())throw Error('数据块校验失败');
        const encoded=decoder.resultUR().decodeCBOR();
        if(encoded.length>size+1)throw Error('数据块长度不正确');
        const bytes=this.meta.codec?unpackBlock(encoded,size):encoded;
        if(bytes.length!==size)throw Error('数据块长度不正确');
        this.parts.set(i,bytes);this.blocks.delete(i);this.seen.delete(i);this.partial.delete(i);
        this.recoveredBytes+=size-old;
        return this.parts.size===this.totalBlocks?this.finish():'accepted';
      }
      const next=Math.max(old,Math.min(size-1,Math.floor(size*decoder.receivedPartIndexes().length/Math.max(1,decoder.expectedPartCount()))));
      this.partial.set(i,next);this.recoveredBytes+=next-old;
      return 'accepted';
    }catch(e){return decoder.isComplete()?this.fail(e):'invalid'}
  }
}
class RateMeter{
  constructor(windowMs=5000){this.window=windowMs;this.reset()}
  reset(){this.samples=[]}
  sample(bytes,now=Date.now()){
    const last=this.samples[this.samples.length-1];
    if(last&&now<last.t)this.reset();
    this.samples.push({t:now,b:bytes});
    while(this.samples.length>1&&this.samples[0].t<now-this.window)this.samples.shift();
    const first=this.samples[0],dt=now-first.t;
    return dt>0?Math.max(0,(bytes-first.b)*1000/dt):0;
  }
}
module.exports={createSender,SegmentReceiver,RateMeter,BLOCK_BYTES,PROFILES};
