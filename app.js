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
function pct(n){return(n>=0?'+':'')+(n*100).toFixed(2)+'%';}
function cc(n){return n>0?'positive':n<0?'negative':'neutral';}
function fmtDate(str){return new Date(str).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});}
function isIDCW(name){return/idcw|dividend|div/i.test(name);}

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
    // Parse and reverse so index 0 = oldest
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
function navSince(data,ds){
  return data._parsed.filter(function(x){return x.date>=ds;});
}

// ── Dividend Detection ────────────────────────────────────
function detectDividends(data,units){
  var arr=data._parsed;
  var events=[];
  for(var i=1;i<arr.length;i++){
    var prev=arr[i-1].nav, cur=arr[i].nav;
    var drop=(prev-cur)/prev;
    // Drop > 0.8% in single day = likely dividend
    if(drop>0.008&&prev>0){
      var divPerUnit=prev-cur;
      events.push({date:arr[i].date,divPerUnit:divPerUnit,total:divPerUnit*units,nav:cur});
    }
  }
  return events;
}

// ── XIRR ─────────────────────────────────────────────────
function calcXIRR(inv,cur,date,divEvents){
  var flows=[-inv], dates=[new Date(date)];
  (divEvents||[]).forEach(function(d){flows.push(d.total);dates.push(new Date(d.date));});
  flows.push(cur);dates.push(new Date());
  return window.xirr(flows,dates);
}

// ── Portfolio ─────────────────────────────────────────────
var portfolio=[];

