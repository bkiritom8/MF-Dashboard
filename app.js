// ── Config ────────────────────────────────────────────────
var PIN_KEY='mfd_pin', PORT_KEY='mfd_portfolio';
var CHART_COLORS=['#6366f1','#34d399','#fb923c','#f472b6'];

// ── Boot ──────────────────────────────────────────────────
function initPin(){
  var pin=localStorage.getItem(PIN_KEY);
  if(!pin){
    pin=prompt('Set a 4-digit PIN to protect your dashboard (or Cancel to skip):');
    if(pin&&/^\d{4}$/.test(pin))localStorage.setItem(PIN_KEY,pin);
    else pin=null;
  }
  if(pin)show('pin-screen');
  else{show('app');init();}
}
function checkPin(){
  if(document.getElementById('pin-input').value===localStorage.getItem(PIN_KEY)){
    hide('pin-screen');show('app');init();
  }else{show('pin-error');document.getElementById('pin-input').value='';}
}
document.addEventListener('DOMContentLoaded',initPin);
document.addEventListener('DOMContentLoaded',function(){
  var p=document.getElementById('pin-input');
  if(p)p.addEventListener('keydown',function(e){if(e.key==='Enter')checkPin();});
});

// ── Helpers ───────────────────────────────────────────────
function show(id){document.getElementById(id).classList.remove('hidden');}
function hide(id){document.getElementById(id).classList.add('hidden');}
function fmt(n){return 'Rs.'+Number(n).toLocaleString('en-IN',{maximumFractionDigits:0});}
function fmt2(n){return 'Rs.'+Number(n).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});}
function pct(n){return(n>=0?'+':'')+(n*100).toFixed(2)+'%';}
function cc(n){return n>0?'positive':n<0?'negative':'neutral';}
function fmtDate(s){return new Date(s).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});}
function isIDCW(name){return/idcw|dividend|div\b/i.test(name);}
function daysAgoStr(n){var d=new Date();d.setDate(d.getDate()-n);return d.toISOString().slice(0,10);}
function daysBetween(a,b){return Math.round((new Date(b)-new Date(a))/(864e5));}

// ── Storage ───────────────────────────────────────────────
function loadPortfolio(){try{return JSON.parse(localStorage.getItem(PORT_KEY))||[];}catch(e){return[];}}
function savePortfolio(p){localStorage.setItem(PORT_KEY,JSON.stringify(p));}

// ── API ───────────────────────────────────────────────────
var navCache={};
async function fetchNAV(code){
  if(navCache[code])return navCache[code];
  try{
    var r=await fetch('https://api.mfapi.in/mf/'+code);
    var d=await r.json();
    d._parsed=d.data.map(function(x){
      var p=x.date.split('-');
      return{date:p[2]+'-'+p[1]+'-'+p[0],nav:parseFloat(x.nav)};
    }).reverse();
    navCache[code]=d;return d;
  }catch(e){return null;}
}
async function searchFunds(q){
  try{var r=await fetch('https://api.mfapi.in/mf/search?q='+encodeURIComponent(q));return await r.json();}
  catch(e){return[];}
}
function latestNAV(data){return data._parsed[data._parsed.length-1].nav;}
function getNavOnDate(data,ds){
  var arr=data._parsed;
  for(var i=arr.length-1;i>=0;i--)if(arr[i].date<=ds)return arr[i].nav;
  return arr[0].nav;
}

// ── Dividend Detection ────────────────────────────────────
// Returns events since a given date (or all if no date given)
function detectDividends(parsed,units,sinceDate){
  var events=[];
  for(var i=1;i<parsed.length;i++){
    var prev=parsed[i-1].nav, cur=parsed[i].nav;
    var drop=(prev-cur)/prev;
    if(drop>0.008&&prev>0){
      if(!sinceDate||parsed[i].date>=sinceDate){
        events.push({date:parsed[i].date,divPerUnit:prev-cur,total:(prev-cur)*(units||1),nav:cur});
      }
    }
  }
  return events;
}

// Throttle dividend dots for display based on visible date range
function throttleDivDots(divs,startDate,endDate){
  var spanDays=daysBetween(startDate,endDate);
  var perYear=divs.length/(spanDays/365);
  // If >1 per week in visible window, show at most 1 per week
  if(perYear>52){
    var filtered=[],lastMs=-Infinity;
    divs.forEach(function(d){
      var ms=new Date(d.date).getTime();
      if(ms-lastMs>=7*864e5){filtered.push(d);lastMs=ms;}
    });
    return filtered;
  }
  // If >12/year show at most 1 per month
  if(perYear>12){
    var filtered=[],lastMonth='';
    divs.forEach(function(d){
      var m=d.date.slice(0,7);
      if(m!==lastMonth){filtered.push(d);lastMonth=m;}
    });
    return filtered;
  }
  return divs;
}

// ── XIRR ─────────────────────────────────────────────────
function calcXIRR(inv,cur,date,divEvents){
  var flows=[-inv],dates=[new Date(date)];
  (divEvents||[]).forEach(function(d){flows.push(d.total);dates.push(new Date(d.date));});
  flows.push(cur);dates.push(new Date());
  return window.xirr(flows,dates);
}

// ── Portfolio State ───────────────────────────────────────
var portfolio=[];

async function init(){
  portfolio=loadPortfolio();
  renderFunds();
  updateSummary();
  loadTopFunds();
  document.getElementById('last-updated').textContent=
    'Data from mfapi.in - '+new Date().toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
}

