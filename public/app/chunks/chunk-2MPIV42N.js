var l=e=>e!=null&&e<10?4:2,a=e=>"upd "+new Date(e).toLocaleTimeString("en-US",{hour12:!1});function m(e,n){let t=e.Indices?.find(r=>r.symbol==="^GSPC");return!t||!("marketTime"in t)||!t.marketTime?null:n-t.marketTime<6*6e4?{text:"LIVE",className:"pill open"}:{text:"CLOSED",className:"pill closed"}}export{l as a,a as b,m as c};
//# sourceMappingURL=chunk-2MPIV42N.js.map
