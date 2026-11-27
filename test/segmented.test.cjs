const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {createSender,SegmentReceiver,RateMeter,BLOCK_BYTES,PROFILES}=require('../src/segmented.cjs');
async function transfer(bytes,drop=()=>false){
  const s=await createSender(new Blob([bytes]),'中文.bin','file'),r=new SegmentReceiver();
  let previous=0;
  for(let i=0;i<30000&&!r.result&&!r.error;i++){
    const frame=await s.next();
    if(drop(i,frame))continue;
    r.receive(frame);const recovered=r.recoveredBytes;
    r.receive(frame);assert.equal(r.recoveredBytes,recovered);
    assert.ok(recovered>=previous&&recovered<=bytes.length);
    previous=recovered;
  }
  assert.ok(r.result,r.error||'未恢复');
  assert.deepEqual(Buffer.concat(r.result.parts),bytes);
  assert.equal(r.recoveredBytes,bytes.length);
  return r;
}
test('超过旧上限的文件、分块及25%漏帧',async()=>{
  await transfer(randomBytes(600*1024),(i)=>i%4===0);
});
test('整块漏扫可在后续轮次补齐',async()=>{
  let skipped=true;
  await transfer(randomBytes(BLOCK_BYTES*2+7),(i,frame)=>{
    const id=Number(frame.split(':')[2]);
    if(id===2)skipped=false;
    return id===1&&skipped;
  });
});
test('空文件及中文内容',async()=>{await transfer(Buffer.alloc(0));await transfer(Buffer.from('你好，二维码'))});
test('速率只根据有效字节变化，停顿衰减',()=>{
  const m=new RateMeter(4000);
  m.sample(0,0);assert.equal(m.sample(1000,1000),1000);
  assert.equal(m.sample(1000,5000),0);
  m.reset();assert.equal(m.sample(9000,6000),0);
});
test('新版真实二维码像素解码，SHA-256 校验',async()=>{
  const QR=require('qrcode'),jsQR=require('jsqr'),{PNG}=require('pngjs');
  const data=randomBytes(2200),s=await createSender(new Blob([data]),'data.bin'),r=new SegmentReceiver();
  for(let i=0;i<40&&!r.result;i++){
    const f=await s.next();if(i===2)continue;
    const img=PNG.sync.read(await QR.toBuffer(f,{scale:6,errorCorrectionLevel:'M',margin:4}));
    const decoded=jsQR(new Uint8ClampedArray(img.data),img.width,img.height);
    assert.equal(decoded.data,f);r.receive(decoded.data);
  }
  assert.deepEqual(Buffer.concat(r.result.parts),data);
});
test('有效编码但篡改数据块，最终摘要拒绝保存',async()=>{
  const {UR,UREncoder}=require('@ngraveio/bc-ur');
  const data=Buffer.from('original'),s=await createSender(new Blob([data]),'a'),r=new SegmentReceiver();
  r.receive(await s.next());
  const bad=new UREncoder(UR.fromBuffer(Buffer.from('modified')),450,0);
  assert.equal(r.receive(('QRT2:'+s.session+':1:'+bad.nextPart()).toUpperCase()),'error');
  assert.match(r.error,/SHA-256/);assert.equal(r.result,null);
});
test('兼容旧发送端，隔离其他会话',async()=>{
  const {sender}=require('../src/protocol.cjs');
  const old=sender(Buffer.from('legacy'),'legacy.txt','text'),r=new SegmentReceiver();
  r.receive(old.next());assert.deepEqual(Buffer.concat(r.result.parts),Buffer.from('legacy'));
  r.reset();
  const a=await createSender(new Blob(['a']),'a'),b=await createSender(new Blob(['b']),'b');
  r.receive(await a.next());assert.equal(r.receive(await b.next()),'other');
  r.receive(await a.next());assert.deepEqual(Buffer.concat(r.result.parts),Buffer.from('a'));
});
test('高速各档位、压缩与不可压缩数据、丢帧和完整性',async()=>{
  const data=Buffer.concat([Buffer.from('二维码日志 hello world\n'.repeat(2000)),randomBytes(40000)]);
  for(const profile of Object.values(PROFILES)){
    const s=await createSender(new Blob([data]),'mix.bin','file',()=>{},{fragment:profile.fragment,compress:true});
    const r=new SegmentReceiver();
    for(let i=0;i<5000&&!r.result&&!r.error;i++){
      const f=await s.next();
      if(i%5===2)continue;
      r.receive(f);const before=r.recoveredBytes;r.receive(f);assert.equal(r.recoveredBytes,before);
    }
    assert.ok(r.result,r.error||profile.label);
    assert.deepEqual(Buffer.concat(r.result.parts),data);
  }
});
test('高密度二维码像素解码，实际载荷恢复',async()=>{
  const QR=require('qrcode'),jsQR=require('jsqr'),{PNG}=require('pngjs');
  const data=randomBytes(8000),s=await createSender(new Blob([data]),'data.bin','file',()=>{},{fragment:1450,compress:true}),r=new SegmentReceiver();
  for(let i=0;i<60&&!r.result;i++){
    const frame=await s.next();
    const img=PNG.sync.read(await QR.toBuffer([{data:frame,mode:'alphanumeric'}],{scale:6,errorCorrectionLevel:'M',margin:4}));
    const decoded=jsQR(new Uint8ClampedArray(img.data),img.width,img.height);
    assert.equal(decoded.data,frame);r.receive(decoded.data);
  }
  assert.ok(r.result,r.error);assert.deepEqual(Buffer.concat(r.result.parts),data);
});
