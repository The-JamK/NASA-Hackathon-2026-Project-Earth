import{k as g,S as v,j as w}from"./sources.js";const y="./",m="nairobi",p="T2M",d="1990-2025";function $(e){return e?/^(?:[a-z]+:)?\/\//i.test(e)||e.startsWith("data:")||e.startsWith("blob:")?e:`${y}${e.replace(/^\/+/,"")}`:""}async function f(e){const s=await fetch($(e));if(!s.ok)throw new Error(`${e} returned ${s.status}`);return s.json()}S();N();function S(){const e=document.getElementById("sources-line");e&&(e.innerHTML=g.map(s=>{const n=v[s];return n?`<a class="text-link" href="${n.url}" target="_blank" rel="noopener noreferrer">${n.label}</a>`:""}).filter(Boolean).join(" · "))}async function N(){const e=document.getElementById("sample-case");if(e)try{const[s,n]=await Promise.all([f("/data/points.json"),f("/data/variables.json")]),t=s.points.find(o=>o.id===m),r=n.variables.find(o=>o.code===p),i=t?.trends?.[p]?.[d];if(!t||!r||!i)throw new Error(`the ${m} ${p} ${d} case is missing from the bundle`);E(e,t,r,i,s.meta)}catch(s){console.error(s),e.innerHTML='<p class="warn-note">The sample case did not load from the data bundle. <a class="text-link" href="./app.html">Open the app</a> to run a case live.</p>'}}function E(e,s,n,t,r){const i=I(t),o=s.series?.[p]||[],l=F(o,r.years,d),u=s.imagery_meta||{},h=`${Math.abs(s.lat).toFixed(2)}°${s.lat>=0?"N":"S"}`,b=`${Math.abs(s.lon).toFixed(2)}°${s.lon>=0?"E":"W"}`,_=`95% CI ${c(t.ci_low_per_decade,2)} to ${c(t.ci_high_per_decade,2)}`;e.innerHTML=`
    <div class="case-head">
      <div class="case-id">${O(`${s.id}:${p}:${d}`)}</div>
      <span class="case-window">${d.replace("-","–")} · ${a(n.short)}</span>
    </div>
    <h3 class="place-title">${a(s.name)}</h3>
    <p class="place-sub">${a(s.country)} · ${a(s.continent)} · ${h} &nbsp;${b}</p>
    ${s.imagery?`<div class="imagery">
      <img src="${a($(s.imagery))}" alt="${a(u.source||"Satellite")} imagery around ${a(s.name)}" width="640" height="360" loading="lazy" />
      <span>${a(u.label||"Imagery")}</span>
    </div>`:""}
    <div class="verdict ${i.tone}">
      <div class="verdict-stamp">${i.stamp}</div>
      <div class="verdict-rate">${c(t.slope_per_decade,2)}<span class="unit">${a(n.units)} / decade</span></div>
      <div class="verdict-sub"><span class="verdict-word">${i.word}</span> · ${_} · n = ${t.n}</div>
    </div>
    <div class="chart" id="sample-chart"></div>
    <dl class="facts">${C(t,n)}</dl>
    <div class="case-sources">
      <b>Variable:</b> ${a(n.source)}<br />
      <b>Imagery:</b> ${a(u.label||"—")} — ${a(u.attribution||"—")}
    </div>
    <details class="work">
      <summary>Show your work</summary>
      <p>Annual means only. OLS with Newey–West HAC standard errors; verdict at p &lt; 0.05; 95% interval with Student-t on n − 2 df; Sen's slope as a robust check; Mann–Kendall descriptive only. The AI proposed the variable and wrote the narrative; it did not compute a number.</p>
    </details>
  `,w(document.getElementById("sample-chart"),{years:l.years,values:l.values,trend:t,variable:n,xLabel:d.replace("-","–"),yLabel:n.units})}function I(e){const s=e.n||0,n=e.p_value??1,t=!!e.verdict?.startsWith("significant");if(e.exploratory||s<20)return{tone:"explore",stamp:"COLD CASE",word:"Exploratory"};if(!t)return{tone:"none",stamp:"NOT PROVEN",word:"Not proven"};const r=e.slope_per_decade>0;return{tone:r?"warm":"cool",stamp:n<.001?"OPEN AND SHUT":"SIGNIFICANT",word:r?"Significant warming":"Significant cooling"}}function C(e,s){const n=[["Sample size",`${e.n} annual means`],["HAC lag",e.maxlag??"—"],["HAC p-value",x(e.p_value)]];return Number.isFinite(e.ci_low_per_decade)&&Number.isFinite(e.ci_high_per_decade)&&n.push(["95% interval",`${c(e.ci_low_per_decade,2)} to ${c(e.ci_high_per_decade,2)}`]),Number.isFinite(e.sen_slope_per_decade)&&n.push(["Sen's slope",c(e.sen_slope_per_decade,2)]),Number.isFinite(e.mk_tau)&&n.push(["Mann–Kendall",`${c(e.mk_tau,2)} τ`]),Number.isFinite(e.r_squared)&&n.push(["R²",e.r_squared.toFixed(2)]),n.push(["Units",s.units]),n.push(["Baseline",s.baseline]),n.map(([t,r])=>`<dt>${a(t)}</dt><dd>${a(String(r))}</dd>`).join("")}function F(e,s,n){const[t,r]=n.split("-").map(Number),i=[],o=[];return s.forEach((l,u)=>{l>=t&&l<=r&&(i.push(l),o.push(e[u]??null))}),{years:i,values:o}}function c(e,s=3){if(!Number.isFinite(Number(e)))return"—";const n=Number(e);return`${n>=0?"+":"−"}${Math.abs(n).toFixed(s)}`}function x(e){if(e==null||!Number.isFinite(Number(e)))return"—";const s=Number(e);return s<.001?"< 0.001":s.toFixed(3)}function O(e){let s=0;for(let n=0;n<e.length;n+=1)s=s*31+e.charCodeAt(n)>>>0;return`CASE-${s.toString(16).toUpperCase().padStart(4,"0").slice(-4)}`}function a(e){return String(e??"").replace(/[&<>"']/g,s=>s==="&"?"&amp;":s==="<"?"&lt;":s===">"?"&gt;":s==='"'?"&quot;":"&#39;")}
