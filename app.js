var PIN_KEY='mfd_pin',PORT_KEY='mfd_portfolio';

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
function show(id){document.getElementById(id).classList.remove('hidden');}
function hide(id){document.getElementById(id).classList.add('hidden');}
function fmt(n){return 'Rs.'+Number(n).toLocaleString('en-IN',{maximumFractionDigits:0});}
function pct(n){return(n>=0?'+':'')+(n*100).toFixed(2)+'%';}
function cc(n){return n>0?'positive':n<0?'negative':'neutral';}
function loadPortfolio(){try{return JSON.parse(localStorage.getItem(PORT_KEY))||[];}catch(e){return[];}}
function savePortfolio(p){localStorage.setItem(PORT_KEY,JSON.stringify(p));}

var navCache={};
async function fetchNAV(code){
  if(navCache[code])return navCache[code];
  try{var r=await fetch('https://api.mfapi.in/mf/'+code);var d=await r.json();navCache[code]=d;return d;}
  catch(e){return null;}
}
async function searchFunds(q){
  try{var r=await fetch('https://api.mfapi.in/mf/search?q='+encodeURIComponent(q));return await r.json();}
  catch(e){return[];}
}
function getNavOnDate(data,ds){
  for(var i=0;i<data.data.length;i++){
    var p=data.data[i].date.split('-');
    if(p[2]+'-'+p[1]+'-'+p[0]<=ds)return parseFloat(data.data[i].nav);
  }
  return parseFloat(data.data[data.data.length-1].nav);
}
function latestNAV(data){return parseFloat(data.data[0].nav);}
function calcXIRR(inv,cur,date){return window.xirr([-inv,cur],[new Date(date),new Date()]);}

// Date helper — returns YYYY-MM-DD string N days ago
function daysAgoStr(n){
  var d=new Date();d.setDate(d.getDate()-n);
  return d.toISOString().slice(0,10);
}

var portfolio=[];

async function init(){
  portfolio=loadPortfolio();
  renderFunds();
  updateSummary();
  loadTopFunds();
  document.getElementById('last-updated').textContent='Data from mfapi.in - '+new Date().toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
}

// ── Your Funds ────────────────────────────────────────────
function renderFunds(){
  var g=document.getElementById('funds-grid');
  if(!portfolio.length){
    g.innerHTML='<div class="empty-state"><p>No funds added yet. Click <strong>+ Add Fund</strong> to get started.</p></div>';
    return;
  }
  g.innerHTML=portfolio.map(function(f,i){
    return '<div class="fund-card" id="fc-'+i+'">'+
      '<div class="fund-card-top"><div class="fund-name">'+f.name+'</div>'+
      '<button class="fund-remove" onclick="removeFund('+i+')" title="Remove fund">Remove</button></div>'+
      '<div class="fund-meta">'+
        '<div class="fund-stat"><span class="fs-label">Invested</span><span class="fs-value neutral">'+fmt(f.amount)+'</span></div>'+
        '<div class="fund-stat"><span class="fs-label">Since</span><span class="fs-value neutral">'+new Date(f.date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})+'</span></div>'+
      '</div><div class="fund-loading" id="fl-'+i+'">Fetching NAV...</div></div>';
  }).join('');
  portfolio.forEach(function(f,i){loadFundData(f,i);});
}