// ── Fund Cards ────────────────────────────────────────────
function renderFunds(){
  var g=document.getElementById('funds-grid');
  if(!portfolio.length){
    g.innerHTML='<div class="empty-state"><p>No funds added yet. Click <strong>+ Add Fund</strong> to get started.</p></div>';
    return;
  }
  g.innerHTML=portfolio.map(function(f,i){
    var badge=isIDCW(f.name)
      ?'<span class="idcw-badge">IDCW</span>'
      :'<span class="growth-badge">Growth</span>';
    return '<div class="fund-card" id="fc-'+i+'">'+
      '<div class="fund-card-top">'+
        '<div class="fund-name">'+f.name+badge+'</div>'+
        '<div class="fund-actions">'+
          '<button class="fund-btn" onclick="openChart('+i+')">Chart</button>'+
          '<button class="fund-btn remove" onclick="removeFund('+i+')">Remove</button>'+
        '</div>'+
      '</div>'+
      '<div class="fund-meta">'+
        '<div class="fund-stat"><span class="fs-label">Invested</span><span class="fs-value neutral">'+fmt(f.amount)+'</span></div>'+
        '<div class="fund-stat"><span class="fs-label">Since</span><span class="fs-value neutral">'+fmtDate(f.date)+'</span></div>'+
      '</div>'+
      '<div class="fund-loading" id="fl-'+i+'">Fetching data...</div>'+
    '</div>';
  }).join('');
  portfolio.forEach(function(f,i){loadFundData(f,i);});
}

async function loadFundData(f,i){
  var data=await fetchNAV(f.code);
  var el=document.getElementById('fc-'+i), le=document.getElementById('fl-'+i);
  if(!data||!el)return;
  if(le)le.remove();

  var nav=latestNAV(data);
  var cur=nav*f.units;
  var gain=cur-f.amount;
  var ap=gain/f.amount;
  // Only count dividends since purchase date
  var divs=isIDCW(f.name)?detectDividends(data._parsed,f.units,f.date):[];
  var totalDiv=divs.reduce(function(s,d){return s+d.total;},0);
  var effectiveReturn=cur+totalDiv;
  var totalRetPct=(effectiveReturn-f.amount)/f.amount;
  var xirr=calcXIRR(f.amount,cur,f.date,divs);

  portfolio[i]._cur=cur;portfolio[i]._gain=gain;
  portfolio[i]._xirr=xirr;portfolio[i]._divs=divs;
  portfolio[i]._totalDiv=totalDiv;portfolio[i]._data=data;

  var divHTML='';
  if(isIDCW(f.name)){
    var lastDiv=divs.length?divs[divs.length-1]:null;
    divHTML='<div class="fund-divs">'+
      '<div class="fund-divs-title">Dividends received since purchase</div>'+
      '<div class="fund-meta">'+
        '<div class="fund-stat"><span class="fs-label">Total Received</span><span class="fs-value positive">'+fmt(totalDiv)+'</span></div>'+
        '<div class="fund-stat"><span class="fs-label">No. of Payouts</span><span class="fs-value neutral">'+divs.length+'</span></div>'+
        (lastDiv?'<div class="fund-stat"><span class="fs-label">Last Payout</span><span class="fs-value neutral">'+fmtDate(lastDiv.date)+'</span></div>':'')+ 
        (lastDiv?'<div class="fund-stat"><span class="fs-label">Last Amt/Unit</span><span class="fs-value positive">'+fmt2(lastDiv.divPerUnit)+'</span></div>':'')+
      '</div>'+
    '</div>';
  }

  el.insertAdjacentHTML('beforeend',
    '<div class="fund-meta" style="margin-top:.85rem">'+
      '<div class="fund-stat"><span class="fs-label">Current Value</span><span class="fs-value '+cc(gain)+'">'+fmt(cur)+'</span></div>'+
      '<div class="fund-stat"><span class="fs-label">NAV Gain</span><span class="fs-value '+cc(gain)+'">'+fmt(gain)+'</span></div>'+
      (totalDiv?'<div class="fund-stat"><span class="fs-label">+ Dividends</span><span class="fs-value positive">'+fmt(totalDiv)+'</span></div>':'')+
      '<div class="fund-stat"><span class="fs-label">Total Return</span><span class="fs-value '+cc(totalRetPct)+'">'+pct(totalRetPct)+'</span></div>'+
      '<div class="fund-stat"><span class="fs-label">XIRR</span><span class="fs-value '+cc(xirr)+'">'+pct(xirr)+'</span></div>'+
    '</div>'+divHTML
  );
  updateSummary();
}

function updateSummary(){
  var inv=portfolio.reduce(function(s,f){return s+(f.amount||0);},0);
  var cur=portfolio.reduce(function(s,f){return s+(f._cur||0);},0);
  var divs=portfolio.reduce(function(s,f){return s+(f._totalDiv||0);},0);
  var totalGain=(cur+divs)-inv;
  document.getElementById('total-invested').textContent=fmt(inv);
  document.getElementById('total-current').textContent=cur>0?fmt(cur):'-';
  document.getElementById('total-dividends').textContent=divs>0?fmt(divs):'-';
  var ge=document.getElementById('total-gain');
  ge.textContent=inv>0?fmt(totalGain)+' ('+pct(totalGain/inv)+')':'-';
  ge.className='s-value '+cc(totalGain);
  if(portfolio.length&&portfolio.every(function(f){return f._xirr!==undefined;})&&inv>0){
    var flows=[],fdates=[];
    portfolio.forEach(function(f){
      flows.push(-f.amount);fdates.push(new Date(f.date));
      (f._divs||[]).forEach(function(d){flows.push(d.total);fdates.push(new Date(d.date));});
    });
    flows.push(cur);fdates.push(new Date());
    var px=window.xirr(flows,fdates);
    var xe=document.getElementById('portfolio-xirr');
    xe.textContent=px!==null?pct(px):'-';
    xe.className='s-value '+cc(px);
  }
}

