/* shared helpers for the per-project identity scripts (no dependencies) */
(function(){'use strict';
var d=document,R=d.documentElement;
var FX=window.FX={
 reduce:!!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches),
 $:function(s,c){return(c||d).querySelector(s)},
 $$:function(s,c){return Array.prototype.slice.call((c||d).querySelectorAll(s))},
 mouse:{x:-1e3,y:-1e3,px:.5,py:.5},
 /* add .rv and reveal on scroll */
 reveal:function(sel,cls){cls=cls||'in';var els=FX.$$(sel);els.forEach(function(e){e.classList.add('rv')});
  if(FX.reduce||!('IntersectionObserver' in window)){els.forEach(function(e){e.classList.add(cls)});return}
  var io=new IntersectionObserver(function(es){es.forEach(function(x){if(x.isIntersecting){x.target.classList.add(cls);io.unobserve(x.target)}})},{rootMargin:'0px 0px -6% 0px'});els.forEach(function(e,i){e.style.setProperty('--i',i%6);io.observe(e)})},
 /* canvas loop: sizes to its box, pauses offscreen / hidden tab; draw(ctx,w,h,t,dt,m) with m = mouse in canvas px */
 loop:function(cv,draw,o){o=o||{};var ctx=cv.getContext('2d'),w=0,h=0,dpr=1,raf=0,on=false,vis=true,last=0,t0=performance.now(),m={x:-1e3,y:-1e3,in:false};
  function size(){var r=cv.getBoundingClientRect();w=r.width;h=r.height;dpr=Math.min(o.dpr||2,window.devicePixelRatio||1);cv.width=Math.max(1,Math.round(w*dpr));cv.height=Math.max(1,Math.round(h*dpr));ctx.setTransform(dpr,0,0,dpr,0,0);if(o.resize)o.resize(w,h)}
  function fr(now){if(!on)return;var t=(now-t0)/1000,dt=Math.min(.05,(now-last)/1000||.016);last=now;ctx.setTransform(dpr,0,0,dpr,0,0);draw(ctx,w,h,t,dt,m);raf=requestAnimationFrame(fr)}
  function go(){if(on||FX.reduce||d.hidden||!vis)return;on=true;last=performance.now();raf=requestAnimationFrame(fr)}
  function stop(){on=false;cancelAnimationFrame(raf)}
  size();addEventListener('resize',function(){size();if(!on){ctx.setTransform(dpr,0,0,dpr,0,0);draw(ctx,w,h,0,0,m)}});
  var host=o.host||cv.parentElement;host.addEventListener('pointermove',function(e){var r=cv.getBoundingClientRect();m.x=e.clientX-r.left;m.y=e.clientY-r.top;m.in=true},{passive:true});host.addEventListener('pointerleave',function(){m.in=false;m.x=m.y=-1e3});
  if(FX.reduce){draw(ctx,w,h,o.still||2,0,m)}else{
   if('IntersectionObserver' in window)new IntersectionObserver(function(es){vis=es[0].isIntersecting;vis?go():stop()},{threshold:0}).observe(cv);else go();
   d.addEventListener('visibilitychange',function(){d.hidden?stop():go()});draw(ctx,w,h,0,0,m)}
  return{size:size,draw:function(){draw(ctx,w,h,(performance.now()-t0)/1000,0,m)},ctx:ctx};},
 /* create an absolutely positioned canvas as the first child of host */
 layer:function(host,cls){var cv=d.createElement('canvas');cv.className='fx '+(cls||'');cv.setAttribute('aria-hidden','true');cv.setAttribute('role','presentation');if(getComputedStyle(host).position==='static')host.style.position='relative';host.insertBefore(cv,host.firstChild);return cv},
 css:function(n){return getComputedStyle(R).getPropertyValue(n).trim()},
 rnd:function(a,b){return a+Math.random()*(b-a)},
 theme:function(){return R.getAttribute('data-theme')==='dark'?'dark':'light'}
};
addEventListener('pointermove',function(e){FX.mouse.x=e.clientX;FX.mouse.y=e.clientY;FX.mouse.px=e.clientX/innerWidth;FX.mouse.py=e.clientY/innerHeight},{passive:true});
R.classList.add('fxjs');
})();

(function(){var main=FX.$('main#top'),hero=FX.$('.hero'),core=FX.$('.core');if(!main||!hero||!core)return;var cv=document.createElement('canvas');cv.className='syn';cv.setAttribute('aria-hidden','true');main.insertBefore(cv,main.firstChild);
var COL=['#ff7a3d','#ff4f8b','#7b6cf6','#c8a61f','#ffc233'],P=[],bursts=0,glow=0;
function H(){return hero.offsetTop+hero.offsetHeight}
function spawn(x,y,fast){var side=Math.random();return{x0:x,y0:y,t:fast?Math.random()*.2:0,sp:(fast?.7:.16)+Math.random()*.12,c:COL[Math.floor(Math.random()*COL.length)],bend:(Math.random()-.5)*260,r:1.4+Math.random()*2.4}}
function edge(w,h){var s=Math.random();return s<.5?{x:Math.random()*w,y:-10}:s<.75?{x:-10,y:Math.random()*h}:{x:w+10,y:Math.random()*h}}
cv.style.height=H()+'px';addEventListener('resize',function(){cv.style.height=H()+'px'});
hero.addEventListener('pointerdown',function(e){if(e.target.closest('a,button,.install'))return;var r=cv.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;for(var i=0;i<26;i++)P.push(spawn(x,y,true))});
var n0=0;
FX.loop(cv,function(c,w,h,t,dt,m){c.clearRect(0,0,w,h);var cr=core.getBoundingClientRect(),vr=cv.getBoundingClientRect(),tx=cr.left+cr.width/2-vr.left,ty=cr.top+cr.height/2-vr.top;
 var want=w<700?40:90;while(P.length<want){var e=edge(w,h),p=spawn(e.x,e.y,false);p.t=Math.random();P.push(p)}
 glow*=.93;
 for(var i=P.length-1;i>=0;i--){var p=P[i];p.t+=p.sp*dt;if(p.t>=1){glow=Math.min(1,glow+.08);if(P.length>want){P.splice(i,1);continue}var e2=edge(w,h);Object.assign(p,spawn(e2.x,e2.y,false));continue}
  var u=p.t,k=u*u*(3-2*u),mx=(p.x0+tx)/2+p.bend,my=(p.y0+ty)/2-p.bend*.5;
  function B(q){var a=1-q;return{x:a*a*p.x0+2*a*q*mx+q*q*tx,y:a*a*p.y0+2*a*q*my+q*q*ty}}
  var pt=B(k),tail=B(Math.max(0,k-.07));c.strokeStyle=p.c;c.globalAlpha=.55*(1-u*.4);c.lineWidth=p.r;c.lineCap='round';c.beginPath();c.moveTo(tail.x,tail.y);c.lineTo(pt.x,pt.y);c.stroke();c.globalAlpha=1;c.fillStyle=p.c;c.beginPath();c.arc(pt.x,pt.y,p.r*1.2,0,6.3);c.fill()}
 var g=c.createRadialGradient(tx,ty,0,tx,ty,cr.width*(.9+glow*.5));g.addColorStop(0,'rgba(255,122,61,'+(.18+glow*.3)+')');g.addColorStop(.5,'rgba(123,108,246,'+(.1+glow*.15)+')');g.addColorStop(1,'rgba(123,108,246,0)');c.fillStyle=g;c.fillRect(0,0,w,h);
},{still:1,dpr:1.25,host:hero,resize:function(){cv.style.height=H()+'px'}});
})();
