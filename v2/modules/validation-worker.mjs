import {runValidation} from './analysis.mjs';
self.onmessage = event => { try { self.postMessage({ok:true,result:runValidation(event.data)}); } catch(error) { self.postMessage({ok:false,error:error.message}); } };