function removeFund(i){
  if(!confirm('Remove "'+portfolio[i].name+'" from your portfolio?'))return;
  portfolio.splice(i,1);savePortfolio(portfolio);renderFunds();updateSummary();
}

// ── Chart Drawing Utilities ───────────────────────────────
var PAD={t:24,r:24,b:40,l:64};

function setupCanvas(canvas){
  var W=canvas.offsetWidth||700;
  var H=parseInt(canvas.getAttribute('height'))||300;
  canvas.width=W;canvas.height=H;
  return{W:W,H:H,w:W-PAD.l-PAD.r,h:H-PAD.t-PAD.b,ctx:canvas.getContext('2d')};
}

function drawGrid(ctx,W,H,w,h,minV,maxV,yFmt){
  ctx.clearRect(0,0,W,H);
  ctx.strokeStyle='#1e293b';ctx.lineWidth=1;
  for(var g=0;g<=4;g++){
    var y=PAD.t+(g/4)*h;
    ctx.beginPath();ctx.moveTo(PAD.l,y);ctx.lineTo(PAD.l+w,y);ctx.stroke();
    var val=maxV-(g/4)*(maxV-minV);
    ctx.fillStyle='#475569';ctx.font='10px system-ui';ctx.textAlign='right';
    ctx.fillText((yFmt||function(v){return 'Rs.'+v.toFixed(2);})(val),PAD.l-4,y+4);
  }
}

function drawXLabels(ctx,pts,H,w,startIdx,endIdx){
  var visible=endIdx-startIdx;
  var step=Math.max(1,Math.floor(visible/5));
  ctx.fillStyle='#475569';ctx.font='10px system-ui';ctx.textAlign='center';
  for(var i=startIdx;i<=endIdx;i+=step){
    if(i>=pts.length)break;
    var x=PAD.l+((i-startIdx)/(endIdx-startIdx))*w;
    ctx.fillText(pts[i].date.slice(0,7),x,H-PAD.b+16);
  }
}

// Attach drag-to-zoom + mousemove tooltip to a canvas
function attachZoom(canvas,getState,redraw){
  var dragStart=-1,dragging=false;
  function getIdx(e,w,total,start,end){
    var rect=canvas.getBoundingClientRect();
    var cx=(e.touches?e.touches[0].clientX:e.clientX)-rect.left;
    return Math.round(start+((cx-PAD.l)/w)*(end-start));
  }
  canvas.addEventListener('mousedown',function(e){dragStart=getIdx(e,canvas.width-PAD.l-PAD.r,0,getState().start,getState().end);dragging=true;});
  canvas.addEventListener('mousemove',function(e){
    if(!dragging)return;
    var s=getState();
    var cur=getIdx(e,canvas.width-PAD.l-PAD.r,0,s.start,s.end);
    redraw(Math.min(dragStart,cur),Math.max(dragStart,cur),true);
  });
  canvas.addEventListener('mouseup',function(e){
    if(!dragging)return;dragging=false;
    var s=getState();
    var cur=getIdx(e,canvas.width-PAD.l-PAD.r,0,s.start,s.end);
    if(cur<dragStart){redraw(s.fullStart,s.fullEnd,false);}// right-to-left = reset
    else if(cur-dragStart>2){redraw(Math.min(dragStart,cur),Math.max(dragStart,cur),false);}
  });
  canvas.addEventListener('dblclick',function(){var s=getState();redraw(s.fullStart,s.fullEnd,false);});
  canvas.addEventListener('mouseleave',function(){dragging=false;});
  // Touch
  canvas.addEventListener('touchstart',function(e){dragStart=getIdx(e,canvas.width-PAD.l-PAD.r,0,getState().start,getState().end);},{ passive:true});
  canvas.addEventListener('touchend',function(e){
    var s=getState();
    var cur=getIdx(e,canvas.width-PAD.l-PAD.r,0,s.start,s.end);
    if(cur<dragStart)redraw(s.fullStart,s.fullEnd,false);
    else if(cur-dragStart>2)redraw(dragStart,cur,false);
  },{passive:true});
}

// ── NAV Chart (per fund) ─────────────────────────────────
var navState={idx:-1,start:0,end:0,fullStart:0,fullEnd:0,rangeDays:0};

function openChart(i){
  navState.idx=i;navState.rangeDays=0;
  document.getElementById('chart-modal-title').textContent=portfolio[i].name;
  show('chart-modal');
  setTimeout(function(){
    var data=portfolio[i]._data;
    if(!data)return;
    navState.fullStart=0;navState.fullEnd=data._parsed.length-1;
    navState.start=0;navState.end=data._parsed.length-1;
    drawNavChart();
    attachZoom(
      document.getElementById('nav-chart'),
      function(){return navState;},
      function(s,e,preview){navState.start=s;navState.end=e;if(!preview)drawNavChart();}
    );
    setupNavTooltip();
  },60);
}
function closeChartModal(){hide('chart-modal');navState.idx=-1;}

