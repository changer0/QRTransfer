const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {createSender,SegmentReceiver,BLOCK_BYTES}=require('../src/segmented.cjs');
test('显示具体缺失原始帧，整块漏扫，定向补发后校验完整',async()=>{
  const data=randomBytes(BLOCK_BYTES*3+123);
  const s=await createSender(new Blob([data]),'repair.bin','file',()=>{},{fragment:850,compress:true});
  const r=new SegmentReceiver();
  for(let j=0;j<1000;j++){
    const f=await s.next(),m=/^QRT2:[^:]+:(\d+):UR:BYTES\/(?:(\d+)-(\d+)\/)?/.exec(f);
    const block=+m[1],seq=+m[2],count=+m[3];
    if(s.cycle>1)break;
    if(block===2||block===1&&(seq>count||[2,5,6].includes(seq)))continue;
    r.receive(f);
  }
  assert.deepEqual(r.blockStatus(1).missing,[2,5,6]);
  assert.equal(r.blockStatus(2).state,'unseen');
  const plan=r.repairPlan();
  assert.match(plan.code,/1\/2,5-6;2\/\*/);
  const repair=await s.createRepair(plan.code);
  const blocks=new Set();
  for(let i=0;i<repair.count&&!r.result;i++){
    const frame=await repair.next();
    blocks.add(+frame.split(':')[2]);r.receive(frame);
  }
  assert.deepEqual([...blocks],[1,2]);
  assert.ok(r.result,r.error);assert.deepEqual(Buffer.concat(r.result.parts),data);
});
test('补帧会话不匹配、越界及错误格式拒绝',async()=>{
  const s=await createSender(new Blob(['abc']),'a');
  await assert.rejects(s.createRepair('QRF1:00000000:1/*'),/会话/);
  const p='QRF1:'+s.session.slice(0,8)+':';
  await assert.rejects(s.createRepair(p+'2/*'),/分块/);
  await assert.rejects(s.createRepair(p+'1/99'),/帧/);
  await assert.rejects(s.createRepair(p+'1/1-0'),/格式/);
});
