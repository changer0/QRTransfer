const {UR, UREncoder, URDecoder} = require('@ngraveio/bc-ur');
const {Buffer} = require('buffer');
const SHA = require('sha.js');
const MAX = 512 * 1024;
const FRAGMENT = 450;
const hash = b => SHA('sha256').update(b).digest('hex');
function safeName(name) {
  return String(name || 'download.bin').replace(/[\\/\x00-\x1f\x7f]/g, '_').slice(0, 180) || 'download.bin';
}
function makeEnvelope(data, name, kind='file') {
  const bytes = Buffer.from(data);
  if (bytes.length > MAX) throw Error('首版单文件限制为 512 KiB');
  if (!['file','text'].includes(kind)) throw Error('无效类型');
  const meta = {v:1, name:safeName(name), kind, size:bytes.length, sha256:hash(bytes)};
  const header = Buffer.from(JSON.stringify(meta), 'utf8');
  const len = Buffer.alloc(4); len.writeUInt32BE(header.length);
  return Buffer.concat([len,header,bytes]);
}
function unpack(envelope, session) {
  const b = Buffer.from(envelope);
  if (b.length < 4 || b.length > MAX+4096 || hash(b).slice(0,24) !== session) throw Error('传输会话校验失败');
  const n = b.readUInt32BE(0);
  if (n < 2 || n > 4092 || n+4 > b.length) throw Error('文件头损坏');
  const m = JSON.parse(b.subarray(4,4+n).toString('utf8'));
  const data = b.subarray(4+n);
  if (m.v!==1 || !['file','text'].includes(m.kind) || typeof m.name!=='string' || m.size!==data.length || data.length>MAX || m.sha256!==hash(data)) throw Error('文件 SHA-256 或长度校验失败');
  return { ...m, name:safeName(m.name), data };
}
function sender(data,name,kind) {
  const envelope = makeEnvelope(data,name,kind);
  const session = hash(envelope).slice(0,24);
  const encoder = new UREncoder(UR.fromBuffer(envelope),FRAGMENT,0);
  return {session, next:()=> ('QRT1:'+session+':'+encoder.nextPart()).toUpperCase()};
}
class Receiver {
  constructor(){this.reset()}
  reset(){this.session=null;this.decoder=new URDecoder();this.result=null;this.frames=0;this.error=null}
  receive(frame){
    if(this.result || this.error) return 'finished';
    if(typeof frame!=='string' || frame.length>2400) return 'invalid';
    const m=/^QRT1:([0-9A-F]{24}):(UR:BYTES\/(?:([1-9]\d{0,9})-([1-9]\d{0,3})\/)?[A-Z]+)$/i.exec(frame);
    if(!m || (m[4] && (+m[4]>1500 || +m[3]>4294967295))) return 'invalid';
    const session=m[1].toLowerCase();
    if(this.session && this.session!==session) return 'other';
    try {
      const accepted=this.decoder.receivePart(m[2].toLowerCase());
      if(!accepted) return 'ignored';
      this.session=session; this.frames++;
      if(this.decoder.isComplete()){
        if(!this.decoder.isSuccess()) throw Error('喷泉码完整性校验失败，请重新接收');
        this.result=unpack(this.decoder.resultUR().decodeCBOR(),session);
        return 'complete';
      }
      return 'accepted';
    } catch(e) {
      if(this.decoder.isComplete()){this.error=e.message;return 'error'}
      return 'invalid';
    }
  }
  progress(){return this.result?1:Math.min(.99,this.decoder.estimatedPercentComplete()||0)}
}
module.exports={MAX,hash,makeEnvelope,unpack,sender,Receiver};