function setNavRange(days){
  document.querySelectorAll('#nav-range-btns .range-btn').forEach(function(b){b.classList.remove('active');});
  event.target.classList.add('active');
  navState.rangeDays=days;
  var data=portfolio[navState.idx]._data;
  if(!data)return;
  var pts=data._parsed;
  if(days===0){navState.start=0;navState.end=pts.length-1;}
  else{
    var cutoff=daysAgoStr(days);
    var si=pts.findIndex(function(p){return p.date>=cutoff;});
    navState.start=Math.max(0,si<0?0:si);navState.end=pts.length-1;
  }
  drawNavChart();
}

function drawNavChart(){
  var f=portfolio[navState.idx];
  var pts=f._data._parsed;
  var s=navState.start,e=navState.end;
  var vis=pts.slice(s,e+1);
  if(!vis.length)return;

  var c=setupCanvas(document.getElementById('nav-chart'));
  var navs=vis.map(function(x){return x.nav;});
  var minN=Math.min.apply(null,navs)*0.97;
  var maxN=Math.max.apply(null,navs)*1.03;
  var buyNav=pts[s].nav; // reference: first visible point

  // If purchase date is in view, use actual buy price
  var purchaseIdx=pts.findIndex(function(p){return p.date>=f.date;});
  var actualBuyNav=purchaseIdx>=0&&purchaseIdx>=s&&purchaseIdx<=e?pts[purchaseIdx].nav:null;
  var refNav=actualBuyNav||buyNav;

  function xp(i){return PAD.l+(i/(vis.length-1))*c.w;}
  function yp(n){return PAD.t+c.h-(n-minN)/(maxN-minN)*c.h;}

  drawGrid(c.ctx,c.W,c.H,c.w,c.h,minN,maxN);

  // Green fill above ref, red below
  var refY=yp(refNav);
  c.ctx.beginPath();
  vis.forEach(function(p,i){i===0?c.ctx.moveTo(xp(i),Math.min(yp(p.nav),refY)):c.ctx.lineTo(xp(i),Math.min(yp(p.nav),refY));});
  c.ctx.lineTo(xp(vis.length-1),refY);c.ctx.lineTo(xp(0),refY);c.ctx.closePath();
  c.ctx.fillStyle='rgba(52,211,153,.15)';c.ctx.fill();

  c.ctx.beginPath();
  vis.forEach(function(p,i){i===0?c.ctx.moveTo(xp(i),Math.max(yp(p.nav),refY)):c.ctx.lineTo(xp(i),Math.max(yp(p.nav),refY));});
  c.ctx.lineTo(xp(vis.length-1),refY);c.ctx.lineTo(xp(0),refY);c.ctx.closePath();
  c.ctx.fillStyle='rgba(248,113,113,.15)';c.ctx.fill();

  // NAV line
  c.ctx.beginPath();c.ctx.strokeStyle='#6366f1';c.ctx.lineWidth=2;
  vis.forEach(function(p,i){i===0?c.ctx.moveTo(xp(i),yp(p.nav)):c.ctx.lineTo(xp(i),yp(p.nav));});
  c.ctx.stroke();

  // Buy price ref line
  c.ctx.setLineDash([5,4]);c.ctx.strokeStyle='#fbbf24';c.ctx.lineWidth=1;
  c.ctx.beginPath();c.ctx.moveTo(PAD.l,refY);c.ctx.lineTo(PAD.l+c.w,refY);c.ctx.stroke();
  c.ctx.setLineDash([]);
  c.ctx.fillStyle='#fbbf24';c.ctx.font='10px system-ui';c.ctx.textAlign='left';
  c.ctx.fillText('Buy: Rs.'+refNav.toFixed(2),PAD.l+4,refY-5);

  drawXLabels(c.ctx,vis,c.H,c.w,0,vis.length-1);

  // Dividend dots (throttled)
  var allDivs=f._divs||[];
  var visDivs=allDivs.filter(function(d){return d.date>=vis[0].date&&d.date<=vis[vis.length-1].date;});
  var showDivs=throttleDivDots(visDivs,vis[0].date,vis[vis.length-1].date);
  showDivs.forEach(function(d){
    var di=vis.findIndex(function(p){return p.date>=d.date;});
    if(di<0)return;
    c.ctx.beginPath();c.ctx.arc(xp(di),yp(vis[di].nav),5,0,2*Math.PI);
    c.ctx.fillStyle='#fbbf24';c.ctx.fill();
    c.ctx.strokeStyle='#0f172a';c.ctx.lineWidth=1.5;c.ctx.stroke();
  });

  // Signal + dividend table
  renderSignal(f._data,f,document.getElementById('chart-signal'));
  renderDividendTable(f,document.getElementById('chart-dividends'));
}

function setupNavTooltip(){
  var canvas=document.getElementById('nav-chart');
  var tooltip=document.getElementById('nav-tooltip');
  var f=portfolio[navState.idx];
  canvas.onmousemove=function(e){
    var rect=canvas.getBoundingClientRect();
    var mx=e.clientX-rect.left;
    var pts=f._data._parsed;
    var s=navState.start,en=navState.end;
    var vis=pts.slice(s,en+1);
    if(!vis.length)return;
    var w=canvas.width-PAD.l-PAD.r;
    var idx=Math.round(((mx-PAD.l)/w)*(vis.length-1));
    idx=Math.max(0,Math.min(vis.length-1,idx));
    var pt=vis[idx];
    var div=(f._divs||[]).find(function(d){return d.date===pt.date;});
    var txt='<strong>'+pt.date+'</strong><br>NAV: Rs.'+pt.nav.toFixed(4);
    if(div)txt+='<br><span style="color:#fbbf24">Dividend: Rs.'+div.divPerUnit.toFixed(4)+'/unit</span>';
    tooltip.innerHTML=txt;
    var tx=Math.min(mx+12,canvas.width-180);
    tooltip.style.left=tx+'px';tooltip.style.top='8px';
    tooltip.classList.remove('hidden');
  };
  canvas.onmouseleave=function(){tooltip.classList.add('hidden');};
}

