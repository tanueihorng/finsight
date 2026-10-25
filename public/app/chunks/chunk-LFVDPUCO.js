function o(n){if(typeof n=="number")return String(n);let e=n==null?"":String(n);return/[",\n]/.test(e)||/^[=+\-@]/.test(e)?'"'+e.replace(/"/g,'""').replace(/^([=+\-@])/,"'$1")+'"':e}var r=n=>n.map(e=>e.map(o).join(",")).join(`
`);function c(n,e){let t=document.createElement("a");t.href=URL.createObjectURL(new Blob([e],{type:"text/csv"})),t.download=n,t.click(),URL.revokeObjectURL(t.href)}export{r as a,c as b};
//# sourceMappingURL=chunk-LFVDPUCO.js.map
