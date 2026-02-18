window.xirr=function(cf,dates){
  if(!cf||cf.length<2)return null;
  var r=0.1;
  for(var i=0;i<200;i++){
    var f=0,df=0,d0=dates[0];
    for(var j=0;j<cf.length;j++){
      var t=(dates[j]-d0)/(365*24*3600*1000);
      f+=cf[j]/Math.pow(1+r,t);
      df-=t*cf[j]/Math.pow(1+r,t+1);
    }
    if(Math.abs(df)<1e-12)break;
    var nr=r-f/df;
    if(Math.abs(nr-r)<1e-6)return nr;
    r=nr;
  }
  return r;
};