function renderDividendTable(f,el){
  var divs=f._divs||[];
  if(!isIDCW(f.name)){
    el.innerHTML='<div style="font-size:.78rem;color:#475569">Growth plan - returns compound in NAV, no dividend payouts.</div>';return;
  }
  if(!divs.length){
    el.innerHTML='<div style="font-size:.78rem;color:#475569">No dividend events detected since purchase date.</div>';return;
  }
  var totalDiv=divs.reduce(function(s,d){return s+d.total;},0);
  var rows=divs.slice().reverse().slice(0,15).map(function(d){
    return '<tr><td>'+fmtDate(d.date)+'</td>'+
      '<td class="positive">'+fmt2(d.divPerUnit)+'</td>'+
      '<td class="positive">'+fmt(d.total)+'</td></tr>';
  }).join('');
  el.innerHTML='<div style="font-size:.78rem;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:.5rem">Dividend history since purchase ('+f.units+' units)</div>'+
    '<table class="compare-table"><tr><th>Date</th><th>Per Unit</th><th>Your Share</th></tr>'+rows+'</table>'+
    '<div style="font-size:.72rem;color:#64748b;margin-top:.5rem">Showing last '+Math.min(divs.length,15)+' of '+divs.length+' payouts. Total received: <span class="positive">'+fmt(totalDiv)+'</span></div>';
}

// ── Buy/Hold/Avoid Signal ─────────────────────────────────
function renderSignal(data,f,el){
  var arr=data._parsed;
  if(arr.length<60){el.innerHTML='';return;}
  var score=0,max=0,details=[];
  function item(label,val,good,bad,w){
    max+=w;if(val===null)return;
    var s=val>=good?w:val<=bad?0:Math.round(w*(val-bad)/(good-bad));
    score+=s;details.push(label+': '+(val*100).toFixed(1)+'%');
  }
  var today=arr[arr.length-1];
  function ret(d){return arr.length<d?null:(today.nav-arr[arr.length-d].nav)/arr[arr.length-d].nav;}
  item('1M',ret(21),0.03,-0.02,1);item('3M',ret(63),0.08,-0.03,2);
  item('6M',ret(126),0.12,-0.05,2);item('1Y',ret(252),0.15,-0.05,3);
  max+=2;
  if(arr.length>=200){
    var ma=arr.slice(-200).reduce(function(s,x){return s+x.nav;},0)/200;
    var above=today.nav>ma;score+=above?2:0;details.push('Above 200MA: '+(above?'Yes':'No'));
  }
  max+=2;
  if(arr.length>=63){
    var rs=arr.slice(-63),rets=[];
    for(var k=1;k<rs.length;k++)rets.push((rs[k].nav-rs[k-1].nav)/rs[k-1].nav);
    var mean=rets.reduce(function(s,x){return s+x;},0)/rets.length;
    var vol=Math.sqrt(rets.reduce(function(s,x){return s+(x-mean)*(x-mean);},0)/rets.length)*Math.sqrt(252);
    score+=vol<0.12?2:vol<0.18?1:0;details.push('Vol: '+(vol*100).toFixed(1)+'%');
  }
  max+=2;
  if(arr.length>=126){
    var peak=0,dd=0;
    arr.slice(-126).forEach(function(x){
      if(x.nav>peak)peak=x.nav;
      var d=(peak-x.nav)/peak;if(d>dd)dd=d;
    });
    score+=dd<0.08?2:dd<0.15?1:0;details.push('Drawdown: '+(dd*100).toFixed(1)+'%');
  }
  var ratio=score/max;
  var sig=ratio>=0.6?'BUY':ratio>=0.4?'HOLD':'AVOID';
  var cls=sig==='BUY'?'signal-buy':sig==='HOLD'?'signal-hold':'signal-avoid';
  el.className='signal-box '+cls;
  el.innerHTML='<div class="signal-title">Signal: '+sig+' (Score: '+Math.round(ratio*100)+'/100)</div>'+
    '<div style="font-size:.73rem;color:#94a3b8;margin-bottom:.3rem">Momentum, trend, volatility, drawdown. Not financial advice.</div>'+
    '<div class="signal-scores">'+details.map(function(d){return'<span class="signal-score">'+d+'</span>';}).join('')+'</div>';
}

// ── Compare Chart ─────────────────────────────────────────
var compareList=[];
var compareState={start:0,end:0,fullStart:0,fullEnd:0,pts:[]};
var compareTimer;

function searchCompare(q){
  clearTimeout(compareTimer);
  var dd=document.getElementById('compare-dropdown');
  if(q.length<2){dd.classList.add('hidden');return;}
  compareTimer=setTimeout(async function(){
    dd.innerHTML='<div class="dropdown-loading">Searching...</div>';dd.classList.remove('hidden');
    var res=await searchFunds(q);
    if(!res.length){dd.innerHTML='<div class="dropdown-loading">No results</div>';return;}
    dd.innerHTML=res.slice(0,8).map(function(r){
      return '<div class="dropdown-item" onclick="addToCompare('+r.schemeCode+',this.textContent)">'+r.schemeName+'</div>';
    }).join('');
  },350);
}

