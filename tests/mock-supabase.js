(function(){
const DB={profiles:[],bookings:[],conversations:[],messages:[],settings:[]};let seq=1,uid=null;const subs=[];
const users=[];const listeners=[];
const now=()=>new Date().toISOString();
function emit(table,ev,row){subs.forEach(s=>{if(s.table==table&&(s.event=='*'||s.event==ev))setTimeout(()=>s.cb({new:row}),5)})}
function Q(t){this.t=t;this.f=[];this.op='select';this.one=false}
Q.prototype.select=function(){if(this.op=='select')this.op='select';this.ret=true;return this};
Q.prototype.eq=function(k,v){this.f.push(r=>r[k]==v);return this};
Q.prototype.in=function(k,v){this.f.push(r=>v.includes(r[k]));return this};
Q.prototype.order=function(){return this};Q.prototype.limit=function(){return this};
Q.prototype.single=function(){this.one=true;return this};
Q.prototype.insert=function(o){this.op='insert';this.o=o;return this};
Q.prototype.update=function(o){this.op='update';this.o=o;return this};
Q.prototype.upsert=function(o,opt){this.op='upsert';this.o=o;this.opt=opt;return this};
Q.prototype.then=function(res,rej){try{res(this.run())}catch(e){rej(e)}};
function defaults(t,o){o={...o};if(t=='bookings'){o.id=seq++;o.code='CF-'+(1000+o.id);o.status=o.status||'Bago';o.created_at=o.updated_at=now()}
 if(t=='conversations'){o.id='c'+seq++;o.read_c=now();o.read_t='1970-01-01T00:00:00Z';o.created_at=now()}
 if(t=='messages'){o.id=seq++;o.created_at=now()} return o}
Q.prototype.run=function(){const T=DB[this.t];let rows;
 if(this.op=='select'){rows=T.filter(r=>this.f.every(f=>f(r)))}
 else if(this.op=='insert'){if(this.t=='bookings'&&this.o.sched_at){const m=new Date(this.o.sched_at).getTime();if(m<Date.now()-3e5)return{data:null,error:{message:'Lumipas na ang oras na pinili mo. Pumili ng ibang oras'}};if(T.some(x=>x.tech_id==this.o.tech_id&&x.sched_at&&ACT.includes(x.status)&&Math.abs(new Date(x.sched_at).getTime()-m)<72e5))return{data:null,error:{message:'May booking na ang technician sa oras na ito. Pumili ng ibang oras'}}}const r=defaults(this.t,this.o);T.push(r);rows=[r];emit(this.t,'INSERT',r)}
 else if(this.op=='update'){rows=T.filter(r=>this.f.every(f=>f(r)));if(this.t=='profiles'&&this.o.online&&rows.some(r=>r.role=='technician'&&(this.o.doc_status||r.doc_status)!='aprubado'))return {data:null,error:{message:'Hindi pa aprubado ang mga dokumento mo'}};rows.forEach(r=>{Object.assign(r,this.o);if(this.t=='bookings')r.updated_at=now();emit(this.t,'UPDATE',r)})}
 else if(this.op=='upsert'){const keys=(this.opt?.onConflict||(this.t=='settings'?'key':'id')).split(',');let r=T.find(x=>keys.every(k=>x[k]==this.o[k]));if(r)Object.assign(r,this.o);else{r=defaults(this.t,this.o);T.push(r)}rows=[r]}
 rows=JSON.parse(JSON.stringify(rows));
 if(this.one)return rows[0]?{data:rows[0],error:null}:{data:null,error:{message:'not found'}};return {data:rows,error:null}};
const ACT=['Bago','Tinanggap','Papunta na','Dumating na'];
const sess=()=>uid?{user:{id:uid}}:null;
const auth={
 async signUp({email,password,options}){if(users.find(u=>u.email==email))return{data:{},error:{message:'User already registered'}};const id='u'+seq++;users.push({id,email,password});const m=options.data;DB.profiles.push({id,role:m.role=='technician'?'technician':'customer',name:m.name,email,phone:m.phone,addr:m.addr,services:m.services,cert_type:m.cert_type||null,docs:{},doc_status:'kulang',doc_note:'',online:false,lat:null,lng:null,google:false,created_at:now()});uid=id;return{data:{session:sess()},error:null}},
 async signInWithPassword({email,password}){const u=users.find(u=>u.email==email&&u.password==password);if(!u)return{data:{},error:{message:'Invalid login credentials'}};uid=u.id;return{data:{session:sess()},error:null}},
 async signOut(){uid=null;return{error:null}},
 async getSession(){return{data:{session:sess()}}},
 onAuthStateChange(cb){listeners.push(cb);return{data:{subscription:{unsubscribe(){}}}}},
 async resetPasswordForEmail(){return{error:null}},async updateUser(){return{error:null}},async signInWithOAuth(){return{error:{message:'no google'}}}};
const FILES={};window.__FILES=FILES;
const storage={from:b=>({async upload(path,f){FILES[b+'/'+path]=f;return{data:{path},error:null}},async createSignedUrl(path){const f=FILES[b+'/'+path];return f?{data:{signedUrl:URL.createObjectURL(f)},error:null}:{data:null,error:{message:'not found'}}}})};
window.__DB=DB;window.__users=users;
window.supabase={createClient(){return{auth,storage,from:t=>new Q(t),
 async rpc(fn,a){if(fn=='tech_busy')return{data:DB.bookings.filter(x=>x.tech_id==a.t&&x.sched_at&&ACT.includes(x.status)).map(x=>x.sched_at),error:null};return{data:null,error:{message:'no fn'}}},
 channel(){const ch={on(type,opt,cb){subs.push({table:opt.table,event:opt.event,cb});return ch},subscribe(){return ch}};return ch},removeChannel(){subs.length=0}}}};
})();
