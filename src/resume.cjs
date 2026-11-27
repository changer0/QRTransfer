// One active receive task, kept only on this device. Transactions compact a
// completed block atomically, retaining incomplete fountain frames for replay.
class ResumeStore{
  static open(factory=indexedDB){
    return new Promise((resolve,reject)=>{
      const request=factory.open('qrtransfer-resume-v1',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('parts',{keyPath:['block','seq']});
      request.onsuccess=()=>resolve(new ResumeStore(request.result));
      request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(Error('本地存储被其他页面占用'));
    });
  }
  constructor(db){this.db=db}
  write(action){
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction('parts','readwrite');
      tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||Error('缓存写入中断'));tx.onerror=()=>{};
      try{action(tx.objectStore('parts'))}catch(e){tx.abort();reject(e)}
    });
  }
  clear(){return this.write(s=>s.clear())}
  saveForSession(session,action){
    if(!session)return Promise.resolve();
    return this.write(s=>{
      const owner=s.get([-1,0]);
      owner.onsuccess=()=>{
        if(owner.result&&owner.result.session!==session){s.transaction.abort();return}
        if(!owner.result)s.put({block:-1,seq:0,session});
        action(s);
      };
    });
  }
  save(frame,receiver){
    const end=/^QRT2END:[0-9a-f]{24}:(\d+)$/i.exec(frame);
    if(end)return this.saveForSession(receiver.session,s=>s.put({block:0,seq:4294967296,frame}));
    const m=/^QRT2:[0-9a-f]{24}:(\d+):UR:BYTES\/(?:(\d+)-\d+\/)?/i.exec(frame);
    if(!m)return Promise.resolve();
    const block=Number(m[1]),seq=Number(m[2]||1),bytes=receiver.parts.get(block);
    if(bytes)return this.saveForSession(receiver.session,s=>{
      s.delete(IDBKeyRange.bound([block,0],[block,4294967296]));
      s.put({block,seq:0,data:new Uint8Array(bytes)});
    });
    return this.saveForSession(receiver.session,s=>{
      if(block===0){s.put({block,seq,frame});return}
      const complete=s.get([block,0]);
      complete.onsuccess=()=>{if(!complete.result?.data)s.put({block,seq,frame})};
    });
  }
  restore(receiver){
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction('parts','readonly'),req=tx.objectStore('parts').openCursor();
      let count=0, failure=null,owner=null;
      req.onsuccess=()=>{
        const cursor=req.result;if(!cursor)return;
        try{
          const item=cursor.value;
          if(item.block===-1){owner=item.session;cursor.continue();return}
          if(item.data)receiver.restoreBlock(item.block,item.data);
          else {
            const state=receiver.receive(item.frame);
            if(state==='invalid'||state==='other'||state==='waiting')throw Error('缓存帧无效或会话不一致');
          }
          if(receiver.error)throw Error(receiver.error);
          count++;cursor.continue();
        }catch(e){failure=e;tx.abort()}
      };
      tx.oncomplete=()=>owner&&owner!==receiver.session?reject(Error('缓存会话不一致')):resolve(count);tx.onabort=()=>reject(failure||tx.error||Error('缓存读取中断'));tx.onerror=()=>{};
    });
  }
}
module.exports={ResumeStore};