async function addToCompare(code,name){
  hide('compare-dropdown');
  document.getElementById('compare-input').value='';
  if(compareList.length>=4){alert('Maximum 4 funds at once.');return;}
  if(compareList.find(function(x){return x.code==code;}))return;
  compareList.push({code:code,name:String(name).trim()});
  renderCompareChips();
  await buildCompareChart();
}

function removeFromCompare(code){
  compareList=compareList.filter(function(x){return x.code!=code;});
  renderCompareChips();
  if(compareList.length)buildCompareChart();
  else{hide('compare-chart-wrap');hide('compare-table');}
}

function renderCompareChips(){
  document.getElementById('compare-chips').innerHTML=compareList.map(function(f,i){
    return '<div class="chip">'+
      '<span class="chip-dot" style="background:'+CHART_COLORS[i]+'"></span>'+
      f.name.substring(0,35)+(f.name.length>35?'...':'')+
      '<span class="chip-remove" onclick="removeFromCompare('+f.code+')">x</span>'+
    '</div>';
  }).join('');
}

function setCompareRange(days){
  document.querySelectorAll('#compare-range-btns .range-btn').forEach(function(b){b.classList.remove('active');});
  event.target.classList.add('active');
  var pts=compareState.pts;
  if(!pts||!pts.length)return;
  if(days===0){compareState.start=compareState.fullStart;compareState.end=compareState.fullEnd;}
  else{
    var cutoff=daysAgoStr(days);
    var si=pts.findIndex(function(p){return p>=cutoff;});
    compareState.start=Math.max(0,si<0?0:si);
    compareState.end=compareState.fullEnd;
  }
  drawCompareChart();
}

async function buildCompareChart(){
  show('compare-chart-wrap');
  document.getElementById('compare-table').classList.add('hidden');

  var allData=await Promise.all(compareList.map(function(f){return fetchNAV(f.code);}));

  // Find common date range: latest of all start dates, earliest of all end dates
  // so all funds have data in that window
  var starts=allData.map(function(d){return d?d._parsed[0].date:'9999-12-31';});
  var ends=allData.map(function(d){return d?d._parsed[d._parsed.length-1].date:'0000-01-01';});
  var commonStart=starts.reduce(function(a,b){return a>b?a:b;});
  var commonEnd=ends.reduce(function(a,b){return a<b?a:b;});

  // Build a unified date axis from common start to common end
  // using the union of all dates in that range
  var dateSet={};
  allData.forEach(function(d){
    if(!d)return;
    d._parsed.forEach(function(p){
      if(p.date>=commonStart&&p.date<=commonEnd)dateSet[p.date]=true;
    });
  });
  var dates=Object.keys(dateSet).sort();
  if(dates.length<2){
    document.getElementById('compare-table').innerHTML='<p style="color:#f87171">Funds have no overlapping date range.</p>';
    document.getElementById('compare-table').classList.remove('hidden');
    return;
  }

  compareState.pts=dates;
  compareState.fullStart=0;compareState.fullEnd=dates.length-1;
  compareState.start=0;compareState.end=dates.length-1;

  // Store allData on compareList for chart drawing
  compareList.forEach(function(f,i){f._data=allData[i];});

  drawCompareChart();
  attachZoom(
    document.getElementById('compare-chart'),
    function(){return compareState;},
    function(s,e,preview){compareState.start=s;compareState.end=e;if(!preview)drawCompareChart();}
  );
  buildCompareTable(allData,commonStart,commonEnd);
}

