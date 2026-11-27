const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {sender,Receiver,makeEnvelope,unpack,hash,MAX}=require('../src/protocol.cjs');
function roundtrip(data,drop=false){
  const s=sender(data,'中文.bin','file'), r=new Receiver();
  for(let i=0;i<5000&&!r.result;i++){
    const f=s.next();
    if(drop && i%4===0) continue;
    r.receive(f);r.receive(f);
  }
  assert.ok(r.result,r.error||'未恢复');
  assert.deepEqual(r.result.data,data);
  assert.equal(r.result.sha256,hash(data));
}
test('空文件、短文本、二进制',()=>{roundtrip(Buffer.alloc(0));roundtrip(Buffer.from('你好 QR'));roundtrip(randomBytes(4096))});
test('漏帧25%、重复帧',()=>roundtrip(randomBytes(48*1024),true));
test('乱序、重复和跨会话隔离',()=>{
  const data=randomBytes(5000),s=sender(data,'a'),r=new Receiver(),f=Array.from({length:40},()=>s.next()).reverse();
  r.receive(f[0]);assert.equal(r.receive(sender(Buffer.from('other'),'b').next()),'other');
  for(const part of f){r.receive(part);r.receive(part)}
  assert.deepEqual(r.result.data,data);
});
test('篡改文件拒绝输出、超限拒绝',()=>{
  const b=makeEnvelope(Buffer.from('hello'),'a');const id=hash(b).slice(0,24);
  b[b.length-1]^=1;assert.throws(()=>unpack(b,id));assert.throws(()=>unpack(b,hash(b).slice(0,24)),/SHA-256/);
  assert.throws(()=>sender(Buffer.alloc(MAX+1),'a'));
});
test('残缺文件与无效二维码不能输出',()=>{
  const s=sender(randomBytes(8000),'a'),r=new Receiver();r.receive(s.next());assert.equal(r.result,null);assert.equal(r.receive('https://example.com'),'invalid');
});
test('实际二维码 PNG 编码、像素解码和文件重组',async()=>{
  const QR=require('qrcode'), jsQR=require('jsqr'), {PNG}=require('pngjs');
  const bytes=randomBytes(2048), s=sender(bytes,'binary.dat'), r=new Receiver();
  for(let i=0;i<30&&!r.result;i++){
    const frame=s.next();if(i===1)continue;
    const png=PNG.sync.read(await QR.toBuffer(frame,{scale:6,errorCorrectionLevel:'M',margin:4}));
    const code=jsQR(new Uint8ClampedArray(png.data),png.width,png.height);
    assert.ok(code);assert.equal(code.data,frame);r.receive(code.data);
  }
  assert.deepEqual(r.result.data,bytes);
});
