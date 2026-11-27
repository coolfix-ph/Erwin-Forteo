(function(){
const DB={profiles:[],bookings:[],conversations:[],messages:[],settings:[],wallets:[],wallet_tx:[],topups:[],reports:[]};let seq=1,uid=null;const subs=[];
const users=[];const listeners=[];
const now=()=>new Date().toISOString();
function emit(table,ev,row){subs.forEach(s=>{if(s.table==table&&(s.event=='*'||s.event==ev))setTimeout(()=>s.cb({new:JSON.parse(JSON.stringify(row))}),5)})}
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
function defaults(t,o){o={...o};if(t=='bookings'){o.id=seq++;o.code='CF-'+(1000+o.id);o.status=o.status||'Bago';o.created_at=o.updated_at=now();Object.assign(o,{cust_phone:'',rate:20,extra_amt:0,extra_note:'',q_status:'wala',q_amt:null,q_note:'',final_amt:null,commission:null,rating:null,review:''})}
 if(t=='topups'){o.id=seq++;o.status='sinusuri';o.note='';o.created_at=now()}
 if(t=='reports'){o.id=seq++;o.code='RP-'+(1000+o.id);o.status=o.status||'bago';o.admin_note=o.admin_note||'';o.created_at=o.updated_at=now()}
 if(t=='conversations'){o.id='c'+seq++;o.read_c=now();o.read_t='1970-01-01T00:00:00Z';o.created_at=now()}
 if(t=='messages'){o.id=seq++;o.created_at=now()} return o}
Q.prototype.run=function(){const T=DB[this.t];let rows;
 if(this.op=='select'){rows=T.filter(r=>this.f.every(f=>f(r)))}
 else if(this.op=='insert'){if(this.t=='bookings'&&this.o.sched_at){const m=new Date(this.o.sched_at).getTime();if(m<Date.now()-3e5)return{data:null,error:{message:'Lumipas na ang oras na pinili mo. Pumili ng ibang oras'}};if(T.some(x=>x.tech_id==this.o.tech_id&&x.sched_at&&ACT.includes(x.status)&&Math.abs(new Date(x.sched_at).getTime()-m)<72e5))return{data:null,error:{message:'May booking na ang technician sa oras na ito. Pumili ng ibang oras'}}}if(this.t=='bookings'&&low(this.o.tech_id))return{data:null,error:{message:'Hindi available ngayon ang technician na ito. Pumili ng iba'}};const r=defaults(this.t,this.o);T.push(r);rows=[r];emit(this.t,'INSERT',r)}
 else if(this.op=='update'){rows=T.filter(r=>this.f.every(f=>f(r)));if(this.t=='profiles'&&this.o.online&&rows.some(r=>r.role=='technician'&&(this.o.doc_status||r.doc_status)!='aprubado'))return {data:null,error:{message:'Hindi pa aprubado ang mga dokumento mo'}};if(this.t=='profiles'&&this.o.online&&rows.some(r=>r.role=='technician'&&low(r.id)))return{data:null,error:{message:'Kulang ang wallet balance mo'}};rows.forEach(r=>{const was=r.status;Object.assign(r,this.o);if(this.t=='reports')r.updated_at=now();if(this.t=='bookings'){r.updated_at=now();if(r.status=='Natapos'&&was!='Natapos'){r.final_amt=r.amt+r.extra_amt;r.commission=Math.round(r.final_amt*r.rate/100);r.done_at=now();r.warranty_until=new Date(Date.now()+30*864e5).toISOString();wadd(r.tech_id,'commission',-r.commission,'Commission · '+r.code);if(r.booking_fee)wadd(r.tech_id,'booking_fee',-r.booking_fee,'Booking fee · '+r.code)}}emit(this.t,'UPDATE',r)})}
 else if(this.op=='upsert'){const keys=(this.opt?.onConflict||(this.t=='settings'?'key':'id')).split(',');let r=T.find(x=>keys.every(k=>x[k]==this.o[k]));if(r)Object.assign(r,this.o);else{r=defaults(this.t,this.o);T.push(r)}rows=[r]}
 rows=JSON.parse(JSON.stringify(rows));
 if(this.one)return rows[0]?{data:rows[0],error:null}:{data:null,error:{message:'not found'}};return {data:rows,error:null}};
const ACT=['Bago','Tinanggap','Papunta na','Dumating na'];
const setv=k=>{const r=DB.settings.find(x=>x.key==k);return r?r.value:undefined};
const bal=id=>(DB.wallets.find(w=>w.tech_id==id)||{balance:0}).balance;
const low=id=>setv('wallet_required')===true&&bal(id)<(setv('wallet_min')??200);
function wadd(t,kind,amt,note){let w=DB.wallets.find(x=>x.tech_id==t);if(!w){w={tech_id:t,balance:0};DB.wallets.push(w)}w.balance+=amt;DB.wallet_tx.push({id:seq++,tech_id:t,kind,amt,balance_after:w.balance,note,created_at:now()});emit('wallets','UPDATE',{...w})}
const bk=id=>DB.bookings.find(x=>x.id==id);
const upd=b=>{b.updated_at=now();emit('bookings','UPDATE',JSON.parse(JSON.stringify(b)))};
const RPC={tech_reviews:a=>DB.bookings.filter(b=>b.tech_id==a.t&&b.rating).map(b=>{const p=DB.profiles.find(x=>x.id==b.customer_id)||{};const w=(p.name||'Customer').trim().split(/\s+/);return{rating:b.rating,review:b.review||'',rated_at:b.rated_at||b.updated_at,who:w[0]+(w[1]?' '+w[1][0]+'.':'')}}),
 my_profile:()=>{const p=DB.profiles.find(x=>x.id==uid);return p?{...p}:null},
 admin_profiles:()=>DB.profiles.map(x=>({...x})),
 tech_busy:a=>DB.bookings.filter(x=>x.tech_id==a.t&&x.sched_at&&ACT.includes(x.status)).map(x=>x.sched_at),
 tech_stats:()=>{const m={};DB.bookings.filter(b=>b.status=='Natapos').forEach(b=>{const o=m[b.tech_id]=m[b.tech_id]||{tech_id:b.tech_id,s:0,reviews:0,done:0};o.done++;if(b.rating){o.s+=b.rating;o.reviews++}});return Object.values(m).map(o=>({...o,rating:o.reviews?Math.round(o.s/o.reviews*10)/10:null}))},
 send_quote:a=>{const b=bk(a.bid);if(b.status!='Dumating na')throw 'Pwede lang mag-quote pagdating sa customer';Object.assign(b,{q_amt:a.amount,q_note:a.why,q_status:'hinihintay'});upd(b)},
 answer_quote:a=>{const b=bk(a.bid);if(b.q_status!='hinihintay')throw 'Walang quote';if(a.ok){b.extra_amt+=b.q_amt;b.extra_note=(b.extra_note?b.extra_note+'; ':'')+b.q_note+' ('+b.q_amt+')';b.q_status='aprubado'}else b.q_status='tinanggihan';upd(b)},
 rate_booking:a=>{const b=bk(a.bid);if(b.rating)throw 'Na-rate mo na ito';b.rating=a.stars;b.review=a.words||'';upd(b)},
 review_topup:a=>{const t=DB.topups.find(x=>x.id==a.tid);if(t.status!='sinusuri')throw 'Nasuri na';t.status=a.ok?'aprubado':'tinanggihan';t.note=a.why||'';emit('topups','UPDATE',{...t});if(a.ok)wadd(t.tech_id,'topup',t.amt,'Top-up '+t.method.toUpperCase()+' · Ref '+t.ref);return bal(t.tech_id)},
 wallet_adjust:a=>wadd(a.t,a.a>0?'bonus':'adjust',a.a,a.why)};
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
 async rpc(fn,a){if(!RPC[fn])return{data:null,error:{message:'no fn'}};try{return{data:RPC[fn](a||{})??null,error:null}}catch(e){return{data:null,error:{message:String(e)}}}},
 channel(){const ch={on(type,opt,cb){subs.push({table:opt.table,event:opt.event,cb});return ch},subscribe(){return ch}};return ch},removeChannel(){subs.length=0}}}};
})();