function drawCompareChart(){
  var dates=compareState.pts;
  var s=compareState.start, e=compareState.end;
  var visDates=dates.slice(s,e+1);
  if(visDates.length<2)return;

  var canvas=document.getElementById('compare-chart');
  var c=setupCanvas(canvas);

  // Collect all NAV values across all funds in visible range to get Y bounds
  var allVals=[];
  compareList.forEach(function(f){
    var d=f._data;if(!d)return;
    visDates.forEach(function(date){allVals.push(getNavOnDate(d,date));});
  });
  var minV=Math.min.apply(null,allVals)*0.97;
  var maxV=Math.max.apply(null,allVals)*1.03;

  function xp(i){return PAD.l+(i/(visDates.length-1))*c.w;}
  function yp(v){return PAD.t+c.h-(v-minV)/(maxV-minV)*c.h;}

  drawGrid(c.ctx,c.W,c.H,c.w,c.h,minV,maxV);

  // Draw each fund line
  compareList.forEach(function(f,si){
    var d=f._data;if(!d)return;
    var color=CHART_COLORS[si];
    c.ctx.beginPath();c.ctx.strokeStyle=color;c.ctx.lineWidth=2;
    visDates.forEach(function(date,i){
      var nav=getNavOnDate(d,date);
      i===0?c.ctx.moveTo(xp(i),yp(nav)):c.ctx.lineTo(xp(i),yp(nav));
    });
    c.ctx.stroke();

    // Dividend dots (throttled)
    if(isIDCW(f.name)){
      var allDivs=detectDividends(d._parsed,1,null);
      var visDivs=allDivs.filter(function(dv){return dv.date>=visDates[0]&&dv.date<=visDates[visDates.length-1];});
      var showDivs=throttleDivDots(visDivs,visDates[0],visDates[visDates.length-1]);
      showDivs.forEach(function(dv){
        var di=visDates.findIndex(function(dt){return dt>=dv.date;});
        if(di<0)return;
        var nav=getNavOnDate(d,visDates[di]);
        c.ctx.beginPath();c.ctx.arc(xp(di),yp(nav),4,0,2*Math.PI);
        c.ctx.fillStyle=color;c.ctx.fill();
        c.ctx.strokeStyle='#0f172a';c.ctx.lineWidth=1.2;c.ctx.stroke();
      });
    }
  });

  // Fake pts array for x labels
  var fakePts=visDates.map(function(d){return{date:d};});
  drawXLabels(c.ctx,fakePts,c.H,c.w,0,fakePts.length-1);

  // Tooltip
  var tooltip=document.getElementById('compare-tooltip');
  canvas.onmousemove=function(e2){
    var rect=canvas.getBoundingClientRect();
    var mx=e2.clientX-rect.left;
    var idx=Math.round(((mx-PAD.l)/c.w)*(visDates.length-1));
    idx=Math.max(0,Math.min(visDates.length-1,idx));
    var date=visDates[idx];
    var lines=compareList.map(function(f,si){
      if(!f._data)return'';
      var nav=getNavOnDate(f._data,date);
      return '<span style="color:'+CHART_COLORS[si]+'">'+f.name.substring(0,22)+'...</span> Rs.'+nav.toFixed(2);
    }).join('<br>');
    tooltip.innerHTML='<strong>'+date+'</strong><br>'+lines;
    tooltip.style.left=Math.min(mx+12,c.W-200)+'px';
    tooltip.style.top='8px';
    tooltip.classList.remove('hidden');
  };
  canvas.onmouseleave=function(){tooltip.classList.add('hidden');};

  // Legend
  document.getElementById('compare-legend').innerHTML=compareList.map(function(f,i){
    return '<div class="legend-item"><span class="legend-dot" style="background:'+CHART_COLORS[i]+'"></span>'+f.name.substring(0,40)+'</div>';
  }).join('');
}

async function buildCompareTable(allData,commonStart,commonEnd){
  var res=document.getElementById('compare-table');
  var rows=await Promise.all(compareList.map(async function(f,si){
    var d=allData[si];if(!d)return null;
    var pts=d._parsed;
    var nav=latestNAV(d);
    // Divs since common start (per unit, for fair comparison)
    var divs=isIDCW(f.name)?detectDividends(pts,1,commonStart):[];
    var totalDivPerUnit=divs.reduce(function(s,x){return s+x.divPerUnit;},0);
    var totalDivCount=divs.length;
    function retY(days){
      if(pts.length<days)return null;
      return(nav-pts[pts.length-days].nav)/pts[pts.length-days].nav;
    }
    // Total return since common start including divs
    var navAtStart=getNavOnDate(d,commonStart);
    var navReturn=(nav-navAtStart)/navAtStart;
    var totalReturn=navReturn+totalDivPerUnit/navAtStart;
    var sig=document.createElement('div');
    renderSignal(d,{name:f.name},sig);
    var sigText=sig.querySelector('.signal-title');
    return{
      name:f.name,color:CHART_COLORS[si],
      r1:retY(252),r3:retY(756),r5:retY(1825),
      totalReturn:totalReturn,
      divPerUnit:totalDivPerUnit,divCount:totalDivCount,
      signal:sigText?sigText.textContent.replace('Signal: ',''):'N/A'
    };
  }));

  var valid=rows.filter(Boolean);
  if(!valid.length)return;
  var bestTotal=Math.max.apply(null,valid.map(function(x){return x.totalReturn;}));
  var best1=Math.max.apply(null,valid.map(function(x){return x.r1||0;}));

  var html='<h4>Comparison — common window: '+commonStart+' to '+commonEnd+'</h4>'+
    '<table class="compare-table">'+
    '<tr><th>Fund</th><th>Total Return*</th><th>1Y NAV</th><th>3Y NAV</th><th>5Y NAV</th><th>Div/Unit (window)</th><th>Payouts</th><th>Signal</th></tr>';
  valid.forEach(function(d){
    html+='<tr>'+
      '<td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+d.color+';margin-right:.4rem;vertical-align:middle"></span>'+d.name.substring(0,28)+'...</td>'+
      '<td class="'+cc(d.totalReturn)+'">'+pct(d.totalReturn)+(d.totalReturn===bestTotal?'<span class="winner-badge">BEST</span>':'')+' </td>'+
      '<td class="'+(d.r1!==null?cc(d.r1):'neutral')+'">'+(d.r1!==null?pct(d.r1):'-')+(d.r1===best1&&d.r1!==null?'<span class="winner-badge">BEST</span>':'')+' </td>'+
      '<td class="'+(d.r3!==null?cc(d.r3):'neutral')+'">'+(d.r3!==null?pct(d.r3):'-')+' </td>'+
      '<td class="'+(d.r5!==null?cc(d.r5):'neutral')+'">'+(d.r5!==null?pct(d.r5):'-')+' </td>'+
      '<td class="positive">'+(d.divPerUnit>0?fmt2(d.divPerUnit):'-')+'</td>'+
      '<td class="neutral">'+d.divCount+'</td>'+
      '<td>'+d.signal+'</td>'+
    '</tr>';
  });
  html+='</table><p style="font-size:.7rem;color:#475569;margin-top:.6rem">*Total return = NAV gain + dividends per unit, measured from common start date. Dots on chart = dividend events (IDCW). Not financial advice.</p>';
  res.innerHTML=html;
  res.classList.remove('hidden');
}

