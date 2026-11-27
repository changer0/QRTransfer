const jsQR=require('jsqr');
self.onmessage=e=>{
  try{
    const {pixels,width,height}=e.data;
    const code=jsQR(new Uint8ClampedArray(pixels),width,height,{inversionAttempts:'dontInvert'});
    self.postMessage(code?code.data:null);
  }catch{self.postMessage(null)}
};
