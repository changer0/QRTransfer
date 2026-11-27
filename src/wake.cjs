function createWakeLock(onState=()=>{}){
  let wanted=false,lock=null,pending=false;
  async function sync(){
    if(!wanted||document.visibilityState!=='visible'){
      if(lock){const old=lock;lock=null;await old.release().catch(()=>{})}
      onState(false);return;
    }
    if(lock||pending)return;
    if(!navigator.wakeLock){onState(false);return}
    pending=true;
    try{
      const acquired=await navigator.wakeLock.request('screen');
      if(!wanted||document.visibilityState!=='visible'){await acquired.release();return}
      lock=acquired;onState(true);
      acquired.addEventListener('release',()=>{if(lock===acquired){lock=null;onState(false)}});
    }catch{onState(false)}finally{pending=false}
  }
  document.addEventListener('visibilitychange',sync);
  return {set(active){wanted=active;sync()}};
}
module.exports={createWakeLock};
