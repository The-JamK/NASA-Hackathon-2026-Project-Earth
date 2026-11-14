import{o as v,S as w,j as y}from"./sources.js";const N="./",f="nairobi",p="T2M",d="1990-2025";function $(e){return e?/^(?:[a-z]+:)?\/\//i.test(e)||e.startsWith("data:")||e.startsWith("blob:")?e:`${N}${e.replace(/^\/+/,"")}`:""}async function h(e){const s=await fetch($(e));if(!s.ok)throw new Error(`${e} returned ${s.status}`);return s.json()}S();E();function S(){const e=document.getElementById("sources-line");e&&(e.innerHTML=v.map(s=>{const t=w[s];return t?`<a class="text-link" href="${t.url}" target="_blank" rel="noopener noreferrer">${t.label}</a>`:""}).filter(Boolean).join(" · "))}async function E(){const e=document.getElementById("sample-case");if(e)try{const[s,t]=await Promise.all([h("/data/points.json"),h("/data/variables.json")]),n=s.points.find(o=>o.id===f),i=t.variables.find(o=>o.code===p),r=n?.trends?.[p]?.[d];if(!n||!i||!r)throw new Error(`the ${f} ${p} ${d} case is missing from the bundle`);I(e,n,i,r,s.meta)}catch(s){console.error(s),e.innerHTML='<p class="warn-note">The sample case did not load from the data bundle. <a class="text-link" href="./app.html">Open the app</a> to run a case live.</p>'}}function I(e,s,t,n,i){const r=C(n),o=s.series?.[p]||[],l=k(o,i.years,d),u=s.imagery_meta||{},_=`${Math.abs(s.lat).toFixed(2)}°${s.lat>=0?"N":"S"}`,b=`${Math.abs(s.lon).toFixed(2)}°${s.lon>=0?"E":"W"}`,g=`95% CI ${c(n.ci_low_per_decade,2)} to ${c(n.ci_high_per_decade,2)}`;e.innerHTML=`
    <div class="case-head">
      <div class="case-id">${A(`${s.id}:${p}:${d}`)}</div>
      <span class="case-window">${d.replace("-","–")} · ${a(t.short)}</span>
    </div>
    <h3 class="place-title">${a(s.name)}</h3>
    <p class="place-sub">${a(s.country)} · ${a(s.continent)} · ${_} &nbsp;${b}</p>
    ${s.imagery?`<div class="imagery">
      <img src="${a($(s.imagery))}" alt="${a(u.source||"Satellite")} imagery around ${a(s.name)}" width="640" height="360" loading="lazy" />
      <span>${a(u.label||"Imagery")}</span>
    </div>`:""}
    <div class="verdict ${r.tone}">
      <div class="verdict-stamp">${r.stamp}</div>
      <div class="verdict-rate">${c(n.slope_per_decade,2)}<span class="unit">${a(t.units)} / decade</span></div>
      <div class="verdict-sub"><span class="verdict-word">${r.word}</span> · ${g} · n = ${n.n}</div>
    </div>
    <div class="chart" id="sample-chart"></div>
    <dl class="facts">${F(n,t)}</dl>
    <div class="case-sources">
      <b>Variable:</b> ${a(t.source)}<br />
      <b>Imagery:</b> ${a(u.label||"—")} — ${a(u.attribution||"—")}
    </div>
    <details class="work">
      <summary>Show your work</summary>
      <p>Annual means only. OLS with Newey–West HAC standard errors; 95% interval with Student-t on n − 2 df; Sen's slope as a robust check. A verdict needs the HAC p &lt; 0.05 and the Hamed–Rao corrected Mann–Kendall p &lt; 0.05, in the same direction. The AI proposed the variable and wrote the narrative; it did not compute a number.</p>
    </details>
  `,y(document.getElementById("sample-chart"),{years:l.years,values:l.values,trend:n,variable:t,xLabel:d.replace("-","–"),yLabel:t.units})}function C(e){const s=e.n||0,t=e.p_value??1,n=!!e.verdict?.startsWith("significant");if(e.exploratory||s<20)return{tone:"explore",stamp:"COLD CASE",word:"Exploratory"};if(!n)return{tone:"none",stamp:"NOT PROVEN",word:"Not proven"};const i=e.slope_per_decade>0;return{tone:i?"warm":"cool",stamp:t<.001?"OPEN AND SHUT":"SIGNIFICANT",word:i?"Significant warming":"Significant cooling"}}function F(e,s){const t=[["Sample size",`${e.n} annual means`],["HAC lag",e.maxlag??"—"],["HAC p-value",m(e.p_value)]];return Number.isFinite(e.ci_low_per_decade)&&Number.isFinite(e.ci_high_per_decade)&&t.push(["95% interval",`${c(e.ci_low_per_decade,2)} to ${c(e.ci_high_per_decade,2)}`]),Number.isFinite(e.sen_slope_per_decade)&&t.push(["Sen's slope",c(e.sen_slope_per_decade,2)]),Number.isFinite(e.mk_tau)&&t.push(["Mann–Kendall",`${c(e.mk_tau,2)} τ`]),Number.isFinite(e.mk_p)&&t.push(["MK p (i.i.d.)",m(e.mk_p)]),Number.isFinite(e.mk_p_corrected)&&t.push(["MK p (Hamed–Rao)",m(e.mk_p_corrected)]),Number.isFinite(e.r_squared)&&t.push(["R²",e.r_squared.toFixed(2)]),t.push(["Units",s.units]),t.push(["Baseline",s.baseline]),t.map(([n,i])=>`<dt>${a(n)}</dt><dd>${a(String(i))}</dd>`).join("")}function k(e,s,t){const[n,i]=t.split("-").map(Number),r=[],o=[];return s.forEach((l,u)=>{l>=n&&l<=i&&(r.push(l),o.push(e[u]??null))}),{years:r,values:o}}function c(e,s=3){if(!Number.isFinite(Number(e)))return"—";const t=Number(e);return`${t>=0?"+":"−"}${Math.abs(t).toFixed(s)}`}function m(e){if(e==null||!Number.isFinite(Number(e)))return"—";const s=Number(e);return s<.001?"< 0.001":s.toFixed(3)}function A(e){let s=0;for(let t=0;t<e.length;t+=1)s=s*31+e.charCodeAt(t)>>>0;return`CASE-${s.toString(16).toUpperCase().padStart(4,"0").slice(-4)}`}function a(e){return String(e??"").replace(/[&<>"']/g,s=>s==="&"?"&amp;":s==="<"?"&lt;":s===">"?"&gt;":s==='"'?"&quot;":"&#39;")}
