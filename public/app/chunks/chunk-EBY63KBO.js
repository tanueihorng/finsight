var S=s=>{let t,o=new Set,c=(e,r)=>{let n=typeof e=="function"?e(t):e;if(!Object.is(n,t)){let b=t;t=r??(typeof n!="object"||n===null)?n:Object.assign({},t,n),o.forEach(l=>l(t,b))}},i=()=>t,a={setState:c,getState:i,getInitialState:()=>u,subscribe:e=>(o.add(e),()=>o.delete(e))},u=t=s(c,i,a);return a},d=(s=>s?S(s):S);export{d as a};
//# sourceMappingURL=chunk-EBY63KBO.js.map
