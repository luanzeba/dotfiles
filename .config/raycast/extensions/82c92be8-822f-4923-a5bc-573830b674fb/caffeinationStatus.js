var fn=Object.create;var B=Object.defineProperty;var pn=Object.getOwnPropertyDescriptor;var mn=Object.getOwnPropertyNames;var hn=Object.getPrototypeOf,Sn=Object.prototype.hasOwnProperty;var we=e=>B(e,"__esModule",{value:!0});var c=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports),gn=(e,t)=>{for(var r in t)B(e,r,{get:t[r],enumerable:!0})},ve=(e,t,r,n)=>{if(t&&typeof t=="object"||typeof t=="function")for(let s of mn(t))!Sn.call(e,s)&&(r||s!=="default")&&B(e,s,{get:()=>t[s],enumerable:!(n=pn(t,s))||n.enumerable});return e},Ee=(e,t)=>ve(we(B(e!=null?fn(hn(e)):{},"default",!t&&e&&e.__esModule?{get:()=>e.default,enumerable:!0}:{value:e,enumerable:!0})),e),xn=(e=>(t,r)=>e&&e.get(t)||(r=ve(we({}),t,1),e&&e.set(t,r),r))(typeof WeakMap!="undefined"?new WeakMap:0);var Ce=c((Ss,Ge)=>{Ge.exports=Pe;Pe.sync=bn;var Ie=require("fs");function yn(e,t){var r=t.pathExt!==void 0?t.pathExt:process.env.PATHEXT;if(!r||(r=r.split(";"),r.indexOf("")!==-1))return!0;for(var n=0;n<r.length;n++){var s=r[n].toLowerCase();if(s&&e.substr(-s.length).toLowerCase()===s)return!0}return!1}function Te(e,t,r){return!e.isSymbolicLink()&&!e.isFile()?!1:yn(t,r)}function Pe(e,t,r){Ie.stat(e,function(n,s){r(n,n?!1:Te(s,e,t))})}function bn(e,t){return Te(Ie.statSync(e),e,t)}});var Ne=c((gs,qe)=>{qe.exports=Re;Re.sync=wn;var Ae=require("fs");function Re(e,t,r){Ae.stat(e,function(n,s){r(n,n?!1:Oe(s,t))})}function wn(e,t){return Oe(Ae.statSync(e),t)}function Oe(e,t){return e.isFile()&&vn(e,t)}function vn(e,t){var r=e.mode,n=e.uid,s=e.gid,o=t.uid!==void 0?t.uid:process.getuid&&process.getuid(),i=t.gid!==void 0?t.gid:process.getgid&&process.getgid(),a=parseInt("100",8),d=parseInt("010",8),l=parseInt("001",8),f=a|d,h=r&l||r&d&&s===i||r&a&&n===o||r&f&&o===0;return h}});var $e=c((ys,_e)=>{var xs=require("fs"),L;process.platform==="win32"||global.TESTING_WINDOWS?L=Ce():L=Ne();_e.exports=Y;Y.sync=En;function Y(e,t,r){if(typeof t=="function"&&(r=t,t={}),!r){if(typeof Promise!="function")throw new TypeError("callback not provided");return new Promise(function(n,s){Y(e,t||{},function(o,i){o?s(o):n(i)})})}L(e,t||{},function(n,s){n&&(n.code==="EACCES"||t&&t.ignoreErrors)&&(n=null,s=!1),r(n,s)})}function En(e,t){try{return L.sync(e,t||{})}catch(r){if(t&&t.ignoreErrors||r.code==="EACCES")return!1;throw r}}});var Ue=c((bs,Fe)=>{var v=process.platform==="win32"||process.env.OSTYPE==="cygwin"||process.env.OSTYPE==="msys",ke=require("path"),In=v?";":":",Be=$e(),Le=e=>Object.assign(new Error(`not found: ${e}`),{code:"ENOENT"}),Me=(e,t)=>{let r=t.colon||In,n=e.match(/\//)||v&&e.match(/\\/)?[""]:[...v?[process.cwd()]:[],...(t.path||process.env.PATH||"").split(r)],s=v?t.pathExt||process.env.PATHEXT||".EXE;.CMD;.BAT;.COM":"",o=v?s.split(r):[""];return v&&e.indexOf(".")!==-1&&o[0]!==""&&o.unshift(""),{pathEnv:n,pathExt:o,pathExtExe:s}},je=(e,t,r)=>{typeof t=="function"&&(r=t,t={}),t||(t={});let{pathEnv:n,pathExt:s,pathExtExe:o}=Me(e,t),i=[],a=l=>new Promise((f,h)=>{if(l===n.length)return t.all&&i.length?f(i):h(Le(e));let m=n[l],S=/^".*"$/.test(m)?m.slice(1,-1):m,g=ke.join(S,e),x=!S&&/^\.[\\\/]/.test(e)?e.slice(0,2)+g:g;f(d(x,l,0))}),d=(l,f,h)=>new Promise((m,S)=>{if(h===s.length)return m(a(f+1));let g=s[h];Be(l+g,{pathExt:o},(x,w)=>{if(!x&&w)if(t.all)i.push(l+g);else return m(l+g);return m(d(l,f,h+1))})});return r?a(0).then(l=>r(null,l),r):a(0)},Tn=(e,t)=>{t=t||{};let{pathEnv:r,pathExt:n,pathExtExe:s}=Me(e,t),o=[];for(let i=0;i<r.length;i++){let a=r[i],d=/^".*"$/.test(a)?a.slice(1,-1):a,l=ke.join(d,e),f=!d&&/^\.[\\\/]/.test(e)?e.slice(0,2)+l:l;for(let h=0;h<n.length;h++){let m=f+n[h];try{if(Be.sync(m,{pathExt:s}))if(t.all)o.push(m);else return m}catch{}}}if(t.all&&o.length)return o;if(t.nothrow)return null;throw Le(e)};Fe.exports=je;je.sync=Tn});var Z=c((ws,Q)=>{"use strict";var De=(e={})=>{let t=e.env||process.env;return(e.platform||process.platform)!=="win32"?"PATH":Object.keys(t).reverse().find(n=>n.toUpperCase()==="PATH")||"Path"};Q.exports=De;Q.exports.default=De});var We=c((vs,Ke)=>{"use strict";var He=require("path"),Pn=Ue(),Gn=Z();function Xe(e,t){let r=e.options.env||process.env,n=process.cwd(),s=e.options.cwd!=null,o=s&&process.chdir!==void 0&&!process.chdir.disabled;if(o)try{process.chdir(e.options.cwd)}catch{}let i;try{i=Pn.sync(e.command,{path:r[Gn({env:r})],pathExt:t?He.delimiter:void 0})}catch{}finally{o&&process.chdir(n)}return i&&(i=He.resolve(s?e.options.cwd:"",i)),i}function Cn(e){return Xe(e)||Xe(e,!0)}Ke.exports=Cn});var Ve=c((Es,ee)=>{"use strict";var J=/([()\][%!^"`<>&|;, *?])/g;function An(e){return e=e.replace(J,"^$1"),e}function Rn(e,t){return e=`${e}`,e=e.replace(/(\\*)"/g,'$1$1\\"'),e=e.replace(/(\\*)$/,"$1$1"),e=`"${e}"`,e=e.replace(J,"^$1"),t&&(e=e.replace(J,"^$1")),e}ee.exports.command=An;ee.exports.argument=Rn});var Ye=c((Is,ze)=>{"use strict";ze.exports=/^#!(.*)/});var Ze=c((Ts,Qe)=>{"use strict";var On=Ye();Qe.exports=(e="")=>{let t=e.match(On);if(!t)return null;let[r,n]=t[0].replace(/#! ?/,"").split(" "),s=r.split("/").pop();return s==="env"?n:n?`${s} ${n}`:s}});var et=c((Ps,Je)=>{"use strict";var te=require("fs"),qn=Ze();function Nn(e){let t=150,r=Buffer.alloc(t),n;try{n=te.openSync(e,"r"),te.readSync(n,r,0,t,0),te.closeSync(n)}catch{}return qn(r.toString())}Je.exports=Nn});var st=c((Gs,rt)=>{"use strict";var _n=require("path"),tt=We(),nt=Ve(),$n=et(),kn=process.platform==="win32",Bn=/\.(?:com|exe)$/i,Ln=/node_modules[\\/].bin[\\/][^\\/]+\.cmd$/i;function Mn(e){e.file=tt(e);let t=e.file&&$n(e.file);return t?(e.args.unshift(e.file),e.command=t,tt(e)):e.file}function jn(e){if(!kn)return e;let t=Mn(e),r=!Bn.test(t);if(e.options.forceShell||r){let n=Ln.test(t);e.command=_n.normalize(e.command),e.command=nt.command(e.command),e.args=e.args.map(o=>nt.argument(o,n));let s=[e.command].concat(e.args).join(" ");e.args=["/d","/s","/c",`"${s}"`],e.command=process.env.comspec||"cmd.exe",e.options.windowsVerbatimArguments=!0}return e}function Fn(e,t,r){t&&!Array.isArray(t)&&(r=t,t=null),t=t?t.slice(0):[],r=Object.assign({},r);let n={command:e,args:t,options:r,file:void 0,original:{command:e,args:t}};return r.shell?n:jn(n)}rt.exports=Fn});var at=c((Cs,it)=>{"use strict";var ne=process.platform==="win32";function re(e,t){return Object.assign(new Error(`${t} ${e.command} ENOENT`),{code:"ENOENT",errno:"ENOENT",syscall:`${t} ${e.command}`,path:e.command,spawnargs:e.args})}function Un(e,t){if(!ne)return;let r=e.emit;e.emit=function(n,s){if(n==="exit"){let o=ot(s,t,"spawn");if(o)return r.call(e,"error",o)}return r.apply(e,arguments)}}function ot(e,t){return ne&&e===1&&!t.file?re(t.original,"spawn"):null}function Dn(e,t){return ne&&e===1&&!t.file?re(t.original,"spawnSync"):null}it.exports={hookChildProcess:Un,verifyENOENT:ot,verifyENOENTSync:Dn,notFoundError:re}});var dt=c((As,E)=>{"use strict";var ct=require("child_process"),se=st(),oe=at();function ut(e,t,r){let n=se(e,t,r),s=ct.spawn(n.command,n.args,n.options);return oe.hookChildProcess(s,n),s}function Hn(e,t,r){let n=se(e,t,r),s=ct.spawnSync(n.command,n.args,n.options);return s.error=s.error||oe.verifyENOENTSync(s.status,n),s}E.exports=ut;E.exports.spawn=ut;E.exports.sync=Hn;E.exports._parse=se;E.exports._enoent=oe});var ft=c((Rs,lt)=>{"use strict";lt.exports=e=>{let t=typeof e=="string"?`
`:`
`.charCodeAt(),r=typeof e=="string"?"\r":"\r".charCodeAt();return e[e.length-1]===t&&(e=e.slice(0,e.length-1)),e[e.length-1]===r&&(e=e.slice(0,e.length-1)),e}});var ht=c((Os,O)=>{"use strict";var R=require("path"),pt=Z(),mt=e=>{e={cwd:process.cwd(),path:process.env[pt()],execPath:process.execPath,...e};let t,r=R.resolve(e.cwd),n=[];for(;t!==r;)n.push(R.join(r,"node_modules/.bin")),t=r,r=R.resolve(r,"..");let s=R.resolve(e.cwd,e.execPath,"..");return n.push(s),n.concat(e.path).join(R.delimiter)};O.exports=mt;O.exports.default=mt;O.exports.env=e=>{e={env:process.env,...e};let t={...e.env},r=pt({env:t});return e.path=t[r],t[r]=O.exports(e),t}});var gt=c((qs,ie)=>{"use strict";var St=(e,t)=>{for(let r of Reflect.ownKeys(t))Object.defineProperty(e,r,Object.getOwnPropertyDescriptor(t,r));return e};ie.exports=St;ie.exports.default=St});var yt=c((Ns,j)=>{"use strict";var Xn=gt(),M=new WeakMap,xt=(e,t={})=>{if(typeof e!="function")throw new TypeError("Expected a function");let r,n=0,s=e.displayName||e.name||"<anonymous>",o=function(...i){if(M.set(o,++n),n===1)r=e.apply(this,i),e=null;else if(t.throw===!0)throw new Error(`Function \`${s}\` can only be called once`);return r};return Xn(o,e),M.set(o,n),o};j.exports=xt;j.exports.default=xt;j.exports.callCount=e=>{if(!M.has(e))throw new Error(`The given function \`${e.name}\` is not wrapped by the \`onetime\` package`);return M.get(e)}});var bt=c(F=>{"use strict";Object.defineProperty(F,"__esModule",{value:!0});F.SIGNALS=void 0;var Kn=[{name:"SIGHUP",number:1,action:"terminate",description:"Terminal closed",standard:"posix"},{name:"SIGINT",number:2,action:"terminate",description:"User interruption with CTRL-C",standard:"ansi"},{name:"SIGQUIT",number:3,action:"core",description:"User interruption with CTRL-\\",standard:"posix"},{name:"SIGILL",number:4,action:"core",description:"Invalid machine instruction",standard:"ansi"},{name:"SIGTRAP",number:5,action:"core",description:"Debugger breakpoint",standard:"posix"},{name:"SIGABRT",number:6,action:"core",description:"Aborted",standard:"ansi"},{name:"SIGIOT",number:6,action:"core",description:"Aborted",standard:"bsd"},{name:"SIGBUS",number:7,action:"core",description:"Bus error due to misaligned, non-existing address or paging error",standard:"bsd"},{name:"SIGEMT",number:7,action:"terminate",description:"Command should be emulated but is not implemented",standard:"other"},{name:"SIGFPE",number:8,action:"core",description:"Floating point arithmetic error",standard:"ansi"},{name:"SIGKILL",number:9,action:"terminate",description:"Forced termination",standard:"posix",forced:!0},{name:"SIGUSR1",number:10,action:"terminate",description:"Application-specific signal",standard:"posix"},{name:"SIGSEGV",number:11,action:"core",description:"Segmentation fault",standard:"ansi"},{name:"SIGUSR2",number:12,action:"terminate",description:"Application-specific signal",standard:"posix"},{name:"SIGPIPE",number:13,action:"terminate",description:"Broken pipe or socket",standard:"posix"},{name:"SIGALRM",number:14,action:"terminate",description:"Timeout or timer",standard:"posix"},{name:"SIGTERM",number:15,action:"terminate",description:"Termination",standard:"ansi"},{name:"SIGSTKFLT",number:16,action:"terminate",description:"Stack is empty or overflowed",standard:"other"},{name:"SIGCHLD",number:17,action:"ignore",description:"Child process terminated, paused or unpaused",standard:"posix"},{name:"SIGCLD",number:17,action:"ignore",description:"Child process terminated, paused or unpaused",standard:"other"},{name:"SIGCONT",number:18,action:"unpause",description:"Unpaused",standard:"posix",forced:!0},{name:"SIGSTOP",number:19,action:"pause",description:"Paused",standard:"posix",forced:!0},{name:"SIGTSTP",number:20,action:"pause",description:'Paused using CTRL-Z or "suspend"',standard:"posix"},{name:"SIGTTIN",number:21,action:"pause",description:"Background process cannot read terminal input",standard:"posix"},{name:"SIGBREAK",number:21,action:"terminate",description:"User interruption with CTRL-BREAK",standard:"other"},{name:"SIGTTOU",number:22,action:"pause",description:"Background process cannot write to terminal output",standard:"posix"},{name:"SIGURG",number:23,action:"ignore",description:"Socket received out-of-band data",standard:"bsd"},{name:"SIGXCPU",number:24,action:"core",description:"Process timed out",standard:"bsd"},{name:"SIGXFSZ",number:25,action:"core",description:"File too big",standard:"bsd"},{name:"SIGVTALRM",number:26,action:"terminate",description:"Timeout or timer",standard:"bsd"},{name:"SIGPROF",number:27,action:"terminate",description:"Timeout or timer",standard:"bsd"},{name:"SIGWINCH",number:28,action:"ignore",description:"Terminal window size changed",standard:"bsd"},{name:"SIGIO",number:29,action:"terminate",description:"I/O is available",standard:"other"},{name:"SIGPOLL",number:29,action:"terminate",description:"Watched event",standard:"other"},{name:"SIGINFO",number:29,action:"ignore",description:"Request for process information",standard:"other"},{name:"SIGPWR",number:30,action:"terminate",description:"Device running out of power",standard:"systemv"},{name:"SIGSYS",number:31,action:"core",description:"Invalid system call",standard:"other"},{name:"SIGUNUSED",number:31,action:"terminate",description:"Invalid system call",standard:"other"}];F.SIGNALS=Kn});var ae=c(I=>{"use strict";Object.defineProperty(I,"__esModule",{value:!0});I.SIGRTMAX=I.getRealtimeSignals=void 0;var Wn=function(){let e=vt-wt+1;return Array.from({length:e},Vn)};I.getRealtimeSignals=Wn;var Vn=function(e,t){return{name:`SIGRT${t+1}`,number:wt+t,action:"terminate",description:"Application-specific signal (realtime)",standard:"posix"}},wt=34,vt=64;I.SIGRTMAX=vt});var Et=c(U=>{"use strict";Object.defineProperty(U,"__esModule",{value:!0});U.getSignals=void 0;var zn=require("os"),Yn=bt(),Qn=ae(),Zn=function(){let e=(0,Qn.getRealtimeSignals)();return[...Yn.SIGNALS,...e].map(Jn)};U.getSignals=Zn;var Jn=function({name:e,number:t,description:r,action:n,forced:s=!1,standard:o}){let{signals:{[e]:i}}=zn.constants,a=i!==void 0;return{name:e,number:a?i:t,description:r,supported:a,action:n,forced:s,standard:o}}});var Tt=c(T=>{"use strict";Object.defineProperty(T,"__esModule",{value:!0});T.signalsByNumber=T.signalsByName=void 0;var er=require("os"),It=Et(),tr=ae(),nr=function(){return(0,It.getSignals)().reduce(rr,{})},rr=function(e,{name:t,number:r,description:n,supported:s,action:o,forced:i,standard:a}){return{...e,[t]:{name:t,number:r,description:n,supported:s,action:o,forced:i,standard:a}}},sr=nr();T.signalsByName=sr;var or=function(){let e=(0,It.getSignals)(),t=tr.SIGRTMAX+1,r=Array.from({length:t},(n,s)=>ir(s,e));return Object.assign({},...r)},ir=function(e,t){let r=ar(e,t);if(r===void 0)return{};let{name:n,description:s,supported:o,action:i,forced:a,standard:d}=r;return{[e]:{name:n,number:e,description:s,supported:o,action:i,forced:a,standard:d}}},ar=function(e,t){let r=t.find(({name:n})=>er.constants.signals[n]===e);return r!==void 0?r:t.find(n=>n.number===e)},cr=or();T.signalsByNumber=cr});var Gt=c((Ls,Pt)=>{"use strict";var{signalsByName:ur}=Tt(),dr=({timedOut:e,timeout:t,errorCode:r,signal:n,signalDescription:s,exitCode:o,isCanceled:i})=>e?`timed out after ${t} milliseconds`:i?"was canceled":r!==void 0?`failed with ${r}`:n!==void 0?`was killed with ${n} (${s})`:o!==void 0?`failed with exit code ${o}`:"failed",lr=({stdout:e,stderr:t,all:r,error:n,signal:s,exitCode:o,command:i,escapedCommand:a,timedOut:d,isCanceled:l,killed:f,parsed:{options:{timeout:h}}})=>{o=o===null?void 0:o,s=s===null?void 0:s;let m=s===void 0?void 0:ur[s].description,S=n&&n.code,x=`Command ${dr({timedOut:d,timeout:h,errorCode:S,signal:s,signalDescription:m,exitCode:o,isCanceled:l})}: ${i}`,w=Object.prototype.toString.call(n)==="[object Error]",$=w?`${x}
${n.message}`:x,k=[$,t,e].filter(Boolean).join(`
`);return w?(n.originalMessage=n.message,n.message=k):n=new Error(k),n.shortMessage=$,n.command=i,n.escapedCommand=a,n.exitCode=o,n.signal=s,n.signalDescription=m,n.stdout=e,n.stderr=t,r!==void 0&&(n.all=r),"bufferedData"in n&&delete n.bufferedData,n.failed=!0,n.timedOut=Boolean(d),n.isCanceled=l,n.killed=f&&!d,n};Pt.exports=lr});var At=c((Ms,ce)=>{"use strict";var D=["stdin","stdout","stderr"],fr=e=>D.some(t=>e[t]!==void 0),Ct=e=>{if(!e)return;let{stdio:t}=e;if(t===void 0)return D.map(n=>e[n]);if(fr(e))throw new Error(`It's not possible to provide \`stdio\` in combination with one of ${D.map(n=>`\`${n}\``).join(", ")}`);if(typeof t=="string")return t;if(!Array.isArray(t))throw new TypeError(`Expected \`stdio\` to be of type \`string\` or \`Array\`, got \`${typeof t}\``);let r=Math.max(t.length,D.length);return Array.from({length:r},(n,s)=>t[s])};ce.exports=Ct;ce.exports.node=e=>{let t=Ct(e);return t==="ipc"?"ipc":t===void 0||typeof t=="string"?[t,t,t,"ipc"]:t.includes("ipc")?t:[...t,"ipc"]}});var Rt=c((js,H)=>{H.exports=["SIGABRT","SIGALRM","SIGHUP","SIGINT","SIGTERM"];process.platform!=="win32"&&H.exports.push("SIGVTALRM","SIGXCPU","SIGXFSZ","SIGUSR2","SIGTRAP","SIGSYS","SIGQUIT","SIGIOT");process.platform==="linux"&&H.exports.push("SIGIO","SIGPOLL","SIGPWR","SIGSTKFLT","SIGUNUSED")});var $t=c((Fs,C)=>{var u=global.process;typeof u!="object"||!u?C.exports=function(){}:(Ot=require("assert"),P=Rt(),qt=/^win/i.test(u.platform),q=require("events"),typeof q!="function"&&(q=q.EventEmitter),u.__signal_exit_emitter__?p=u.__signal_exit_emitter__:(p=u.__signal_exit_emitter__=new q,p.count=0,p.emitted={}),p.infinite||(p.setMaxListeners(1/0),p.infinite=!0),C.exports=function(e,t){if(global.process===u){Ot.equal(typeof e,"function","a callback must be provided for exit handler"),G===!1&&ue();var r="exit";t&&t.alwaysLast&&(r="afterexit");var n=function(){p.removeListener(r,e),p.listeners("exit").length===0&&p.listeners("afterexit").length===0&&X()};return p.on(r,e),n}},X=function(){!G||global.process!==u||(G=!1,P.forEach(function(t){try{u.removeListener(t,K[t])}catch{}}),u.emit=W,u.reallyExit=de,p.count-=1)},C.exports.unload=X,b=function(t,r,n){p.emitted[t]||(p.emitted[t]=!0,p.emit(t,r,n))},K={},P.forEach(function(e){K[e]=function(){if(u===global.process){var r=u.listeners(e);r.length===p.count&&(X(),b("exit",null,e),b("afterexit",null,e),qt&&e==="SIGHUP"&&(e="SIGINT"),u.kill(u.pid,e))}}}),C.exports.signals=function(){return P},G=!1,ue=function(){G||u!==global.process||(G=!0,p.count+=1,P=P.filter(function(t){try{return u.on(t,K[t]),!0}catch{return!1}}),u.emit=_t,u.reallyExit=Nt)},C.exports.load=ue,de=u.reallyExit,Nt=function(t){u===global.process&&(u.exitCode=t||0,b("exit",u.exitCode,null),b("afterexit",u.exitCode,null),de.call(u,u.exitCode))},W=u.emit,_t=function(t,r){if(t==="exit"&&u===global.process){r!==void 0&&(u.exitCode=r);var n=W.apply(this,arguments);return b("exit",u.exitCode,null),b("afterexit",u.exitCode,null),n}else return W.apply(this,arguments)});var Ot,P,qt,q,p,X,b,K,G,ue,de,Nt,W,_t});var Bt=c((Us,kt)=>{"use strict";var pr=require("os"),mr=$t(),hr=1e3*5,Sr=(e,t="SIGTERM",r={})=>{let n=e(t);return gr(e,t,r,n),n},gr=(e,t,r,n)=>{if(!xr(t,r,n))return;let s=br(r),o=setTimeout(()=>{e("SIGKILL")},s);o.unref&&o.unref()},xr=(e,{forceKillAfterTimeout:t},r)=>yr(e)&&t!==!1&&r,yr=e=>e===pr.constants.signals.SIGTERM||typeof e=="string"&&e.toUpperCase()==="SIGTERM",br=({forceKillAfterTimeout:e=!0})=>{if(e===!0)return hr;if(!Number.isFinite(e)||e<0)throw new TypeError(`Expected the \`forceKillAfterTimeout\` option to be a non-negative integer, got \`${e}\` (${typeof e})`);return e},wr=(e,t)=>{e.kill()&&(t.isCanceled=!0)},vr=(e,t,r)=>{e.kill(t),r(Object.assign(new Error("Timed out"),{timedOut:!0,signal:t}))},Er=(e,{timeout:t,killSignal:r="SIGTERM"},n)=>{if(t===0||t===void 0)return n;let s,o=new Promise((a,d)=>{s=setTimeout(()=>{vr(e,r,d)},t)}),i=n.finally(()=>{clearTimeout(s)});return Promise.race([o,i])},Ir=({timeout:e})=>{if(e!==void 0&&(!Number.isFinite(e)||e<0))throw new TypeError(`Expected the \`timeout\` option to be a non-negative integer, got \`${e}\` (${typeof e})`)},Tr=async(e,{cleanup:t,detached:r},n)=>{if(!t||r)return n;let s=mr(()=>{e.kill()});return n.finally(()=>{s()})};kt.exports={spawnedKill:Sr,spawnedCancel:wr,setupTimeout:Er,validateTimeout:Ir,setExitHandler:Tr}});var Mt=c((Ds,Lt)=>{"use strict";var y=e=>e!==null&&typeof e=="object"&&typeof e.pipe=="function";y.writable=e=>y(e)&&e.writable!==!1&&typeof e._write=="function"&&typeof e._writableState=="object";y.readable=e=>y(e)&&e.readable!==!1&&typeof e._read=="function"&&typeof e._readableState=="object";y.duplex=e=>y.writable(e)&&y.readable(e);y.transform=e=>y.duplex(e)&&typeof e._transform=="function";Lt.exports=y});var Ft=c((Hs,jt)=>{"use strict";var{PassThrough:Pr}=require("stream");jt.exports=e=>{e={...e};let{array:t}=e,{encoding:r}=e,n=r==="buffer",s=!1;t?s=!(r||n):r=r||"utf8",n&&(r=null);let o=new Pr({objectMode:s});r&&o.setEncoding(r);let i=0,a=[];return o.on("data",d=>{a.push(d),s?i=a.length:i+=d.length}),o.getBufferedValue=()=>t?a:n?Buffer.concat(a,i):a.join(""),o.getBufferedLength=()=>i,o}});var Ut=c((Xs,N)=>{"use strict";var{constants:Gr}=require("buffer"),Cr=require("stream"),{promisify:Ar}=require("util"),Rr=Ft(),Or=Ar(Cr.pipeline),le=class extends Error{constructor(){super("maxBuffer exceeded");this.name="MaxBufferError"}};async function fe(e,t){if(!e)throw new Error("Expected a stream");t={maxBuffer:1/0,...t};let{maxBuffer:r}=t,n=Rr(t);return await new Promise((s,o)=>{let i=a=>{a&&n.getBufferedLength()<=Gr.MAX_LENGTH&&(a.bufferedData=n.getBufferedValue()),o(a)};(async()=>{try{await Or(e,n),s()}catch(a){i(a)}})(),n.on("data",()=>{n.getBufferedLength()>r&&i(new le)})}),n.getBufferedValue()}N.exports=fe;N.exports.buffer=(e,t)=>fe(e,{...t,encoding:"buffer"});N.exports.array=(e,t)=>fe(e,{...t,array:!0});N.exports.MaxBufferError=le});var Ht=c((Ks,Dt)=>{"use strict";var{PassThrough:qr}=require("stream");Dt.exports=function(){var e=[],t=new qr({objectMode:!0});return t.setMaxListeners(0),t.add=r,t.isEmpty=n,t.on("unpipe",s),Array.prototype.slice.call(arguments).forEach(r),t;function r(o){return Array.isArray(o)?(o.forEach(r),this):(e.push(o),o.once("end",s.bind(null,o)),o.once("error",t.emit.bind(t,"error")),o.pipe(t,{end:!1}),this)}function n(){return e.length==0}function s(o){e=e.filter(function(i){return i!==o}),!e.length&&t.readable&&t.end()}}});var Vt=c((Ws,Wt)=>{"use strict";var Xt=Mt(),Kt=Ut(),Nr=Ht(),_r=(e,t)=>{t===void 0||e.stdin===void 0||(Xt(t)?t.pipe(e.stdin):e.stdin.end(t))},$r=(e,{all:t})=>{if(!t||!e.stdout&&!e.stderr)return;let r=Nr();return e.stdout&&r.add(e.stdout),e.stderr&&r.add(e.stderr),r},pe=async(e,t)=>{if(!!e){e.destroy();try{return await t}catch(r){return r.bufferedData}}},me=(e,{encoding:t,buffer:r,maxBuffer:n})=>{if(!(!e||!r))return t?Kt(e,{encoding:t,maxBuffer:n}):Kt.buffer(e,{maxBuffer:n})},kr=async({stdout:e,stderr:t,all:r},{encoding:n,buffer:s,maxBuffer:o},i)=>{let a=me(e,{encoding:n,buffer:s,maxBuffer:o}),d=me(t,{encoding:n,buffer:s,maxBuffer:o}),l=me(r,{encoding:n,buffer:s,maxBuffer:o*2});try{return await Promise.all([i,a,d,l])}catch(f){return Promise.all([{error:f,signal:f.signal,timedOut:f.timedOut},pe(e,a),pe(t,d),pe(r,l)])}},Br=({input:e})=>{if(Xt(e))throw new TypeError("The `input` option cannot be a stream in sync mode")};Wt.exports={handleInput:_r,makeAllStream:$r,getSpawnedResult:kr,validateInputSync:Br}});var Yt=c((Vs,zt)=>{"use strict";var Lr=(async()=>{})().constructor.prototype,Mr=["then","catch","finally"].map(e=>[e,Reflect.getOwnPropertyDescriptor(Lr,e)]),jr=(e,t)=>{for(let[r,n]of Mr){let s=typeof t=="function"?(...o)=>Reflect.apply(n.value,t(),o):n.value.bind(t);Reflect.defineProperty(e,r,{...n,value:s})}return e},Fr=e=>new Promise((t,r)=>{e.on("exit",(n,s)=>{t({exitCode:n,signal:s})}),e.on("error",n=>{r(n)}),e.stdin&&e.stdin.on("error",n=>{r(n)})});zt.exports={mergePromise:jr,getSpawnedPromise:Fr}});var Jt=c((zs,Zt)=>{"use strict";var Qt=(e,t=[])=>Array.isArray(t)?[e,...t]:[e],Ur=/^[\w.-]+$/,Dr=/"/g,Hr=e=>typeof e!="string"||Ur.test(e)?e:`"${e.replace(Dr,'\\"')}"`,Xr=(e,t)=>Qt(e,t).join(" "),Kr=(e,t)=>Qt(e,t).map(r=>Hr(r)).join(" "),Wr=/ +/g,Vr=e=>{let t=[];for(let r of e.trim().split(Wr)){let n=t[t.length-1];n&&n.endsWith("\\")?t[t.length-1]=`${n.slice(0,-1)} ${r}`:t.push(r)}return t};Zt.exports={joinCommand:Xr,getEscapedCommand:Kr,parseCommand:Vr}});var an=c((Ys,A)=>{"use strict";var zr=require("path"),he=require("child_process"),Yr=dt(),Qr=ft(),Zr=ht(),Jr=yt(),V=Gt(),en=At(),{spawnedKill:es,spawnedCancel:ts,setupTimeout:ns,validateTimeout:rs,setExitHandler:ss}=Bt(),{handleInput:os,getSpawnedResult:is,makeAllStream:as,validateInputSync:cs}=Vt(),{mergePromise:tn,getSpawnedPromise:us}=Yt(),{joinCommand:nn,parseCommand:rn,getEscapedCommand:sn}=Jt(),ds=1e3*1e3*100,ls=({env:e,extendEnv:t,preferLocal:r,localDir:n,execPath:s})=>{let o=t?{...process.env,...e}:e;return r?Zr.env({env:o,cwd:n,execPath:s}):o},on=(e,t,r={})=>{let n=Yr._parse(e,t,r);return e=n.command,t=n.args,r=n.options,r={maxBuffer:ds,buffer:!0,stripFinalNewline:!0,extendEnv:!0,preferLocal:!1,localDir:r.cwd||process.cwd(),execPath:process.execPath,encoding:"utf8",reject:!0,cleanup:!0,all:!1,windowsHide:!0,...r},r.env=ls(r),r.stdio=en(r),process.platform==="win32"&&zr.basename(e,".exe")==="cmd"&&t.unshift("/q"),{file:e,args:t,options:r,parsed:n}},_=(e,t,r)=>typeof t!="string"&&!Buffer.isBuffer(t)?r===void 0?void 0:"":e.stripFinalNewline?Qr(t):t,z=(e,t,r)=>{let n=on(e,t,r),s=nn(e,t),o=sn(e,t);rs(n.options);let i;try{i=he.spawn(n.file,n.args,n.options)}catch(S){let g=new he.ChildProcess,x=Promise.reject(V({error:S,stdout:"",stderr:"",all:"",command:s,escapedCommand:o,parsed:n,timedOut:!1,isCanceled:!1,killed:!1}));return tn(g,x)}let a=us(i),d=ns(i,n.options,a),l=ss(i,n.options,d),f={isCanceled:!1};i.kill=es.bind(null,i.kill.bind(i)),i.cancel=ts.bind(null,i,f);let m=Jr(async()=>{let[{error:S,exitCode:g,signal:x,timedOut:w},$,k,ln]=await is(i,n.options,l),ge=_(n.options,$),xe=_(n.options,k),ye=_(n.options,ln);if(S||g!==0||x!==null){let be=V({error:S,exitCode:g,signal:x,stdout:ge,stderr:xe,all:ye,command:s,escapedCommand:o,parsed:n,timedOut:w,isCanceled:f.isCanceled,killed:i.killed});if(!n.options.reject)return be;throw be}return{command:s,escapedCommand:o,exitCode:0,stdout:ge,stderr:xe,all:ye,failed:!1,timedOut:!1,isCanceled:!1,killed:!1}});return os(i,n.options.input),i.all=as(i,n.options),tn(i,m)};A.exports=z;A.exports.sync=(e,t,r)=>{let n=on(e,t,r),s=nn(e,t),o=sn(e,t);cs(n.options);let i;try{i=he.spawnSync(n.file,n.args,n.options)}catch(l){throw V({error:l,stdout:"",stderr:"",all:"",command:s,escapedCommand:o,parsed:n,timedOut:!1,isCanceled:!1,killed:!1})}let a=_(n.options,i.stdout,i.error),d=_(n.options,i.stderr,i.error);if(i.error||i.status!==0||i.signal!==null){let l=V({stdout:a,stderr:d,error:i.error,signal:i.signal,exitCode:i.status,command:s,escapedCommand:o,parsed:n,timedOut:i.error&&i.error.code==="ETIMEDOUT",isCanceled:!1,killed:i.signal!==null});if(!n.options.reject)return l;throw l}return{command:s,escapedCommand:o,exitCode:0,stdout:a,stderr:d,failed:!1,timedOut:!1,isCanceled:!1,killed:!1}};A.exports.command=(e,t)=>{let[r,...n]=rn(e);return z(r,n,t)};A.exports.commandSync=(e,t)=>{let[r,...n]=rn(e);return z.sync(r,n,t)};A.exports.node=(e,t,r={})=>{t&&!Array.isArray(t)&&typeof t=="object"&&(r=t,t=[]);let n=en.node(r),s=process.execArgv.filter(a=>!a.startsWith("--inspect")),{nodePath:o=process.execPath,nodeOptions:i=s}=r;return z(o,[...i,e,...Array.isArray(t)?t:[]],{...r,stdin:void 0,stdout:void 0,stderr:void 0,stdio:n,shell:!1})}});var ms={};gn(ms,{default:()=>ps});var Se=require("@raycast/api");var cn=Ee(require("process"),1),un=Ee(an(),1);async function dn(e){if(cn.default.platform!=="darwin")throw new Error("macOS only");let{stdout:t}=await(0,un.default)("osascript",["-e",e]);return t}var fs=async()=>{try{await dn('do shell script "pgrep caffeinate"'),await(0,Se.showHUD)("Your Mac is caffeinated")}catch{await(0,Se.showHUD)("Your Mac is decaffeinated")}},ps=fs;module.exports=xn(ms);0&&(module.exports={});