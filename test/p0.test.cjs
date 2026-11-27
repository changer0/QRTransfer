const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {createSender,SegmentReceiver,BLOCK_BYTES}=require('../src/segmented.cjs');
test('首轮进度单调递增，结束标记绑定会话并可补帧',async()=>{
  const bytes=randomBytes(BLOCK_BYTES+333);
  const s=await createSender(new Blob([bytes]),'round.bin','file',()=>{},{fragment:850,roundSignals:true});
  const r=new SegmentReceiver();let previous=0,marker;
  for(let i=0;i<2000;i++){
    const f=await s.next();assert.ok(s.firstProgress>=previous);previous=s.firstProgress;
    if(f.startsWith('QRT2END:')){marker=f;break}
    if(f.split(':')[2]==='1')continue;
    r.receive(f);
  }
  assert.equal(s.firstProgress,1);
  assert.ok(marker);assert.equal(r.receive('QRT2END:'+'0'.repeat(24)+':1'),'ignored');
  assert.equal(r.receive(marker),'round');assert.equal(r.round,1);
  assert.equal(r.receive(marker),'ignored');
  const repair=await s.createRepair(r.repairPlan().code);
  for(let i=0;i<repair.count;i++)r.receive(repair.next());
  assert.deepEqual(Buffer.concat(r.result.parts),bytes);
});
test('从完整块与未完成帧恢复后继续校验',async()=>{
  const bytes=randomBytes(BLOCK_BYTES*2+100);
  const s=await createSender(new Blob([bytes]),'resume.bin','file',()=>{},{fragment:850});
  const a=new SegmentReceiver(),pending=[];let manifest;
  for(let i=0;i<2000;i++){
    const f=await s.next(),block=+f.split(':')[2];
    if(block===0&&!manifest)manifest=f;
    if(block===3)break;
    if(block===2&&pending.length>=4)continue;
    a.receive(f);if(block===2)pending.push(f);
  }
  assert.equal(a.completedBlocks,1);
  const b=new SegmentReceiver();b.receive(manifest);b.restoreBlock(1,a.parts.get(1));pending.forEach(f=>b.receive(f));
  assert.equal(b.recoveredBytes,a.recoveredBytes);
  assert.deepEqual(b.blockStatus(2),a.blockStatus(2));
  assert.throws(()=>b.restoreBlock(3,Buffer.alloc(1)),/长度/);
  const repair=await s.createRepair(b.repairPlan().code);
  for(let i=0;i<repair.count;i++)b.receive(repair.next());
  assert.deepEqual(Buffer.concat(b.result.parts),bytes);
});