async function init(){
  portfolio=loadPortfolio();
  renderFunds();
  updateSummary();
  loadTopFunds();
  document.getElementById('last-updated').textContent=
    'Data from mfapi.in - '+new Date().toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
}

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
  var divs=isIDCW(f.name)?detectDividends(data,f.units):[];
  var totalDiv=divs.reduce(function(s,d){return s+d.total;},0);
  var totalReturn=cur+totalDiv;
  var xirr=calcXIRR(f.amount,cur,f.date,divs);

  portfolio[i]._cur=cur; portfolio[i]._gain=gain; portfolio[i]._xirr=xirr;
  portfolio[i]._divs=divs; portfolio[i]._totalDiv=totalDiv; portfolio[i]._data=data;

  var divHTML='';
  if(isIDCW(f.name)){
    var lastDiv=divs.length?divs[divs.length-1]:null;
    divHTML='<div class="fund-divs">'+
      '<div class="fund-divs-title">Dividends (IDCW)</div>'+
      '<div style="display:flex;gap:1.25rem;flex-wrap:wrap">'+
        '<div class="fund-stat"><span class="fs-label">Total Received</span><span class="fs-value positive">'+fmt(totalDiv)+'</span></div>'+
        '<div class="fund-stat"><span class="fs-label">No. of Payouts</span><span class="fs-value neutral">'+divs.length+'</span></div>'+
        (lastDiv?'<div class="fund-stat"><span class="fs-label">Last Payout</span><span class="fs-value neutral">'+fmtDate(lastDiv.date)+'</span></div>':'')+
        (lastDiv?'<div class="fund-stat"><span class="fs-label">Last Amt/Unit</span><span class="fs-value positive">Rs.'+lastDiv.divPerUnit.toFixed(4)+'</span></div>':'')+
      '</div>'+
    '</div>';
  }

  el.insertAdjacentHTML('beforeend',
    '<div class="fund-meta" style="margin-top:.85rem">'+
      '<div class="fund-stat"><span class="fs-label">Current Value</span><span class="fs-value '+cc(gain)+'">'+fmt(cur)+'</span></div>'+
      '<div class="fund-stat"><span class="fs-label">NAV Gain</span><span class="fs-value '+cc(gain)+'">'+fmt(gain)+'</span></div>'+
      (totalDiv?'<div class="fund-stat"><span class="fs-label">+ Dividends</span><span class="fs-value positive">'+fmt(totalDiv)+'</span></div>':'')+
      '<div class="fund-stat"><span class="fs-label">Total Return</span><span class="fs-value '+cc(totalReturn-f.amount)+'">'+pct((totalReturn-f.amount)/f.amount)+'</span></div>'+
      '<div class="fund-stat"><span class="fs-label">XIRR</span><span class="fs-value '+cc(xirr)+'">'+pct(xirr)+'</span></div>'+
    '</div>'+
    divHTML
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
    var earliest=new Date(Math.min.apply(null,portfolio.map(function(f){return new Date(f.date);})));
    // Build combined cashflows including all dividends
    var flows=[], fdates=[];
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

// ── NAV Chart ─────────────────────────────────────────────
var currentChartIdx=-1;

function openChart(i){
  currentChartIdx=i;
  var f=portfolio[i];
  document.getElementById('chart-modal-title').textContent=f.name;
  show('chart-modal');
  setTimeout(function(){drawNavChart(i);},50);
}
function closeChartModal(){hide('chart-modal');currentChartIdx=-1;}

function drawNavChart(i){
  var f=portfolio[i];
  var data=f._data;
  if(!data)return;

  var pts=navSince(data,f.date);
  if(!pts.length)return;

  var canvas=document.getElementById('nav-chart');
  var W=canvas.offsetWidth||700, H=300;
  canvas.width=W;canvas.height=H;
  var ctx=canvas.getContext('2d');
  var pad={t:20,r:20,b:40,l:60};
  var w=W-pad.l-pad.r, h=H-pad.t-pad.b;

  var navs=pts.map(function(x){return x.nav;});
  var minN=Math.min.apply(null,navs)*0.97;
  var maxN=Math.max.apply(null,navs)*1.03;
  var buyNav=pts[0].nav;

  function xp(idx){return pad.l+(idx/(pts.length-1))*w;}
  function yp(n){return pad.t+h-(n-minN)/(maxN-minN)*h;}

  ctx.clearRect(0,0,W,H);

  // Grid lines
  ctx.strokeStyle='#1e293b';ctx.lineWidth=1;
  for(var g=0;g<=4;g++){
    var y=pad.t+(g/4)*h;
    ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(pad.l+w,y);ctx.stroke();
    var val=maxN-(g/4)*(maxN-minN);
    ctx.fillStyle='#475569';ctx.font='10px system-ui';ctx.textAlign='right';
    ctx.fillText('Rs.'+val.toFixed(2),pad.l-6,y+4);
  }

  // Fill above/below buy price
  var buyY=yp(buyNav);
  // Green fill above buy price
  ctx.beginPath();
  ctx.moveTo(xp(0),Math.min(yp(pts[0].nav),buyY));
  pts.forEach(function(p,idx){ctx.lineTo(xp(idx),Math.min(yp(p.nav),buyY));});
  ctx.lineTo(xp(pts.length-1),buyY);ctx.lineTo(xp(0),buyY);ctx.closePath();
  ctx.fillStyle='rgba(52,211,153,0.15)';ctx.fill();
  // Red fill below buy price
  ctx.beginPath();
  ctx.moveTo(xp(0),Math.max(yp(pts[0].nav),buyY));
  pts.forEach(function(p,idx){ctx.lineTo(xp(idx),Math.max(yp(p.nav),buyY));});
  ctx.lineTo(xp(pts.length-1),buyY);ctx.lineTo(xp(0),buyY);ctx.closePath();
  ctx.fillStyle='rgba(248,113,113,0.15)';ctx.fill();

  // NAV line
  ctx.beginPath();ctx.strokeStyle='#6366f1';ctx.lineWidth=2;
  pts.forEach(function(p,idx){idx===0?ctx.moveTo(xp(idx),yp(p.nav)):ctx.lineTo(xp(idx),yp(p.nav));});
  ctx.stroke();

  // Buy price line
  ctx.beginPath();ctx.strokeStyle='#fbbf24';ctx.lineWidth=1;ctx.setLineDash([5,4]);
  ctx.moveTo(pad.l,buyY);ctx.lineTo(pad.l+w,buyY);ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle='#fbbf24';ctx.font='10px system-ui';ctx.textAlign='left';
  ctx.fillText('Buy: Rs.'+buyNav.toFixed(2),pad.l+4,buyY-5);

  // X axis labels
  ctx.fillStyle='#475569';ctx.font='10px system-ui';ctx.textAlign='center';
  var labelCount=5;
  for(var l=0;l<=labelCount;l++){
    var li=Math.floor((l/labelCount)*(pts.length-1));
    ctx.fillText(pts[li].date.slice(0,7),xp(li),H-pad.b+16);
  }

  // Dividend dots
  var divs=f._divs||[];
  divs.forEach(function(d){
    var idx=pts.findIndex(function(p){return p.date===d.date;});
    if(idx<0)return;
    ctx.beginPath();
    ctx.arc(xp(idx),yp(d.nav),5,0,2*Math.PI);
    ctx.fillStyle='#fbbf24';ctx.fill();
    ctx.strokeStyle='#0f172a';ctx.lineWidth=1.5;ctx.stroke();
  });

  // Hover tooltip
  var tooltip=document.getElementById('nav-tooltip');
  canvas.onmousemove=function(e){
    var rect=canvas.getBoundingClientRect();
    var mx=e.clientX-rect.left;
    var idx=Math.round(((mx-pad.l)/w)*(pts.length-1));
    idx=Math.max(0,Math.min(pts.length-1,idx));
    var pt=pts[idx];
    var div=divs.find(function(d){return d.date===pt.date;});
    var txt=pt.date+' — Rs.'+pt.nav.toFixed(4);
    if(div)txt+='<br><span style="color:#fbbf24">Dividend: Rs.'+div.divPerUnit.toFixed(4)+'/unit (Total: '+fmt(div.total)+')</span>';
    tooltip.innerHTML=txt;
    tooltip.style.left=(xp(idx)+10)+'px';
    tooltip.style.top=(yp(pt.nav)-20)+'px';
    tooltip.classList.remove('hidden');
  };
  canvas.onmouseleave=function(){tooltip.classList.add('hidden');};

  // Signal
  renderSignal(data,f,document.getElementById('chart-signal'));

  // Dividend summary
  var dc=document.getElementById('chart-dividends');
  if(isIDCW(f.name)&&divs.length){
    var totalDiv=divs.reduce(function(s,d){return s+d.total;},0);
    var rows=divs.slice().reverse().slice(0,10).map(function(d){
      return '<tr><td>'+fmtDate(d.date)+'</td><td class="positive">Rs.'+d.divPerUnit.toFixed(4)+'</td><td class="positive">'+fmt(d.total)+'</td></tr>';
    }).join('');
    dc.innerHTML='<div style="font-size:.78rem;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:.5rem">Dividend History</div>'+
      '<table class="compare-table"><tr><th>Date</th><th>Per Unit</th><th>Your Share ('+f.units+' units)</th></tr>'+rows+'</table>'+
      '<div style="font-size:.75rem;color:#64748b;margin-top:.5rem">Showing last '+Math.min(divs.length,10)+' of '+divs.length+' detected payouts. Total received: <span class="positive">'+fmt(totalDiv)+'</span></div>';
  }else{
    dc.innerHTML='<div style="font-size:.78rem;color:#475569">'+
      (isIDCW(f.name)?'No dividend events detected in this fund.':'Growth plan — returns compound in NAV, no dividend payouts.')+
    '</div>';
  }
}

// ── Buy/Hold/Avoid Signal ─────────────────────────────────
function renderSignal(data,f,el){
  var arr=data._parsed;
  if(arr.length<60){el.innerHTML='';return;}
  var score=0, maxScore=0, details=[];

  function scoreItem(label,val,good,bad,weight){
    maxScore+=weight;
    if(val===null){return;}
    var s=val>=good?weight:val<=bad?0:Math.round(weight*(val-bad)/(good-bad));
    score+=s;
    details.push(label+': '+(val*100).toFixed(1)+'%');
  }

  var today=arr[arr.length-1];
  function retOver(days){
    if(arr.length<days)return null;
    var old=arr[arr.length-days];
    return (today.nav-old.nav)/old.nav;
  }

  // Momentum
  scoreItem('1M return',retOver(21),0.03,-0.02,1);
  scoreItem('3M return',retOver(63),0.08,-0.03,2);
  scoreItem('6M return',retOver(126),0.12,-0.05,2);
  scoreItem('1Y return',retOver(252),0.15,-0.05,3);

  // 200-day MA trend
  maxScore+=2;
  if(arr.length>=200){
    var ma200=arr.slice(-200).reduce(function(s,x){return s+x.nav;},0)/200;
    var aboveMA=today.nav>ma200;
    score+=aboveMA?2:0;
    details.push('Above 200MA: '+(aboveMA?'Yes':'No'));
  }

  // Volatility (lower = better)
  maxScore+=2;
  if(arr.length>=63){
    var recent=arr.slice(-63);
    var rets=[];
    for(var k=1;k<recent.length;k++)rets.push((recent[k].nav-recent[k-1].nav)/recent[k-1].nav);
    var mean=rets.reduce(function(s,x){return s+x;},0)/rets.length;
    var vol=Math.sqrt(rets.reduce(function(s,x){return s+(x-mean)*(x-mean);},0)/rets.length)*Math.sqrt(252);
    var vs=vol<0.12?2:vol<0.18?1:0;
    score+=vs;
    details.push('Annualized vol: '+(vol*100).toFixed(1)+'%');
  }

  // Max drawdown
  maxScore+=2;
  if(arr.length>=126){
    var peak=0,dd=0;
    arr.slice(-126).forEach(function(x){
      if(x.nav>peak)peak=x.nav;
      var d=(peak-x.nav)/peak;
      if(d>dd)dd=d;
    });
    var ds=dd<0.08?2:dd<0.15?1:0;
    score+=ds;
    details.push('6M max drawdown: '+(dd*100).toFixed(1)+'%');
  }

  var ratio=score/maxScore;
  var signal=ratio>=0.6?'BUY':ratio>=0.4?'HOLD':'AVOID';
  var cls=signal==='BUY'?'signal-buy':signal==='HOLD'?'signal-hold':'signal-avoid';

  el.className='signal-box '+cls;
  el.innerHTML='<div class="signal-title">Signal: '+signal+' (Score: '+Math.round(ratio*100)+'/100)</div>'+
    '<div style="font-size:.75rem;color:#94a3b8;margin-bottom:.35rem">Based on momentum, trend, volatility, and drawdown. Not financial advice.</div>'+
    '<div class="signal-scores">'+details.map(function(d){return'<span class="signal-score">'+d+'</span>';}).join('')+'</div>';
}

// ── Compare ───────────────────────────────────────────────
var compareList=[];
var compareTimer;

function searchCompare(q){
  clearTimeout(compareTimer);
  var dd=document.getElementById('compare-dropdown');
  if(q.length<2){dd.classList.add('hidden');return;}
  compareTimer=setTimeout(async function(){
    dd.innerHTML='<div class="dropdown-loading">Searching...</div>';
    dd.classList.remove('hidden');
    var results=await searchFunds(q);
    if(!results.length){dd.innerHTML='<div class="dropdown-loading">No results</div>';return;}
    dd.innerHTML=results.slice(0,8).map(function(r){
      return '<div class="dropdown-item" onclick="addToCompare('+r.schemeCode+',this.textContent)">'+r.schemeName+'</div>';
    }).join('');
  },350);
}

async function addToCompare(code,name){
  hide('compare-dropdown');
  document.getElementById('compare-input').value='';
  if(compareList.length>=4){alert('Maximum 4 funds can be compared at once.');return;}
  if(compareList.find(function(x){return x.code==code;})){return;}
  compareList.push({code:code,name:name});
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
  var chips=document.getElementById('compare-chips');
  chips.innerHTML=compareList.map(function(f,i){
    return '<div class="chip" style="border-color:'+CHART_COLORS[i]+'">'+
      '<span style="width:8px;height:8px;border-radius:50%;background:'+CHART_COLORS[i]+';display:inline-block"></span>'+
      f.name.substring(0,40)+(f.name.length>40?'...':'')+
      '<span class="chip-remove" onclick="removeFromCompare('+f.code+')">x</span>'+
    '</div>';
  }).join('');
}

async function buildCompareChart(){
  if(!compareList.length)return;
  show('compare-chart-wrap');

  // Fetch all NAV data
  var allData=await Promise.all(compareList.map(function(f){return fetchNAV(f.code);}));

  // Find common start date (latest of all earliest dates)
  var starts=allData.map(function(d){return d?d._parsed[0].date:'9999';});
  var commonStart=starts.reduce(function(a,b){return a>b?a:b;});

  // Normalize to 100 at common start
  var series=allData.map(function(d,i){
    if(!d)return null;
    var pts=d._parsed.filter(function(x){return x.date>=commonStart;});
    if(!pts.length)return null;
    var base=pts[0].nav;
    return pts.map(function(x){return{date:x.date,val:(x.nav/base)*100};});
  });

  var canvas=document.getElementById('compare-chart');
  var W=canvas.offsetWidth||700, H=260;
  canvas.width=W;canvas.height=H;
  var ctx=canvas.getContext('2d');
  var pad={t:20,r:20,b:40,l:50};
  var w=W-pad.l-pad.r, h=H-pad.t-pad.b;

  var allVals=series.filter(Boolean).reduce(function(a,s){return a.concat(s.map(function(x){return x.val;}));},[]); 
  var minV=Math.min.apply(null,allVals)*0.98;
  var maxV=Math.max.apply(null,allVals)*1.02;
  var maxLen=Math.max.apply(null,series.filter(Boolean).map(function(s){return s.length;}));

  function xp(idx,len){return pad.l+(idx/(len-1))*w;}
  function yp(v){return pad.t+h-(v-minV)/(maxV-minV)*h;}

  ctx.clearRect(0,0,W,H);

  // Grid
  ctx.strokeStyle='#1e293b';ctx.lineWidth=1;
  for(var g=0;g<=4;g++){
    var y=pad.t+(g/4)*h;
    ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(pad.l+w,y);ctx.stroke();
    var val=maxV-(g/4)*(maxV-minV);
    ctx.fillStyle='#475569';ctx.font='10px system-ui';ctx.textAlign='right';
    ctx.fillText(val.toFixed(0),pad.l-4,y+4);
  }
  // Base line at 100
  var base100Y=yp(100);
  ctx.beginPath();ctx.strokeStyle='#334155';ctx.lineWidth=1;ctx.setLineDash([4,4]);
  ctx.moveTo(pad.l,base100Y);ctx.lineTo(pad.l+w,base100Y);ctx.stroke();
  ctx.setLineDash([]);

  // Draw each fund
  series.forEach(function(s,si){
    if(!s)return;
    var color=CHART_COLORS[si];
    ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=2;
    s.forEach(function(p,idx){idx===0?ctx.moveTo(xp(idx,s.length),yp(p.val)):ctx.lineTo(xp(idx,s.length),yp(p.val));});
    ctx.stroke();

    // Dividend dots for IDCW
    var f=compareList[si];
    var ddata=allData[si];
    if(ddata&&isIDCW(f.name)){
      var divs=detectDividends(ddata,1);
      divs.forEach(function(d){
        var idx=s.findIndex(function(p){return p.date===d.date;});
        if(idx<0)return;
        ctx.beginPath();ctx.arc(xp(idx,s.length),yp(s[idx].val),4,0,2*Math.PI);
        ctx.fillStyle=color;ctx.fill();
        ctx.strokeStyle='#0f172a';ctx.lineWidth=1.5;ctx.stroke();
      });
    }
  });

  // X labels
  ctx.fillStyle='#475569';ctx.font='10px system-ui';ctx.textAlign='center';
  var ref=series.find(Boolean);
  if(ref){
    [0,0.25,0.5,0.75,1].forEach(function(t){
      var idx=Math.floor(t*(ref.length-1));
      ctx.fillText(ref[idx].date.slice(0,7),xp(idx,ref.length),H-pad.b+16);
    });
  }

  // Tooltip
  var tooltip=document.getElementById('compare-tooltip');
  canvas.onmousemove=function(e){
    var rect=canvas.getBoundingClientRect();
    var mx=e.clientX-rect.left;
    var ref2=series.find(Boolean);
    if(!ref2)return;
    var idx=Math.round(((mx-pad.l)/w)*(ref2.length-1));
    idx=Math.max(0,Math.min(ref2.length-1,idx));
    var lines=series.map(function(s,si){
      if(!s||idx>=s.length)return'';
      var color=CHART_COLORS[si];
      return'<span style="color:'+color+'">'+compareList[si].name.substring(0,25)+'...</span>: '+s[idx].val.toFixed(2);
    }).filter(Boolean).join('<br>');
    tooltip.innerHTML=(ref2[idx]?ref2[idx].date:'')+' (normalized to 100)<br>'+lines;
    tooltip.style.left=Math.min(mx+12,W-200)+'px';
    tooltip.style.top='10px';
    tooltip.classList.remove('hidden');
  };
  canvas.onmouseleave=function(){tooltip.classList.add('hidden');};

  // Comparison table
  var tableData=await Promise.all(compareList.map(async function(f,si){
    var d=allData[si];if(!d)return null;
    var pts=d._parsed;
    var nav=latestNAV(d);
    var divs=isIDCW(f.name)?detectDividends(d,1):[];
    var totalDivPerUnit=divs.reduce(function(s,x){return s+x.divPerUnit;},0);
    function retY(days){
      if(pts.length<days)return null;
      return(nav-pts[pts.length-days].nav)/pts[pts.length-days].nav;
    }
    var sig=document.createElement('div');
    renderSignal(d,{name:f.name},sig);
    var sigText=sig.querySelector('.signal-title');
    return{
      name:f.name,color:CHART_COLORS[si],
      r1:retY(252),r3:retY(756),r5:retY(1825),
      divPerUnit:totalDivPerUnit,
      signal:sigText?sigText.textContent:'N/A'
    };
  }));

  var res=document.getElementById('compare-table');
  res.classList.remove('hidden');
  var best1=Math.max.apply(null,tableData.filter(Boolean).map(function(x){return x.r1||0;}));
  var best3=Math.max.apply(null,tableData.filter(Boolean).map(function(x){return x.r3||0;}));
  var html='<h4>Comparison (normalized to 100 at common start date)</h4>'+
    '<table class="compare-table"><tr><th>Fund</th><th>1Y Return</th><th>3Y Return</th><th>5Y Return</th><th>Div/Unit</th><th>Signal</th></tr>';
  tableData.forEach(function(d){
    if(!d)return;
    html+='<tr>'+
      '<td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+d.color+';margin-right:.4rem"></span>'+d.name.substring(0,30)+'...</td>'+
      '<td class="'+(d.r1!==null?cc(d.r1):'neutral')+'">'+(d.r1!==null?pct(d.r1):'-')+(d.r1===best1?'<span class="winner-badge">BEST</span>':'')+' </td>'+
      '<td class="'+(d.r3!==null?cc(d.r3):'neutral')+'">'+(d.r3!==null?pct(d.r3):'-')+(d.r3===best3?'<span class="winner-badge">BEST</span>':'')+' </td>'+
      '<td class="'+(d.r5!==null?cc(d.r5):'neutral')+'">'+(d.r5!==null?pct(d.r5):'-')+' </td>'+
      '<td class="positive">'+(d.divPerUnit>0?'Rs.'+d.divPerUnit.toFixed(4):'-')+'</td>'+
      '<td>'+d.signal+'</td>'+
    '</tr>';
  });
  html+='</table><p style="font-size:.7rem;color:#475569;margin-top:.5rem">Chart normalized to 100 at common start. Dots = dividend events (IDCW funds). Past performance is not a guarantee of future returns.</p>';
  res.innerHTML=html;
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
    var results=await searchFunds(q);
    if(!results.length){dd.innerHTML='<div class="dropdown-loading">No results</div>';return;}
    dd.innerHTML=results.slice(0,8).map(function(r){
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
var CATEGORIES={'120':'Large Cap','119':'Mid Cap','118':'Small Cap','117':'Multi Cap','121':'ELSS','122':'Flexi Cap'};
var topCache={},topLoading=false;

async function loadTopFunds(){
  if(topLoading)return;
  var period=parseInt(document.getElementById('top-period').value);
  var catCode=document.getElementById('top-category').value;
  var catName=CATEGORIES[catCode];
  var cacheKey=catCode+'-'+period;
  var res=document.getElementById('top-results');
  if(topCache[cacheKey]){renderTopTable(topCache[cacheKey],catName,period);return;}
  topLoading=true;
  res.innerHTML='<p class="top-loading">Searching '+catName+' funds...</p>';
  var results=await searchFunds(catName+' fund');
  if(!results||!results.length){res.innerHTML='<p class="top-hint">Could not load. Try again.</p>';topLoading=false;return;}
  var candidates=results.slice(0,30);
  var cutoffStr=daysAgoStr(period);
  var scored=[];
  for(var b=0;b<candidates.length;b+=6){
    var batch=candidates.slice(b,b+6);
    var fetched=await Promise.all(batch.map(async function(c){
      var data=await fetchNAV(c.schemeCode);
      if(!data||!data._parsed||data._parsed.length<2)return null;
      var navNow=latestNAV(data);
      var navThen=getNavOnDate(data,cutoffStr);
      if(!navThen||navThen<=0)return null;
      var years=period/365;
      var annualized=Math.pow(navNow/navThen,1/years)-1;
      return{name:c.schemeName,code:c.schemeCode,ret:annualized,navNow:navNow};
    }));
    fetched.forEach(function(f){if(f)scored.push(f);});
  }
  scored.sort(function(a,b){return b.ret-a.ret;});
  var top10=scored.slice(0,10);
  topCache[cacheKey]=top10;
  renderTopTable(top10,catName,period);
  topLoading=false;
}

function renderTopTable(funds,catName,period){
  var res=document.getElementById('top-results');
  var yrs=period===365?'1 Year':period===1095?'3 Years':'5 Years';
  if(!funds.length){res.innerHTML='<p class="top-hint">No data available.</p>';return;}
  var html='<div style="font-size:.78rem;color:#64748b;margin-bottom:.75rem">Top '+catName+' funds by annualized return over '+yrs+'</div>';
  html+='<table class="top-table"><tr><th>#</th><th>Fund</th><th>Annualized Return</th><th>Current NAV</th></tr>';
  funds.forEach(function(f,i){
    var badge=i===0?'gold':i===1?'silver':i===2?'bronze':'';
    html+='<tr><td><span class="rank-badge '+badge+'">'+(i+1)+'</span></td>'+
      '<td style="max-width:280px;line-height:1.4">'+f.name+'</td>'+
      '<td class="'+cc(f.ret)+'">'+pct(f.ret)+'</td>'+
      '<td class="neutral">Rs.'+f.navNow.toFixed(2)+'</td></tr>';
  });
  html+='</table><p style="font-size:.7rem;color:#475569;margin-top:.75rem">Annualized returns. Past performance does not guarantee future results.</p>';
  res.innerHTML=html;
}

function daysAgoStr(n){
  var d=new Date();d.setDate(d.getDate()-n);
  return d.toISOString().slice(0,10);
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