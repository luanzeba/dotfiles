var hn=Object.create;var B=Object.defineProperty;var Sn=Object.getOwnPropertyDescriptor;var gn=Object.getOwnPropertyNames;var yn=Object.getPrototypeOf,xn=Object.prototype.hasOwnProperty;var Ee=e=>B(e,"__esModule",{value:!0});var c=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports),wn=(e,t)=>{for(var r in t)B(e,r,{get:t[r],enumerable:!0})},Ie=(e,t,r,n)=>{if(t&&typeof t=="object"||typeof t=="function")for(let s of gn(t))!xn.call(e,s)&&(r||s!=="default")&&B(e,s,{get:()=>t[s],enumerable:!(n=Sn(t,s))||n.enumerable});return e},Te=(e,t)=>Ie(Ee(B(e!=null?hn(yn(e)):{},"default",!t&&e&&e.__esModule?{get:()=>e.default,enumerable:!0}:{value:e,enumerable:!0})),e),bn=(e=>(t,r)=>e&&e.get(t)||(r=Ie(Ee({}),t,1),e&&e.set(t,r),r))(typeof WeakMap!="undefined"?new WeakMap:0);var Re=c((bs,Ae)=>{Ae.exports=Ge;Ge.sync=En;var Pe=require("fs");function vn(e,t){var r=t.pathExt!==void 0?t.pathExt:process.env.PATHEXT;if(!r||(r=r.split(";"),r.indexOf("")!==-1))return!0;for(var n=0;n<r.length;n++){var s=r[n].toLowerCase();if(s&&e.substr(-s.length).toLowerCase()===s)return!0}return!1}function Ce(e,t,r){return!e.isSymbolicLink()&&!e.isFile()?!1:vn(t,r)}function Ge(e,t,r){Pe.stat(e,function(n,s){r(n,n?!1:Ce(s,e,t))})}function En(e,t){return Ce(Pe.statSync(e),e,t)}});var $e=c((vs,_e)=>{_e.exports=qe;qe.sync=In;var Oe=require("fs");function qe(e,t,r){Oe.stat(e,function(n,s){r(n,n?!1:Ne(s,t))})}function In(e,t){return Ne(Oe.statSync(e),t)}function Ne(e,t){return e.isFile()&&Tn(e,t)}function Tn(e,t){var r=e.mode,n=e.uid,s=e.gid,o=t.uid!==void 0?t.uid:process.getuid&&process.getuid(),i=t.gid!==void 0?t.gid:process.getgid&&process.getgid(),a=parseInt("100",8),l=parseInt("010",8),d=parseInt("001",8),f=a|l,h=r&d||r&l&&s===i||r&a&&n===o||r&f&&o===0;return h}});var Me=c((Is,ke)=>{var Es=require("fs"),L;process.platform==="win32"||global.TESTING_WINDOWS?L=Re():L=$e();ke.exports=Q;Q.sync=Pn;function Q(e,t,r){if(typeof t=="function"&&(r=t,t={}),!r){if(typeof Promise!="function")throw new TypeError("callback not provided");return new Promise(function(n,s){Q(e,t||{},function(o,i){o?s(o):n(i)})})}L(e,t||{},function(n,s){n&&(n.code==="EACCES"||t&&t.ignoreErrors)&&(n=null,s=!1),r(n,s)})}function Pn(e,t){try{return L.sync(e,t||{})}catch(r){if(t&&t.ignoreErrors||r.code==="EACCES")return!1;throw r}}});var He=c((Ts,De)=>{var E=process.platform==="win32"||process.env.OSTYPE==="cygwin"||process.env.OSTYPE==="msys",Be=require("path"),Cn=E?";":":",Le=Me(),je=e=>Object.assign(new Error(`not found: ${e}`),{code:"ENOENT"}),Ue=(e,t)=>{let r=t.colon||Cn,n=e.match(/\//)||E&&e.match(/\\/)?[""]:[...E?[process.cwd()]:[],...(t.path||process.env.PATH||"").split(r)],s=E?t.pathExt||process.env.PATHEXT||".EXE;.CMD;.BAT;.COM":"",o=E?s.split(r):[""];return E&&e.indexOf(".")!==-1&&o[0]!==""&&o.unshift(""),{pathEnv:n,pathExt:o,pathExtExe:s}},Fe=(e,t,r)=>{typeof t=="function"&&(r=t,t={}),t||(t={});let{pathEnv:n,pathExt:s,pathExtExe:o}=Ue(e,t),i=[],a=d=>new Promise((f,h)=>{if(d===n.length)return t.all&&i.length?f(i):h(je(e));let m=n[d],S=/^".*"$/.test(m)?m.slice(1,-1):m,g=Be.join(S,e),y=!S&&/^\.[\\\/]/.test(e)?e.slice(0,2)+g:g;f(l(y,d,0))}),l=(d,f,h)=>new Promise((m,S)=>{if(h===s.length)return m(a(f+1));let g=s[h];Le(d+g,{pathExt:o},(y,v)=>{if(!y&&v)if(t.all)i.push(d+g);else return m(d+g);return m(l(d,f,h+1))})});return r?a(0).then(d=>r(null,d),r):a(0)},Gn=(e,t)=>{t=t||{};let{pathEnv:r,pathExt:n,pathExtExe:s}=Ue(e,t),o=[];for(let i=0;i<r.length;i++){let a=r[i],l=/^".*"$/.test(a)?a.slice(1,-1):a,d=Be.join(l,e),f=!l&&/^\.[\\\/]/.test(e)?e.slice(0,2)+d:d;for(let h=0;h<n.length;h++){let m=f+n[h];try{if(Le.sync(m,{pathExt:s}))if(t.all)o.push(m);else return m}catch{}}}if(t.all&&o.length)return o;if(t.nothrow)return null;throw je(e)};De.exports=Fe;Fe.sync=Gn});var J=c((Ps,Z)=>{"use strict";var Xe=(e={})=>{let t=e.env||process.env;return(e.platform||process.platform)!=="win32"?"PATH":Object.keys(t).reverse().find(n=>n.toUpperCase()==="PATH")||"Path"};Z.exports=Xe;Z.exports.default=Xe});var Ye=c((Cs,Ve)=>{"use strict";var Ke=require("path"),An=He(),Rn=J();function We(e,t){let r=e.options.env||process.env,n=process.cwd(),s=e.options.cwd!=null,o=s&&process.chdir!==void 0&&!process.chdir.disabled;if(o)try{process.chdir(e.options.cwd)}catch{}let i;try{i=An.sync(e.command,{path:r[Rn({env:r})],pathExt:t?Ke.delimiter:void 0})}catch{}finally{o&&process.chdir(n)}return i&&(i=Ke.resolve(s?e.options.cwd:"",i)),i}function On(e){return We(e)||We(e,!0)}Ve.exports=On});var ze=c((Gs,te)=>{"use strict";var ee=/([()\][%!^"`<>&|;, *?])/g;function qn(e){return e=e.replace(ee,"^$1"),e}function Nn(e,t){return e=`${e}`,e=e.replace(/(\\*)"/g,'$1$1\\"'),e=e.replace(/(\\*)$/,"$1$1"),e=`"${e}"`,e=e.replace(ee,"^$1"),t&&(e=e.replace(ee,"^$1")),e}te.exports.command=qn;te.exports.argument=Nn});var Ze=c((As,Qe)=>{"use strict";Qe.exports=/^#!(.*)/});var et=c((Rs,Je)=>{"use strict";var _n=Ze();Je.exports=(e="")=>{let t=e.match(_n);if(!t)return null;let[r,n]=t[0].replace(/#! ?/,"").split(" "),s=r.split("/").pop();return s==="env"?n:n?`${s} ${n}`:s}});var nt=c((Os,tt)=>{"use strict";var ne=require("fs"),$n=et();function kn(e){let t=150,r=Buffer.alloc(t),n;try{n=ne.openSync(e,"r"),ne.readSync(n,r,0,t,0),ne.closeSync(n)}catch{}return $n(r.toString())}tt.exports=kn});var it=c((qs,ot)=>{"use strict";var Mn=require("path"),rt=Ye(),st=ze(),Bn=nt(),Ln=process.platform==="win32",jn=/\.(?:com|exe)$/i,Un=/node_modules[\\/].bin[\\/][^\\/]+\.cmd$/i;function Fn(e){e.file=rt(e);let t=e.file&&Bn(e.file);return t?(e.args.unshift(e.file),e.command=t,rt(e)):e.file}function Dn(e){if(!Ln)return e;let t=Fn(e),r=!jn.test(t);if(e.options.forceShell||r){let n=Un.test(t);e.command=Mn.normalize(e.command),e.command=st.command(e.command),e.args=e.args.map(o=>st.argument(o,n));let s=[e.command].concat(e.args).join(" ");e.args=["/d","/s","/c",`"${s}"`],e.command=process.env.comspec||"cmd.exe",e.options.windowsVerbatimArguments=!0}return e}function Hn(e,t,r){t&&!Array.isArray(t)&&(r=t,t=null),t=t?t.slice(0):[],r=Object.assign({},r);let n={command:e,args:t,options:r,file:void 0,original:{command:e,args:t}};return r.shell?n:Dn(n)}ot.exports=Hn});var ut=c((Ns,ct)=>{"use strict";var re=process.platform==="win32";function se(e,t){return Object.assign(new Error(`${t} ${e.command} ENOENT`),{code:"ENOENT",errno:"ENOENT",syscall:`${t} ${e.command}`,path:e.command,spawnargs:e.args})}function Xn(e,t){if(!re)return;let r=e.emit;e.emit=function(n,s){if(n==="exit"){let o=at(s,t,"spawn");if(o)return r.call(e,"error",o)}return r.apply(e,arguments)}}function at(e,t){return re&&e===1&&!t.file?se(t.original,"spawn"):null}function Kn(e,t){return re&&e===1&&!t.file?se(t.original,"spawnSync"):null}ct.exports={hookChildProcess:Xn,verifyENOENT:at,verifyENOENTSync:Kn,notFoundError:se}});var ft=c((_s,I)=>{"use strict";var lt=require("child_process"),oe=it(),ie=ut();function dt(e,t,r){let n=oe(e,t,r),s=lt.spawn(n.command,n.args,n.options);return ie.hookChildProcess(s,n),s}function Wn(e,t,r){let n=oe(e,t,r),s=lt.spawnSync(n.command,n.args,n.options);return s.error=s.error||ie.verifyENOENTSync(s.status,n),s}I.exports=dt;I.exports.spawn=dt;I.exports.sync=Wn;I.exports._parse=oe;I.exports._enoent=ie});var mt=c(($s,pt)=>{"use strict";pt.exports=e=>{let t=typeof e=="string"?`
`:`
`.charCodeAt(),r=typeof e=="string"?"\r":"\r".charCodeAt();return e[e.length-1]===t&&(e=e.slice(0,e.length-1)),e[e.length-1]===r&&(e=e.slice(0,e.length-1)),e}});var gt=c((ks,q)=>{"use strict";var O=require("path"),ht=J(),St=e=>{e={cwd:process.cwd(),path:process.env[ht()],execPath:process.execPath,...e};let t,r=O.resolve(e.cwd),n=[];for(;t!==r;)n.push(O.join(r,"node_modules/.bin")),t=r,r=O.resolve(r,"..");let s=O.resolve(e.cwd,e.execPath,"..");return n.push(s),n.concat(e.path).join(O.delimiter)};q.exports=St;q.exports.default=St;q.exports.env=e=>{e={env:process.env,...e};let t={...e.env},r=ht({env:t});return e.path=t[r],t[r]=q.exports(e),t}});var xt=c((Ms,ae)=>{"use strict";var yt=(e,t)=>{for(let r of Reflect.ownKeys(t))Object.defineProperty(e,r,Object.getOwnPropertyDescriptor(t,r));return e};ae.exports=yt;ae.exports.default=yt});var bt=c((Bs,U)=>{"use strict";var Vn=xt(),j=new WeakMap,wt=(e,t={})=>{if(typeof e!="function")throw new TypeError("Expected a function");let r,n=0,s=e.displayName||e.name||"<anonymous>",o=function(...i){if(j.set(o,++n),n===1)r=e.apply(this,i),e=null;else if(t.throw===!0)throw new Error(`Function \`${s}\` can only be called once`);return r};return Vn(o,e),j.set(o,n),o};U.exports=wt;U.exports.default=wt;U.exports.callCount=e=>{if(!j.has(e))throw new Error(`The given function \`${e.name}\` is not wrapped by the \`onetime\` package`);return j.get(e)}});var vt=c(F=>{"use strict";Object.defineProperty(F,"__esModule",{value:!0});F.SIGNALS=void 0;var Yn=[{name:"SIGHUP",number:1,action:"terminate",description:"Terminal closed",standard:"posix"},{name:"SIGINT",number:2,action:"terminate",description:"User interruption with CTRL-C",standard:"ansi"},{name:"SIGQUIT",number:3,action:"core",description:"User interruption with CTRL-\\",standard:"posix"},{name:"SIGILL",number:4,action:"core",description:"Invalid machine instruction",standard:"ansi"},{name:"SIGTRAP",number:5,action:"core",description:"Debugger breakpoint",standard:"posix"},{name:"SIGABRT",number:6,action:"core",description:"Aborted",standard:"ansi"},{name:"SIGIOT",number:6,action:"core",description:"Aborted",standard:"bsd"},{name:"SIGBUS",number:7,action:"core",description:"Bus error due to misaligned, non-existing address or paging error",standard:"bsd"},{name:"SIGEMT",number:7,action:"terminate",description:"Command should be emulated but is not implemented",standard:"other"},{name:"SIGFPE",number:8,action:"core",description:"Floating point arithmetic error",standard:"ansi"},{name:"SIGKILL",number:9,action:"terminate",description:"Forced termination",standard:"posix",forced:!0},{name:"SIGUSR1",number:10,action:"terminate",description:"Application-specific signal",standard:"posix"},{name:"SIGSEGV",number:11,action:"core",description:"Segmentation fault",standard:"ansi"},{name:"SIGUSR2",number:12,action:"terminate",description:"Application-specific signal",standard:"posix"},{name:"SIGPIPE",number:13,action:"terminate",description:"Broken pipe or socket",standard:"posix"},{name:"SIGALRM",number:14,action:"terminate",description:"Timeout or timer",standard:"posix"},{name:"SIGTERM",number:15,action:"terminate",description:"Termination",standard:"ansi"},{name:"SIGSTKFLT",number:16,action:"terminate",description:"Stack is empty or overflowed",standard:"other"},{name:"SIGCHLD",number:17,action:"ignore",description:"Child process terminated, paused or unpaused",standard:"posix"},{name:"SIGCLD",number:17,action:"ignore",description:"Child process terminated, paused or unpaused",standard:"other"},{name:"SIGCONT",number:18,action:"unpause",description:"Unpaused",standard:"posix",forced:!0},{name:"SIGSTOP",number:19,action:"pause",description:"Paused",standard:"posix",forced:!0},{name:"SIGTSTP",number:20,action:"pause",description:'Paused using CTRL-Z or "suspend"',standard:"posix"},{name:"SIGTTIN",number:21,action:"pause",description:"Background process cannot read terminal input",standard:"posix"},{name:"SIGBREAK",number:21,action:"terminate",description:"User interruption with CTRL-BREAK",standard:"other"},{name:"SIGTTOU",number:22,action:"pause",description:"Background process cannot write to terminal output",standard:"posix"},{name:"SIGURG",number:23,action:"ignore",description:"Socket received out-of-band data",standard:"bsd"},{name:"SIGXCPU",number:24,action:"core",description:"Process timed out",standard:"bsd"},{name:"SIGXFSZ",number:25,action:"core",description:"File too big",standard:"bsd"},{name:"SIGVTALRM",number:26,action:"terminate",description:"Timeout or timer",standard:"bsd"},{name:"SIGPROF",number:27,action:"terminate",description:"Timeout or timer",standard:"bsd"},{name:"SIGWINCH",number:28,action:"ignore",description:"Terminal window size changed",standard:"bsd"},{name:"SIGIO",number:29,action:"terminate",description:"I/O is available",standard:"other"},{name:"SIGPOLL",number:29,action:"terminate",description:"Watched event",standard:"other"},{name:"SIGINFO",number:29,action:"ignore",description:"Request for process information",standard:"other"},{name:"SIGPWR",number:30,action:"terminate",description:"Device running out of power",standard:"systemv"},{name:"SIGSYS",number:31,action:"core",description:"Invalid system call",standard:"other"},{name:"SIGUNUSED",number:31,action:"terminate",description:"Invalid system call",standard:"other"}];F.SIGNALS=Yn});var ce=c(T=>{"use strict";Object.defineProperty(T,"__esModule",{value:!0});T.SIGRTMAX=T.getRealtimeSignals=void 0;var zn=function(){let e=It-Et+1;return Array.from({length:e},Qn)};T.getRealtimeSignals=zn;var Qn=function(e,t){return{name:`SIGRT${t+1}`,number:Et+t,action:"terminate",description:"Application-specific signal (realtime)",standard:"posix"}},Et=34,It=64;T.SIGRTMAX=It});var Tt=c(D=>{"use strict";Object.defineProperty(D,"__esModule",{value:!0});D.getSignals=void 0;var Zn=require("os"),Jn=vt(),er=ce(),tr=function(){let e=(0,er.getRealtimeSignals)();return[...Jn.SIGNALS,...e].map(nr)};D.getSignals=tr;var nr=function({name:e,number:t,description:r,action:n,forced:s=!1,standard:o}){let{signals:{[e]:i}}=Zn.constants,a=i!==void 0;return{name:e,number:a?i:t,description:r,supported:a,action:n,forced:s,standard:o}}});var Ct=c(P=>{"use strict";Object.defineProperty(P,"__esModule",{value:!0});P.signalsByNumber=P.signalsByName=void 0;var rr=require("os"),Pt=Tt(),sr=ce(),or=function(){return(0,Pt.getSignals)().reduce(ir,{})},ir=function(e,{name:t,number:r,description:n,supported:s,action:o,forced:i,standard:a}){return{...e,[t]:{name:t,number:r,description:n,supported:s,action:o,forced:i,standard:a}}},ar=or();P.signalsByName=ar;var cr=function(){let e=(0,Pt.getSignals)(),t=sr.SIGRTMAX+1,r=Array.from({length:t},(n,s)=>ur(s,e));return Object.assign({},...r)},ur=function(e,t){let r=lr(e,t);if(r===void 0)return{};let{name:n,description:s,supported:o,action:i,forced:a,standard:l}=r;return{[e]:{name:n,number:e,description:s,supported:o,action:i,forced:a,standard:l}}},lr=function(e,t){let r=t.find(({name:n})=>rr.constants.signals[n]===e);return r!==void 0?r:t.find(n=>n.number===e)},dr=cr();P.signalsByNumber=dr});var At=c((Ds,Gt)=>{"use strict";var{signalsByName:fr}=Ct(),pr=({timedOut:e,timeout:t,errorCode:r,signal:n,signalDescription:s,exitCode:o,isCanceled:i})=>e?`timed out after ${t} milliseconds`:i?"was canceled":r!==void 0?`failed with ${r}`:n!==void 0?`was killed with ${n} (${s})`:o!==void 0?`failed with exit code ${o}`:"failed",mr=({stdout:e,stderr:t,all:r,error:n,signal:s,exitCode:o,command:i,escapedCommand:a,timedOut:l,isCanceled:d,killed:f,parsed:{options:{timeout:h}}})=>{o=o===null?void 0:o,s=s===null?void 0:s;let m=s===void 0?void 0:fr[s].description,S=n&&n.code,y=`Command ${pr({timedOut:l,timeout:h,errorCode:S,signal:s,signalDescription:m,exitCode:o,isCanceled:d})}: ${i}`,v=Object.prototype.toString.call(n)==="[object Error]",k=v?`${y}
${n.message}`:y,M=[k,t,e].filter(Boolean).join(`
`);return v?(n.originalMessage=n.message,n.message=M):n=new Error(M),n.shortMessage=k,n.command=i,n.escapedCommand=a,n.exitCode=o,n.signal=s,n.signalDescription=m,n.stdout=e,n.stderr=t,r!==void 0&&(n.all=r),"bufferedData"in n&&delete n.bufferedData,n.failed=!0,n.timedOut=Boolean(l),n.isCanceled=d,n.killed=f&&!l,n};Gt.exports=mr});var Ot=c((Hs,ue)=>{"use strict";var H=["stdin","stdout","stderr"],hr=e=>H.some(t=>e[t]!==void 0),Rt=e=>{if(!e)return;let{stdio:t}=e;if(t===void 0)return H.map(n=>e[n]);if(hr(e))throw new Error(`It's not possible to provide \`stdio\` in combination with one of ${H.map(n=>`\`${n}\``).join(", ")}`);if(typeof t=="string")return t;if(!Array.isArray(t))throw new TypeError(`Expected \`stdio\` to be of type \`string\` or \`Array\`, got \`${typeof t}\``);let r=Math.max(t.length,H.length);return Array.from({length:r},(n,s)=>t[s])};ue.exports=Rt;ue.exports.node=e=>{let t=Rt(e);return t==="ipc"?"ipc":t===void 0||typeof t=="string"?[t,t,t,"ipc"]:t.includes("ipc")?t:[...t,"ipc"]}});var qt=c((Xs,X)=>{X.exports=["SIGABRT","SIGALRM","SIGHUP","SIGINT","SIGTERM"];process.platform!=="win32"&&X.exports.push("SIGVTALRM","SIGXCPU","SIGXFSZ","SIGUSR2","SIGTRAP","SIGSYS","SIGQUIT","SIGIOT");process.platform==="linux"&&X.exports.push("SIGIO","SIGPOLL","SIGPWR","SIGSTKFLT","SIGUNUSED")});var Mt=c((Ks,A)=>{var u=global.process;typeof u!="object"||!u?A.exports=function(){}:(Nt=require("assert"),C=qt(),_t=/^win/i.test(u.platform),N=require("events"),typeof N!="function"&&(N=N.EventEmitter),u.__signal_exit_emitter__?p=u.__signal_exit_emitter__:(p=u.__signal_exit_emitter__=new N,p.count=0,p.emitted={}),p.infinite||(p.setMaxListeners(1/0),p.infinite=!0),A.exports=function(e,t){if(global.process===u){Nt.equal(typeof e,"function","a callback must be provided for exit handler"),G===!1&&le();var r="exit";t&&t.alwaysLast&&(r="afterexit");var n=function(){p.removeListener(r,e),p.listeners("exit").length===0&&p.listeners("afterexit").length===0&&K()};return p.on(r,e),n}},K=function(){!G||global.process!==u||(G=!1,C.forEach(function(t){try{u.removeListener(t,W[t])}catch{}}),u.emit=V,u.reallyExit=de,p.count-=1)},A.exports.unload=K,b=function(t,r,n){p.emitted[t]||(p.emitted[t]=!0,p.emit(t,r,n))},W={},C.forEach(function(e){W[e]=function(){if(u===global.process){var r=u.listeners(e);r.length===p.count&&(K(),b("exit",null,e),b("afterexit",null,e),_t&&e==="SIGHUP"&&(e="SIGINT"),u.kill(u.pid,e))}}}),A.exports.signals=function(){return C},G=!1,le=function(){G||u!==global.process||(G=!0,p.count+=1,C=C.filter(function(t){try{return u.on(t,W[t]),!0}catch{return!1}}),u.emit=kt,u.reallyExit=$t)},A.exports.load=le,de=u.reallyExit,$t=function(t){u===global.process&&(u.exitCode=t||0,b("exit",u.exitCode,null),b("afterexit",u.exitCode,null),de.call(u,u.exitCode))},V=u.emit,kt=function(t,r){if(t==="exit"&&u===global.process){r!==void 0&&(u.exitCode=r);var n=V.apply(this,arguments);return b("exit",u.exitCode,null),b("afterexit",u.exitCode,null),n}else return V.apply(this,arguments)});var Nt,C,_t,N,p,K,b,W,G,le,de,$t,V,kt});var Lt=c((Ws,Bt)=>{"use strict";var Sr=require("os"),gr=Mt(),yr=1e3*5,xr=(e,t="SIGTERM",r={})=>{let n=e(t);return wr(e,t,r,n),n},wr=(e,t,r,n)=>{if(!br(t,r,n))return;let s=Er(r),o=setTimeout(()=>{e("SIGKILL")},s);o.unref&&o.unref()},br=(e,{forceKillAfterTimeout:t},r)=>vr(e)&&t!==!1&&r,vr=e=>e===Sr.constants.signals.SIGTERM||typeof e=="string"&&e.toUpperCase()==="SIGTERM",Er=({forceKillAfterTimeout:e=!0})=>{if(e===!0)return yr;if(!Number.isFinite(e)||e<0)throw new TypeError(`Expected the \`forceKillAfterTimeout\` option to be a non-negative integer, got \`${e}\` (${typeof e})`);return e},Ir=(e,t)=>{e.kill()&&(t.isCanceled=!0)},Tr=(e,t,r)=>{e.kill(t),r(Object.assign(new Error("Timed out"),{timedOut:!0,signal:t}))},Pr=(e,{timeout:t,killSignal:r="SIGTERM"},n)=>{if(t===0||t===void 0)return n;let s,o=new Promise((a,l)=>{s=setTimeout(()=>{Tr(e,r,l)},t)}),i=n.finally(()=>{clearTimeout(s)});return Promise.race([o,i])},Cr=({timeout:e})=>{if(e!==void 0&&(!Number.isFinite(e)||e<0))throw new TypeError(`Expected the \`timeout\` option to be a non-negative integer, got \`${e}\` (${typeof e})`)},Gr=async(e,{cleanup:t,detached:r},n)=>{if(!t||r)return n;let s=gr(()=>{e.kill()});return n.finally(()=>{s()})};Bt.exports={spawnedKill:xr,spawnedCancel:Ir,setupTimeout:Pr,validateTimeout:Cr,setExitHandler:Gr}});var Ut=c((Vs,jt)=>{"use strict";var x=e=>e!==null&&typeof e=="object"&&typeof e.pipe=="function";x.writable=e=>x(e)&&e.writable!==!1&&typeof e._write=="function"&&typeof e._writableState=="object";x.readable=e=>x(e)&&e.readable!==!1&&typeof e._read=="function"&&typeof e._readableState=="object";x.duplex=e=>x.writable(e)&&x.readable(e);x.transform=e=>x.duplex(e)&&typeof e._transform=="function";jt.exports=x});var Dt=c((Ys,Ft)=>{"use strict";var{PassThrough:Ar}=require("stream");Ft.exports=e=>{e={...e};let{array:t}=e,{encoding:r}=e,n=r==="buffer",s=!1;t?s=!(r||n):r=r||"utf8",n&&(r=null);let o=new Ar({objectMode:s});r&&o.setEncoding(r);let i=0,a=[];return o.on("data",l=>{a.push(l),s?i=a.length:i+=l.length}),o.getBufferedValue=()=>t?a:n?Buffer.concat(a,i):a.join(""),o.getBufferedLength=()=>i,o}});var Ht=c((zs,_)=>{"use strict";var{constants:Rr}=require("buffer"),Or=require("stream"),{promisify:qr}=require("util"),Nr=Dt(),_r=qr(Or.pipeline),fe=class extends Error{constructor(){super("maxBuffer exceeded");this.name="MaxBufferError"}};async function pe(e,t){if(!e)throw new Error("Expected a stream");t={maxBuffer:1/0,...t};let{maxBuffer:r}=t,n=Nr(t);return await new Promise((s,o)=>{let i=a=>{a&&n.getBufferedLength()<=Rr.MAX_LENGTH&&(a.bufferedData=n.getBufferedValue()),o(a)};(async()=>{try{await _r(e,n),s()}catch(a){i(a)}})(),n.on("data",()=>{n.getBufferedLength()>r&&i(new fe)})}),n.getBufferedValue()}_.exports=pe;_.exports.buffer=(e,t)=>pe(e,{...t,encoding:"buffer"});_.exports.array=(e,t)=>pe(e,{...t,array:!0});_.exports.MaxBufferError=fe});var Kt=c((Qs,Xt)=>{"use strict";var{PassThrough:$r}=require("stream");Xt.exports=function(){var e=[],t=new $r({objectMode:!0});return t.setMaxListeners(0),t.add=r,t.isEmpty=n,t.on("unpipe",s),Array.prototype.slice.call(arguments).forEach(r),t;function r(o){return Array.isArray(o)?(o.forEach(r),this):(e.push(o),o.once("end",s.bind(null,o)),o.once("error",t.emit.bind(t,"error")),o.pipe(t,{end:!1}),this)}function n(){return e.length==0}function s(o){e=e.filter(function(i){return i!==o}),!e.length&&t.readable&&t.end()}}});var zt=c((Zs,Yt)=>{"use strict";var Wt=Ut(),Vt=Ht(),kr=Kt(),Mr=(e,t)=>{t===void 0||e.stdin===void 0||(Wt(t)?t.pipe(e.stdin):e.stdin.end(t))},Br=(e,{all:t})=>{if(!t||!e.stdout&&!e.stderr)return;let r=kr();return e.stdout&&r.add(e.stdout),e.stderr&&r.add(e.stderr),r},me=async(e,t)=>{if(!!e){e.destroy();try{return await t}catch(r){return r.bufferedData}}},he=(e,{encoding:t,buffer:r,maxBuffer:n})=>{if(!(!e||!r))return t?Vt(e,{encoding:t,maxBuffer:n}):Vt.buffer(e,{maxBuffer:n})},Lr=async({stdout:e,stderr:t,all:r},{encoding:n,buffer:s,maxBuffer:o},i)=>{let a=he(e,{encoding:n,buffer:s,maxBuffer:o}),l=he(t,{encoding:n,buffer:s,maxBuffer:o}),d=he(r,{encoding:n,buffer:s,maxBuffer:o*2});try{return await Promise.all([i,a,l,d])}catch(f){return Promise.all([{error:f,signal:f.signal,timedOut:f.timedOut},me(e,a),me(t,l),me(r,d)])}},jr=({input:e})=>{if(Wt(e))throw new TypeError("The `input` option cannot be a stream in sync mode")};Yt.exports={handleInput:Mr,makeAllStream:Br,getSpawnedResult:Lr,validateInputSync:jr}});var Zt=c((Js,Qt)=>{"use strict";var Ur=(async()=>{})().constructor.prototype,Fr=["then","catch","finally"].map(e=>[e,Reflect.getOwnPropertyDescriptor(Ur,e)]),Dr=(e,t)=>{for(let[r,n]of Fr){let s=typeof t=="function"?(...o)=>Reflect.apply(n.value,t(),o):n.value.bind(t);Reflect.defineProperty(e,r,{...n,value:s})}return e},Hr=e=>new Promise((t,r)=>{e.on("exit",(n,s)=>{t({exitCode:n,signal:s})}),e.on("error",n=>{r(n)}),e.stdin&&e.stdin.on("error",n=>{r(n)})});Qt.exports={mergePromise:Dr,getSpawnedPromise:Hr}});var tn=c((eo,en)=>{"use strict";var Jt=(e,t=[])=>Array.isArray(t)?[e,...t]:[e],Xr=/^[\w.-]+$/,Kr=/"/g,Wr=e=>typeof e!="string"||Xr.test(e)?e:`"${e.replace(Kr,'\\"')}"`,Vr=(e,t)=>Jt(e,t).join(" "),Yr=(e,t)=>Jt(e,t).map(r=>Wr(r)).join(" "),zr=/ +/g,Qr=e=>{let t=[];for(let r of e.trim().split(zr)){let n=t[t.length-1];n&&n.endsWith("\\")?t[t.length-1]=`${n.slice(0,-1)} ${r}`:t.push(r)}return t};en.exports={joinCommand:Vr,getEscapedCommand:Yr,parseCommand:Qr}});var un=c((to,R)=>{"use strict";var Zr=require("path"),Se=require("child_process"),Jr=ft(),es=mt(),ts=gt(),ns=bt(),Y=At(),nn=Ot(),{spawnedKill:rs,spawnedCancel:ss,setupTimeout:os,validateTimeout:is,setExitHandler:as}=Lt(),{handleInput:cs,getSpawnedResult:us,makeAllStream:ls,validateInputSync:ds}=zt(),{mergePromise:rn,getSpawnedPromise:fs}=Zt(),{joinCommand:sn,parseCommand:on,getEscapedCommand:an}=tn(),ps=1e3*1e3*100,ms=({env:e,extendEnv:t,preferLocal:r,localDir:n,execPath:s})=>{let o=t?{...process.env,...e}:e;return r?ts.env({env:o,cwd:n,execPath:s}):o},cn=(e,t,r={})=>{let n=Jr._parse(e,t,r);return e=n.command,t=n.args,r=n.options,r={maxBuffer:ps,buffer:!0,stripFinalNewline:!0,extendEnv:!0,preferLocal:!1,localDir:r.cwd||process.cwd(),execPath:process.execPath,encoding:"utf8",reject:!0,cleanup:!0,all:!1,windowsHide:!0,...r},r.env=ms(r),r.stdio=nn(r),process.platform==="win32"&&Zr.basename(e,".exe")==="cmd"&&t.unshift("/q"),{file:e,args:t,options:r,parsed:n}},$=(e,t,r)=>typeof t!="string"&&!Buffer.isBuffer(t)?r===void 0?void 0:"":e.stripFinalNewline?es(t):t,z=(e,t,r)=>{let n=cn(e,t,r),s=sn(e,t),o=an(e,t);is(n.options);let i;try{i=Se.spawn(n.file,n.args,n.options)}catch(S){let g=new Se.ChildProcess,y=Promise.reject(Y({error:S,stdout:"",stderr:"",all:"",command:s,escapedCommand:o,parsed:n,timedOut:!1,isCanceled:!1,killed:!1}));return rn(g,y)}let a=fs(i),l=os(i,n.options,a),d=as(i,n.options,l),f={isCanceled:!1};i.kill=rs.bind(null,i.kill.bind(i)),i.cancel=ss.bind(null,i,f);let m=ns(async()=>{let[{error:S,exitCode:g,signal:y,timedOut:v},k,M,mn]=await us(i,n.options,d),xe=$(n.options,k),we=$(n.options,M),be=$(n.options,mn);if(S||g!==0||y!==null){let ve=Y({error:S,exitCode:g,signal:y,stdout:xe,stderr:we,all:be,command:s,escapedCommand:o,parsed:n,timedOut:v,isCanceled:f.isCanceled,killed:i.killed});if(!n.options.reject)return ve;throw ve}return{command:s,escapedCommand:o,exitCode:0,stdout:xe,stderr:we,all:be,failed:!1,timedOut:!1,isCanceled:!1,killed:!1}});return cs(i,n.options.input),i.all=ls(i,n.options),rn(i,m)};R.exports=z;R.exports.sync=(e,t,r)=>{let n=cn(e,t,r),s=sn(e,t),o=an(e,t);ds(n.options);let i;try{i=Se.spawnSync(n.file,n.args,n.options)}catch(d){throw Y({error:d,stdout:"",stderr:"",all:"",command:s,escapedCommand:o,parsed:n,timedOut:!1,isCanceled:!1,killed:!1})}let a=$(n.options,i.stdout,i.error),l=$(n.options,i.stderr,i.error);if(i.error||i.status!==0||i.signal!==null){let d=Y({stdout:a,stderr:l,error:i.error,signal:i.signal,exitCode:i.status,command:s,escapedCommand:o,parsed:n,timedOut:i.error&&i.error.code==="ETIMEDOUT",isCanceled:!1,killed:i.signal!==null});if(!n.options.reject)return d;throw d}return{command:s,escapedCommand:o,exitCode:0,stdout:a,stderr:l,failed:!1,timedOut:!1,isCanceled:!1,killed:!1}};R.exports.command=(e,t)=>{let[r,...n]=on(e);return z(r,n,t)};R.exports.commandSync=(e,t)=>{let[r,...n]=on(e);return z.sync(r,n,t)};R.exports.node=(e,t,r={})=>{t&&!Array.isArray(t)&&typeof t=="object"&&(r=t,t=[]);let n=nn.node(r),s=process.execArgv.filter(a=>!a.startsWith("--inspect")),{nodePath:o=process.execPath,nodeOptions:i=s}=r;return z(o,[...i,e,...Array.isArray(t)?t:[]],{...r,stdin:void 0,stdout:void 0,stderr:void 0,stdio:n,shell:!1})}});var xs={};wn(xs,{default:()=>ys});var ln=Te(require("process"),1),dn=Te(un(),1);async function w(e){if(ln.default.platform!=="darwin")throw new Error("macOS only");let{stdout:t}=await(0,dn.default)("osascript",["-e",e]);return t}var ge=require("@raycast/api");var hs=async e=>{try{await w('do shell script "pgrep caffeinate"'),await(0,ge.showHUD)("Your Mac is already caffeinated")}catch{w(`do shell script "caffeinate -di${e||""}"`),await(0,ge.showHUD)("Your Mac is caffeinated")}},fn=hs;var ye=require("@raycast/api");var Ss=async()=>{try{await w('do shell script "pgrep caffeinate"'),await w('do shell script "killall caffeinate"'),await(0,ye.showHUD)("Your Mac is decaffeinated")}catch{await(0,ye.showHUD)("Your Mac is already decaffeinated")}},pn=Ss;var gs=async()=>{try{await w('do shell script "pgrep caffeinate"'),await pn()}catch{await fn()}},ys=gs;module.exports=bn(xs);0&&(module.exports={});