async function loadFundData(f,i){
  var data=await fetchNAV(f.code);
  var el=document.getElementById('fc-'+i),le=document.getElementById('fl-'+i);
  if(!data||!el)return;
  var nav=latestNAV(data),cur=nav*f.units,gain=cur-f.amount,ap=gain/f.amount,xirr=calcXIRR(f.amount,cur,f.date);
  if(le)le.remove();
  el.insertAdjacentHTML('beforeend',
    '<div class="fund-meta" style="margin-top:.85rem">'+
      '<div class="fund-stat"><span class="fs-label">Current Value</span><span class="fs-value '+cc(gain)+'">'+fmt(cur)+'</span></div>'+
      '<div class="fund-stat"><span class="fs-label">Gain / Loss</span><span class="fs-value '+cc(gain)+'">'+fmt(gain)+'</span></div>'+
      '<div class="fund-stat"><span class="fs-label">Absolute</span><span class="fs-value '+cc(ap)+'">'+pct(ap)+'</span></div>'+
      '<div class="fund-stat"><span class="fs-label">XIRR</span><span class="fs-value '+cc(xirr)+'">'+pct(xirr)+'</span></div>'+
    '</div>'+
    '<div class="fund-progress">'+
      '<div style="display:flex;justify-content:space-between;font-size:.7rem;color:#64748b">'+
        '<span>NAV: Rs.'+nav.toFixed(4)+'</span><span>'+f.units.toFixed(3)+' units</span></div>'+
      '<div class="progress-bar"><div class="progress-fill" style="width:'+Math.min(50+ap*50,100)+'%"></div></div>'+
    '</div>');
  portfolio[i]._cur=cur;portfolio[i]._gain=gain;portfolio[i]._xirr=xirr;
  updateSummary();
}

function updateSummary(){
  var inv=portfolio.reduce(function(s,f){return s+(f.amount||0);},0);
  var cur=portfolio.reduce(function(s,f){return s+(f._cur||0);},0);
  var gain=cur-inv;
  document.getElementById('total-invested').textContent=fmt(inv);
  document.getElementById('total-current').textContent=cur>0?fmt(cur):'-';
  var ge=document.getElementById('total-gain');
  ge.textContent=gain!==0?fmt(gain)+' ('+pct(gain/inv)+')':'-';
  ge.className='s-value '+cc(gain);
  if(portfolio.length&&portfolio.every(function(f){return f._xirr!==undefined;})&&inv>0){
    var earliest=new Date(Math.min.apply(null,portfolio.map(function(f){return new Date(f.date);})));
    var px=window.xirr([-inv,cur],[earliest,new Date()]);
    var xe=document.getElementById('portfolio-xirr');
    xe.textContent=px!==null?pct(px):'-';xe.className='s-value '+cc(px);
  }
}

function removeFund(i){
  if(!confirm('Remove "'+portfolio[i].name+'" from your portfolio?'))return;
  portfolio.splice(i,1);
  savePortfolio(portfolio);
  renderFunds();
  updateSummary();
}

// ── Top Performers ────────────────────────────────────────
// Category codes map to AMFI category search terms
var CATEGORIES={
  '120':'Large Cap','119':'Mid Cap','118':'Small Cap',
  '117':'Multi Cap','121':'ELSS','122':'Flexi Cap'
};

var topCache={};
var topLoading=false;

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

  // Search for funds in this category
  var results=await searchFunds(catName+' fund');
  if(!results||!results.length){
    res.innerHTML='<p class="top-hint">Could not load funds. Try again.</p>';
    topLoading=false;return;
  }

  // Limit to first 30 results to avoid too many API calls
  var candidates=results.slice(0,30);
  var cutoffStr=daysAgoStr(period);
  var scored=[];

  res.innerHTML='<p class="top-loading">Fetching NAV history for '+candidates.length+' funds...</p>';

  // Fetch NAV data in parallel batches of 6
  for(var b=0;b<candidates.length;b+=6){
    var batch=candidates.slice(b,b+6);
    var fetched=await Promise.all(batch.map(async function(c){
      var data=await fetchNAV(c.schemeCode);
      if(!data||!data.data||data.data.length<2)return null;
      var navNow=latestNAV(data);
      var navThen=getNavOnDate(data,cutoffStr);
      if(!navThen||navThen<=0)return null;
      // Annualized return
      var years=period/365;
      var annualized=Math.pow(navNow/navThen,1/years)-1;
      return{name:c.schemeName,code:c.schemeCode,ret:annualized,navNow:navNow};
    }));
    fetched.forEach(function(f){if(f)scored.push(f);});
  }

  // Sort by annualized return descending, take top 10
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
    html+='<tr>'+
      '<td><span class="rank-badge '+badge+'">'+(i+1)+'</span></td>'+
      '<td style="max-width:280px;line-height:1.4">'+f.name+'</td>'+
      '<td class="'+cc(f.ret)+'">'+pct(f.ret)+'</td>'+
      '<td class="neutral">Rs.'+f.navNow.toFixed(2)+'</td>'+
    '</tr>';
  });
  html+='</table><p style="font-size:.7rem;color:#475569;margin-top:.75rem">Returns are annualized. Past performance does not guarantee future results.</p>';
  res.innerHTML=html;
}

