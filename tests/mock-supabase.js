(function(){
const DB={profiles:[],bookings:[],conversations:[],messages:[],settings:[],wallets:[],wallet_tx:[],topups:[],reports:[],app_installs:[],credits:[],referrals:[],repeat_plans:[],promo_codes:[],ref_codes:[],push_subs:[],tech_certs:[]};let seq=1,uid=null;const subs=[];
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
Q.prototype.delete=function(){this.op='delete';return this};
Q.prototype.upsert=function(o,opt){this.op='upsert';this.o=o;this.opt=opt;return this};
Q.prototype.then=function(res,rej){try{res(this.run())}catch(e){rej(e)}};
function defaults(t,o){o={...o};if(t=='bookings'){o.id=seq++;o.code='CF-'+(1000+o.id);o.status=o.status||'Bago';o.created_at=o.updated_at=now();Object.assign(o,{discount:o.discount||0,promo:o.promo||'',warranty_of:o.warranty_of||null,cust_note:o.cust_note||'',plan_id:null,cust_phone:'',rate:o.warranty_of?0:20,extra_amt:0,extra_note:'',q_status:'wala',q_amt:null,q_note:'',final_amt:null,commission:null,rating:null,review:''})}
 if(t=='tech_certs'){o.id=seq++;o.status='sinusuri';o.note='';o.created_at=now();o.issuer=o.issuer||'';o.issued_year=o.issued_year??null}
 if(t=='promo_codes'){o.active=o.active??true;o.created_at=now()}
 if(t=='topups'){o.id=seq++;o.status='sinusuri';o.note='';o.created_at=now()}
 if(t=='reports'){o.id=seq++;o.code='RP-'+(1000+o.id);o.status=o.status||'bago';o.admin_note=o.admin_note||'';o.created_at=o.updated_at=now()}
 if(t=='conversations'){o.id='c'+seq++;o.read_c=now();o.read_t='1970-01-01T00:00:00Z';o.created_at=now()}
 if(t=='messages'){o.id=seq++;o.created_at=now()} return o}
Q.prototype.run=function(){const T=DB[this.t];let rows;
 if(this.op=='select'){rows=T.filter(r=>this.f.every(f=>f(r)))}
 else if(this.op=='insert'){if(this.t=='bookings'&&this.o.sched_at){const m=new Date(this.o.sched_at).getTime();if(m<Date.now()-3e5)return{data:null,error:{message:'Lumipas na ang oras na pinili mo. Pumili ng ibang oras'}};if(T.some(x=>x.tech_id==this.o.tech_id&&x.sched_at&&ACT.includes(x.status)&&Math.abs(new Date(x.sched_at).getTime()-m)<72e5))return{data:null,error:{message:'May booking na ang technician sa oras na ito. Pumili ng ibang oras'}}}if(this.t=='bookings'&&low(this.o.tech_id))return{data:null,error:{message:'Hindi available ngayon ang technician na ito. Pumili ng iba'}};if(this.t=='bookings'){const e=prepX(this.o);if(e)return{data:null,error:{message:e}}}const r=defaults(this.t,this.o);if(this.t=='bookings'&&r.promo=='CREDIT'){const c=DB.credits.find(x=>x.user_id==r.customer_id&&!x.booking_id);if(c)c.booking_id=r.id}T.push(r);rows=[r];emit(this.t,'INSERT',r)}
 else if(this.op=='update'){rows=T.filter(r=>this.f.every(f=>f(r)));if(this.t=='profiles'&&this.o.online&&rows.some(r=>r.role=='technician'&&(this.o.doc_status||r.doc_status)!='aprubado'))return {data:null,error:{message:'Hindi pa aprubado ang mga dokumento mo'}};if(this.t=='profiles'&&this.o.online&&rows.some(r=>r.role=='technician'&&low(r.id)))return{data:null,error:{message:'Kulang ang wallet balance mo'}};rows.forEach(r=>{const was=r.status;Object.assign(r,this.o);if(this.t=='reports')r.updated_at=now();if(this.t=='bookings'){r.updated_at=now();if(r.status=='Natapos'&&was!='Natapos'){r.final_amt=r.amt+r.extra_amt;r.commission=Math.round(r.final_amt*r.rate/100);r.done_at=now();r.warranty_until=new Date(Date.now()+30*864e5).toISOString();wadd(r.tech_id,'commission',-r.commission,'Commission · '+r.code);if(r.booking_fee)wadd(r.tech_id,'booking_fee',-r.booking_fee,'Booking fee · '+r.code);if(r.discount)wadd(r.tech_id,'promo',r.discount,'Discount · '+r.code);const rf=DB.referrals.find(x=>x.new_user==r.customer_id&&!x.rewarded_at);if(rf){rf.rewarded_at=now();DB.credits.push({id:seq++,user_id:rf.referrer,amt:setv('ref_inv')??50,note:'Referral',booking_id:null,created_at:now()})}}if(['Kinansela','Tinanggihan'].includes(r.status))DB.credits.forEach(c=>{if(c.booking_id==r.id)c.booking_id=null})}emit(this.t,'UPDATE',r)})}
 else if(this.op=='delete'){rows=T.filter(r=>this.f.every(f=>f(r)));rows.forEach(r=>T.splice(T.indexOf(r),1))}
 else if(this.op=='upsert'){const keys=(this.opt?.onConflict||(this.t=='settings'?'key':'id')).split(',');let r=T.find(x=>keys.every(k=>x[k]==this.o[k]));if(r)Object.assign(r,this.o);else{r=defaults(this.t,this.o);T.push(r)}rows=[r]}
 rows=JSON.parse(JSON.stringify(rows));
 if(this.one)return rows[0]?{data:rows[0],error:null}:{data:null,error:{message:'not found'}};return {data:rows,error:null}};
const ACT=['Bago','Tinanggap','Papunta na','Dumating na'];
const live=b=>!['Kinansela','Tinanggihan'].includes(b.status);
function promoAmt(code,cust,amt){const p=DB.promo_codes.find(x=>x.code==String(code).trim().toUpperCase());if(!p||!p.active)throw 'Hindi valid o expired na ang promo code';if(p.max_uses&&DB.bookings.filter(b=>b.promo==p.code&&live(b)).length>=p.max_uses)throw 'Naubos na ang promo code na ito';if(DB.bookings.some(b=>b.customer_id==cust&&b.promo==p.code&&live(b)))throw 'Nagamit mo na ang promo code na ito';if(p.first_only&&DB.bookings.some(b=>b.customer_id==cust&&live(b)))throw 'Para lang sa unang booking ang promo code na ito';return Math.min(amt,p.kind=='pct'?Math.round(amt*p.value/100):p.value)}
function prepX(o){try{if(o.warranty_of){const w=bk(o.warranty_of);if(!w||w.status!='Natapos')throw 'Walang ganitong natapos na booking';if(DB.bookings.some(b=>b.warranty_of==w.id&&ACT.includes(b.status)))throw 'May warranty request ka na para sa booking na ito';if((o.cust_note||'').length<5)throw 'Ilarawan ang problema';Object.assign(o,{amt:0,booking_fee:0,discount:0,promo:'',tech_id:w.tech_id});return ''}
 if(o.promo){o.discount=promoAmt(o.promo,o.customer_id,o.amt);o.promo=o.promo.toUpperCase()}else{const c=DB.credits.find(x=>x.user_id==o.customer_id&&!x.booking_id);if(c){o.discount=Math.min(c.amt,o.amt);o.promo='CREDIT'}}return ''}catch(e){return String(e)}}
const setv=k=>{const r=DB.settings.find(x=>x.key==k);return r?r.value:undefined};
const bal=id=>(DB.wallets.find(w=>w.tech_id==id)||{balance:0}).balance;
const low=id=>setv('wallet_required')===true&&bal(id)<(setv('wallet_min')??200);
function wadd(t,kind,amt,note){let w=DB.wallets.find(x=>x.tech_id==t);if(!w){w={tech_id:t,balance:0};DB.wallets.push(w)}w.balance+=amt;DB.wallet_tx.push({id:seq++,tech_id:t,kind,amt,balance_after:w.balance,note,created_at:now()});emit('wallets','UPDATE',{...w})}
const bk=id=>DB.bookings.find(x=>x.id==id);
const upd=b=>{b.updated_at=now();emit('bookings','UPDATE',JSON.parse(JSON.stringify(b)))};
const RPC={tech_reviews:a=>DB.bookings.filter(b=>b.tech_id==a.t&&b.rating).map(b=>{const p=DB.profiles.find(x=>x.id==b.customer_id)||{};const w=(p.name||'Customer').trim().split(/\s+/);return{rating:b.rating,review:b.review||'',rated_at:b.rated_at||b.updated_at,who:w[0]+(w[1]?' '+w[1][0]+'.':'')}}),
 avatars_of:a=>DB.profiles.filter(p=>a.ids.includes(p.id)&&p.avatar).map(p=>({id:p.id,avatar:p.avatar})),
 my_profile:()=>{const p=DB.profiles.find(x=>x.id==uid);return p?{...p}:null},
 admin_profiles:()=>DB.profiles.map(x=>({...x})),
 tech_busy:a=>DB.bookings.filter(x=>x.tech_id==a.t&&x.sched_at&&ACT.includes(x.status)).map(x=>x.sched_at),
 tech_stats:()=>{const m={};DB.bookings.filter(b=>b.status=='Natapos').forEach(b=>{const o=m[b.tech_id]=m[b.tech_id]||{tech_id:b.tech_id,s:0,reviews:0,done:0};o.done++;if(b.rating){o.s+=b.rating;o.reviews++}});return Object.values(m).map(o=>({...o,rating:o.reviews?Math.round(o.s/o.reviews*10)/10:null}))},
 send_quote:a=>{const b=bk(a.bid);if(b.status!='Dumating na')throw 'Pwede lang mag-quote pagdating sa customer';Object.assign(b,{q_amt:a.amount,q_note:a.why,q_status:'hinihintay'});upd(b)},
 answer_quote:a=>{const b=bk(a.bid);if(b.q_status!='hinihintay')throw 'Walang quote';if(a.ok){b.extra_amt+=b.q_amt;b.extra_note=(b.extra_note?b.extra_note+'; ':'')+b.q_note+' ('+b.q_amt+')';b.q_status='aprubado'}else b.q_status='tinanggihan';upd(b)},
 rate_booking:a=>{const b=bk(a.bid);if(b.rating)throw 'Na-rate mo na ito';b.rating=a.stars;b.review=a.words||'';upd(b)},
 review_topup:a=>{const t=DB.topups.find(x=>x.id==a.tid);if(t.status!='sinusuri')throw 'Nasuri na';t.status=a.ok?'aprubado':'tinanggihan';t.note=a.why||'';emit('topups','UPDATE',{...t});if(a.ok)wadd(t.tech_id,'topup',t.amt,'Top-up '+t.method.toUpperCase()+' · Ref '+t.ref);return bal(t.tech_id)},
 wallet_adjust:a=>wadd(a.t,a.a>0?'bonus':'adjust',a.a,a.why),
 push_save:a=>{const i=DB.push_subs.findIndex(x=>x.endpoint==a.p_endpoint);if(i>=0)DB.push_subs.splice(i,1);DB.push_subs.push({id:seq++,user_id:uid,endpoint:a.p_endpoint,p256dh:a.p_p256dh,auth:a.p_auth})},
 push_drop:a=>{const i=DB.push_subs.findIndex(x=>x.endpoint==a.p_endpoint);if(i>=0)DB.push_subs.splice(i,1)},
 my_ref_code:()=>{let r=DB.ref_codes.find(x=>x.user_id==uid);if(!r){const p=DB.profiles.find(x=>x.id==uid);r={user_id:uid,code:(p.name.split(' ')[0]).toUpperCase().replace(/[^A-Z]/g,'').slice(0,6)+'123'};DB.ref_codes.push(r)}return r.code},
 apply_ref:a=>{const r=DB.ref_codes.find(x=>x.code==String(a.p_code).trim().toUpperCase());if(!r)throw 'Walang ganitong referral code';if(r.user_id==uid)throw 'Hindi pwedeng gamitin ang sarili mong code';if(DB.referrals.some(x=>x.new_user==uid))throw 'May referral code ka nang nagamit';if(DB.bookings.some(b=>b.customer_id==uid&&live(b)))throw 'Para lang sa bagong customer na wala pang booking ang referral code';DB.referrals.push({new_user:uid,referrer:r.user_id,created_at:now(),rewarded_at:null});const v=setv('ref_new')??50;DB.credits.push({id:seq++,user_id:uid,amt:v,note:'Referral',booking_id:null,created_at:now()});emit('credits','INSERT',DB.credits.at(-1));return v},
 check_promo:a=>promoAmt(a.p_code,uid,a.p_amt),
 repeat_make:a=>{const b=bk(a.bid);const p={id:seq++,customer_id:b.customer_id,tech_id:b.tech_id,src_booking:b.id,items:b.items,svc:b.svc,address:b.address,every_m:a.months,hour:10,next_at:new Date(Date.now()+a.months*30*864e5).toISOString(),active:true,last_note:'',created_at:now()};DB.repeat_plans.push(p);return p.id},
 repeat_stop:a=>{const p=DB.repeat_plans.find(x=>x.id==a.pid);if(p)p.active=false}};
const sess=()=>uid?{user:{id:uid}}:null;
const auth={
 async signUp({email,password,options}){if(users.find(u=>u.email==email))return{data:{},error:{message:'User already registered'}};const id='u'+seq++;users.push({id,email,password});const m=options.data;DB.profiles.push({id,role:m.role=='technician'?'technician':'customer',name:m.name,email,phone:m.phone,addr:m.addr,services:m.services,cert_type:m.cert_type||null,docs:{},doc_status:'kulang',doc_note:'',online:false,lat:null,lng:null,google:false,created_at:now()});uid=id;return{data:{session:sess()},error:null}},
 async signInWithPassword({email,password}){const u=users.find(u=>u.email==email&&u.password==password);if(!u)return{data:{},error:{message:'Invalid login credentials'}};uid=u.id;return{data:{session:sess()},error:null}},
 async signOut(){uid=null;return{error:null}},
 async getSession(){return{data:{session:sess()}}},
 onAuthStateChange(cb){listeners.push(cb);return{data:{subscription:{unsubscribe(){}}}}},
 async resetPasswordForEmail(){return{error:null}},async updateUser(){return{error:null}},async signInWithOAuth(){return{error:{message:'no google'}}}};
const FILES={};window.__FILES=FILES;
const PURL={};const storage={from:b=>({async upload(path,f){FILES[b+'/'+path]=f;return{data:{path},error:null}},getPublicUrl(path){const k=b+'/'+path,f=FILES[k];return{data:{publicUrl:f?(PURL[k]=PURL[k]||URL.createObjectURL(f)):'https://x/'+k}}},async remove(ps){ps.forEach(q=>delete FILES[b+'/'+q]);return{data:[],error:null}},async download(path){const f=FILES[b+'/'+path];return f?{data:f,error:null}:{data:null,error:{message:'not found'}}},async createSignedUrl(path){const f=FILES[b+'/'+path];return f?{data:{signedUrl:URL.createObjectURL(f)},error:null}:{data:null,error:{message:'not found'}}}})};
window.__DB=DB;window.__users=users;
window.supabase={createClient(){return{auth,storage,from:t=>new Q(t),
 functions:{async invoke(fn,o){window.__INVOKED=[fn,o&&o.body];const r=window.__FN&&window.__FN[fn];return r?r(o&&o.body):{data:null,error:{message:'no fn',context:{json:async()=>({error:'Hindi pa naka-set up ang online na bayad.'})}}}}},
 async rpc(fn,a){if(!RPC[fn])return{data:null,error:{message:'no fn'}};try{return{data:RPC[fn](a||{})??null,error:null}}catch(e){return{data:null,error:{message:String(e)}}}},
 channel(){const ch={on(type,opt,cb){subs.push({table:opt.table,event:opt.event,cb});return ch},subscribe(){return ch}};return ch},removeChannel(){subs.length=0}}}};
})();