// ── Add Fund Modal ────────────────────────────────────────
var searchTimer2,selectedFund=null;
function openAddFund(){
  selectedFund=null;
  ['fund-search','fund-amount','fund-date','fund-units'].forEach(function(id){document.getElementById(id).value='';});
  hide('fund-dropdown');show('modal');
}
function closeModal(){hide('modal');}
function searchFund(q){
  clearTimeout(searchTimer2);
  if(q.length<2){hide('fund-dropdown');return;}
  searchTimer2=setTimeout(async function(){
    var dd=document.getElementById('fund-dropdown');
    dd.innerHTML='<div class="dropdown-loading">Searching...</div>';dd.classList.remove('hidden');
    var res=await searchFunds(q);
    if(!res.length){dd.innerHTML='<div class="dropdown-loading">No results</div>';return;}
    dd.innerHTML=res.slice(0,8).map(function(r){
      return '<div class="dropdown-item" onclick="selectFund('+r.schemeCode+',this.textContent)">'+r.schemeName+'</div>';
    }).join('');
  },350);
}
function selectFund(code,name){
  selectedFund={code:code,name:String(name).trim()};
  document.getElementById('fund-search').value=selectedFund.name;
  hide('fund-dropdown');
}
async function addFund(){
  if(!selectedFund){alert('Please search and select a fund first.');return;}
  var amount=parseFloat(document.getElementById('fund-amount').value);
  var date=document.getElementById('fund-date').value;
  var units=parseFloat(document.getElementById('fund-units').value);
  if(!amount||!date||!units){alert('Please fill in all fields.');return;}
  portfolio.push({code:selectedFund.code,name:selectedFund.name,amount:amount,date:date,units:units});
  savePortfolio(portfolio);closeModal();renderFunds();
}

// ── Top Performers ────────────────────────────────────────
var CATS={'120':'Large Cap','119':'Mid Cap','118':'Small Cap','117':'Multi Cap','121':'ELSS','122':'Flexi Cap'};
var topCache={},topLoading=false;

async function loadTopFunds(){
  if(topLoading)return;
  var period=parseInt(document.getElementById('top-period').value);
  var cat=document.getElementById('top-category').value;
  var key=cat+'-'+period;
  var res=document.getElementById('top-results');
  if(topCache[key]){renderTopTable(topCache[key],CATS[cat],period);return;}
  topLoading=true;
  res.innerHTML='<p class="top-loading">Searching '+CATS[cat]+' funds...</p>';
  var results=await searchFunds(CATS[cat]+' fund');
  if(!results||!results.length){res.innerHTML='<p class="top-hint">Could not load. Try again.</p>';topLoading=false;return;}
  var candidates=results.slice(0,30);
  var cutoff=daysAgoStr(period);
  var scored=[];
  for(var b=0;b<candidates.length;b+=6){
    var batch=candidates.slice(b,b+6);
    var fetched=await Promise.all(batch.map(async function(c){
      var data=await fetchNAV(c.schemeCode);
      if(!data||!data._parsed||data._parsed.length<2)return null;
      var nav=latestNAV(data);
      var old=getNavOnDate(data,cutoff);
      if(!old||old<=0)return null;
      var years=period/365;
      return{name:c.schemeName,code:c.schemeCode,ret:Math.pow(nav/old,1/years)-1,navNow:nav};
    }));
    fetched.forEach(function(f){if(f)scored.push(f);});
  }
  scored.sort(function(a,b){return b.ret-a.ret;});
  topCache[key]=scored.slice(0,10);
  renderTopTable(topCache[key],CATS[cat],period);
  topLoading=false;
}

function renderTopTable(funds,cat,period){
  var res=document.getElementById('top-results');
  var yrs=period===365?'1 Year':period===1095?'3 Years':'5 Years';
  if(!funds.length){res.innerHTML='<p class="top-hint">No data available.</p>';return;}
  var html='<div style="font-size:.78rem;color:#64748b;margin-bottom:.75rem">Top '+cat+' funds — annualized return over '+yrs+'</div>';
  html+='<table class="top-table"><tr><th>#</th><th>Fund</th><th>Annualized Return</th><th>Current NAV</th></tr>';
  funds.forEach(function(f,i){
    var badge=i===0?'gold':i===1?'silver':i===2?'bronze':'';
    html+='<tr><td><span class="rank-badge '+badge+'">'+(i+1)+'</span></td>'+
      '<td style="max-width:280px;line-height:1.4">'+f.name+'</td>'+
      '<td class="'+cc(f.ret)+'">'+pct(f.ret)+'</td>'+
      '<td class="neutral">Rs.'+f.navNow.toFixed(2)+'</td></tr>';
  });
  html+='</table><p style="font-size:.7rem;color:#475569;margin-top:.75rem">Past performance does not guarantee future results.</p>';
  res.innerHTML=html;
}

// ── Export / Import ───────────────────────────────────────
function exportPortfolio(){
  var a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(loadPortfolio(),null,2)],{type:'application/json'}));
  a.download='my-mf-portfolio.json';a.click();
}
function importPortfolio(e){
  var file=e.target.files[0];if(!file)return;
  var reader=new FileReader();
  reader.onload=function(ev){
    try{
      var data=JSON.parse(ev.target.result);
      if(!Array.isArray(data))throw new Error();
      savePortfolio(data);portfolio=data;renderFunds();updateSummary();
      alert('Imported successfully!');
    }catch(err){alert('Could not import - make sure it is a valid export file.');}
  };
  reader.readAsText(file);
}