// ── Add Fund Modal ────────────────────────────────────────
var searchTimer,selectedFund=null;
function openAddFund(){
  selectedFund=null;
  ['fund-search','fund-amount','fund-date','fund-units'].forEach(function(id){document.getElementById(id).value='';});
  hide('fund-dropdown');show('modal');
}
function closeModal(){hide('modal');}
function searchFund(q){
  clearTimeout(searchTimer);
  if(q.length<2){hide('fund-dropdown');return;}
  searchTimer=setTimeout(async function(){
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
  selectedFund={code:code,name:name};
  document.getElementById('fund-search').value=name;
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

// ── Compare ───────────────────────────────────────────────
var compareTimer;
function searchCompare(q){
  clearTimeout(compareTimer);
  var dd=document.getElementById('compare-dropdown');
  if(q.length<2){dd.classList.add('hidden');return;}
  compareTimer=setTimeout(async function(){
    dd.innerHTML='<div class="dropdown-loading">Searching...</div>';dd.classList.remove('hidden');
    var results=await searchFunds(q);
    if(!results.length){dd.innerHTML='<div class="dropdown-loading">No results</div>';return;}
    dd.innerHTML=results.slice(0,8).map(function(r){
      return '<div class="dropdown-item" onclick="runCompare('+r.schemeCode+',this.textContent)">'+r.schemeName+'</div>';
    }).join('');
  },350);
}
async function runCompare(code,name){
  hide('compare-dropdown');document.getElementById('compare-input').value=name;
  var res=document.getElementById('compare-result');
  res.innerHTML='<p style="color:#64748b">Fetching data...</p>';res.classList.remove('hidden');
  var data=await fetchNAV(code);
  if(!data){res.innerHTML='<p style="color:#f87171">Could not fetch data.</p>';return;}
  var rows=await Promise.all(portfolio.map(async function(f){
    var hypo=(f.amount/getNavOnDate(data,f.date))*latestNAV(data);
    return{name:f.name,myX:f._xirr,cX:calcXIRR(f.amount,hypo,f.date)};
  }));
  var sn=name.split(' ').slice(0,4).join(' ');
  var html='<h4>Your funds vs. '+name+'</h4><table class="compare-table"><tr><th>Your Fund</th><th>Your XIRR</th><th>'+sn+'... XIRR</th><th>Result</th></tr>';
  rows.forEach(function(r){
    var yw=r.myX!==null&&r.cX!==null&&r.myX>=r.cX;
    html+='<tr><td>'+r.name.substring(0,35)+'...</td>'+
      '<td class="'+cc(r.myX)+'">'+(r.myX!==null?pct(r.myX):'-')+'</td>'+
      '<td class="'+cc(r.cX)+'">'+(r.cX!==null?pct(r.cX):'-')+'</td>'+
      '<td>'+(yw?'Yours <span class="winner-badge">BETTER</span>':'Compare <span class="winner-badge" style="background:#7c2d12;color:#fb923c">BETTER</span>')+'</td></tr>';
  });
  res.innerHTML=html+'</table>';
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

// ── Boot ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',initPin);
document.addEventListener('DOMContentLoaded',function(){
  var p=document.getElementById('pin-input');
  if(p)p.addEventListener('keydown',function(e){if(e.key==='Enter')checkPin();});
});