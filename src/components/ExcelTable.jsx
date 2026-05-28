import { useState, useCallback, useRef, useEffect, useMemo, useReducer } from "react";

// ─── Google Fonts Loader ──────────────────────────────────────────────────────
const GFONTS = ["Roboto","Open+Sans","Lato","Montserrat","Raleway","Poppins","Inter","Playfair+Display","Merriweather","Source+Code+Pro","Fira+Code","Space+Mono","Nunito","Quicksand","Dancing+Script","Pacifico","Ubuntu+Mono","JetBrains+Mono","Crimson+Text","EB+Garamond"];
if (typeof document !== "undefined" && !document.getElementById("excel-gfonts")) {
  const link = document.createElement("link");
  link.id = "excel-gfonts";
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?${GFONTS.map(f=>`family=${f}:wght@400;600;700`).join("&")}&display=swap`;
  document.head.appendChild(link);
}

// ─── Constants ────────────────────────────────────────────────────────────────
const SEL_COLOR = "#1a73e8";
const SEL_BG    = "#e8f0fe";
const BORDER    = "#d0d7de";
const HEADER_BG = "#E8EAED";
const FROZEN_BG = "#F1F3F4";
const tBtn = { padding:"2px 8px", fontSize:11, border:"1px solid #d0d0d0", borderRadius:4, background:"#e8eaed", cursor:"pointer", fontFamily:"monospace", color:"#333" };

// ─── Undo/Redo ────────────────────────────────────────────────────────────────
const historyReducer = (state, action) => {
  switch (action.type) {
    case "PUSH": return { past:[...state.past.slice(-49), action.snapshot], future:[] };
    case "UNDO": if (!state.past.length) return state; return { past:state.past.slice(0,-1), future:[state.past[state.past.length-1],...state.future] };
    case "REDO": if (!state.future.length) return state; return { past:[...state.past,state.future[0]], future:state.future.slice(1) };
    default: return state;
  }
};

// ─── Formula Engine ───────────────────────────────────────────────────────────
const evaluateFormula = (expr, rows, cols, namedRanges = {}) => {
  if (!expr.startsWith("=")) return expr;
  try {
    let formula = expr.slice(1).toUpperCase().trim();
    Object.entries(namedRanges).forEach(([name,ref])=>{
      formula = formula.replace(new RegExp(`\\b${name.toUpperCase()}\\b`,"g"),ref.toUpperCase());
    });
    const parseCellRef = (ref) => {
      const m = ref.match(/^([A-Z]+)(\d+)$/);
      if (!m) return null;
      const ci = m[1].charCodeAt(0)-65, ri = parseInt(m[2])-1;
      if (ri<0||ri>=rows.length||ci<0||ci>=cols.length) return null;
      const val = rows[ri][cols[ci].key];
      return val===undefined?0:isNaN(Number(val))?val:Number(val);
    };
    const parseRange = (range) => {
      const [start,end] = range.split(":");
      const sm = start.match(/^([A-Z]+)(\d+)$/), em = end.match(/^([A-Z]+)(\d+)$/);
      if (!sm||!em) return [];
      const c1=sm[1].charCodeAt(0)-65, r1=parseInt(sm[2])-1, c2=em[1].charCodeAt(0)-65, r2=parseInt(em[2])-1;
      const vals=[];
      for(let r=Math.min(r1,r2);r<=Math.max(r1,r2);r++)
        for(let c=Math.min(c1,c2);c<=Math.max(c1,c2);c++)
          if(r>=0&&r<rows.length&&c>=0&&c<cols.length){const v=rows[r][cols[c].key];vals.push(isNaN(Number(v))?0:Number(v));}
      return vals;
    };
    const parseRangeRaw = (range) => {
      const [start,end] = range.split(":");
      const sm = start.match(/^([A-Z]+)(\d+)$/), em = end.match(/^([A-Z]+)(\d+)$/);
      if (!sm||!em) return [];
      const c1=sm[1].charCodeAt(0)-65, r1=parseInt(sm[2])-1, c2=em[1].charCodeAt(0)-65, r2=parseInt(em[2])-1;
      const vals=[];
      for(let r=Math.min(r1,r2);r<=Math.max(r1,r2);r++)
        for(let c=Math.min(c1,c2);c<=Math.max(c1,c2);c++)
          if(r>=0&&r<rows.length&&c>=0&&c<cols.length) vals.push(rows[r][cols[c].key]);
      return vals;
    };
    const sumMatch=formula.match(/^SUM\(([^)]+)\)$/); if(sumMatch){const a=sumMatch[1];return a.includes(":")?parseRange(a).reduce((a,b)=>a+b,0):a.split(",").reduce((acc,r)=>acc+(parseCellRef(r.trim())||0),0);}
    const avgMatch=formula.match(/^AVERAGE\(([^)]+)\)$/); if(avgMatch){const v=parseRange(avgMatch[1]);return v.length?(v.reduce((a,b)=>a+b,0)/v.length).toFixed(2):0;}
    const maxMatch=formula.match(/^MAX\(([^)]+)\)$/); if(maxMatch){const v=parseRange(maxMatch[1]);return v.length?Math.max(...v):0;}
    const minMatch=formula.match(/^MIN\(([^)]+)\)$/); if(minMatch){const v=parseRange(minMatch[1]);return v.length?Math.min(...v):0;}
    const countMatch=formula.match(/^COUNT\(([^)]+)\)$/); if(countMatch){return parseRange(countMatch[1]).filter(v=>!isNaN(v)).length;}
    const countaMatch=formula.match(/^COUNTA\(([^)]+)\)$/); if(countaMatch){return parseRangeRaw(countaMatch[1]).filter(v=>v!==""&&v!==undefined&&v!==null).length;}
    const countifMatch=formula.match(/^COUNTIF\(([^,]+),([^)]+)\)$/); if(countifMatch){const vals=parseRangeRaw(countifMatch[1].trim());const crit=countifMatch[2].trim().replace(/"/g,"");const numCrit=Number(crit);return vals.filter(v=>isNaN(numCrit)?String(v)===crit:Number(v)===numCrit).length;}
    const sumifMatch=formula.match(/^SUMIF\(([^,]+),([^,]+),([^)]+)\)$/); if(sumifMatch){const cv=parseRangeRaw(sumifMatch[1].trim());const crit=sumifMatch[2].trim().replace(/"/g,"");const sv=parseRange(sumifMatch[3].trim());const nc=Number(crit);return cv.reduce((acc,v,i)=>{const m=isNaN(nc)?String(v)===crit:Number(v)===nc;return acc+(m?(sv[i]||0):0);},0);}
    const ifMatch=formula.match(/^IF\((.+),(.+),(.+)\)$/); if(ifMatch){try{const cond=ifMatch[1].trim().replace(/([A-Z]+\d+)/g,m=>parseCellRef(m)??0);const condVal=Function('"use strict";return('+cond+')')();return condVal?ifMatch[2].trim().replace(/"/g,""):ifMatch[3].trim().replace(/"/g,"");}catch{return "#ERR";}}
    const iferrorMatch=formula.match(/^IFERROR\((.+),(.+)\)$/); if(iferrorMatch){try{const r=evaluateFormula("="+iferrorMatch[1].trim(),rows,cols,namedRanges);return r==="#ERR"?iferrorMatch[2].trim().replace(/"/g,""):r;}catch{return iferrorMatch[2].trim().replace(/"/g,"");}}
    const roundMatch=formula.match(/^ROUND\(([^,]+),(\d+)\)$/); if(roundMatch){const val=parseCellRef(roundMatch[1].trim())??Number(roundMatch[1].trim());return Number(val).toFixed(Number(roundMatch[2]));}
    const absMatch=formula.match(/^ABS\(([^)]+)\)$/); if(absMatch){return Math.abs(parseCellRef(absMatch[1].trim())??Number(absMatch[1].trim()));}
    const concatMatch=formula.match(/^CONC(?:ATENATE)?\((.+)\)$/); if(concatMatch){return concatMatch[1].split(",").map(a=>{const t=a.trim();return t.startsWith('"')?t.replace(/"/g,""):String(parseCellRef(t)??t);}).join("");}
    const lenMatch=formula.match(/^LEN\(([^)]+)\)$/); if(lenMatch){const v=parseRangeRaw(lenMatch[1])[0]??parseCellRef(lenMatch[1].trim())??lenMatch[1].trim().replace(/"/g,"");return String(v).length;}
    const leftMatch=formula.match(/^LEFT\(([^,]+),(\d+)\)$/); if(leftMatch){return String(parseCellRef(leftMatch[1].trim())??"").slice(0,Number(leftMatch[2]));}
    const rightMatch=formula.match(/^RIGHT\(([^,]+),(\d+)\)$/); if(rightMatch){return String(parseCellRef(rightMatch[1].trim())??"").slice(-Number(rightMatch[2]));}
    const midMatch=formula.match(/^MID\(([^,]+),(\d+),(\d+)\)$/); if(midMatch){const v=String(parseCellRef(midMatch[1].trim())??"");return v.slice(Number(midMatch[2])-1,Number(midMatch[2])-1+Number(midMatch[3]));}
    const upperMatch=formula.match(/^UPPER\(([^)]+)\)$/); if(upperMatch){return String(parseCellRef(upperMatch[1].trim())??upperMatch[1].trim().replace(/"/g,"")).toUpperCase();}
    const lowerMatch=formula.match(/^LOWER\(([^)]+)\)$/); if(lowerMatch){return String(parseCellRef(lowerMatch[1].trim())??lowerMatch[1].trim().replace(/"/g,"")).toLowerCase();}
    const vlookupMatch=formula.match(/^VLOOKUP\(([^,]+),([^,]+),(\d+)(?:,[^)]+)?\)$/); if(vlookupMatch){const lv=parseCellRef(vlookupMatch[1].trim())??vlookupMatch[1].trim().replace(/"/g,"");const colIdx=Number(vlookupMatch[3])-1;const sm2=vlookupMatch[2].trim().split(":")[0].match(/^([A-Z]+)(\d+)$/);if(!sm2)return "#N/A";const startC=sm2[1].charCodeAt(0)-65,startR=parseInt(sm2[2])-1;for(let r=startR;r<rows.length;r++){const cv=rows[r][cols[startC]?.key];if(String(cv)===String(lv))return rows[r][cols[startC+colIdx]?.key]??"#N/A";}return "#N/A";}
    if(formula==="TODAY()")return new Date().toLocaleDateString();
    if(formula==="NOW()")return new Date().toLocaleString();

    // ── XLOOKUP ────────────────────────────────────────────────────────────────
    const xlookupMatch=formula.match(/^XLOOKUP\(([^,]+),([^,]+),([^,)]+)(?:,([^,)]*))?(?:,([^,)]*))?(?:,([^)]*))??\)$/);
    if(xlookupMatch){const lv=parseCellRef(xlookupMatch[1].trim())??xlookupMatch[1].trim().replace(/"/g,"");const sv=parseRangeRaw(xlookupMatch[2].trim());const rv=parseRangeRaw(xlookupMatch[3].trim());const notFound=xlookupMatch[4]?xlookupMatch[4].trim().replace(/"/g,""):"#N/A";const idx=sv.findIndex(v=>String(v)===String(lv));return idx>=0?(rv[idx]??notFound):notFound;}

    // ── INDEX ──────────────────────────────────────────────────────────────────
    const indexMatch=formula.match(/^INDEX\(([^,]+),(\d+)(?:,(\d+))?\)$/);
    if(indexMatch){const ri2=Number(indexMatch[2])-1,ci2=indexMatch[3]?Number(indexMatch[3])-1:0;const sm2=indexMatch[1].trim().split(":")[0].match(/^([A-Z]+)(\d+)$/);if(!sm2)return "#REF";const sc=sm2[1].charCodeAt(0)-65,sr=parseInt(sm2[2])-1;return rows[sr+ri2]?.[cols[sc+ci2]?.key]??"";}

    // ── MATCH ──────────────────────────────────────────────────────────────────
    const matchMatch=formula.match(/^MATCH\(([^,]+),([^,]+)(?:,([^)]+))?\)$/);
    if(matchMatch){const lv=parseCellRef(matchMatch[1].trim())??matchMatch[1].trim().replace(/"/g,"");const rv=parseRangeRaw(matchMatch[2].trim());const idx=rv.findIndex(v=>String(v)===String(lv));return idx>=0?idx+1:"#N/A";}

    // ── CHOOSE ─────────────────────────────────────────────────────────────────
    const chooseMatch=formula.match(/^CHOOSE\(([^,]+),(.+)\)$/);
    if(chooseMatch){const idx=Number(parseCellRef(chooseMatch[1].trim())??chooseMatch[1].trim())-1;const opts=chooseMatch[2].split(",");return opts[idx]?.trim().replace(/"/g,"")??"#VALUE";}

    // ── IFS ────────────────────────────────────────────────────────────────────
    const ifsMatch=formula.match(/^IFS\((.+)\)$/);
    if(ifsMatch){const parts=ifsMatch[1].split(",");for(let i=0;i<parts.length-1;i+=2){try{const cond=parts[i].trim().replace(/([A-Z]+\d+)/g,m=>parseCellRef(m)??0);if(Function('"use strict";return('+cond+')')())return parts[i+1].trim().replace(/"/g,"");}catch{}}return "#N/A";}

    // ── SWITCH ────────────────────────────────────────────────────────────────
    const switchMatch=formula.match(/^SWITCH\(([^,]+),(.+)\)$/);
    if(switchMatch){const val=String(parseCellRef(switchMatch[1].trim())??switchMatch[1].trim().replace(/"/g,""));const parts=switchMatch[2].split(",");for(let i=0;i<parts.length-1;i+=2){if(parts[i].trim().replace(/"/g,"")===val)return parts[i+1].trim().replace(/"/g,"");}return parts.length%2===1?parts[parts.length-1].trim().replace(/"/g,""):"#N/A";}

    // ── MEDIAN ────────────────────────────────────────────────────────────────
    const medianMatch=formula.match(/^MEDIAN\(([^)]+)\)$/);
    if(medianMatch){const v=[...parseRange(medianMatch[1])].sort((a,b)=>a-b);if(!v.length)return 0;const m=Math.floor(v.length/2);return v.length%2?v[m]:((v[m-1]+v[m])/2).toFixed(2);}

    // ── MODE ──────────────────────────────────────────────────────────────────
    const modeMatch=formula.match(/^MODE\(([^)]+)\)$/);
    if(modeMatch){const v=parseRange(modeMatch[1]);if(!v.length)return "#N/A";const freq={};v.forEach(n=>{freq[n]=(freq[n]||0)+1;});return Number(Object.entries(freq).sort((a,b)=>b[1]-a[1])[0][0]);}

    // ── STDEV ─────────────────────────────────────────────────────────────────
    const stdevMatch=formula.match(/^STDEV\(([^)]+)\)$/);
    if(stdevMatch){const v=parseRange(stdevMatch[1]);if(v.length<2)return 0;const mean=v.reduce((a,b)=>a+b,0)/v.length;return Math.sqrt(v.reduce((a,b)=>a+(b-mean)**2,0)/(v.length-1)).toFixed(4);}

    // ── VAR ───────────────────────────────────────────────────────────────────
    const varMatch=formula.match(/^VAR\(([^)]+)\)$/);
    if(varMatch){const v=parseRange(varMatch[1]);if(v.length<2)return 0;const mean=v.reduce((a,b)=>a+b,0)/v.length;return (v.reduce((a,b)=>a+(b-mean)**2,0)/(v.length-1)).toFixed(4);}

    // ── RANK ──────────────────────────────────────────────────────────────────
    const rankMatch=formula.match(/^RANK\(([^,]+),([^,)]+)(?:,([^)]+))?\)$/);
    if(rankMatch){const val=Number(parseCellRef(rankMatch[1].trim())??rankMatch[1].trim());const v=parseRange(rankMatch[2].trim());const order=rankMatch[3]?.trim()==="1"?1:0;const sorted=[...v].sort((a,b)=>order?a-b:b-a);return sorted.indexOf(val)+1;}

    // ── PERCENTILE ────────────────────────────────────────────────────────────
    const pctMatch=formula.match(/^PERCENTILE\(([^,]+),([^)]+)\)$/);
    if(pctMatch){const v=[...parseRange(pctMatch[1])].sort((a,b)=>a-b);const p=Number(pctMatch[2].trim());if(!v.length)return 0;const idx=p*(v.length-1);const lo=Math.floor(idx);return (v[lo]+(v[lo+1]??v[lo])*(idx-lo)).toFixed(2);}

    // ── TEXTJOIN ──────────────────────────────────────────────────────────────
    const textjoinMatch=formula.match(/^TEXTJOIN\(([^,]+),([^,]+),(.+)\)$/);
    if(textjoinMatch){const delim=textjoinMatch[1].trim().replace(/"/g,"");const ignoreEmpty=textjoinMatch[2].trim().toUpperCase()==="TRUE";const vals=parseRangeRaw(textjoinMatch[3].trim());return vals.filter(v=>ignoreEmpty?v!==""&&v!==undefined:true).join(delim);}

    // ── SUBSTITUTE ────────────────────────────────────────────────────────────
    const subMatch=formula.match(/^SUBSTITUTE\(([^,]+),([^,]+),([^)]+)\)$/);
    if(subMatch){const src=String(parseCellRef(subMatch[1].trim())??subMatch[1].trim().replace(/"/g,""));const find=subMatch[2].trim().replace(/"/g,"");const rep=subMatch[3].trim().replace(/"/g,"");return src.split(find).join(rep);}

    // ── TRIM ──────────────────────────────────────────────────────────────────
    const trimMatch=formula.match(/^TRIM\(([^)]+)\)$/);
    if(trimMatch){return String(parseCellRef(trimMatch[1].trim())??trimMatch[1].trim().replace(/"/g,"")).trim().replace(/\s+/g," ");}

    // ── PROPER ────────────────────────────────────────────────────────────────
    const properMatch=formula.match(/^PROPER\(([^)]+)\)$/);
    if(properMatch){const s=String(parseCellRef(properMatch[1].trim())??properMatch[1].trim().replace(/"/g,""));return s.toLowerCase().replace(/(^|\s)\S/g,c=>c.toUpperCase());}

    // ── SEARCH ────────────────────────────────────────────────────────────────
    const searchMatch=formula.match(/^SEARCH\(([^,]+),([^)]+)\)$/);
    if(searchMatch){const needle=searchMatch[1].trim().replace(/"/g,"");const haystack=String(parseCellRef(searchMatch[2].trim())??searchMatch[2].trim().replace(/"/g,"")).toLowerCase();const idx=haystack.indexOf(needle.toLowerCase());return idx>=0?idx+1:"#VALUE";}

    // ── FIND ──────────────────────────────────────────────────────────────────
    const findFnMatch=formula.match(/^FIND\(([^,]+),([^)]+)\)$/);
    if(findFnMatch){const needle=findFnMatch[1].trim().replace(/"/g,"");const haystack=String(parseCellRef(findFnMatch[2].trim())??findFnMatch[2].trim().replace(/"/g,""));const idx=haystack.indexOf(needle);return idx>=0?idx+1:"#VALUE";}

    // ── REPLACE ───────────────────────────────────────────────────────────────
    const replaceMatch=formula.match(/^REPLACE\(([^,]+),(\d+),(\d+),([^)]+)\)$/);
    if(replaceMatch){const src=String(parseCellRef(replaceMatch[1].trim())??"");const start=Number(replaceMatch[2])-1;const len=Number(replaceMatch[3]);const rep=replaceMatch[4].trim().replace(/"/g,"");return src.slice(0,start)+rep+src.slice(start+len);}

    // ── DATEDIF ───────────────────────────────────────────────────────────────
    const datedifMatch=formula.match(/^DATEDIF\(([^,]+),([^,]+),([^)]+)\)$/);
    if(datedifMatch){try{const d1=new Date(String(parseCellRef(datedifMatch[1].trim())??datedifMatch[1].trim().replace(/"/g,"")));const d2=new Date(String(parseCellRef(datedifMatch[2].trim())??datedifMatch[2].trim().replace(/"/g,"")));const unit=datedifMatch[3].trim().replace(/"/g,"").toUpperCase();const ms=d2-d1;if(unit==="D")return Math.floor(ms/864e5);if(unit==="M")return (d2.getFullYear()-d1.getFullYear())*12+(d2.getMonth()-d1.getMonth());if(unit==="Y")return d2.getFullYear()-d1.getFullYear();}catch{return "#ERR";}return "#ERR";}

    // ── NETWORKDAYS ───────────────────────────────────────────────────────────
    const netdaysMatch=formula.match(/^NETWORKDAYS\(([^,]+),([^)]+)\)$/);
    if(netdaysMatch){try{let d=new Date(String(parseCellRef(netdaysMatch[1].trim())??netdaysMatch[1].trim().replace(/"/g,"")));const end=new Date(String(parseCellRef(netdaysMatch[2].trim())??netdaysMatch[2].trim().replace(/"/g,"")));let count=0;while(d<=end){const day=d.getDay();if(day!==0&&day!==6)count++;d.setDate(d.getDate()+1);}return count;}catch{return "#ERR";}}

    // ── EDATE ─────────────────────────────────────────────────────────────────
    const edateMatch=formula.match(/^EDATE\(([^,]+),([^)]+)\)$/);
    if(edateMatch){try{const d=new Date(String(parseCellRef(edateMatch[1].trim())??edateMatch[1].trim().replace(/"/g,"")));d.setMonth(d.getMonth()+Number(edateMatch[2].trim()));return d.toLocaleDateString();}catch{return "#ERR";}}

    // ── EOMONTH ───────────────────────────────────────────────────────────────
    const eomonthMatch=formula.match(/^EOMONTH\(([^,]+),([^)]+)\)$/);
    if(eomonthMatch){try{const d=new Date(String(parseCellRef(eomonthMatch[1].trim())??eomonthMatch[1].trim().replace(/"/g,"")));const m=d.getMonth()+Number(eomonthMatch[2].trim())+1;return new Date(d.getFullYear(),m,0).toLocaleDateString();}catch{return "#ERR";}}

    // ── WEEKNUM ───────────────────────────────────────────────────────────────
    const weeknumMatch=formula.match(/^WEEKNUM\(([^)]+)\)$/);
    if(weeknumMatch){try{const d=new Date(String(parseCellRef(weeknumMatch[1].trim())??weeknumMatch[1].trim().replace(/"/g,"")));const start=new Date(d.getFullYear(),0,1);return Math.ceil(((d-start)/864e5+start.getDay()+1)/7);}catch{return "#ERR";}}

    // ── YEAR / MONTH / DAY ────────────────────────────────────────────────────
    const yearMatch=formula.match(/^YEAR\(([^)]+)\)$/);if(yearMatch){try{return new Date(String(parseCellRef(yearMatch[1].trim())??yearMatch[1].trim().replace(/"/g,""))).getFullYear();}catch{return "#ERR";}}
    const monthMatch2=formula.match(/^MONTH\(([^)]+)\)$/);if(monthMatch2){try{return new Date(String(parseCellRef(monthMatch2[1].trim())??monthMatch2[1].trim().replace(/"/g,""))).getMonth()+1;}catch{return "#ERR";}}
    const dayMatch=formula.match(/^DAY\(([^)]+)\)$/);if(dayMatch){try{return new Date(String(parseCellRef(dayMatch[1].trim())??dayMatch[1].trim().replace(/"/g,""))).getDate();}catch{return "#ERR";}}

    // ── PMT ───────────────────────────────────────────────────────────────────
    const pmtMatch=formula.match(/^PMT\(([^,]+),([^,]+),([^)]+)\)$/);
    if(pmtMatch){const rate=Number(parseCellRef(pmtMatch[1].trim())??pmtMatch[1].trim());const nper=Number(parseCellRef(pmtMatch[2].trim())??pmtMatch[2].trim());const pv=Number(parseCellRef(pmtMatch[3].trim())??pmtMatch[3].trim());if(rate===0)return(-pv/nper).toFixed(2);return(-(pv*rate*(1+rate)**nper)/((1+rate)**nper-1)).toFixed(2);}

    // ── NPV ───────────────────────────────────────────────────────────────────
    const npvMatch=formula.match(/^NPV\(([^,]+),([^)]+)\)$/);
    if(npvMatch){const rate=Number(parseCellRef(npvMatch[1].trim())??npvMatch[1].trim());const cf=parseRange(npvMatch[2].trim());return cf.reduce((acc,v,i)=>acc+v/Math.pow(1+rate,i+1),0).toFixed(2);}

    // ── PROFITMARGIN ──────────────────────────────────────────────────────────
    const pmargMatch=formula.match(/^PROFITMARGIN\(([^,]+),([^)]+)\)$/);
    if(pmargMatch){const rev=Number(parseCellRef(pmargMatch[1].trim())??pmargMatch[1].trim());const cost=Number(parseCellRef(pmargMatch[2].trim())??pmargMatch[2].trim());return rev?((rev-cost)/rev*100).toFixed(2)+"%":"#DIV/0";}

    // ── CAGR ──────────────────────────────────────────────────────────────────
    const cagrMatch=formula.match(/^CAGR\(([^,]+),([^,]+),([^)]+)\)$/);
    if(cagrMatch){const bv=Number(parseCellRef(cagrMatch[1].trim())??cagrMatch[1].trim());const ev=Number(parseCellRef(cagrMatch[2].trim())??cagrMatch[2].trim());const n=Number(parseCellRef(cagrMatch[3].trim())??cagrMatch[3].trim());return bv&&n?((Math.pow(ev/bv,1/n)-1)*100).toFixed(2)+"%":"#ERR";}

    // ── TAXCALC ───────────────────────────────────────────────────────────────
    const taxMatch=formula.match(/^TAXCALC\(([^,]+),([^)]+)\)$/);
    if(taxMatch){const amount=Number(parseCellRef(taxMatch[1].trim())??taxMatch[1].trim());const rate=Number(parseCellRef(taxMatch[2].trim())??taxMatch[2].trim());return (amount*rate/100).toFixed(2);}

    // ── STOCKLEFT ─────────────────────────────────────────────────────────────
    const stockMatch=formula.match(/^STOCKLEFT\(([^,]+),([^)]+)\)$/);
    if(stockMatch){const open=Number(parseCellRef(stockMatch[1].trim())??stockMatch[1].trim());const used=Number(parseCellRef(stockMatch[2].trim())??stockMatch[2].trim());return Math.max(0,open-used);}

    // ── LOWSTOCK ──────────────────────────────────────────────────────────────
    const lowstockMatch=formula.match(/^LOWSTOCK\(([^,]+),([^)]+)\)$/);
    if(lowstockMatch){const qty=Number(parseCellRef(lowstockMatch[1].trim())??lowstockMatch[1].trim());const thresh=Number(parseCellRef(lowstockMatch[2].trim())??lowstockMatch[2].trim());return qty<=thresh?"LOW STOCK":"OK";}

    // ── EXPIRYDAYS ────────────────────────────────────────────────────────────
    const expMatch=formula.match(/^EXPIRYDAYS\(([^)]+)\)$/);
    if(expMatch){try{const d=new Date(String(parseCellRef(expMatch[1].trim())??expMatch[1].trim().replace(/"/g,"")));return Math.ceil((d-new Date())/864e5);}catch{return "#ERR";}}

    // ── BATCHSTATUS ───────────────────────────────────────────────────────────
    const batchMatch=formula.match(/^BATCHSTATUS\(([^)]+)\)$/);
    if(batchMatch){const days=Number(parseCellRef(batchMatch[1].trim())??batchMatch[1].trim());return days<0?"EXPIRED":days<=7?"EXPIRING SOON":"VALID";}

    // ── ROI ───────────────────────────────────────────────────────────────────
    const roiMatch=formula.match(/^ROI\(([^,]+),([^)]+)\)$/);
    if(roiMatch){const gain=Number(parseCellRef(roiMatch[1].trim())??roiMatch[1].trim());const cost=Number(parseCellRef(roiMatch[2].trim())??roiMatch[2].trim());return cost?((gain-cost)/cost*100).toFixed(2)+"%":"#DIV/0";}

    // ── POWER / SQRT ──────────────────────────────────────────────────────────
    const powerMatch=formula.match(/^POWER\(([^,]+),([^)]+)\)$/);if(powerMatch){return Math.pow(Number(parseCellRef(powerMatch[1].trim())??powerMatch[1].trim()),Number(powerMatch[2].trim()));}
    const sqrtMatch=formula.match(/^SQRT\(([^)]+)\)$/);if(sqrtMatch){return Math.sqrt(Math.abs(Number(parseCellRef(sqrtMatch[1].trim())??sqrtMatch[1].trim()))).toFixed(4);}

    // ── CEILING / FLOOR ───────────────────────────────────────────────────────
    const ceilMatch=formula.match(/^CEILING\(([^,]+),([^)]+)\)$/);if(ceilMatch){const v=Number(parseCellRef(ceilMatch[1].trim())??ceilMatch[1].trim());const sig=Number(ceilMatch[2].trim());return Math.ceil(v/sig)*sig;}
    const floorMatch=formula.match(/^FLOOR\(([^,]+),([^)]+)\)$/);if(floorMatch){const v=Number(parseCellRef(floorMatch[1].trim())??floorMatch[1].trim());const sig=Number(floorMatch[2].trim());return Math.floor(v/sig)*sig;}

    // ── MOD ───────────────────────────────────────────────────────────────────
    const modMatch=formula.match(/^MOD\(([^,]+),([^)]+)\)$/);if(modMatch){return Number(parseCellRef(modMatch[1].trim())??modMatch[1].trim())%Number(modMatch[2].trim());}

    // ── EXACT ─────────────────────────────────────────────────────────────────
    const exactMatch=formula.match(/^EXACT\(([^,]+),([^)]+)\)$/);if(exactMatch){const a=String(parseCellRef(exactMatch[1].trim())??exactMatch[1].trim().replace(/"/g,""));const b=String(parseCellRef(exactMatch[2].trim())??exactMatch[2].trim().replace(/"/g,""));return a===b?"TRUE":"FALSE";}

    // ── ISBLANK / ISNUMBER / ISTEXT ───────────────────────────────────────────
    const isblankMatch=formula.match(/^ISBLANK\(([^)]+)\)$/);if(isblankMatch){const v=parseCellRef(isblankMatch[1].trim());return v===null||v===undefined||v===""?"TRUE":"FALSE";}
    const isnumberMatch=formula.match(/^ISNUMBER\(([^)]+)\)$/);if(isnumberMatch){const v=parseCellRef(isnumberMatch[1].trim());return !isNaN(Number(v))&&v!==null&&v!==""?"TRUE":"FALSE";}
    const istextMatch=formula.match(/^ISTEXT\(([^)]+)\)$/);if(istextMatch){const v=parseCellRef(istextMatch[1].trim());return isNaN(Number(v))&&v!==null?"TRUE":"FALSE";}

    if(formula==="TODAY()")return new Date().toLocaleDateString();
    if(formula==="NOW()")return new Date().toLocaleString();
    const cellVal=parseCellRef(formula); if(cellVal!==null)return cellVal;
    const resolved=formula.replace(/([A-Z]+\d+)/g,m=>parseCellRef(m)??0);
    return Function('"use strict";return('+resolved+')')();
  } catch { return "#ERR"; }
};

// ─── Formula Autocomplete suggestions ─────────────────────────────────────────
const FORMULA_FNS = [
  "SUM","AVERAGE","MAX","MIN","COUNT","COUNTA","COUNTIF","SUMIF","ROUND","ABS","POWER","SQRT","CEILING","FLOOR","MOD",
  "IF","IFERROR","IFS","SWITCH","ISBLANK","ISNUMBER","ISTEXT","EXACT",
  "VLOOKUP","XLOOKUP","INDEX","MATCH","CHOOSE",
  "CONCATENATE","LEN","LEFT","RIGHT","MID","UPPER","LOWER","TRIM","PROPER","SUBSTITUTE","TEXTJOIN","SEARCH","FIND","REPLACE",
  "TODAY","NOW","YEAR","MONTH","DAY","DATEDIF","NETWORKDAYS","EDATE","EOMONTH","WEEKNUM",
  "MEDIAN","MODE","STDEV","VAR","RANK","PERCENTILE",
  "PMT","NPV","ROI","CAGR","TAXCALC","PROFITMARGIN",
  "STOCKLEFT","LOWSTOCK","EXPIRYDAYS","BATCHSTATUS",
];

// ─── Sparkline ────────────────────────────────────────────────────────────────
const Sparkline = ({ values, width=80, height=24, type="line" }) => {
  const nums = (values||[]).map(Number).filter(n=>!isNaN(n));
  if (nums.length<2) return <span style={{color:"#ccc",fontSize:10}}>—</span>;
  const min=Math.min(...nums), max=Math.max(...nums), range=max-min||1;
  const color = nums[nums.length-1]>=nums[0]?"#22c55e":"#ef4444";
  if (type==="bar") {
    const bw=(width/nums.length)-1;
    return <svg width={width} height={height} style={{display:"block"}}>{nums.map((v,i)=>{const bh=((v-min)/range)*(height-2)+2;return <rect key={i} x={i*(bw+1)} y={height-bh} width={bw} height={bh} fill={color} opacity={0.7+0.3*(i/nums.length)} rx={1}/>;})}</svg>;
  }
  const pts=nums.map((v,i)=>`${(i/(nums.length-1))*width},${height-((v-min)/range)*(height-4)-2}`).join(" ");
  const lx=(nums.length-1)/(nums.length-1)*width, ly=height-((nums[nums.length-1]-min)/range)*(height-4)-2;
  return <svg width={width} height={height} style={{display:"block"}}><polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round"/><circle cx={lx} cy={ly} r={2.5} fill={color}/></svg>;
};

// ─── Filter Dropdown ──────────────────────────────────────────────────────────
const FilterDropdown = ({ col, rows, activeFilter, onFilter, onSort, onClose }) => {
  const [search,setSearch]=useState("");
  const uniqueVals=useMemo(()=>[...new Set(rows.map(r=>String(r[col.key]??"")))].sort(),[rows,col.key]);
  const [checked,setChecked]=useState(activeFilter||new Set(uniqueVals));
  const filtered=uniqueVals.filter(v=>v.toLowerCase().includes(search.toLowerCase()));
  return (
    <div style={{position:"absolute",top:"100%",left:0,zIndex:1000,background:"#fff",border:"1px solid #d0d0d0",borderRadius:6,boxShadow:"0 8px 24px rgba(0,0,0,0.15)",minWidth:210,padding:8}}>
      <div style={{display:"flex",gap:4,marginBottom:6}}><button onClick={()=>onSort("asc")} style={tBtn}>▲ A→Z</button><button onClick={()=>onSort("desc")} style={tBtn}>▼ Z→A</button></div>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search values…" autoFocus style={{width:"100%",padding:"4px 6px",fontSize:11,border:"1px solid #ddd",borderRadius:4,marginBottom:4,boxSizing:"border-box",fontFamily:"monospace"}}/>
      <div style={{maxHeight:160,overflowY:"auto",marginBottom:6}}>
        <div style={{padding:"2px 4px",fontSize:11,cursor:"pointer",color:"#1a73e8"}} onClick={()=>setChecked(new Set(uniqueVals))}>Select All</div>
        <div style={{padding:"2px 4px",fontSize:11,cursor:"pointer",color:"#1a73e8"}} onClick={()=>setChecked(new Set())}>Clear</div>
        {filtered.map(v=>(
          <label key={v} style={{display:"flex",alignItems:"center",gap:6,padding:"2px 4px",cursor:"pointer",fontSize:11,fontFamily:"monospace"}}>
            <input type="checkbox" checked={checked.has(v)} onChange={e=>{const n=new Set(checked);e.target.checked?n.add(v):n.delete(v);setChecked(n);}}/>{v||"(blank)"}
          </label>
        ))}
      </div>
      <div style={{display:"flex",gap:4}}>
        <button onClick={()=>{onFilter(checked);onClose();}} style={{...tBtn,background:"#1a73e8",color:"#fff",flex:1}}>Apply</button>
        <button onClick={onClose} style={{...tBtn,flex:1}}>Cancel</button>
      </div>
    </div>
  );
};

// ─── Cond Format ──────────────────────────────────────────────────────────────
const applyCondFmt = (value, rules, colKey, allColValues, rowIndex) => {
  if (!rules||!rules.length) return null;
  for (const rule of rules) {
    if (rule.col!==colKey) continue;
    const num=Number(value); let match=false;
    switch(rule.op){
      case ">":match=!isNaN(num)&&num>Number(rule.val);break;
      case "<":match=!isNaN(num)&&num<Number(rule.val);break;
      case ">=":match=!isNaN(num)&&num>=Number(rule.val);break;
      case "<=":match=!isNaN(num)&&num<=Number(rule.val);break;
      case "=":match=String(value)===String(rule.val);break;
      case "contains":match=String(value).toLowerCase().includes(String(rule.val).toLowerCase());break;
      case "notempty":match=value!==""&&value!==undefined&&value!==null;break;
      case "isempty":match=value===""||value===undefined||value===null;break;
      case "beginswith":match=String(value).toLowerCase().startsWith(String(rule.val).toLowerCase());break;
      case "endswith":match=String(value).toLowerCase().endsWith(String(rule.val).toLowerCase());break;
      case "between":{const lo=Number(rule.val),hi=Number(rule.val2);match=!isNaN(num)&&num>=lo&&num<=hi;break;}
      case "topN":{if(allColValues){const nums=[...allColValues].map(Number).filter(n=>!isNaN(n)).sort((a,b)=>b-a);const thresh=nums[Number(rule.val)-1];match=!isNaN(num)&&num>=thresh;}break;}
      case "bottomN":{if(allColValues){const nums=[...allColValues].map(Number).filter(n=>!isNaN(n)).sort((a,b)=>a-b);const thresh=nums[Number(rule.val)-1];match=!isNaN(num)&&num<=thresh;}break;}
      case "aboveavg":{if(allColValues){const nums=[...allColValues].map(Number).filter(n=>!isNaN(n));const avg=nums.reduce((a,b)=>a+b,0)/nums.length;match=!isNaN(num)&&num>avg;}break;}
      case "belowavg":{if(allColValues){const nums=[...allColValues].map(Number).filter(n=>!isNaN(n));const avg=nums.reduce((a,b)=>a+b,0)/nums.length;match=!isNaN(num)&&num<avg;}break;}
      case "duplicate":{if(allColValues){const freq={};allColValues.forEach(v=>{freq[String(v)]=(freq[String(v)]||0)+1;});match=(freq[String(value)]||0)>1;}break;}
      case "unique":{if(allColValues){const freq={};allColValues.forEach(v=>{freq[String(v)]=(freq[String(v)]||0)+1;});match=(freq[String(value)]||0)===1;}break;}
      case "outlier2sd":{match=rowIndex!==undefined&&Array.isArray(rule._outlierIdxs)&&rule._outlierIdxs.includes(rowIndex);break;}
    }
    if (match) {
      // Data bar style
      if(rule.type==="databar"){
        const nums=(allColValues||[]).map(Number).filter(n=>!isNaN(n));
        const min=Math.min(...nums,0),max=Math.max(...nums,1);
        const pct=Math.max(0,Math.min(100,((num-min)/(max-min))*100));
        return {__databar:true,pct,color:rule.barColor||"#1a73e8"};
      }
      // Color scale style
      if(rule.type==="colorscale"){
        const nums=(allColValues||[]).map(Number).filter(n=>!isNaN(n));
        const min=Math.min(...nums),max=Math.max(...nums),range=max-min||1;
        const t=(num-min)/range;
        const r=Math.round(255*(1-t)),g=Math.round(200*t),b=60;
        return {background:`rgb(${r},${g},${b})`,color:t>0.5?"#fff":"#000"};
      }
      return {background:rule.bg,color:rule.fg,fontWeight:rule.bold?"bold":undefined};
    }
  }
  return null;
};

// ─── Searchable Dropdown ──────────────────────────────────────────────────────
const SearchableDropdown = ({ options, value, onChange, onBlur }) => {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(true);
  const filtered = options.filter(o=>o.toLowerCase().includes(q.toLowerCase()));
  const ref = useRef(null);
  useEffect(()=>{const h=e=>{if(ref.current&&!ref.current.contains(e.target)){onBlur&&onBlur();}};document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);},[]);
  return (
    <div ref={ref} style={{position:"absolute",inset:0,zIndex:20}}>
      <input autoFocus value={q} onChange={e=>setQ(e.target.value)}
        placeholder="Search…"
        style={{position:"absolute",inset:0,border:"none",outline:`2px solid #1a73e8`,padding:"0 6px",fontSize:12,fontFamily:"'Courier New',monospace",background:"#fff",width:"100%",boxSizing:"border-box"}}
      />
      {open&&(
        <div style={{position:"absolute",top:"100%",left:0,zIndex:10001,background:"#fff",border:"1px solid #ddd",borderRadius:4,boxShadow:"0 4px 12px rgba(0,0,0,0.15)",minWidth:160,maxHeight:160,overflowY:"auto"}}>
          {filtered.map(o=>(
            <div key={o} onClick={()=>{onChange(o);onBlur&&onBlur();}}
              style={{padding:"5px 10px",fontSize:12,cursor:"pointer",background:o===value?"#e8f0fe":"transparent",fontFamily:"'Courier New',monospace"}}
              onMouseEnter={e=>e.currentTarget.style.background="#f3f4f6"}
              onMouseLeave={e=>e.currentTarget.style.background=o===value?"#e8f0fe":"transparent"}>
              {o||"—"}
            </div>
          ))}
          {!filtered.length&&<div style={{padding:"5px 10px",fontSize:11,color:"#aaa"}}>No matches</div>}
        </div>
      )}
    </div>
  );
};

// ─── Context Menu ─────────────────────────────────────────────────────────────
const ContextMenu = ({ x, y, items, onClose }) => {
  const ref = useRef(null);
  const [openSub, setOpenSub] = useState(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useEffect(()=>{const h=e=>{if(ref.current&&!ref.current.contains(e.target))onClose();};document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);},[]);
  useEffect(()=>{
    if(!ref.current)return;
    const {width,height}=ref.current.getBoundingClientRect();
    setPos({left:x+width>window.innerWidth?Math.max(0,x-width):x,top:y+height>window.innerHeight?Math.max(0,y-height):y});
  },[x,y]);

  const menuStyle={position:"fixed",left:pos.left,top:pos.top,zIndex:9999,background:"#fff",border:"none",borderRadius:10,boxShadow:"0 8px 40px rgba(0,0,0,0.22),0 2px 8px rgba(0,0,0,0.1)",minWidth:230,padding:"6px 0",fontSize:12.5,fontFamily:"'Segoe UI',system-ui,sans-serif",userSelect:"none"};
  const divider=<div style={{height:1,background:"#f0f0f0",margin:"4px 0"}}/>;
  const sectionLabel=(lbl)=><div style={{padding:"4px 14px 2px",fontSize:10,fontWeight:700,color:"#9ca3af",textTransform:"uppercase",letterSpacing:"0.6px"}}>{lbl}</div>;

  const renderItem=(item,i)=>{
    if(item==="---")return<div key={i}>{divider}</div>;
    if(item.__section)return<div key={i}>{sectionLabel(item.__section)}</div>;
    if(item.children){
      const isOpen=openSub===i;
      return(
        <div key={i} style={{position:"relative"}} onMouseEnter={()=>setOpenSub(i)} onMouseLeave={()=>setOpenSub(null)}>
          <div style={{padding:"7px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:10,background:isOpen?"#f5f5ff":"transparent",color:"#111",transition:"background 0.1s"}}>
            <span style={{width:18,fontSize:15,textAlign:"center",flexShrink:0}}>{item.icon}</span>
            <span style={{flex:1,fontWeight:500}}>{item.label}</span>
            <span style={{fontSize:9,color:"#bbb",marginLeft:4}}>▶</span>
          </div>
          {isOpen&&(
            <div style={{position:"absolute",left:"100%",top:-6,background:"#fff",border:"none",borderRadius:10,boxShadow:"0 8px 40px rgba(0,0,0,0.22)",minWidth:220,padding:"6px 0",fontSize:12.5,zIndex:10001}}>
              {item.children.map((child,ci)=>{
                if(child==="---")return<div key={ci}>{divider}</div>;
                if(child.__section)return<div key={ci}>{sectionLabel(child.__section)}</div>;
                return(
                  <div key={ci} onClick={()=>{if(!child.disabled){child.action?.();onClose();setOpenSub(null);}}}
                    style={{padding:"7px 14px",cursor:child.disabled?"default":"pointer",display:"flex",alignItems:"center",gap:10,color:child.danger?"#ef4444":child.disabled?"#ccc":"#111",transition:"background 0.1s"}}
                    onMouseEnter={e=>{if(!child.disabled)e.currentTarget.style.background="#f5f5ff";}}
                    onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
                    <span style={{width:18,fontSize:14,textAlign:"center",flexShrink:0}}>{child.icon}</span>
                    <span style={{flex:1,fontWeight:child.bold?700:400}}>{child.label}</span>
                    {child.shortcut&&<span style={{fontSize:10,color:"#bbb",background:"#f3f4f6",padding:"1px 5px",borderRadius:3,fontFamily:"monospace"}}>{child.shortcut}</span>}
                    {child.badge&&<span style={{fontSize:9,background:"#6366f1",color:"#fff",padding:"1px 6px",borderRadius:8,fontWeight:700}}>{child.badge}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }
    return(
      <div key={i} onClick={()=>{if(!item.disabled){item.action?.();onClose();}}}
        style={{padding:"7px 14px",cursor:item.disabled?"default":"pointer",display:"flex",alignItems:"center",gap:10,color:item.danger?"#ef4444":item.disabled?"#ccc":"#111",transition:"background 0.1s"}}
        onMouseEnter={e=>{if(!item.disabled)e.currentTarget.style.background="#f5f5ff";}}
        onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
        <span style={{width:18,fontSize:14,textAlign:"center",flexShrink:0}}>{item.icon}</span>
        <span style={{flex:1,fontWeight:item.bold?700:400}}>{item.label}</span>
        {item.shortcut&&<span style={{fontSize:10,color:"#bbb",background:"#f3f4f6",padding:"1px 5px",borderRadius:3,fontFamily:"monospace"}}>{item.shortcut}</span>}
        {item.badge&&<span style={{fontSize:9,background:"#6366f1",color:"#fff",padding:"1px 6px",borderRadius:8,fontWeight:700}}>{item.badge}</span>}
      </div>
    );
  };
  return<div ref={ref} style={menuStyle}>{items.map(renderItem)}</div>;
};

// ─── Find/Replace Modal ───────────────────────────────────────────────────────
const FindReplaceModal = ({ rows, cols, onChange, onClose }) => {
  const [find,setFind]=useState(""); const [replace,setReplace]=useState(""); const [results,setResults]=useState([]);
  const doFind=()=>{if(!find)return;const hits=[];rows.forEach((r,ri)=>cols.forEach((c,ci)=>{if(String(r[c.key]??"").toLowerCase().includes(find.toLowerCase()))hits.push({ri,ci,val:r[c.key]});}));setResults(hits);};
  const doReplace=()=>{results.forEach(({ri,ci,val})=>onChange(ri,cols[ci].key,String(val).replace(new RegExp(find,"gi"),replace)));onClose();};
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.3)",zIndex:9000,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:"#fff",borderRadius:8,padding:20,minWidth:340,boxShadow:"0 16px 48px rgba(0,0,0,0.2)"}}>
        <div style={{fontWeight:700,fontSize:14,marginBottom:14}}>🔍 Find & Replace</div>
        <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:12}}>
          <input value={find} onChange={e=>setFind(e.target.value)} placeholder="Find…" style={{padding:"6px 10px",border:"1px solid #ddd",borderRadius:4,fontSize:12,fontFamily:"monospace"}}/>
          <input value={replace} onChange={e=>setReplace(e.target.value)} placeholder="Replace with…" style={{padding:"6px 10px",border:"1px solid #ddd",borderRadius:4,fontSize:12,fontFamily:"monospace"}}/>
        </div>
        {results.length>0&&<div style={{fontSize:11,color:"#1a73e8",marginBottom:10}}>{results.length} cell(s) found</div>}
        <div style={{display:"flex",gap:6,justifyContent:"flex-end"}}>
          <button onClick={onClose} style={tBtn}>Cancel</button>
          <button onClick={doFind} style={tBtn}>Find All</button>
          <button onClick={doReplace} disabled={!results.length} style={{...tBtn,background:"#1a73e8",color:"#fff",opacity:results.length?1:0.5}}>Replace All</button>
        </div>
      </div>
    </div>
  );
};

// ─── Cond Fmt Modal ───────────────────────────────────────────────────────────
const CondFmtModal = ({ cols, rules, onChange, onClose }) => {
  const [local,setLocal]=useState(rules||[]);
  const add=()=>setLocal(r=>[...r,{type:"cell",col:cols[0]?.key||"",op:">",val:"",val2:"",bg:"#fef08a",fg:"#000000",bold:false,barColor:"#1a73e8"}]);
  const upd=(i,k,v)=>setLocal(r=>r.map((x,j)=>j===i?{...x,[k]:v}:x));
  const del=i=>setLocal(r=>r.filter((_,j)=>j!==i));
  const needsVal2=(op)=>op==="between";
  const needsVal=(op)=>!["notempty","isempty","duplicate","unique","aboveavg","belowavg"].includes(op);
  const opsWithN=["topN","bottomN"];
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.3)",zIndex:9000,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:"#fff",borderRadius:8,padding:20,minWidth:560,maxHeight:"85vh",overflowY:"auto",boxShadow:"0 16px 48px rgba(0,0,0,0.2)"}}>
        <div style={{fontWeight:700,fontSize:14,marginBottom:14}}>🎨 Conditional Formatting</div>
        {local.map((rule,i)=>(
          <div key={i} style={{display:"flex",gap:6,alignItems:"center",marginBottom:8,padding:8,background:"#f9fafb",borderRadius:6,border:"1px solid #e5e7eb",flexWrap:"wrap"}}>
            {/* Rule type */}
            <select value={rule.type||"cell"} onChange={e=>upd(i,"type",e.target.value)} style={{fontSize:11,padding:"3px 6px",border:"1px solid #ddd",borderRadius:4}}>
              <option value="cell">Cell Rules</option>
              <option value="databar">Data Bar</option>
              <option value="colorscale">Color Scale</option>
            </select>
            {/* Column */}
            <select value={rule.col} onChange={e=>upd(i,"col",e.target.value)} style={{fontSize:11,padding:"3px 6px",border:"1px solid #ddd",borderRadius:4}}>
              {cols.map(c=><option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            {/* Operator */}
            <select value={rule.op} onChange={e=>upd(i,"op",e.target.value)} style={{fontSize:11,padding:"3px 6px",border:"1px solid #ddd",borderRadius:4}}>
              {[">","<",">=","<=","=","contains","notempty","isempty","beginswith","endswith","between","topN","bottomN","aboveavg","belowavg","duplicate","unique"].map(o=><option key={o}>{o}</option>)}
            </select>
            {needsVal(rule.op)&&<input value={rule.val} onChange={e=>upd(i,"val",e.target.value)} placeholder={opsWithN.includes(rule.op)?"N":""} style={{width:60,fontSize:11,padding:"3px 6px",border:"1px solid #ddd",borderRadius:4,fontFamily:"monospace"}}/>}
            {needsVal2(rule.op)&&<input value={rule.val2||""} onChange={e=>upd(i,"val2",e.target.value)} placeholder="max" style={{width:60,fontSize:11,padding:"3px 6px",border:"1px solid #ddd",borderRadius:4,fontFamily:"monospace"}}/>}
            {/* Styling options */}
            {rule.type==="databar"?(
              <><span style={{fontSize:11}}>Bar</span><input type="color" value={rule.barColor||"#1a73e8"} onChange={e=>upd(i,"barColor",e.target.value)} style={{width:28,height:22,border:"1px solid #ddd",borderRadius:3,cursor:"pointer"}}/></>
            ):rule.type!=="colorscale"?(
              <><span style={{fontSize:11}}>BG</span><input type="color" value={rule.bg||"#fef08a"} onChange={e=>upd(i,"bg",e.target.value)} style={{width:28,height:22,border:"1px solid #ddd",borderRadius:3,cursor:"pointer"}}/>
              <span style={{fontSize:11}}>Text</span><input type="color" value={rule.fg||"#000000"} onChange={e=>upd(i,"fg",e.target.value)} style={{width:28,height:22,border:"1px solid #ddd",borderRadius:3,cursor:"pointer"}}/>
              <label style={{fontSize:11,display:"flex",alignItems:"center",gap:3}}><input type="checkbox" checked={rule.bold||false} onChange={e=>upd(i,"bold",e.target.checked)}/>Bold</label></>
            ):null}
            <button onClick={()=>del(i)} style={{...tBtn,color:"#ef4444",marginLeft:"auto"}}>✕</button>
          </div>
        ))}
        <div style={{fontSize:10,color:"#888",marginBottom:8,padding:"4px 8px",background:"#f0f9ff",borderRadius:4,border:"1px solid #bae6fd"}}>
          💡 <b>Data Bar</b>: shows fill bar per value. <b>Color Scale</b>: red→green gradient. <b>Top/Bottom N</b>: highlight N best/worst. <b>Duplicate/Unique</b>: highlight repeated or unique values.
        </div>
        <div style={{display:"flex",gap:6,justifyContent:"space-between",marginTop:10}}>
          <button onClick={add} style={{...tBtn,background:"#f0fdf4",color:"#16a34a"}}>+ Add Rule</button>
          <div style={{display:"flex",gap:6}}><button onClick={onClose} style={tBtn}>Cancel</button><button onClick={()=>{onChange(local);onClose();}} style={{...tBtn,background:"#1a73e8",color:"#fff"}}>Apply</button></div>
        </div>
      </div>
    </div>
  );
};

// ─── Named Range Modal ────────────────────────────────────────────────────────
const NamedRangeModal = ({ namedRanges, onChange, onClose }) => {
  const [local,setLocal]=useState({...namedRanges}); const [newName,setNewName]=useState(""); const [newRef,setNewRef]=useState("");
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.3)",zIndex:9000,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:"#fff",borderRadius:8,padding:20,minWidth:360,boxShadow:"0 16px 48px rgba(0,0,0,0.2)"}}>
        <div style={{fontWeight:700,fontSize:14,marginBottom:14}}>📌 Named Ranges</div>
        <div style={{marginBottom:10}}>{Object.entries(local).map(([name,ref])=>(
          <div key={name} style={{display:"flex",gap:6,alignItems:"center",marginBottom:6}}>
            <code style={{flex:1,fontSize:11,background:"#f3f4f6",padding:"3px 8px",borderRadius:4}}>{name}</code>
            <span style={{fontSize:11,color:"#888"}}>→</span>
            <code style={{flex:1,fontSize:11,background:"#f3f4f6",padding:"3px 8px",borderRadius:4}}>{ref}</code>
            <button onClick={()=>setLocal(l=>{const n={...l};delete n[name];return n;})} style={{...tBtn,color:"#ef4444"}}>✕</button>
          </div>
        ))}</div>
        <div style={{display:"flex",gap:6,marginBottom:12}}>
          <input value={newName} onChange={e=>setNewName(e.target.value.toUpperCase())} placeholder="Name" style={{flex:1,padding:"4px 8px",fontSize:11,border:"1px solid #ddd",borderRadius:4,fontFamily:"monospace"}}/>
          <input value={newRef} onChange={e=>setNewRef(e.target.value.toUpperCase())} placeholder="A1:B10" style={{flex:1,padding:"4px 8px",fontSize:11,border:"1px solid #ddd",borderRadius:4,fontFamily:"monospace"}}/>
          <button onClick={()=>{if(newName&&newRef){setLocal(l=>({...l,[newName]:newRef}));setNewName("");setNewRef("");}}} style={tBtn}>Add</button>
        </div>
        <div style={{display:"flex",gap:6,justifyContent:"flex-end"}}><button onClick={onClose} style={tBtn}>Cancel</button><button onClick={()=>{onChange(local);onClose();}} style={{...tBtn,background:"#1a73e8",color:"#fff"}}>Save</button></div>
      </div>
    </div>
  );
};

// ─── Data Validation Modal ────────────────────────────────────────────────────
const DataValidationModal = ({ cols, validation, onChange, onClose }) => {
  const [local,setLocal]=useState(validation||{});
  const upd=(colKey,field,val)=>setLocal(v=>({...v,[colKey]:{...v[colKey],[field]:val}}));
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.3)",zIndex:9000,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:"#fff",borderRadius:8,padding:20,minWidth:420,maxHeight:"80vh",overflowY:"auto",boxShadow:"0 16px 48px rgba(0,0,0,0.2)"}}>
        <div style={{fontWeight:700,fontSize:14,marginBottom:14}}>✅ Data Validation</div>
        {cols.map(c=>(
          <div key={c.key} style={{marginBottom:10,padding:10,background:"#f9fafb",borderRadius:6,border:"1px solid #e5e7eb"}}>
            <div style={{fontSize:12,fontWeight:600,marginBottom:6}}>{c.label}</div>
            <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
              <select value={local[c.key]?.type||"none"} onChange={e=>upd(c.key,"type",e.target.value)} style={{fontSize:11,padding:"3px 6px",border:"1px solid #ddd",borderRadius:4}}>
                <option value="none">No validation</option><option value="number">Number</option><option value="list">List (dropdown)</option><option value="notempty">Not empty</option>
              </select>
              {local[c.key]?.type==="number"&&<>
                <select value={local[c.key]?.op||">"} onChange={e=>upd(c.key,"op",e.target.value)} style={{fontSize:11,padding:"3px 6px",border:"1px solid #ddd",borderRadius:4}}>{[">","<",">=","<=","between"].map(o=><option key={o}>{o}</option>)}</select>
                <input value={local[c.key]?.min||""} onChange={e=>upd(c.key,"min",e.target.value)} placeholder="value" style={{width:60,fontSize:11,padding:"3px 6px",border:"1px solid #ddd",borderRadius:4}}/>
                {local[c.key]?.op==="between"&&<input value={local[c.key]?.max||""} onChange={e=>upd(c.key,"max",e.target.value)} placeholder="max" style={{width:60,fontSize:11,padding:"3px 6px",border:"1px solid #ddd",borderRadius:4}}/>}
              </>}
              {local[c.key]?.type==="list"&&<input value={local[c.key]?.list||""} onChange={e=>upd(c.key,"list",e.target.value)} placeholder="a,b,c" style={{flex:1,fontSize:11,padding:"3px 6px",border:"1px solid #ddd",borderRadius:4,fontFamily:"monospace"}}/>}
            </div>
          </div>
        ))}
        <div style={{display:"flex",gap:6,justifyContent:"flex-end",marginTop:10}}><button onClick={onClose} style={tBtn}>Cancel</button><button onClick={()=>{onChange(local);onClose();}} style={{...tBtn,background:"#1a73e8",color:"#fff"}}>Save</button></div>
      </div>
    </div>
  );
};

// ─── Chart Modal (Enhanced) ───────────────────────────────────────────────────
const ChartModal = ({ rows, cols, selection, onClose }) => {
  const [chartType, setChartType] = useState("bar");
  const [labelCol, setLabelCol]   = useState(cols[0]?.key||"");
  const [valueCol, setValueCol]   = useState(cols[1]?.key||cols[0]?.key||"");
  const [value2Col, setValue2Col] = useState(cols[2]?.key||cols[1]?.key||"");
  const [chartTitle, setChartTitle] = useState("");
  const [showLegend, setShowLegend] = useState(true);

  const numericCols = cols.filter(c=>rows.some(r=>!isNaN(Number(r[c.key]))&&r[c.key]!==""));

  const chartData = useMemo(() => {
    const useRows = selection?.start && selection?.end
      ? rows.slice(Math.min(selection.start.ri, selection.end.ri), Math.max(selection.start.ri, selection.end.ri)+1)
      : rows.slice(0, 14);
    return useRows.map(r=>({ label: String(r[labelCol]??""), value: Number(r[valueCol])||0, value2: Number(r[value2Col])||0 })).filter(d=>d.label);
  }, [rows, labelCol, valueCol, value2Col, selection]);

  const W=520, H=240, PAD=44, chartW=W-PAD*2, chartH=H-PAD*2;
  const maxVal = Math.max(...chartData.map(d=>d.value), 1);
  const maxVal2 = Math.max(...chartData.map(d=>d.value2), 1);
  const colors = ["#1a73e8","#34a853","#fbbc04","#ea4335","#9c27b0","#00bcd4","#ff5722","#607d8b","#795548","#ff9800","#4caf50","#2196f3"];

  const GridLines = () => (
    <g>{[0,0.25,0.5,0.75,1].map((t,i)=>{
      const y=PAD+chartH*(1-t);
      return <g key={i}><line x1={PAD} y1={y} x2={W-PAD} y2={y} stroke="#e5e7eb" strokeWidth={1} strokeDasharray="3,3"/><text x={PAD-5} y={y+4} textAnchor="end" fontSize={8} fill="#999">{Math.round(maxVal*t)}</text></g>;
    })}</g>
  );

  const renderBarChart = () => {
    const bw = Math.min(chartW / Math.max(chartData.length, 1) - 6, 48);
    return <g><GridLines/>{chartData.map((d, i) => {
      const bh = (d.value / maxVal) * chartH;
      const x = PAD + i * (chartW / chartData.length) + (chartW / chartData.length - bw) / 2;
      const y = PAD + chartH - bh;
      return (
        <g key={i}>
          <rect x={x} y={y} width={bw} height={bh} fill={colors[i%colors.length]} rx={3} opacity={0.85}>
            <title>{d.label}: {d.value}</title>
          </rect>
          <text x={x+bw/2} y={H-PAD+13} textAnchor="middle" fontSize={8} fill="#666">{String(d.label).slice(0,9)}</text>
          {bh>14&&<text x={x+bw/2} y={y-3} textAnchor="middle" fontSize={8} fill="#333">{d.value}</text>}
        </g>
      );
    })}</g>;
  };

  const renderStackedBar = () => {
    const bw = Math.min(chartW / Math.max(chartData.length, 1) - 6, 48);
    const combined = chartData.map(d=>d.value+d.value2);
    const maxC = Math.max(...combined, 1);
    return <g>{chartData.map((d, i) => {
      const x = PAD + i * (chartW / chartData.length) + (chartW / chartData.length - bw) / 2;
      const h1 = (d.value / maxC) * chartH;
      const h2 = (d.value2 / maxC) * chartH;
      return (
        <g key={i}>
          <rect x={x} y={PAD+chartH-h1-h2} width={bw} height={h1} fill={colors[i%colors.length]} rx={2} opacity={0.85}/>
          <rect x={x} y={PAD+chartH-h2} width={bw} height={h2} fill={colors[(i+3)%colors.length]} rx={2} opacity={0.7}/>
          <text x={x+bw/2} y={H-PAD+13} textAnchor="middle" fontSize={8} fill="#666">{String(d.label).slice(0,9)}</text>
        </g>
      );
    })}</g>;
  };

  const renderLineChart = () => {
    if (chartData.length < 2) return null;
    const pts = chartData.map((d, i) => ({
      x: PAD + (i / (chartData.length - 1)) * chartW,
      y: PAD + chartH - (d.value / maxVal) * chartH, d
    }));
    const pathD = pts.map((p,i)=>`${i===0?"M":"L"} ${p.x} ${p.y}`).join(" ");
    return <g><GridLines/>
      <path d={pathD} fill="none" stroke="#1a73e8" strokeWidth={2.5} strokeLinejoin="round"/>
      {pts.map((p,i)=>(
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={4} fill="#1a73e8" stroke="#fff" strokeWidth={1.5}/>
          <text x={p.x} y={p.y-9} textAnchor="middle" fontSize={8} fill="#333">{p.d.value}</text>
          <text x={p.x} y={H-PAD+13} textAnchor="middle" fontSize={8} fill="#666">{String(p.d.label).slice(0,9)}</text>
        </g>
      ))}
    </g>;
  };

  const renderAreaChart = () => {
    if (chartData.length < 2) return null;
    const pts = chartData.map((d, i) => ({
      x: PAD + (i / (chartData.length - 1)) * chartW,
      y: PAD + chartH - (d.value / maxVal) * chartH, d
    }));
    const pathD = pts.map((p,i)=>`${i===0?"M":"L"} ${p.x} ${p.y}`).join(" ");
    const areaD = `${pathD} L ${pts[pts.length-1].x} ${PAD+chartH} L ${pts[0].x} ${PAD+chartH} Z`;
    return <g><GridLines/>
      <defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1a73e8" stopOpacity="0.4"/><stop offset="100%" stopColor="#1a73e8" stopOpacity="0.02"/></linearGradient></defs>
      <path d={areaD} fill="url(#areaGrad)"/>
      <path d={pathD} fill="none" stroke="#1a73e8" strokeWidth={2.5} strokeLinejoin="round"/>
      {pts.map((p,i)=>(
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={3.5} fill="#fff" stroke="#1a73e8" strokeWidth={2}/>
          <text x={p.x} y={H-PAD+13} textAnchor="middle" fontSize={8} fill="#666">{String(p.d.label).slice(0,9)}</text>
        </g>
      ))}
    </g>;
  };

  const renderScatter = () => {
    const xMax = Math.max(...chartData.map(d=>d.value), 1);
    const yMax = Math.max(...chartData.map(d=>d.value2), 1);
    return <g>
      <GridLines/>
      {[0,0.25,0.5,0.75,1].map((t,i)=>{
        const x=PAD+chartW*t;
        return <g key={i}><line x1={x} y1={PAD} x2={x} y2={PAD+chartH} stroke="#e5e7eb" strokeWidth={1} strokeDasharray="3,3"/><text x={x} y={H-PAD+13} textAnchor="middle" fontSize={8} fill="#999">{Math.round(xMax*t)}</text></g>;
      })}
      {chartData.map((d,i)=>{
        const cx2 = PAD + (d.value/xMax)*chartW;
        const cy2 = PAD + chartH - (d.value2/yMax)*chartH;
        return <g key={i}><circle cx={cx2} cy={cy2} r={6} fill={colors[i%colors.length]} opacity={0.8} stroke="#fff" strokeWidth={1}><title>{d.label}: ({d.value}, {d.value2})</title></circle><text x={cx2} y={cy2-9} textAnchor="middle" fontSize={7} fill="#555">{String(d.label).slice(0,6)}</text></g>;
      })}
    </g>;
  };

  const renderPieChart = (donut=false) => {
    const total = chartData.reduce((a,b)=>a+b.value, 0) || 1;
    const cx = W/2, cy = H/2, r = Math.min(chartW, chartH) / 2 - 8;
    const innerR = donut ? r*0.5 : 0;
    let angle = -Math.PI / 2;
    return <g>{chartData.map((d, i) => {
      const slice = (d.value / total) * 2 * Math.PI;
      const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
      angle += slice;
      const x2 = cx + r * Math.cos(angle), y2 = cy + r * Math.sin(angle);
      const mid = angle - slice / 2;
      const mx = cx + (r*0.7) * Math.cos(mid), my = cy + (r*0.7) * Math.sin(mid);
      const large = slice > Math.PI ? 1 : 0;
      const pathD = donut
        ? `M${cx+innerR*Math.cos(angle-slice)},${cy+innerR*Math.sin(angle-slice)} L${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} L${cx+innerR*Math.cos(angle)},${cy+innerR*Math.sin(angle)} A${innerR},${innerR} 0 ${large},0 ${cx+innerR*Math.cos(angle-slice)},${cy+innerR*Math.sin(angle-slice)} Z`
        : `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} Z`;
      return (
        <g key={i}>
          <path d={pathD} fill={colors[i%colors.length]} opacity={0.88} stroke="#fff" strokeWidth={1.5}>
            <title>{d.label}: {d.value} ({Math.round(d.value/total*100)}%)</title>
          </path>
          {slice > 0.28 && <text x={mx} y={my+1} textAnchor="middle" fontSize={8} fill="#fff" fontWeight="bold">{Math.round(d.value/total*100)}%</text>}
        </g>
      );
    })}</g>;
  };

  const renderRadar = () => {
    const n = Math.min(chartData.length, 8);
    const data = chartData.slice(0, n);
    const cx2 = W/2, cy2 = H/2, r = Math.min(chartW,chartH)/2 - 20;
    const angle = (i) => (i/n)*2*Math.PI - Math.PI/2;
    const pts = data.map((d,i)=>({ x: cx2+r*(d.value/maxVal)*Math.cos(angle(i)), y: cy2+r*(d.value/maxVal)*Math.sin(angle(i)) }));
    const polyD = pts.map((p,i)=>`${i===0?"M":"L"} ${p.x} ${p.y}`).join(" ") + " Z";
    return <g>
      {[0.25,0.5,0.75,1].map(t=>{
        const rp = pts.map((_,i)=>({ x: cx2+r*t*Math.cos(angle(i)), y: cy2+r*t*Math.sin(angle(i)) }));
        return <polygon key={t} points={rp.map(p=>`${p.x},${p.y}`).join(" ")} fill="none" stroke="#e5e7eb" strokeWidth={1}/>;
      })}
      {data.map((_,i)=><line key={i} x1={cx2} y1={cy2} x2={cx2+r*Math.cos(angle(i))} y2={cy2+r*Math.sin(angle(i))} stroke="#e5e7eb" strokeWidth={1}/>)}
      <path d={polyD} fill="#1a73e8" fillOpacity={0.2} stroke="#1a73e8" strokeWidth={2}/>
      {pts.map((p,i)=><g key={i}><circle cx={p.x} cy={p.y} r={4} fill="#1a73e8"/><text x={cx2+(r+14)*Math.cos(angle(i))} y={cy2+(r+14)*Math.sin(angle(i))+3} textAnchor="middle" fontSize={8} fill="#555">{String(data[i].label).slice(0,8)}</text></g>)}
    </g>;
  };

  const CHART_TYPES = [
    {id:"bar",icon:"📊",label:"Bar"},
    {id:"stackedbar",icon:"📊",label:"Stacked"},
    {id:"line",icon:"📈",label:"Line"},
    {id:"area",icon:"🏔",label:"Area"},
    {id:"pie",icon:"🥧",label:"Pie"},
    {id:"donut",icon:"🍩",label:"Donut"},
    {id:"scatter",icon:"⬡",label:"Scatter"},
    {id:"radar",icon:"🕸",label:"Radar"},
  ];

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.35)",zIndex:9000,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:"#fff",borderRadius:12,padding:20,minWidth:600,boxShadow:"0 20px 60px rgba(0,0,0,0.25)",maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{fontWeight:700,fontSize:15,marginBottom:12}}>📊 Insert Chart</div>

        {/* Chart type selector */}
        <div style={{display:"flex",gap:5,marginBottom:12,flexWrap:"wrap"}}>
          {CHART_TYPES.map(t=>(
            <button key={t.id} onClick={()=>setChartType(t.id)}
              style={{...tBtn,background:chartType===t.id?"#1a73e8":"#f1f5f9",color:chartType===t.id?"#fff":"#333",padding:"4px 10px",fontSize:11,borderRadius:6,border:chartType===t.id?"1px solid #1a73e8":"1px solid #e2e8f0"}}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Config row */}
        <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center",background:"#f8faff",padding:"8px 10px",borderRadius:6}}>
          <div style={{display:"flex",alignItems:"center",gap:4}}>
            <span style={{fontSize:11,color:"#888"}}>Title:</span>
            <input value={chartTitle} onChange={e=>setChartTitle(e.target.value)} placeholder="Chart title…" style={{fontSize:11,padding:"2px 6px",border:"1px solid #ddd",borderRadius:4,width:120}}/>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:4}}>
            <span style={{fontSize:11,color:"#888"}}>Labels:</span>
            <select value={labelCol} onChange={e=>setLabelCol(e.target.value)} style={{fontSize:11,padding:"2px 5px",border:"1px solid #ddd",borderRadius:4}}>{cols.map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</select>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:4}}>
            <span style={{fontSize:11,color:"#888"}}>Series 1:</span>
            <select value={valueCol} onChange={e=>setValueCol(e.target.value)} style={{fontSize:11,padding:"2px 5px",border:"1px solid #ddd",borderRadius:4}}>{numericCols.map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</select>
          </div>
          {(chartType==="stackedbar"||chartType==="scatter")&&(
            <div style={{display:"flex",alignItems:"center",gap:4}}>
              <span style={{fontSize:11,color:"#888"}}>{chartType==="scatter"?"Y-Axis:":"Series 2:"}</span>
              <select value={value2Col} onChange={e=>setValue2Col(e.target.value)} style={{fontSize:11,padding:"2px 5px",border:"1px solid #ddd",borderRadius:4}}>{numericCols.map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</select>
            </div>
          )}
          <label style={{display:"flex",alignItems:"center",gap:4,fontSize:11,cursor:"pointer"}}>
            <input type="checkbox" checked={showLegend} onChange={e=>setShowLegend(e.target.checked)}/> Legend
          </label>
        </div>

        {/* Chart */}
        <div style={{border:"1px solid #e5e7eb",borderRadius:8,overflow:"hidden",background:"#fafafa",padding:"8px 4px 4px"}}>
          {chartTitle&&<div style={{textAlign:"center",fontWeight:700,fontSize:13,color:"#1e293b",marginBottom:4}}>{chartTitle}</div>}
          <svg width={W} height={H} style={{display:"block",margin:"0 auto"}}>
            {chartType==="bar"&&renderBarChart()}
            {chartType==="stackedbar"&&renderStackedBar()}
            {chartType==="line"&&renderLineChart()}
            {chartType==="area"&&renderAreaChart()}
            {chartType==="scatter"&&renderScatter()}
            {(chartType==="pie"||chartType==="donut")&&renderPieChart(chartType==="donut")}
            {chartType==="radar"&&renderRadar()}
          </svg>
        </div>

        {/* Legend */}
        {showLegend&&(chartType==="pie"||chartType==="donut"||chartType==="stackedbar")&&(
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8}}>
            {chartData.slice(0,12).map((d,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:4,fontSize:10}}>
                <div style={{width:10,height:10,borderRadius:2,background:colors[i%colors.length]}}/>
                {String(d.label).slice(0,14)}
              </div>
            ))}
          </div>
        )}
        <div style={{display:"flex",justifyContent:"flex-end",marginTop:14}}>
          <button onClick={onClose} style={{...tBtn,background:"#1a73e8",color:"#fff",padding:"5px 18px"}}>Close</button>
        </div>
      </div>
    </div>
  );
};

// ─── Comment Popover ──────────────────────────────────────────────────────────
const CommentPopover = ({ x: initX, y: initY, cellKey, comment, onChange, onClose }) => {
  const [val, setVal] = useState(comment||"");
  const [pos, setPos] = useState({ x: initX, y: initY });
  const dragRef = useRef(null);
  const ref = useRef(null);
  useEffect(()=>{const h=e=>{if(ref.current&&!ref.current.contains(e.target))onClose();};document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);},[]);
  const startDrag = (e) => {
    const startX = e.clientX - pos.x, startY = e.clientY - pos.y;
    const onMove = ev => setPos({ x: ev.clientX - startX, y: ev.clientY - startY });
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    e.preventDefault();
  };
  return (
    <div ref={ref} style={{position:"fixed",left:pos.x,top:pos.y,zIndex:9999,background:"#fff",border:"1px solid #ddd",borderRadius:8,boxShadow:"0 8px 28px rgba(0,0,0,0.18)",padding:10,minWidth:200}}>
      <div onMouseDown={startDrag} style={{fontSize:11,fontWeight:600,color:"#555",marginBottom:6,cursor:"grab",userSelect:"none",display:"flex",alignItems:"center",gap:4}}>
        <span style={{opacity:0.4,fontSize:10}}>⠿</span> 💬 Comment
      </div>
      <textarea value={val} onChange={e=>setVal(e.target.value)} rows={3} autoFocus style={{width:"100%",fontSize:11,border:"1px solid #ddd",borderRadius:4,padding:"4px 6px",resize:"vertical",fontFamily:"monospace",boxSizing:"border-box"}}/>
      <div style={{display:"flex",gap:4,marginTop:6,justifyContent:"flex-end"}}>
        {comment&&<button onClick={()=>{onChange("");onClose();}} style={{...tBtn,color:"#ef4444"}}>Delete</button>}
        <button onClick={onClose} style={tBtn}>Cancel</button>
        <button onClick={()=>{onChange(val);onClose();}} style={{...tBtn,background:"#1a73e8",color:"#fff"}}>Save</button>
      </div>
    </div>
  );
};

// ─── Merge Cells utility ──────────────────────────────────────────────────────
const cellInMerge = (merges, ri, ci) => {
  for (const m of merges) {
    if (ri >= m.r1 && ri <= m.r2 && ci >= m.c1 && ci <= m.c2) return m;
  }
  return null;
};
const isMergeOrigin = (merges, ri, ci) => {
  const m = cellInMerge(merges, ri, ci);
  return m && m.r1 === ri && m.c1 === ci ? m : null;
};

// ─── Ribbon Tab Button ────────────────────────────────────────────────────────
const RibbonTab = ({ label, active, onClick }) => (
  <button onClick={onClick} style={{padding:"4px 14px",fontSize:12,borderTop:"none",borderLeft:"none",borderRight:"none",borderBottom:active?"2px solid #1a73e8":"2px solid transparent",background:"transparent",cursor:"pointer",color:active?"#1a73e8":"#444",fontWeight:active?600:400,fontFamily:"'Segoe UI',sans-serif",marginBottom:-1,transition:"color 0.15s"}}>
    {label}
  </button>
);

// ─── Ribbon Group ─────────────────────────────────────────────────────────────
const RibbonGroup = ({ label, children }) => (
  <div style={{display:"flex",flexDirection:"column",alignItems:"center",borderRight:`1px solid ${BORDER}`,paddingRight:8,marginRight:4,minWidth:0}}>
    <div style={{display:"flex",alignItems:"center",gap:3,flexWrap:"wrap",justifyContent:"center"}}>{children}</div>
    <div style={{fontSize:9,color:"#888",marginTop:2,textTransform:"uppercase",letterSpacing:"0.04em"}}>{label}</div>
  </div>
);

// ─── Icon Btn ─────────────────────────────────────────────────────────────────
const IBtn = ({ icon, label, onClick, active, disabled, title }) => (
  <button onClick={onClick} disabled={disabled} title={title||label}
    style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minWidth:32,padding:"2px 4px",border:"1px solid transparent",borderRadius:4,background:active?"#e8f0fe":"transparent",cursor:disabled?"default":"pointer",opacity:disabled?0.4:1,fontSize:typeof icon==="string"?16:14,lineHeight:1,transition:"background 0.1s"}}
    onMouseEnter={e=>{if(!disabled&&!active)e.currentTarget.style.background="#f3f4f6";}}
    onMouseLeave={e=>{e.currentTarget.style.background=active?"#e8f0fe":"transparent";}}>
    <span>{icon}</span>
    {label&&<span style={{fontSize:9,color:"#555",marginTop:1,whiteSpace:"nowrap"}}>{label}</span>}
  </button>
);

// ─── Customize Table Modal ────────────────────────────────────────────────────
const CustomizeTableModal = ({ cols, hiddenCols, onCols, onHidden, onClose }) => {
  const [local, setLocal] = useState(cols.map((c,i)=>({...c,_i:i})));
  const upd=(i,k,v)=>setLocal(cs=>cs.map((c,j)=>j===i?{...c,[k]:v}:c));
  const moveUp=(i)=>{if(i===0)return;setLocal(cs=>{const n=[...cs];[n[i-1],n[i]]=[n[i],n[i-1]];return n;});}
  const moveDown=(i)=>{if(i===local.length-1)return;setLocal(cs=>{const n=[...cs];[n[i],n[i+1]]=[n[i+1],n[i]];return n;});}
  const [localHidden, setLocalHidden] = useState(new Set(
    [...hiddenCols].map(ci=>cols[ci]?.key).filter(Boolean)
  ));
  const toggleHide=(key)=>setLocalHidden(s=>{const n=new Set(s);n.has(key)?n.delete(key):n.add(key);return n;});
  const save=()=>{
    onCols(local);
    const newHidden=new Set();
    local.forEach((c,i)=>{if(localHidden.has(c.key))newHidden.add(i);});
    onHidden(newHidden);
    onClose();
  };
  const TYPES=["text","number","currency","percent","date","dropdown","checkbox","email","url"];
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.35)",zIndex:9000,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:"#fff",borderRadius:10,padding:20,minWidth:560,maxHeight:"85vh",overflowY:"auto",boxShadow:"0 16px 48px rgba(0,0,0,0.22)"}}>
        <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>⚙️ Customize Table</div>
        <div style={{fontSize:11,color:"#888",marginBottom:14}}>Rename columns, set types, reorder, show/hide</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr auto auto auto auto auto",gap:"6px 8px",alignItems:"center",marginBottom:4}}>
          <span style={{fontSize:10,fontWeight:600,color:"#888",textTransform:"uppercase"}}>Column Name</span>
          <span style={{fontSize:10,fontWeight:600,color:"#888",textTransform:"uppercase"}}>Type</span>
          <span style={{fontSize:10,fontWeight:600,color:"#888",textTransform:"uppercase"}}>Width</span>
          <span style={{fontSize:10,fontWeight:600,color:"#888",textTransform:"uppercase"}}>Visible</span>
          <span style={{fontSize:10,fontWeight:600,color:"#888",textTransform:"uppercase"}}>Order</span>
          <span/>
        </div>
        {local.map((c,i)=>(
          <div key={c.key} style={{display:"grid",gridTemplateColumns:"1fr auto auto auto auto auto",gap:"6px 8px",alignItems:"center",padding:"6px 0",borderBottom:"1px solid #f0f0f0"}}>
            <input value={c.label} onChange={e=>upd(i,"label",e.target.value)}
              style={{padding:"4px 8px",fontSize:12,border:"1px solid #ddd",borderRadius:4,fontFamily:"monospace",minWidth:100}}/>
            <select value={c.type||"text"} onChange={e=>upd(i,"type",e.target.value)}
              style={{fontSize:11,padding:"3px 5px",border:"1px solid #ddd",borderRadius:4}}>
              {TYPES.map(t=><option key={t} value={t}>{t}</option>)}
            </select>
            <input type="number" value={c.width||120} onChange={e=>upd(i,"width",Number(e.target.value))} min={40} max={600}
              style={{width:58,fontSize:11,padding:"3px 5px",border:"1px solid #ddd",borderRadius:4}}/>
            <label style={{display:"flex",alignItems:"center",gap:4,fontSize:11,cursor:"pointer"}}>
              <input type="checkbox" checked={!localHidden.has(c.key)} onChange={()=>toggleHide(c.key)}/> Show
            </label>
            <div style={{display:"flex",flexDirection:"column",gap:1}}>
              <button onClick={()=>moveUp(i)} disabled={i===0} style={{...tBtn,padding:"0 5px",fontSize:9,opacity:i===0?0.3:1}}>▲</button>
              <button onClick={()=>moveDown(i)} disabled={i===local.length-1} style={{...tBtn,padding:"0 5px",fontSize:9,opacity:i===local.length-1?0.3:1}}>▼</button>
            </div>
            <div style={{fontSize:9,color:"#bbb",fontFamily:"monospace"}}>{c.key}</div>
          </div>
        ))}
        <div style={{display:"flex",gap:6,justifyContent:"flex-end",marginTop:14}}>
          <button onClick={onClose} style={tBtn}>Cancel</button>
          <button onClick={save} style={{...tBtn,background:"#1a73e8",color:"#fff"}}>Save Changes</button>
        </div>
      </div>
    </div>
  );
};

// ─── Design tokens ────────────────────────────────────────────────────────────
const DT = {
  bg: "#F8F9FC",
  surface: "#FFFFFF",
  surfaceHover: "#F3F5FB",
  border: "#E2E8F0",
  borderStrong: "#CBD5E1",
  text: "#0F172A",
  muted: "#64748B",
  accent: "#6366F1",
  accentLight: "#EEF2FF",
  accentMid: "#818CF8",
  green: "#10B981",
  greenLight: "#D1FAE5",
  yellow: "#F59E0B",
  yellowLight: "#FEF3C7",
  red: "#EF4444",
  redLight: "#FEE2E2",
  purple: "#8B5CF6",
  purpleLight: "#EDE9FE",
  shadow: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
  shadowMd: "0 4px 16px rgba(0,0,0,0.08)",
  shadowLg: "0 20px 48px rgba(0,0,0,0.14)",
  radius: 8,
  radiusLg: 12,
};

// ─── Global CSS injection ─────────────────────────────────────────────────────
if (typeof document !== "undefined" && !document.getElementById("excel-global-css")) {
  const s = document.createElement("style");
  s.id = "excel-global-css";
  s.textContent = `
    @keyframes bounce { 0%,100%{transform:translateY(0);opacity:0.5} 50%{transform:translateY(-4px);opacity:1} }
    @keyframes fadeIn { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:none} }
    @keyframes slideInRight { from{transform:translateX(40px);opacity:0} to{transform:none;opacity:1} }
    @keyframes slideUpFade { from{transform:translateY(8px);opacity:0} to{transform:none;opacity:1} }
  `;
  document.head.appendChild(s);
}

// ─── Presence avatars ─────────────────────────────────────────────────────────
const COLLAB_USERS = [
  { id:"u1", name:"Alex", color:"#6366F1", initials:"AX" },
  { id:"u2", name:"Maria", color:"#10B981", initials:"MR" },
  { id:"u3", name:"James", color:"#F59E0B", initials:"JM" },
  { id:"u4", name:"Priya", color:"#EF4444", initials:"PR" },
];

// ─── @Mention Popover ─────────────────────────────────────────────────────────
const MentionPopover = ({ query, x, y, onSelect, onClose }) => {
  const results = COLLAB_USERS.filter(u =>
    u.name.toLowerCase().startsWith(query.toLowerCase())
  );
  const ref = useRef(null);
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  if (!results.length) return null;
  return (
    <div ref={ref} style={{
      position: "fixed", left: x, top: y, zIndex: 99999,
      background: DT.surface, border: `1px solid ${DT.border}`,
      borderRadius: DT.radiusLg, boxShadow: DT.shadowLg,
      overflow: "hidden", minWidth: 200,
      animation: "slideUpFade 0.15s ease"
    }}>
      <div style={{ padding: "8px 12px", borderBottom: `1px solid ${DT.border}`, fontSize: 11, fontWeight: 700, color: DT.muted, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        Mention a teammate
      </div>
      {results.map(u => (
        <div key={u.id} onMouseDown={() => onSelect(u)}
          style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", cursor: "pointer", transition: "background 0.1s" }}
          onMouseEnter={e => e.currentTarget.style.background = DT.accentLight}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: u.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{u.initials}</div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: DT.text }}>{u.name}</div>
            <div style={{ fontSize: 10, color: DT.muted }}>@{u.name.toLowerCase()}</div>
          </div>
        </div>
      ))}
    </div>
  );
};

// ─── Floating/Inline Comment Thread ──────────────────────────────────────────
const CommentThread = ({ cellKey, comments, currentUser, onAdd, onClose, x, y }) => {
  const [draft, setDraft] = useState("");
  const ref = useRef(null);
  const textRef = useRef(null);
  const [mentionState, setMentionState] = useState(null); // { query, caretX, caretY }

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  useEffect(() => { textRef.current?.focus(); }, []);

  const threads = comments || [];

  const handleDraftChange = e => {
    const val = e.target.value;
    setDraft(val);
    // @mention detection
    const match = val.slice(0, e.target.selectionStart).match(/@(\w*)$/);
    if (match) {
      const rect = e.target.getBoundingClientRect();
      setMentionState({ query: match[1], caretX: rect.left + 10, caretY: rect.bottom + 4 });
    } else {
      setMentionState(null);
    }
  };

  const insertMention = (user) => {
    const before = draft.slice(0, draft.lastIndexOf("@"));
    setDraft(before + `@${user.name} `);
    setMentionState(null);
    textRef.current?.focus();
  };

  const submit = () => {
    if (!draft.trim()) return;
    onAdd(cellKey, {
      id: Date.now(),
      author: currentUser?.name || "You",
      authorColor: currentUser?.color || DT.accent,
      initials: currentUser?.initials || "YO",
      text: draft.trim(),
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      resolved: false,
    });
    setDraft("");
  };

  return (
    <>
      <div ref={ref} style={{
        position: "fixed", left: Math.min(x, window.innerWidth - 320), top: Math.min(y, window.innerHeight - 360),
        width: 300, zIndex: 9999,
        background: DT.surface, border: `1px solid ${DT.border}`,
        borderRadius: DT.radiusLg, boxShadow: DT.shadowLg,
        display: "flex", flexDirection: "column", overflow: "hidden",
        animation: "slideUpFade 0.15s ease",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: `1px solid ${DT.border}`, background: DT.bg }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: DT.text }}>💬 Comment Thread</div>
          <div style={{ display: "flex", gap: 6 }}>
            <span style={{ fontSize: 10, color: DT.muted, background: DT.border, padding: "2px 6px", borderRadius: 4 }}>{cellKey}</span>
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: DT.muted, padding: 0, lineHeight: 1 }}>✕</button>
          </div>
        </div>

        {/* Thread messages */}
        <div style={{ maxHeight: 200, overflowY: "auto", padding: "8px 0" }}>
          {threads.length === 0 && (
            <div style={{ padding: "20px 14px", textAlign: "center", color: DT.muted, fontSize: 12 }}>
              No comments yet. Start the conversation!
            </div>
          )}
          {threads.map(c => (
            <div key={c.id} style={{ padding: "8px 14px", display: "flex", gap: 9, animation: "fadeIn 0.2s ease" }}>
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: c.authorColor || DT.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#fff", flexShrink: 0, marginTop: 1 }}>{c.initials || c.author?.[0]}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: DT.text }}>{c.author}</span>
                  <span style={{ fontSize: 10, color: DT.muted }}>{c.time}</span>
                  {c.resolved && <span style={{ fontSize: 9, background: DT.greenLight, color: DT.green, padding: "1px 5px", borderRadius: 3, fontWeight: 600 }}>Resolved</span>}
                </div>
                <div style={{ fontSize: 12, color: DT.text, lineHeight: 1.5 }}>
                  {c.text.split(/(@\w+)/g).map((part, i) =>
                    /^@\w+/.test(part)
                      ? <span key={i} style={{ color: DT.accent, fontWeight: 600 }}>{part}</span>
                      : part
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Reply box */}
        <div style={{ padding: "8px 14px", borderTop: `1px solid ${DT.border}`, background: DT.bg }}>
          <textarea ref={textRef} value={draft} onChange={handleDraftChange}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } if (e.key === "Escape") onClose(); }}
            placeholder="Reply… (@ to mention, Enter to send)"
            rows={2}
            style={{ width: "100%", resize: "none", border: `1px solid ${DT.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 12, fontFamily: "inherit", outline: "none", background: DT.surface, color: DT.text, boxSizing: "border-box", transition: "border-color 0.15s" }}
            onFocus={e => e.target.style.borderColor = DT.accent}
            onBlur={e => e.target.style.borderColor = DT.border}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 6 }}>
            <button onClick={onClose} style={{ fontSize: 11, padding: "4px 10px", border: `1px solid ${DT.border}`, borderRadius: 5, background: DT.surface, cursor: "pointer", color: DT.muted }}>Cancel</button>
            <button onClick={submit} disabled={!draft.trim()} style={{ fontSize: 11, padding: "4px 12px", border: "none", borderRadius: 5, background: draft.trim() ? DT.accent : DT.border, cursor: draft.trim() ? "pointer" : "default", color: "#fff", fontWeight: 600, transition: "background 0.15s" }}>Send</button>
          </div>
        </div>
      </div>
      {mentionState && (
        <MentionPopover
          query={mentionState.query}
          x={mentionState.caretX}
          y={mentionState.caretY}
          onSelect={insertMention}
          onClose={() => setMentionState(null)}
        />
      )}
    </>
  );
};

// ─── Activity Timeline Panel ──────────────────────────────────────────────────
const ActivityTimeline = ({ activities = [], onClose }) => {
  const ACTION_ICONS = { edit: "✏️", comment: "💬", delete: "🗑", insert: "➕", restore: "↩️", share: "🔗", filter: "🔽", sort: "↕️" };
  const [userFilter, setUserFilter] = useState("all");
  const uniqueUsers = useMemo(() => {
    const seen = new Set();
    return activities.filter(a => { if(!a.userName||seen.has(a.userName)) return false; seen.add(a.userName); return true; });
  }, [activities]);
  const filtered = userFilter === "all" ? activities : activities.filter(a => a.userName === userFilter);
  return (
    <div style={{
      position: "fixed", right: 0, top: 0, bottom: 0, width: 320, zIndex: 9990,
      background: DT.surface, borderLeft: `1px solid ${DT.border}`,
      display: "flex", flexDirection: "column", boxShadow: "-4px 0 24px rgba(0,0,0,0.1)",
      animation: "slideInRight 0.2s ease",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px", borderBottom: `1px solid ${DT.border}`, flexShrink: 0 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: DT.text }}>Activity Timeline</div>
          <div style={{ fontSize: 11, color: DT.muted, marginTop: 2 }}>{filtered.length} of {activities.length} events</div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: DT.muted }}>✕</button>
      </div>
      {/* User filter */}
      <div style={{ padding: "8px 18px", borderBottom: `1px solid ${DT.border}`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: DT.muted, flexShrink: 0 }}>Filter by:</span>
        <select value={userFilter} onChange={e => setUserFilter(e.target.value)}
          style={{ flex: 1, fontSize: 11, padding: "3px 6px", border: `1px solid ${DT.border}`, borderRadius: 4, background: DT.surface, color: DT.text, cursor: "pointer" }}>
          <option value="all">All users</option>
          {uniqueUsers.map(a => (
            <option key={a.userName} value={a.userName}>{a.userName}</option>
          ))}
        </select>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {filtered.length === 0 && (
          <div style={{ padding: 32, textAlign: "center", color: DT.muted, fontSize: 13 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📋</div>
            No activity yet.
          </div>
        )}
        {[...filtered].reverse().map((a, i) => (
          <div key={a.id || i} style={{ display: "flex", gap: 12, padding: "10px 18px", borderBottom: `1px solid ${DT.border}`, transition: "background 0.1s" }}
            onMouseEnter={e => e.currentTarget.style.background = DT.surfaceHover}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: a.userColor || DT.accentLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: a.userColor ? "#fff" : DT.accent }}>{a.userInitials || "—"}</div>
              {i < activities.length - 1 && <div style={{ width: 1, flex: 1, background: DT.border, marginTop: 4, minHeight: 12 }} />}
            </div>
            <div style={{ flex: 1, paddingBottom: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 13 }}>{ACTION_ICONS[a.type] || "•"}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: DT.text }}>{a.userName}</span>
                <span style={{ fontSize: 10, color: DT.muted, marginLeft: "auto" }}>{a.time}</span>
              </div>
              <div style={{ fontSize: 11, color: DT.muted, lineHeight: 1.5 }}>{a.description}</div>
              {a.cellRef && <div style={{ marginTop: 3, fontSize: 10, background: DT.accentLight, color: DT.accent, padding: "1px 6px", borderRadius: 3, display: "inline-block", fontFamily: "monospace" }}>{a.cellRef}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Version History Panel ────────────────────────────────────────────────────
const VersionHistoryPanel = ({ versions, onRestore, onClose }) => (
  <div style={{
    position: "fixed", right: 0, top: 0, bottom: 0, width: 340, zIndex: 9990,
    background: DT.surface, borderLeft: `1px solid ${DT.border}`,
    display: "flex", flexDirection: "column", boxShadow: "-4px 0 24px rgba(0,0,0,0.1)",
    animation: "slideInRight 0.2s ease",
  }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px", borderBottom: `1px solid ${DT.border}`, flexShrink: 0 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 14, color: DT.text }}>Version History</div>
        <div style={{ fontSize: 11, color: DT.muted, marginTop: 2 }}>Click a snapshot to restore</div>
      </div>
      <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: DT.muted }}>✕</button>
    </div>
    <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
      {versions.length === 0 && (
        <div style={{ padding: 32, textAlign: "center", color: DT.muted, fontSize: 13 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📸</div>
          No snapshots yet. Edits will create snapshots automatically.
        </div>
      )}
      {[...versions].reverse().map((v, i) => (
        <div key={v.id} style={{ padding: "12px 18px", borderBottom: `1px solid ${DT.border}`, display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: i === 0 ? DT.accentLight : DT.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0, border: `1px solid ${i === 0 ? DT.accent : DT.border}` }}>
            {i === 0 ? "📌" : "📄"}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: DT.text }}>{v.label || `Version ${versions.length - i}`}</span>
              {i === 0 && <span style={{ fontSize: 9, background: DT.accentLight, color: DT.accent, padding: "2px 6px", borderRadius: 3, fontWeight: 700 }}>LATEST</span>}
            </div>
            <div style={{ fontSize: 11, color: DT.muted, marginTop: 2 }}>{v.description || `${v.changes} change(s) made`}</div>
            <div style={{ fontSize: 10, color: DT.muted, marginTop: 2 }}>{v.time} · by {v.author}</div>
            {i > 0 && (
              <button onClick={() => onRestore(v)}
                style={{ marginTop: 6, fontSize: 11, padding: "3px 10px", border: `1px solid ${DT.border}`, borderRadius: 5, background: DT.surface, cursor: "pointer", color: DT.text, fontWeight: 500, transition: "all 0.15s" }}
                onMouseEnter={e => { e.currentTarget.style.background = DT.accentLight; e.currentTarget.style.borderColor = DT.accent; e.currentTarget.style.color = DT.accent; }}
                onMouseLeave={e => { e.currentTarget.style.background = DT.surface; e.currentTarget.style.borderColor = DT.border; e.currentTarget.style.color = DT.text; }}>
                ↩ Restore this version
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  </div>
);

// ─── Shared Views Manager ─────────────────────────────────────────────────────
const SharedViewsPanel = ({ savedViews, currentFilters, currentSort, cols, onApply, onSave, onDelete, onClose }) => {
  const [newName, setNewName] = useState("");
  return (
    <div style={{
      position: "fixed", right: 0, top: 0, bottom: 0, width: 300, zIndex: 9990,
      background: DT.surface, borderLeft: `1px solid ${DT.border}`,
      display: "flex", flexDirection: "column", boxShadow: "-4px 0 24px rgba(0,0,0,0.1)",
      animation: "slideInRight 0.2s ease",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px", borderBottom: `1px solid ${DT.border}`, flexShrink: 0 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: DT.text }}>Shared Views</div>
          <div style={{ fontSize: 11, color: DT.muted, marginTop: 2 }}>Save & share filter+sort combos</div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: DT.muted }}>✕</button>
      </div>
      {/* Save current */}
      <div style={{ padding: "14px 18px", borderBottom: `1px solid ${DT.border}`, background: DT.bg }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: DT.muted, marginBottom: 8 }}>SAVE CURRENT VIEW</div>
        <div style={{ display: "flex", gap: 6 }}>
          <input value={newName} onChange={e => setNewName(e.target.value)}
            placeholder="View name…"
            style={{ flex: 1, padding: "5px 8px", border: `1px solid ${DT.border}`, borderRadius: 5, fontSize: 12, fontFamily: "inherit", outline: "none" }}
            onKeyDown={e => { if (e.key === "Enter" && newName.trim()) { onSave(newName.trim()); setNewName(""); } }}
          />
          <button onClick={() => { if (newName.trim()) { onSave(newName.trim()); setNewName(""); } }}
            style={{ padding: "5px 12px", background: DT.accent, color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
            Save
          </button>
        </div>
      </div>
      {/* Saved views list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {savedViews.length === 0 && (
          <div style={{ padding: 32, textAlign: "center", color: DT.muted, fontSize: 12 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>👁</div>
            No saved views yet.
          </div>
        )}
        {savedViews.map((v, i) => (
          <div key={i} style={{ padding: "10px 18px", borderBottom: `1px solid ${DT.border}`, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: DT.text }}>{v.name}</div>
              <div style={{ fontSize: 10, color: DT.muted, marginTop: 2 }}>
                {Object.values(v.filters || {}).filter(f => f?.size > 0).length} filter(s) · {v.sort?.length ? `sorted by ${v.sort.map(s=>s.key).join(", ")}` : "no sort"}
              </div>
            </div>
            <button onClick={() => onApply(v)}
              style={{ fontSize: 11, padding: "3px 10px", border: `1px solid ${DT.border}`, borderRadius: 5, background: DT.surface, cursor: "pointer", color: DT.accent, fontWeight: 600 }}>
              Apply
            </button>
            <button onClick={() => onDelete(i)}
              style={{ background: "none", border: "none", cursor: "pointer", color: DT.muted, fontSize: 12 }}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Collaboration Dashboard ──────────────────────────────────────────────────
const CollabDashboard = ({ presenceUsers, activities, comments, onClose }) => {
  const totalComments = Object.values(comments).reduce((a, b) => a + (Array.isArray(b) ? b.length : 1), 0);
  const recentActivity = activities.slice(-5).reverse();
  return (
    <div style={{
      position: "fixed", left: "50%", top: "50%", transform: "translate(-50%,-50%)",
      width: 560, zIndex: 9999,
      background: DT.surface, border: `1px solid ${DT.border}`,
      borderRadius: DT.radiusLg + 4, boxShadow: DT.shadowLg,
      display: "flex", flexDirection: "column", overflow: "hidden",
      animation: "slideUpFade 0.2s ease",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 24px 16px", borderBottom: `1px solid ${DT.border}` }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, color: DT.text }}>Collaboration Dashboard</div>
          <div style={{ fontSize: 12, color: DT.muted, marginTop: 2 }}>Live team activity & presence</div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: DT.muted }}>✕</button>
      </div>
      {/* Stats row */}
      <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${DT.border}` }}>
        {[
          { label: "Online Now", value: presenceUsers.length, color: DT.green, icon: "🟢" },
          { label: "Comments", value: totalComments, color: DT.accent, icon: "💬" },
          { label: "Events Today", value: activities.length, color: DT.yellow, icon: "📋" },
        ].map((s, i) => (
          <div key={i} style={{ flex: 1, padding: "16px 20px", textAlign: "center", borderRight: i < 2 ? `1px solid ${DT.border}` : "none" }}>
            <div style={{ fontSize: 22 }}>{s.icon}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: s.color, lineHeight: 1.2, marginTop: 4 }}>{s.value}</div>
            <div style={{ fontSize: 11, color: DT.muted }}>{s.label}</div>
          </div>
        ))}
      </div>
      {/* Who's online */}
      <div style={{ padding: "16px 24px", borderBottom: `1px solid ${DT.border}` }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: DT.muted, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10 }}>Active Members</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {presenceUsers.map(u => (
            <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 10px", background: DT.bg, border: `1px solid ${DT.border}`, borderRadius: 20 }}>
              <div style={{ width: 20, height: 20, borderRadius: "50%", background: u.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 700, color: "#fff" }}>{u.initials}</div>
              <span style={{ fontSize: 12, fontWeight: 500, color: DT.text }}>{u.name}</span>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: DT.green }} />
            </div>
          ))}
          {presenceUsers.length === 0 && <span style={{ fontSize: 12, color: DT.muted }}>No one else is online</span>}
        </div>
      </div>
      {/* Recent activity */}
      <div style={{ padding: "16px 24px", flex: 1, overflowY: "auto" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: DT.muted, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10 }}>Recent Activity</div>
        {recentActivity.length === 0 && <div style={{ fontSize: 12, color: DT.muted }}>No activity yet.</div>}
        {recentActivity.map((a, i) => (
          <div key={i} style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "flex-start" }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: a.userColor || DT.accentLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: a.userColor ? "#fff" : DT.accent, flexShrink: 0 }}>{a.userInitials}</div>
            <div>
              <span style={{ fontSize: 12, fontWeight: 600, color: DT.text }}>{a.userName} </span>
              <span style={{ fontSize: 12, color: DT.muted }}>{a.description}</span>
              <div style={{ fontSize: 10, color: DT.muted, marginTop: 1 }}>{a.time}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Presence Bar ─────────────────────────────────────────────────────────────
const PresenceBar = ({ users, onOpenDashboard }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", background: DT.bg, borderBottom: `1px solid ${DT.border}`, flexShrink: 0 }}>
    <div style={{ width: 6, height: 6, borderRadius: "50%", background: DT.green, boxShadow: `0 0 0 2px ${DT.greenLight}` }} />
    <span style={{ fontSize: 11, color: DT.muted, fontWeight: 500 }}>{users.length + 1} online</span>
    <div style={{ display: "flex", marginLeft: 4 }}>
      {users.slice(0, 4).map((u, i) => (
        <div key={u.id} title={u.name} style={{ width: 22, height: 22, borderRadius: "50%", background: u.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 700, color: "#fff", border: `2px solid ${DT.surface}`, marginLeft: i === 0 ? 0 : -6, zIndex: 10 - i, position: "relative" }}>{u.initials}</div>
      ))}
    </div>
    <button onClick={onOpenDashboard}
      style={{ marginLeft: "auto", fontSize: 10, padding: "2px 8px", border: `1px solid ${DT.border}`, borderRadius: 4, background: DT.surface, cursor: "pointer", color: DT.muted, fontWeight: 500 }}>
      View all →
    </button>
  </div>
);

// ─── Auto-save indicator ──────────────────────────────────────────────────────
const AutoSaveIndicator = ({ status }) => {
  const configs = {
    saved: { color: DT.green, dot: DT.green, label: "All changes saved" },
    saving: { color: DT.yellow, dot: DT.yellow, label: "Saving…" },
    unsaved: { color: DT.muted, dot: DT.border, label: "Unsaved" },
  };
  const c = configs[status] || configs.unsaved;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: c.color, transition: "color 0.3s" }}>
      <div style={{ width: 6, height: 6, borderRadius: "50%", background: c.dot, transition: "background 0.3s", boxShadow: status === "saving" ? `0 0 0 2px ${DT.yellowLight}` : "none" }} />
      {c.label}
    </div>
  );
};

// ─── Status Pill ──────────────────────────────────────────────────────────────
const STATUS_COLORS = {
  "Pending":     { bg:"#fef9c3", color:"#a16207", border:"#fde047" },
  "In Progress": { bg:"#dbeafe", color:"#1d4ed8", border:"#93c5fd" },
  "Done":        { bg:"#dcfce7", color:"#15803d", border:"#86efac" },
  "Blocked":     { bg:"#fee2e2", color:"#b91c1c", border:"#fca5a5" },
};
const StatusPill = ({ value, onClick }) => {
  const s = STATUS_COLORS[value] || { bg:"#f1f5f9", color:"#475569", border:"#cbd5e1" };
  return (
    <span onClick={onClick} title="Click to cycle status"
      style={{display:"inline-block",padding:"1px 8px",borderRadius:10,fontSize:10,fontWeight:700,cursor:"pointer",
        background:s.bg,color:s.color,border:`1px solid ${s.border}`,userSelect:"none",
        transition:"opacity 0.1s",letterSpacing:"0.02em"}}
      onMouseEnter={e=>e.currentTarget.style.opacity="0.75"}
      onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
      {value||"—"}
    </span>
  );
};

// ─── Main ExcelTable Component ────────────────────────────────────────────────
const ExcelTable = ({ cols: initialCols, rows: initialRows, onChange, onDelete, currentUser: extUser }) => {
  // ── Sheet state ────────────────────────────────────────────────────────────
  const [sheets, setSheets] = useState([
    { id:"sheet1", name:"Sheet1", rows: initialRows, cols: initialCols }
  ]);
  const [activeSheet, setActiveSheet] = useState("sheet1");

  const sheet     = sheets.find(s=>s.id===activeSheet) || sheets[0];
  const rows      = sheet.rows;
  const baseCols  = sheet.cols;

  const updateSheetRows = useCallback((updater) => {
    setSheets(ss => ss.map(s => s.id===activeSheet ? {...s, rows: typeof updater==="function" ? updater(s.rows) : updater} : s));
  }, [activeSheet]);
  const updateSheetCols = useCallback((updater) => {
    setSheets(ss => ss.map(s => s.id===activeSheet ? {...s, cols: typeof updater==="function" ? updater(s.cols) : updater} : s));
  }, [activeSheet]);

  const addSheet = () => {
    const id = "sheet"+Date.now();
    const name = "Sheet"+(sheets.length+1);
    const newCols = initialCols.map(c=>({...c}));
    const newRows = [Object.fromEntries(newCols.map(c=>[c.key,""]))];
    setSheets(ss=>[...ss,{id,name,rows:newRows,cols:newCols}]);
    setActiveSheet(id);
  };
  const renameSheet = (id) => {
    const s = sheets.find(s=>s.id===id);
    const name = prompt("Sheet name:", s?.name||"");
    if (name) setSheets(ss=>ss.map(s=>s.id===id?{...s,name}:s));
  };
  const deleteSheet = (id) => {
    if (sheets.length===1) return;
    setSheets(ss=>{const n=ss.filter(s=>s.id!==id); if(activeSheet===id)setActiveSheet(n[0].id); return n;});
  };
  const duplicateSheet = (id) => {
    const src=sheets.find(s=>s.id===id); if(!src) return;
    const newId="sheet"+Date.now();
    setSheets(ss=>[...ss,{id:newId,name:src.name+" (2)",rows:src.rows.map(r=>({...r})),cols:src.cols.map(c=>({...c}))}]);
    setActiveSheet(newId);
  };

  // ── Core state ─────────────────────────────────────────────────────────────
  const [editing, setEditing]               = useState(null);
  const [editVal, setEditVal]               = useState("");
  const [selection, setSelection]           = useState({start:null,end:null});
  const [colWidths, setColWidths]           = useState({});
  const [rowHeights, setRowHeights]         = useState({});
  const [sortConfig, setSortConfig]         = useState([]);
  const [filters, setFilters]               = useState({});
  const [openFilter, setOpenFilter]         = useState(null);
  const [frozenCols, setFrozenCols]         = useState(1);
  const [frozenRows, setFrozenRows]         = useState(0);
  const [formulaInput, setFormulaInput]     = useState("");
  const [clipboard, setClipboard]           = useState(null);
  const [resizing, setResizing]             = useState(null);
  const [sparkCols, setSparkCols]           = useState({});
  const [sparkType, setSparkType]           = useState("line");
  const [condFmtRules, setCondFmtRules]     = useState([]);
  const [namedRanges, setNamedRanges]       = useState({});
  const [validation, setValidation]         = useState({});
  const [validErrors, setValidErrors]       = useState({});
  const [hiddenCols, setHiddenCols]         = useState(new Set());
  const [hiddenRows, setHiddenRows]         = useState(new Set());
  const [contextMenu, setContextMenu]       = useState(null);
  const [modal, setModal]                   = useState(null);
  const [sheetColors, setSheetColors]       = useState({});
  const [zebra, setZebra]                   = useState(true);
  const [showGridLines, setShowGridLines]   = useState(true);
  const [history, dispatchHistory]          = useReducer(historyReducer,{past:[],future:[]});
  const [ribbonTab, setRibbonTab]           = useState("Home");
  // Phase 2: per-cell formatting: { "ri-ci": { bold, italic, underline, fontSize, fillColor, textColor, borderStyle, align } }
  // Phase 3+: per-sheet state stored on sheet object; fallback to global for backward compat
  const sheetMeta = useMemo(()=>sheets.find(s=>s.id===activeSheet)||sheets[0],[sheets,activeSheet]);
  const [cellFmt, setCellFmt]               = useState({});
  // Phase 4: merges: [{ r1,c1,r2,c2 }]
  const [merges, setMerges]                 = useState([]);
  // Phase 5: comments: { "ri-ci": "text" }
  const [comments, setComments]             = useState({});
  const [commentPopover, setCommentPopover] = useState(null);

  // Reset per-sheet state when active sheet changes
  const prevSheetRef = useRef(activeSheet);
  const [sheetState, setSheetState] = useState({}); // keyed by sheet id
  const saveSheetState = useCallback((id) => {
    setSheetState(ss=>({...ss,[id]:{cellFmt,merges,comments,condFmtRules,namedRanges,validation}}));
  },[cellFmt,merges,comments,condFmtRules,namedRanges,validation]);

  useEffect(()=>{
    if(prevSheetRef.current===activeSheet)return;
    // Save old sheet state
    saveSheetState(prevSheetRef.current);
    // Load new sheet state
    const saved=sheetState[activeSheet];
    if(saved){
      setCellFmt(saved.cellFmt||{});
      setMerges(saved.merges||[]);
      setComments(saved.comments||{});
      setCondFmtRules(saved.condFmtRules||[]);
      setNamedRanges(saved.namedRanges||{});
      setValidation(saved.validation||{});
    } else {
      setCellFmt({});setMerges([]);setComments({});
      setCondFmtRules([]);setNamedRanges({});setValidation({});
    }
    prevSheetRef.current=activeSheet;
  },[activeSheet]);
  // Formula autocomplete
  const [acSuggestions, setAcSuggestions]   = useState([]);
  const [acIndex, setAcIndex]               = useState(0);
  // ── Drag-to-fill (Fill Handle) ────────────────────────────────────────────
  const [fillDrag, setFillDrag]             = useState(null); // {startRi,startCi,endRi,endCi}
  const [fillHandleDragging, setFillHandleDragging] = useState(false);
  const [fillHandlePreview, setFillHandlePreview]   = useState(null); // {startRi,startCi,endRi,endCi}

  const detectFillPattern = useCallback((vals) => {
    if (!vals.length) return (i) => vals[0];
    // Weekdays
    const days = ["mon","tue","wed","thu","fri","sat","sun"];
    const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    const lower0 = String(vals[0]).toLowerCase();
    const lower1 = vals.length > 1 ? String(vals[1]).toLowerCase() : null;
    const dayIdx = days.findIndex(d => lower0.startsWith(d));
    if (dayIdx >= 0) return (i) => { const d = days[(dayIdx + i) % 7]; return d.charAt(0).toUpperCase()+d.slice(1); };
    const monIdx = months.findIndex(m => lower0.startsWith(m));
    if (monIdx >= 0) return (i) => { const m = months[(monIdx + i) % 12]; return m.charAt(0).toUpperCase()+m.slice(1); };
    // Text+number pattern like INV-001
    const txNumMatch = String(vals[0]).match(/^(.*?)(\d+)(\D*)$/);
    if (txNumMatch && vals.length >= 1) {
      const prefix = txNumMatch[1], numStr = txNumMatch[2], suffix = txNumMatch[3];
      const start = parseInt(numStr);
      const step = vals.length >= 2 ? (() => { const m2 = String(vals[1]).match(/^(.*?)(\d+)(\D*)$/); return m2 ? parseInt(m2[2]) - start : 1; })() : 1;
      if (!isNaN(start)) return (i) => prefix + String(start + i * step).padStart(numStr.length, '0') + suffix;
    }
    // Numeric sequence
    const nums = vals.map(v => Number(v));
    if (nums.every(n => !isNaN(n))) {
      if (nums.length === 1) return (i) => nums[0] + i;
      const step = nums.length >= 2 ? nums[1] - nums[0] : 1;
      return (i) => nums[0] + i * step;
    }
    // Formula: adjust row refs
    if (String(vals[0]).startsWith("=")) {
      return (i) => String(vals[0]).replace(/([A-Z]+)(\d+)/g, (_, col, row) => col + (parseInt(row) + i));
    }
    // Plain text: repeat
    return (i) => vals[i % vals.length];
  }, []);

  // ── Pinned rows ───────────────────────────────────────────────────────────
  const [pinnedRows, setPinnedRows]         = useState(new Set());
  // ── Row grouping ──────────────────────────────────────────────────────────
  const [rowGroups, setRowGroups]           = useState([]); // [{start,end,collapsed}]
  // ── Split pane ───────────────────────────────────────────────────────────
  const [splitPane, setSplitPane]           = useState(false);
  const [splitRatio, setSplitRatio]         = useState(0.5);
  // ── Saved filters ─────────────────────────────────────────────────────────
  const [savedFilters, setSavedFilters]     = useState([]); // [{name, filters}]
  // ── Quick search ──────────────────────────────────────────────────────────
  const [quickSearch, setQuickSearch]       = useState("");
  const [showQuickSearch, setShowQuickSearch] = useState(false);
  // ── Formula trace ─────────────────────────────────────────────────────────
  const [traceCell, setTraceCell]           = useState(null); // {ri,ci}
  // ── Drag row reorder ──────────────────────────────────────────────────────
  const [rowDrag, setRowDrag]               = useState(null); // {fromRi}
  const [rowDragOver, setRowDragOver]       = useState(null);
  // ── Drag col reorder ──────────────────────────────────────────────────────
  const [colDrag, setColDrag]               = useState(null); // {fromCi}
  const [colDragOver, setColDragOver]       = useState(null);
  const tableRef = useRef(null);
  // ── Recent values per column ──────────────────────────────────────────────
  const [recentValues, setRecentValues]     = useState({}); // {colKey: [val,...]}
  // ── Slash command ─────────────────────────────────────────────────────────
  const [slashMenu, setSlashMenu]           = useState(null); // {ri,ci,x,y,q}
  // ── Row template ──────────────────────────────────────────────────────────
  const [rowTemplates, setRowTemplates]     = useState([]); // [{name, data}]
  // ── Multi-row creation ────────────────────────────────────────────────────
  const [multiRowCount, setMultiRowCount]   = useState(1);
  // ── Smart suggestions (autofill from prev entries) ────────────────────────
  const [inlineSuggest, setInlineSuggest]   = useState(null); // {val,ri,ci}
  // ── Voice input ───────────────────────────────────────────────────────────
  const [voiceActive, setVoiceActive]       = useState(false);
  const voiceRef = useRef(null);
  // ── Attachment drop ───────────────────────────────────────────────────────
  const [attachments, setAttachments]       = useState({}); // {"origIdx-key": [{name,url}]}
  const [dragOver, setDragOver]             = useState(false);

  // ── UPGRADE 2: Pivot Table ────────────────────────────────────────────────
  const [pivotConfig, setPivotConfig]       = useState({ rowField:"", colField:"", valueField:"", aggFn:"SUM", filterField:"", filterValue:"" });
  const [showPivotPanel, setShowPivotPanel] = useState(false);

  // ── UPGRADE 3: AI Formula Assistant ──────────────────────────────────────
  const [aiQuery, setAiQuery]               = useState("");
  const [aiResult, setAiResult]             = useState("");
  const [aiLoading, setAiLoading]           = useState(false);
  const [showAiPanel, setShowAiPanel]       = useState(false);
  const [aiHistory, setAiHistory]           = useState([]); // [{role,content}]
  const [aiMode, setAiMode]                 = useState("chat"); // "chat" | "formula"
  const aiChatEndRef                        = useRef(null);

  // ── UPGRADE 4: Import/Export extra state ─────────────────────────────────
  const [importPreview, setImportPreview]   = useState(null);
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [exportAllSheets, setExportAllSheets] = useState(false);

  // ── UPGRADE 7: Command Palette ────────────────────────────────────────────
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const [cmdQuery, setCmdQuery]             = useState("");
  const cmdInputRef                         = useRef(null);
  const [cmdIndex, setCmdIndex]             = useState(0);

  // ── UPGRADE 8: Heatmap ────────────────────────────────────────────────────
  const [heatmapOn, setHeatmapOn]           = useState(false);
  const [zoomLevel, setZoomLevel]           = useState(100);

  // ── Undo/Redo ──────────────────────────────────────────────────────────────
  const pushHistory = useCallback(snap=>dispatchHistory({type:"PUSH",snapshot:snap}),[]);
  const undo = useCallback(()=>{if(!history.past.length||!onChange)return;history.past[history.past.length-1].forEach(({ri,key,val})=>onChange(ri,key,val,true));dispatchHistory({type:"UNDO"});},[history,onChange]);
  const redo = useCallback(()=>{if(!history.future.length||!onChange)return;history.future[0].forEach(({ri,key,val})=>onChange(ri,key,val,true));dispatchHistory({type:"REDO"});},[history,onChange]);

  // ── Validation ─────────────────────────────────────────────────────────────
  const validateCell = useCallback((colKey,value)=>{
    const rule=validation[colKey]; if(!rule||rule.type==="none")return null;
    if(rule.type==="notempty"&&(!value&&value!==0))return "Required";
    if(rule.type==="number"){const n=Number(value);if(isNaN(n))return "Must be a number";if(rule.op===">"&&!(n>Number(rule.min)))return `Must be > ${rule.min}`;if(rule.op==="<"&&!(n<Number(rule.min)))return `Must be < ${rule.min}`;if(rule.op===">="&&!(n>=Number(rule.min)))return `Must be ≥ ${rule.min}`;if(rule.op==="<="&&!(n<=Number(rule.min)))return `Must be ≤ ${rule.min}`;if(rule.op==="between"&&!(n>=Number(rule.min)&&n<=Number(rule.max)))return `Must be ${rule.min}–${rule.max}`;}
    return null;
  },[validation]);
  // ── Processed rows ─────────────────────────────────────────────────────────
  const processedRows = useMemo(()=>{
    let result=rows.map((r,i)=>({...r,__origIdx:i}));
    Object.entries(filters).forEach(([key,allowed])=>{if(allowed?.size>0)result=result.filter(r=>allowed.has(String(r[key]??"")));});
    if(sortConfig.length){result=[...result].sort((a,b)=>{for(const sc of sortConfig){const av=a[sc.key],bv=b[sc.key],an=Number(av),bn=Number(bv);const cmp=!isNaN(an)&&!isNaN(bn)?an-bn:String(av??'').localeCompare(String(bv??''));if(cmp!==0)return sc.dir==="asc"?cmp:-cmp;}return 0;});}
    return result;
  },[rows,filters,sortConfig]);

  const visibleCols = useMemo(()=>baseCols.filter((_,i)=>!hiddenCols.has(i)),[baseCols,hiddenCols]);
  const commitFillHandle = useCallback((startRi, startCi, endRi, endCi) => {
    if (!onChange) return;
    const col = visibleCols[startCi]; if (!col) return;
    const seedVals = [];
    const r1 = Math.min(startRi, endRi), r2 = Math.max(startRi, endRi);
    const c1 = Math.min(startCi, endCi), c2 = Math.max(startCi, endCi);
    const dragDown = endRi !== startRi;
    if (dragDown) {
      // seed = selected col cells before drag, at minimum the startRi cell
      seedVals.push(processedRows[startRi]?.[col.key] ?? "");
      if (startRi > 0) seedVals.unshift(processedRows[startRi-1]?.[col.key] ?? "");
    } else {
      // dragging right
      for (let c = c1; c <= startCi; c++) {
        const sc = visibleCols[c]; if (sc) seedVals.push(processedRows[startRi]?.[sc.key] ?? "");
      }
    }
    const pattern = detectFillPattern(seedVals.filter(v => v !== ""));
    const snapshot = [];
    if (dragDown) {
      for (let ri = startRi + 1; ri <= endRi; ri++) {
        const row = processedRows[ri]; if (!row) continue;
        snapshot.push({ ri: row.__origIdx, key: col.key, val: row[col.key] });
        onChange(row.__origIdx, col.key, pattern(ri - startRi));
      }
    } else {
      for (let ci = startCi + 1; ci <= endCi; ci++) {
        const c = visibleCols[ci]; if (!c) continue;
        const row = processedRows[startRi]; if (!row) continue;
        snapshot.push({ ri: row.__origIdx, key: c.key, val: row[c.key] });
        onChange(row.__origIdx, c.key, pattern(ci - startCi));
      }
    }
    if (snapshot.length) pushHistory(snapshot);
  }, [processedRows, visibleCols, onChange, pushHistory, detectFillPattern]);

  // validErrors keyed by "origIdx-colKey" so they survive sort/filter
  const validErrKey=(ri,ci)=>`${processedRows[ri]?.__origIdx}-${visibleCols[ci]?.key}`;

  // Apply row group collapsing
  const collapsedRowIdxs = useMemo(()=>{
    const s = new Set();
    rowGroups.forEach(g=>{ if(g.collapsed) for(let r=g.start+1;r<=g.end;r++) s.add(r); });
    return s;
  }, [rowGroups]);

  const visibleProcessedRows = useMemo(()=>{
    let base = processedRows.filter((_,ri)=>!hiddenRows.has(ri)&&!collapsedRowIdxs.has(ri));
    if (quickSearch.trim()) {
      const q = quickSearch.toLowerCase();
      base = base.filter(r => visibleCols.some(c => String(r[c.key]??"").toLowerCase().includes(q)));
    }
    // Pinned rows bubble to top (keyed by __origIdx)
    const pinned = base.filter(r=>pinnedRows.has(r.__origIdx));
    const rest   = base.filter(r=>!pinnedRows.has(r.__origIdx));
    return [...pinned, ...rest];
  }, [processedRows, hiddenRows, collapsedRowIdxs, quickSearch, visibleCols, pinnedRows]);

  const evalCell = useCallback((val,ri,ci)=>{
    if(typeof val==="string"&&val.startsWith("="))return evaluateFormula(val,processedRows,visibleCols,namedRanges);
    return val;
  },[processedRows,visibleCols,namedRanges]);

  // ── Selection ──────────────────────────────────────────────────────────────
  const cellId=(ri,ci)=>`xl3-${activeSheet}-${ri}-${ci}`;
  const isSelected=(ri,ci)=>{
    if(!selection.start)return false;
    const {start,end}=selection,e=end||start;
    return ri>=Math.min(start.ri,e.ri)&&ri<=Math.max(start.ri,e.ri)&&ci>=Math.min(start.ci,e.ci)&&ci<=Math.max(start.ci,e.ci);
  };
  const select=(ri,ci,extend=false)=>{
    setEditing(null);
    if(extend&&selection.start)setSelection(s=>({...s,end:{ri,ci}}));
    else setSelection({start:{ri,ci},end:null});
    const val=processedRows[ri]?.[visibleCols[ci]?.key];
    setFormulaInput(val!==undefined?String(val):"");
    setAcSuggestions([]);
  };

  const startEdit=(ri,ci,initChar)=>{
    const val=processedRows[ri]?.[visibleCols[ci]?.key]??"";
    setEditing({ri,ci});
    const v=initChar!==undefined?initChar:String(val);
    setEditVal(v);
    setFormulaInput(v);
    setSelection({start:{ri,ci},end:null});
  };

  const commitEdit=useCallback((ri,ci,overrideVal)=>{
    const row=processedRows[ri]; if(!row||!onChange)return;
    const raw=overrideVal!==undefined?overrideVal:editVal;
    const col=visibleCols[ci];
    const errKey=`${row.__origIdx}-${col?.key}`;
    const err=validateCell(col?.key,raw);
    if(err)setValidErrors(e=>({...e,[errKey]:err}));
    else setValidErrors(e=>{const n={...e};delete n[errKey];return n;});
    const isFormula=typeof raw==="string"&&raw.startsWith("=");
    const parsed=!isFormula&&raw.trim()!==""&&!isNaN(raw)?Number(raw):raw;
    pushHistory([{ri:row.__origIdx,key:col?.key,val:row[col?.key]}]);
    onChange(row.__origIdx,col?.key,parsed);
    // Track recent values per column
    if(parsed!==""&&parsed!==undefined){
      setRecentValues(rv=>{
        const key=col?.key; if(!key)return rv;
        const prev=(rv[key]||[]).filter(v=>v!==parsed);
        return {...rv,[key]:[parsed,...prev].slice(0,8)};
      });
    }
    setEditing(null);
    setAcSuggestions([]);
    setInlineSuggest(null);
  },[processedRows,editVal,visibleCols,onChange,validateCell,pushHistory]);

  // ── Formula autocomplete ───────────────────────────────────────────────────
  const updateAutocomplete=(val)=>{
    if(!val.startsWith("="))return setAcSuggestions([]);
    const inner=val.slice(1).toUpperCase();
    const lastWord=inner.match(/([A-Z]+)$/)?.[1]||"";
    if(lastWord.length<1)return setAcSuggestions([]);
    const matches=FORMULA_FNS.filter(f=>f.startsWith(lastWord)&&f!==lastWord);
    setAcSuggestions(matches.slice(0,6));
    setAcIndex(0);
  };

  // ── Smart date parsing ─────────────────────────────────────────────────────
  const parseSmartDate = (val) => {
    if(!val || val.startsWith("=")) return val;
    // Detect patterns like "today", "tomorrow", "yesterday", "next monday", "jan 5", "1/5", etc.
    const s = val.trim().toLowerCase();
    const now = new Date();
    if(s==="today") return now.toLocaleDateString();
    if(s==="tomorrow"){const d=new Date(now);d.setDate(d.getDate()+1);return d.toLocaleDateString();}
    if(s==="yesterday"){const d=new Date(now);d.setDate(d.getDate()-1);return d.toLocaleDateString();}
    const nextDay=s.match(/^next (mon|tue|wed|thu|fri|sat|sun)/i);
    if(nextDay){const days={mon:1,tue:2,wed:3,thu:4,fri:5,sat:6,sun:0};const target=days[nextDay[1].toLowerCase()];const d=new Date(now);let diff=(target-d.getDay()+7)%7||7;d.setDate(d.getDate()+diff);return d.toLocaleDateString();}
    // Try parsing short dates: "1/5", "jan 5", "5 jan"
    const parsed=new Date(val);
    if(!isNaN(parsed)&&val.length>3)return parsed.toLocaleDateString();
    return val;
  };

  // ── Auto-generated ID ──────────────────────────────────────────────────────
  const generateId = (colKey) => {
    const prefix = colKey.slice(0,3).toUpperCase();
    const existing = rows.map(r=>r[colKey]).filter(Boolean).map(v=>parseInt(String(v).replace(/\D/g,""))).filter(n=>!isNaN(n));
    const next = existing.length ? Math.max(...existing)+1 : 1;
    return `${prefix}-${String(next).padStart(4,"0")}`;
  };

  // ── Smart inline suggestion (autofill from prev entries) ──────────────────
  const updateInlineSuggest = (val, ri, ci) => {
    if(!val || val.startsWith("=") || val.length < 1) { setInlineSuggest(null); return; }
    const col = visibleCols[ci]; if(!col) return;
    const colKey = col.key;
    const allVals = rows.map(r=>r[colKey]).filter(v=>v!==undefined&&v!==""&&String(v).toLowerCase().startsWith(val.toLowerCase())&&String(v)!==val);
    if(allVals.length) setInlineSuggest({val:String(allVals[0]),ri,ci});
    else setInlineSuggest(null);
  };

  // ── Slash command handler ──────────────────────────────────────────────────
  const SLASH_CMDS = [
    {id:"bold",icon:"𝐁",label:"Bold"},
    {id:"italic",icon:"𝐼",label:"Italic"},
    {id:"underline",icon:"U̲",label:"Underline"},
    {id:"insert-row",icon:"⬇",label:"Insert Row Below"},
    {id:"delete-row",icon:"🗑",label:"Delete Row"},
    {id:"duplicate-row",icon:"⧉",label:"Duplicate Row"},
    {id:"pin-row",icon:"📌",label:"Pin Row"},
    {id:"add-comment",icon:"💬",label:"Add Comment"},
    {id:"clear-cell",icon:"✕",label:"Clear Cell"},
    {id:"sum",icon:"Σ",label:"Sum Column"},
    {id:"average",icon:"⌀",label:"Average Column"},
    {id:"date-today",icon:"📅",label:"Insert Today"},
    {id:"gen-id",icon:"🆔",label:"Generate ID"},
    {id:"save-template",icon:"💾",label:"Save Row as Template"},
    {id:"multi-row",icon:"⊞",label:"Add Multiple Rows"},
    {id:"merge",icon:"🔗",label:"Merge Cells"},
    {id:"find",icon:"🔍",label:"Find & Replace"},
    {id:"export",icon:"⬇️",label:"Export CSV"},
  ];
  const handleSlashCmd = (cmd, ri, ci) => {
    setSlashMenu(null); setEditVal(""); setEditing(null);
    switch(cmd.id){
      case "bold": toggleFmt("bold"); break;
      case "italic": toggleFmt("italic"); break;
      case "underline": toggleFmt("underline"); break;
      case "insert-row": insertRowBelow(ri); break;
      case "delete-row": deleteRow(ri); break;
      case "duplicate-row": duplicateRow(ri); break;
      case "pin-row": togglePinRow(ri); break;
      case "add-comment":{const row=processedRows[ri];const col=visibleCols[ci];const k=`${row?.__origIdx}-${col?.key}`;const rect=document.getElementById(cellId(ri,ci))?.getBoundingClientRect();setCommentPopover({x:(rect?.right||400)+4,y:rect?.top||200,cellKey:k});break;}
      case "clear-cell":{const row=processedRows[ri];const col=visibleCols[ci];if(row&&col&&onChange)onChange(row.__origIdx,col.key,"");break;}
      case "sum":{const col=visibleCols[ci];if(col&&selection.start)startEdit(ri,ci,`=SUM(${colLetter(ci)}1:${colLetter(ci)}${visibleProcessedRows.length})`);break;}
      case "average":{const col=visibleCols[ci];if(col&&selection.start)startEdit(ri,ci,`=AVERAGE(${colLetter(ci)}1:${colLetter(ci)}${visibleProcessedRows.length})`);break;}
      case "date-today":{const row=processedRows[ri];const col=visibleCols[ci];if(row&&col&&onChange)onChange(row.__origIdx,col.key,new Date().toLocaleDateString());break;}
      case "gen-id":{const col=visibleCols[ci];if(col&&onChange){const row=processedRows[ri];onChange(row.__origIdx,col.key,generateId(col.key));}break;}
      case "save-template":{const row=processedRows[ri];if(row){const name=prompt("Template name:");if(name){const data=Object.fromEntries(baseCols.map(c=>[c.key,row[c.key]||""]));setRowTemplates(ts=>[...ts,{name,data}]);}}break;}
      case "multi-row":{const n=parseInt(prompt("How many rows to add?","5"));if(!isNaN(n)&&n>0)autoExpandRows(n);break;}
      case "merge": mergeCells(); break;
      case "find": setModal("findreplace"); break;
      case "export": exportCSV(); break;
    }
  };

  // ── Voice input ────────────────────────────────────────────────────────────
  const startVoice = (ri, ci) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SR){alert("Voice input not supported in this browser.");return;}
    if(voiceRef.current){voiceRef.current.stop();voiceRef.current=null;setVoiceActive(false);return;}
    const recog = new SR(); recog.lang="en-US"; recog.continuous=false; recog.interimResults=false;
    recog.onresult = e => { const t=e.results[0][0].transcript; startEdit(ri,ci,t); setVoiceActive(false); voiceRef.current=null; };
    recog.onerror = () => { setVoiceActive(false); voiceRef.current=null; };
    recog.onend = () => { setVoiceActive(false); voiceRef.current=null; };
    voiceRef.current=recog; recog.start(); setVoiceActive(true);
  };

  // ── Drag/drop attachment handler ───────────────────────────────────────────
  const handleAttachDrop = (e, ri, ci) => {
    e.preventDefault(); setDragOver(false);
    const row=processedRows[ri]; const col=visibleCols[ci]; if(!row||!col)return;
    const files=[...e.dataTransfer.files];
    if(!files.length)return;
    const key=`${row.__origIdx}-${col.key}`;
    const newAttachments=files.map(f=>({name:f.name,url:URL.createObjectURL(f),type:f.type}));
    setAttachments(a=>({...a,[key]:[...(a[key]||[]),...newAttachments]}));
  };

  // ── Smart paste (reads system clipboard with tab/newline parsing) ──────────
  const handleSmartPaste = async (ri, ci) => {
    try {
      const text = await navigator.clipboard.readText();
      if(!text||!onChange)return;
      const rows2d = text.split("\n").map(r=>r.split("\t"));
      const snapshot=[];
      rows2d.forEach((row2,dr)=>row2.forEach((val,dc)=>{
        const tr=ri+dr, tc=ci+dc;
        if(tr<processedRows.length&&tc<visibleCols.length){
          const parsed=parseSmartDate(!isNaN(val.trim())&&val.trim()!==""?Number(val.trim()):val.trim());
          snapshot.push({ri:processedRows[tr].__origIdx,key:visibleCols[tc].key,val:processedRows[tr][visibleCols[tc].key]});
          onChange(processedRows[tr].__origIdx,visibleCols[tc].key,parsed);
        }
      }));
      if(snapshot.length)pushHistory(snapshot);
    } catch { handlePaste(ri,ci); }
  };

  // ── Apply formula autocomplete ─────────────────────────────────────────────
  const applyAutocomplete = (fn) => {
    if(!editing)return;
    const base=editVal;
    const lastWord=base.slice(1).toUpperCase().match(/([A-Z]*)$/)?.[1]||"";
    const newVal="="+base.slice(1,base.length-lastWord.length)+fn+"(";
    setEditVal(newVal);
    setFormulaInput(newVal);
    setAcSuggestions([]);
  };

  // ── Cell formatting ────────────────────────────────────────────────────────
  const getFmt=(ri,ci)=>cellFmt[`${ri}-${ci}`]||{};
  const applyFmt=(key,val)=>{
    if(!selection.start)return;
    const {start,end}=selection,e=end||start;
    const updates={};
    for(let r=Math.min(start.ri,e.ri);r<=Math.max(start.ri,e.ri);r++)
      for(let c=Math.min(start.ci,e.ci);c<=Math.max(start.ci,e.ci);c++){
        const k=`${r}-${c}`;
        updates[k]={...cellFmt[k],[key]:val};
      }
    setCellFmt(f=>({...f,...updates}));
  };
  const toggleFmt=(key)=>{
    if(!selection.start)return;
    const {start,end}=selection,e=end||start;
    const ri=start.ri,ci=start.ci;
    const cur=getFmt(Math.min(ri,e.ri),Math.min(ci,e.ci))[key];
    applyFmt(key,!cur);
  };

  // ── Move ───────────────────────────────────────────────────────────────────
  const colLetter=(ci)=>{let r="",n=ci+1;while(n>0){r=String.fromCharCode(65+((n-1)%26))+r;n=Math.floor((n-1)/26);}return r;};
  const move=(ri,ci,dr,dc,extend=false)=>{
    const nr=Math.max(0,Math.min(visibleProcessedRows.length-1,ri+dr));
    const nc=Math.max(0,Math.min(visibleCols.length-1,ci+dc));
    select(nr,nc,extend);
    setTimeout(()=>document.getElementById(cellId(nr,nc))?.focus(),0);
  };

  // ── Keyboard ───────────────────────────────────────────────────────────────
  const handleCellKeyDown=(e,ri,ci)=>{
    if(editing?.ri===ri&&editing?.ci===ci)return;
    const sh=e.shiftKey;
    switch(e.key){
      case "ArrowRight":e.preventDefault();move(ri,ci,0,1,sh);break;
      case "ArrowLeft": e.preventDefault();move(ri,ci,0,-1,sh);break;
      case "ArrowDown": e.preventDefault();move(ri,ci,1,0,sh);break;
      case "ArrowUp":   e.preventDefault();move(ri,ci,-1,0,sh);break;
      case "Tab":e.preventDefault();move(ri,ci,0,sh?-1:1);break;
      case "Enter":case "F2":e.preventDefault();startEdit(ri,ci);break;
      case "Delete":case "Backspace":{
        if(!onChange)break;
        const {start,end}=selection;const ev=end||start;
        if(start){const snapshot=[];for(let r=Math.min(start.ri,ev.ri);r<=Math.max(start.ri,ev.ri);r++)for(let c=Math.min(start.ci,ev.ci);c<=Math.max(start.ci,ev.ci);c++){snapshot.push({ri:processedRows[r].__origIdx,key:visibleCols[c].key,val:processedRows[r][visibleCols[c].key]});onChange(processedRows[r].__origIdx,visibleCols[c].key,"");}pushHistory(snapshot);}
        break;
      }
      case "c":if(e.ctrlKey||e.metaKey){e.preventDefault();handleCopy();}break;
      case "v":if(e.ctrlKey||e.metaKey){e.preventDefault();handleSmartPaste(ri,ci);}break;
      case "z":if(e.ctrlKey||e.metaKey){e.preventDefault();e.shiftKey?redo():undo();}break;
      case "y":if(e.ctrlKey||e.metaKey){e.preventDefault();redo();}break;
      case "f":if(e.ctrlKey||e.metaKey){e.preventDefault();setModal("findreplace");}break;
      case "b":if(e.ctrlKey||e.metaKey){e.preventDefault();toggleFmt("bold");}break;
      case "i":if(e.ctrlKey||e.metaKey){e.preventDefault();toggleFmt("italic");}break;
      case "u":if(e.ctrlKey||e.metaKey){e.preventDefault();toggleFmt("underline");}break;
      default:if(e.key.length===1&&!e.ctrlKey&&!e.metaKey)startEdit(ri,ci,e.key);
    }
  };

  const handleInputKeyDown=(e)=>{
    const {ri,ci}=editing;
    // Autocomplete navigation
    if(acSuggestions.length>0){
      if(e.key==="ArrowDown"){e.preventDefault();setAcIndex(i=>Math.min(i+1,acSuggestions.length-1));return;}
      if(e.key==="ArrowUp"){e.preventDefault();setAcIndex(i=>Math.max(i-1,0));return;}
      if(e.key==="Tab"&&acSuggestions.length>0){e.preventDefault();applyAutocomplete(acSuggestions[acIndex]);return;}
    }
    if(e.key==="Enter"){
      e.preventDefault();
      // Apply smart date if applicable
      const smartVal=parseSmartDate(editVal);
      if(smartVal!==editVal){setEditVal(smartVal);commitEdit(ri,ci,smartVal);} else commitEdit(ri,ci);
      setTimeout(()=>move(ri,ci,1,0),0);
    }
    if(e.key==="Tab"){
      e.preventDefault();
      // Accept inline suggestion on Tab
      if(inlineSuggest&&inlineSuggest.ri===ri&&inlineSuggest.ci===ci){setEditVal(inlineSuggest.val);commitEdit(ri,ci,inlineSuggest.val);setInlineSuggest(null);}
      else commitEdit(ri,ci);
      setTimeout(()=>move(ri,ci,0,e.shiftKey?-1:1),0);
    }
    if(e.key==="Escape"){setEditing(null);setAcSuggestions([]);setTimeout(()=>document.getElementById(cellId(ri,ci))?.focus(),0);}
    if(e.key==="ArrowUp"){commitEdit(ri,ci);setTimeout(()=>move(ri,ci,-1,0),0);}
    if(e.key==="ArrowDown"){commitEdit(ri,ci);setTimeout(()=>move(ri,ci,1,0),0);}
  };

  // ── Copy/Paste ─────────────────────────────────────────────────────────────
  const handleCopy=()=>{
    const {start,end}=selection;if(!start)return;
    const e=end||start,r1=Math.min(start.ri,e.ri),r2=Math.max(start.ri,e.ri),c1=Math.min(start.ci,e.ci),c2=Math.max(start.ci,e.ci);
    const data=[];
    for(let r=r1;r<=r2;r++){const row=[];for(let c=c1;c<=c2;c++)row.push(processedRows[r]?.[visibleCols[c].key]??"");data.push(row);}
    setClipboard({data,rows:r2-r1+1,cols:c2-c1+1});
    navigator.clipboard?.writeText(data.map(r=>r.join("\t")).join("\n")).catch(()=>{});
  };
  const handlePaste=(ri,ci)=>{
    if(!clipboard||!onChange)return;
    const snapshot=[];
    clipboard.data.forEach((row,dr)=>row.forEach((val,dc)=>{const tr=ri+dr,tc=ci+dc;if(tr<processedRows.length&&tc<visibleCols.length){snapshot.push({ri:processedRows[tr].__origIdx,key:visibleCols[tc].key,val:processedRows[tr][visibleCols[tc].key]});onChange(processedRows[tr].__origIdx,visibleCols[tc].key,val);}}));
    pushHistory(snapshot);
  };

  // ── Resize cols ────────────────────────────────────────────────────────────
  const startResize=(e,ci)=>{e.preventDefault();e.stopPropagation();const key=visibleCols[ci]?.key||ci;setResizing({ci,key,startX:e.clientX,startW:colWidths[key]||visibleCols[ci]?.width||120});};
  useEffect(()=>{
    if(!resizing)return;
    const onMove=e=>setColWidths(p=>({...p,[resizing.key]:Math.max(40,resizing.startW+e.clientX-resizing.startX)}));
    const onUp=()=>setResizing(null);
    window.addEventListener("mousemove",onMove);window.addEventListener("mouseup",onUp);
    return()=>{window.removeEventListener("mousemove",onMove);window.removeEventListener("mouseup",onUp);};
  },[resizing]);
  const colW=(ci)=>{const key=visibleCols[ci]?.key;return (key&&colWidths[key])||visibleCols[ci]?.width||120;};

  // ── Formula bar commit ─────────────────────────────────────────────────────
  const commitFormulaBar=()=>{
    const {start}=selection;if(!start||!onChange)return;
    const row=processedRows[start.ri];if(!row)return;
    const isFormula=formulaInput.startsWith("=");
    const val=!isFormula&&formulaInput.trim()!==""&&!isNaN(formulaInput)?Number(formulaInput):formulaInput;
    pushHistory([{ri:row.__origIdx,key:visibleCols[start.ci]?.key,val:row[visibleCols[start.ci]?.key]}]);
    onChange(row.__origIdx,visibleCols[start.ci]?.key,val);
    setEditing(null);
  };

  // ── Drag-to-fill ──────────────────────────────────────────────────────────
  // Known custom lists for fill handle cycling
  const CUSTOM_LISTS = [
    ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],
    ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],
    ["January","February","March","April","May","June","July","August","September","October","November","December"],
    ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],
    ["Q1","Q2","Q3","Q4"],
    ["Pending","In Progress","Done","Blocked"],
  ];
  const detectPattern = (startRi, startCi) => {
    const colKey = visibleCols[startCi]?.key;
    const vals = [];
    for(let r = Math.max(0, startRi - 3); r <= startRi; r++) {
      const v = processedRows[r]?.[colKey];
      if(v !== "" && v !== undefined) vals.push(v);
    }
    // Numeric arithmetic sequence
    const nums = vals.map(Number);
    if(nums.length >= 2 && nums.every(n=>!isNaN(n))) {
      const diffs = nums.slice(1).map((n,i)=>n-nums[i]);
      if(diffs.every(d=>d===diffs[0])) return { type:"arithmetic", step:diffs[0], lastVal:nums[nums.length-1] };
    }
    // Date sequence detection
    if(vals.length >= 2) {
      const dates = vals.map(v=>new Date(v));
      if(dates.every(d=>!isNaN(d.getTime()))) {
        const msDeltas = dates.slice(1).map((d,i)=>d-dates[i]);
        if(msDeltas.every(d=>d===msDeltas[0])) {
          return { type:"date", stepMs:msDeltas[0], lastDate:dates[dates.length-1] };
        }
      }
    }
    // Custom list cycling
    const lastVal = String(processedRows[startRi]?.[colKey]??"");
    for(const list of CUSTOM_LISTS) {
      const idx = list.findIndex(v=>v.toLowerCase()===lastVal.toLowerCase());
      if(idx>=0) return { type:"customList", list, lastIdx:idx };
    }
    return { type:"repeat", val:processedRows[startRi]?.[colKey] };
  };
  const applyFillDrag = useCallback(() => {
    if (!fillDrag || !onChange) return;
    const { startRi, startCi, endRi, endCi } = fillDrag;
    if (startRi === endRi && startCi === endCi) { setFillDrag(null); return; }
    // Use new smart commitFillHandle
    commitFillHandle(startRi, startCi, endRi, endCi);
    setFillDrag(null);
  }, [fillDrag, commitFillHandle, onChange]);

  // ── Fill drag window-level tracking ────────────────────────────────────────
  useEffect(()=>{
    if(!fillDrag)return;
    const onUp=()=>{applyFillDrag();setFillHandleDragging(false);};
    window.addEventListener("mouseup",onUp);
    return()=>window.removeEventListener("mouseup",onUp);
  },[fillDrag,applyFillDrag]);
  const handleRowDragEnd = useCallback(() => {
    if (rowDrag === null || rowDragOver === null || rowDrag === rowDragOver) { setRowDrag(null); setRowDragOver(null); return; }
    const fromOrig = visibleProcessedRows[rowDrag]?.__origIdx;
    const toOrig   = visibleProcessedRows[rowDragOver]?.__origIdx;
    if(fromOrig===undefined||toOrig===undefined){setRowDrag(null);setRowDragOver(null);return;}
    updateSheetRows(rs => {
      const n = [...rs];
      const fromIdx = n.findIndex((_,i)=>i===fromOrig);
      const toIdx   = n.findIndex((_,i)=>i===toOrig);
      if(fromIdx<0||toIdx<0)return rs;
      const [moved] = n.splice(fromIdx, 1);
      n.splice(toIdx, 0, moved);
      return n;
    });
    setRowDrag(null); setRowDragOver(null);
  }, [rowDrag, rowDragOver, updateSheetRows, visibleProcessedRows]);

  // ── Col drag-reorder ───────────────────────────────────────────────────────
  const handleColDragEnd = useCallback(() => {
    if (colDrag === null || colDragOver === null || colDrag === colDragOver) { setColDrag(null); setColDragOver(null); return; }
    updateSheetCols(cs => {
      const n = [...cs]; const [moved] = n.splice(colDrag, 1); n.splice(colDragOver, 0, moved); return n;
    });
    setColDrag(null); setColDragOver(null);
  }, [colDrag, colDragOver, updateSheetCols]);

  // ── Quick duplicate row ───────────────────────────────────────────────────
  const duplicateRow = useCallback((ri) => {
    const row = processedRows[ri]; if (!row) return;
    const blank = { ...row }; delete blank.__origIdx;
    updateSheetRows(rs => { const n = [...rs]; n.splice(ri + 1, 0, blank); return n; });
  }, [processedRows, updateSheetRows]);

  // ── Auto row expansion ────────────────────────────────────────────────────
  const autoExpandRows = useCallback((count = 10) => {
    const blank = Object.fromEntries(baseCols.map(c => [c.key, ""]));
    updateSheetRows(rs => [...rs, ...Array(count).fill(null).map(() => ({ ...blank }))]);
  }, [baseCols, updateSheetRows]);

  // ── Bulk edit ─────────────────────────────────────────────────────────────
  const bulkSetValue = useCallback((value) => {
    if (!selection.start || !onChange) return;
    const { start, end } = selection, e = end || start;
    const snapshot = [];
    for (let r = Math.min(start.ri, e.ri); r <= Math.max(start.ri, e.ri); r++)
      for (let c = Math.min(start.ci, e.ci); c <= Math.max(start.ci, e.ci); c++) {
        const row = processedRows[r]; const col = visibleCols[c]; if (!row || !col) continue;
        snapshot.push({ ri: row.__origIdx, key: col.key, val: row[col.key] });
        onChange(row.__origIdx, col.key, value);
      }
    pushHistory(snapshot);
  }, [selection, processedRows, visibleCols, onChange, pushHistory]);

  // ── Row grouping ──────────────────────────────────────────────────────────
  const addRowGroup = useCallback(() => {
    if (!selection.start) return;
    const { start, end } = selection, e = end || start;
    const s = Math.min(start.ri, e.ri), en = Math.max(start.ri, e.ri);
    if (s === en) return;
    setRowGroups(gs => [...gs, { start: s, end: en, collapsed: false }]);
  }, [selection]);
  const toggleGroup = useCallback((idx) => {
    setRowGroups(gs => gs.map((g, i) => i === idx ? { ...g, collapsed: !g.collapsed } : g));
  }, []);

  // ── UPGRADE 2: Pivot computation ──────────────────────────────────────────
  const pivotData = useMemo(() => {
    const { rowField, colField, valueField, aggFn, filterField, filterValue } = pivotConfig;
    if (!rowField || !valueField) return null;
    let src = rows;
    if (filterField && filterValue) src = src.filter(r => String(r[filterField] ?? "") === filterValue);
    const rowVals = [...new Set(src.map(r => String(r[rowField] ?? "")))].sort();
    const colVals = colField ? [...new Set(src.map(r => String(r[colField] ?? "")))].sort() : ["Value"];
    const agg = (vals) => {
      const nums = vals.map(Number).filter(n => !isNaN(n));
      if (!nums.length) return "";
      switch (aggFn) {
        case "SUM": return nums.reduce((a,b)=>a+b,0);
        case "COUNT": return vals.length;
        case "AVERAGE": return nums.length?(nums.reduce((a,b)=>a+b,0)/nums.length).toFixed(2):"";
        case "MAX": return nums.length?Math.max(...nums):"";
        case "MIN": return nums.length?Math.min(...nums):"";
        case "MEDIAN": { const s=[...nums].sort((a,b)=>a-b),m=Math.floor(s.length/2); return s.length?s.length%2?s[m]:((s[m-1]+s[m])/2).toFixed(2):""; }
        case "STDEV": { if(nums.length<2)return 0; const mean=nums.reduce((a,b)=>a+b,0)/nums.length; return Math.sqrt(nums.reduce((a,b)=>a+(b-mean)**2,0)/(nums.length-1)).toFixed(4); }
        case "FIRST": return vals[0]??"";
        case "LAST": return vals[vals.length-1]??"";
        default: return nums.reduce((a,b)=>a+b,0);
      }
    };
    const grid = {};
    rowVals.forEach(rv => {
      grid[rv] = {};
      colVals.forEach(cv => {
        const subset = colField
          ? src.filter(r => String(r[rowField]??"")===rv && String(r[colField]??"")===cv)
          : src.filter(r => String(r[rowField]??"")===rv);
        grid[rv][cv] = agg(subset.map(r => r[valueField]));
      });
    });
    // Row subtotals
    rowVals.forEach(rv => {
      const allVals = src.filter(r=>String(r[rowField]??"")===rv).map(r=>r[valueField]);
      grid[rv].__subtotal = agg(allVals);
    });
    // Grand totals per col
    const grandTotals = {};
    colVals.forEach(cv => {
      const allVals = colField
        ? src.filter(r=>String(r[colField]??"")===cv).map(r=>r[valueField])
        : src.map(r=>r[valueField]);
      grandTotals[cv] = agg(allVals);
    });
    grandTotals.__subtotal = agg(src.map(r=>r[valueField]));
    return { rowVals, colVals, grid, grandTotals };
  }, [rows, pivotConfig]);

  // ── UPGRADE 3: AI Formula Assistant ──────────────────────────────────────
  const runAI = useCallback(async (prompt, appendToHistory=true) => {
    setAiLoading(true);
    if(appendToHistory) setAiHistory(h=>[...h,{role:"user",content:prompt}]);
    try {
      const colNames = visibleCols.map(c=>c.label).join(", ");
      const sample = rows.slice(0,5).map(r=>visibleCols.map(c=>r[c.key]).join(" | ")).join("\n");
      const selVal = selection.start ? processedRows[selection.start.ri]?.[visibleCols[selection.start.ci]?.key]??"" : "";
      const selRef = selection.start ? `${colLetter(selection.start.ci)}${selection.start.ri+1}` : "";
      const sysPrompt = `You are an expert spreadsheet AI assistant embedded in a powerful spreadsheet app. You help with formulas, data analysis, cleanup, and insights.\n\nAvailable columns: ${colNames}\nSample data (first 5 rows):\n${sample}\nCurrently selected cell: ${selRef} = "${selVal}"\n\nWhen suggesting formulas, always start with =. Be concise. If inserting a formula, output it on the first line alone. For analysis, use bullet points. For multi-step instructions, number them.`;
      const messages = appendToHistory
        ? [...aiHistory,{role:"user",content:prompt}]
        : [{role:"user",content:prompt}];
      // Note: x-api-key is intentionally omitted — claude.ai proxies the request and injects the key automatically.
      // anthropic-version is included for completeness; the proxy may override it.
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST", headers:{"Content-Type":"application/json","anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true","x-api-key":""},
        body: JSON.stringify({ model:"claude-sonnet-4-5", max_tokens:1000, system:sysPrompt, messages })
      });
      const data = await res.json();
      if(data.error) throw new Error(data.error.message||JSON.stringify(data.error));
      const text = data.content?.map(b=>b.text||"").join("") || "No response";
      setAiResult(text);
      if(appendToHistory) setAiHistory(h=>[...h,{role:"assistant",content:text}]);
      setTimeout(()=>aiChatEndRef.current?.scrollIntoView({behavior:"smooth"}),100);
    } catch(e) {
      const errMsg = "Error: "+e.message;
      setAiResult(errMsg);
      if(appendToHistory) setAiHistory(h=>[...h,{role:"assistant",content:errMsg}]);
    }
    setAiLoading(false);
  }, [visibleCols, rows, processedRows, selection, aiHistory]);

  // ── UPGRADE 4: Export XLSX / JSON / PDF ──────────────────────────────────
  const exportXLSX = useCallback(() => {
    try {
      const XLSX = window.XLSX;
      if (!XLSX) { alert("SheetJS not available"); return; }
      const wb = XLSX.utils.book_new();
      const sheetsToExport = exportAllSheets ? sheets : [sheet];
      sheetsToExport.forEach(s => {
        const data = [s.cols.map(c=>c.label), ...s.rows.map(r=>s.cols.map(c=>r[c.key]??"")),];
        const ws = XLSX.utils.aoa_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, s.name);
      });
      XLSX.writeFile(wb, "export.xlsx");
    } catch(e) { alert("XLSX export failed: "+e.message); }
  }, [sheets, sheet, exportAllSheets]);

  const exportJSON = useCallback(() => {
    const sheetsToExport = exportAllSheets ? sheets : [sheet];
    const data = exportAllSheets
      ? Object.fromEntries(sheetsToExport.map(s=>[s.name, s.rows]))
      : sheet.rows;
    const blob = new Blob([JSON.stringify(data, null, 2)], {type:"application/json"});
    const a = document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="export.json"; a.click();
  }, [sheets, sheet, exportAllSheets]);

  const exportPDF = useCallback(() => {
    const win = window.open("","_blank");
    const colsH = visibleCols.map(c=>`<th style="border:1px solid #999;padding:4px 8px;background:#e8eaed">${c.label}</th>`).join("");
    const rowsH = visibleProcessedRows.map(r=>`<tr>${visibleCols.map(c=>`<td style="border:1px solid #ddd;padding:4px 8px">${r[c.key]??""}</td>`).join("")}</tr>`).join("");
    win.document.write(`<html><head><title>Export</title><style>@media print{body{margin:0}}</style></head><body><table style="border-collapse:collapse;font-family:sans-serif;font-size:12px"><thead><tr>${colsH}</tr></thead><tbody>${rowsH}</tbody></table></body></html>`);
    win.document.close(); win.focus(); win.print(); win.close();
  }, [visibleCols, visibleProcessedRows]);

  // ── UPGRADE 4: Import CSV / JSON ─────────────────────────────────────────
  const handleImportFile = useCallback((file) => {
    const ext = file.name.split(".").pop().toLowerCase();
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      if (ext === "csv") {
        const Papa = window.Papa;
        if (!Papa) { alert("PapaParse not loaded"); return; }
        const result = Papa.parse(text, { header:true, skipEmptyLines:true });
        const cols = result.meta.fields.map(f=>({key:f,label:f,width:120}));
        setImportPreview({ rows:result.data, cols, mode:"append", source:file.name });
        setShowImportPanel(true);
      } else if (ext === "json") {
        try {
          const data = JSON.parse(text);
          const arr = Array.isArray(data) ? data : Object.values(data)[0] || [];
          const cols = arr.length ? Object.keys(arr[0]).map(k=>({key:k,label:k,width:120})) : [];
          setImportPreview({ rows:arr, cols, mode:"append", source:file.name });
          setShowImportPanel(true);
        } catch { alert("Invalid JSON"); }
      }
    };
    reader.readAsText(file);
  }, []);

  const commitImport = useCallback(() => {
    if (!importPreview) return;
    const { rows: newRows, cols: newCols, mode } = importPreview;
    // Add any missing columns
    const existingKeys = new Set(baseCols.map(c=>c.key));
    const addCols = newCols.filter(c=>!existingKeys.has(c.key));
    if (addCols.length) {
      updateSheetCols(cs=>[...cs,...addCols]);
      updateSheetRows(rs=>rs.map(r=>({...r,...Object.fromEntries(addCols.map(c=>[c.key,""]))})));
    }
    if (mode === "replace") {
      updateSheetRows(_ => newRows);
    } else if (mode === "append") {
      updateSheetRows(rs => [...rs, ...newRows]);
    } else { // skip duplicates by first col key
      const firstKey = newCols[0]?.key;
      updateSheetRows(rs => {
        const existingVals = new Set(rs.map(r=>String(r[firstKey]??"")));
        return [...rs, ...newRows.filter(r=>!existingVals.has(String(r[firstKey]??"")))];
      });
    }
    setImportPreview(null); setShowImportPanel(false);
  }, [importPreview, baseCols, updateSheetCols, updateSheetRows]);

  // ── UPGRADE 7: Command Palette commands ──────────────────────────────────
  const allCommands = useMemo(() => {
    const cmds = [
      { label:"Bold", category:"Formatting", shortcut:"Ctrl+B", action:()=>{ /* toggleFmt called below */ } },
      { label:"Italic", category:"Formatting", action:()=>{} },
      { label:"Underline", category:"Formatting", action:()=>{} },
      { label:"Insert Row Above", category:"Data", shortcut:"", action:()=>{if(selection.start)insertRowAbove(selection.start.ri);} },
      { label:"Insert Row Below", category:"Data", action:()=>{if(selection.start)insertRowBelow(selection.start.ri);} },
      { label:"Delete Row", category:"Data", action:()=>{if(selection.start)deleteRow(selection.start.ri);} },
      { label:"Insert Col Left", category:"Data", action:()=>{if(selection.start)insertColLeft(selection.start.ci);} },
      { label:"Insert Col Right", category:"Data", action:()=>{if(selection.start)insertColRight(selection.start.ci);} },
      { label:"Delete Column", category:"Data", action:()=>{if(selection.start)deleteCol(selection.start.ci);} },
      { label:"Sort Ascending", category:"Data", action:()=>{if(selection.start)setSortConfig([{key:visibleCols[selection.start.ci]?.key,dir:"asc"}]);} },
      { label:"Sort Descending", category:"Data", action:()=>{if(selection.start)setSortConfig([{key:visibleCols[selection.start.ci]?.key,dir:"desc"}]);} },
      { label:"Export CSV", category:"Data", action:()=>exportCSV() },
      { label:"Export XLSX", category:"Data", action:()=>exportXLSX() },
      { label:"Export JSON", category:"Data", action:()=>exportJSON() },
      { label:"Export PDF", category:"Data", action:()=>exportPDF() },
      { label:"Find & Replace", category:"Data", shortcut:"Ctrl+F", action:()=>setModal("findreplace") },
      { label:"New Sheet", category:"Sheets", action:()=>addSheet() },
      { label:"Conditional Format", category:"Formatting", action:()=>setModal("condfmt") },
      { label:"Data Validation", category:"Data", action:()=>setModal("validation") },
      { label:"Named Ranges", category:"Formulas", action:()=>setModal("namedranges") },
      { label:"Merge Cells", category:"Formatting", action:()=>mergeCells() },
      { label:"Toggle Heatmap", category:"View", action:()=>setHeatmapOn(h=>!h) },
      { label:"Toggle Grid Lines", category:"View", action:()=>setShowGridLines(g=>!g) },
      { label:"Toggle Zebra", category:"View", action:()=>setZebra(z=>!z) },
      { label:"Undo", category:"Editing", shortcut:"Ctrl+Z", action:()=>undo() },
      { label:"Redo", category:"Editing", shortcut:"Ctrl+Y", action:()=>redo() },
      { label:"Open AI Assistant", category:"AI", action:()=>{setRibbonTab("AI");setShowAiPanel(true);} },
      { label:"Open Pivot Table", category:"Data", action:()=>{setRibbonTab("Pivot");setShowPivotPanel(true);} },
      ...FORMULA_FNS.map(fn=>({ label:`=${fn}( formula`, category:"Formulas", action:()=>{if(selection.start)startEdit(selection.start.ri,selection.start.ci,"="+fn+"(");} })),
      ...sheets.map(s=>({ label:`Go to sheet: ${s.name}`, category:"Navigation", action:()=>setActiveSheet(s.id) })),
    ];
    return cmds;
  }, [selection, visibleCols, sheets]);

  const filteredCmds = useMemo(() => {
    if (!cmdQuery.trim()) return allCommands.slice(0,20);
    const q = cmdQuery.toLowerCase();
    return allCommands.filter(c=>c.label.toLowerCase().includes(q)||c.category.toLowerCase().includes(q)).slice(0,20);
  }, [cmdQuery, allCommands]);

  // ── UPGRADE 8: Heatmap color helper ──────────────────────────────────────
  const heatmapMeta = useMemo(() => {
    if (!heatmapOn) return {};
    const meta = {};
    visibleCols.forEach(c => {
      const nums = rows.map(r=>Number(r[c.key])).filter(n=>!isNaN(n)&&n!=="");
      if (!nums.length) return;
      meta[c.key] = { min: Math.min(...nums), max: Math.max(...nums) };
    });
    return meta;
  }, [heatmapOn, visibleCols, rows]);

  const getHeatmapBg = useCallback((colKey, val) => {
    if (!heatmapOn) return null;
    const m = heatmapMeta[colKey]; if (!m) return null;
    const n = Number(val); if (isNaN(n)) return null;
    const t = m.max === m.min ? 0.5 : (n - m.min) / (m.max - m.min);
    // low=light blue (#bfdbfe), mid=white, high=deep orange (#ea580c)
    if (t <= 0.5) {
      const r2 = t * 2;
      const r = Math.round(191 + (255-191)*r2), g = Math.round(219 + (255-219)*r2), b = Math.round(254 + (255-254)*r2);
      return `rgb(${r},${g},${b})`;
    } else {
      const r2 = (t - 0.5) * 2;
      const r = Math.round(255), g = Math.round(255 - (255-88)*r2), b = Math.round(255 - (255-12)*r2);
      return `rgb(${r},${g},${b})`;
    }
  }, [heatmapOn, heatmapMeta]);

  // ── Formula trace ─────────────────────────────────────────────────────────
  const getTracedCells = useCallback((ri, ci) => {
    const val = processedRows[ri]?.[visibleCols[ci]?.key] ?? "";
    if (typeof val !== "string" || !val.startsWith("=")) return [];
    return [...val.matchAll(/([A-Z]+)(\d+)/g)].map(m => ({ ci: m[1].charCodeAt(0) - 65, ri: parseInt(m[2]) - 1 }));
  }, [processedRows, visibleCols]);

  // ── Pinned rows - keyed by __origIdx for stability across sort/filter ────
  const togglePinRow = useCallback((ri) => {
    const origIdx = processedRows[ri]?.__origIdx;
    if(origIdx===undefined)return;
    setPinnedRows(s => { const n = new Set(s); n.has(origIdx) ? n.delete(origIdx) : n.add(origIdx); return n; });
  }, [processedRows]);

  // ── Status stats ───────────────────────────────────────────────────────────
  const statusStats=useMemo(()=>{
    const {start,end}=selection;if(!start)return null;
    const e=end||start;const vals=[];
    for(let r=Math.min(start.ri,e.ri);r<=Math.max(start.ri,e.ri);r++)
      for(let c=Math.min(start.ci,e.ci);c<=Math.max(start.ci,e.ci);c++){const v=Number(processedRows[r]?.[visibleCols[c]?.key]);if(!isNaN(v))vals.push(v);}
    if(!vals.length)return null;
    const sum=vals.reduce((a,b)=>a+b,0);
    return {count:vals.length,sum:sum.toLocaleString(),avg:(sum/vals.length).toFixed(2),min:Math.min(...vals),max:Math.max(...vals)};
  },[selection,processedRows,visibleCols]);

  const selLabel=selection.start?(selection.end?`${colLetter(Math.min(selection.start.ci,selection.end.ci))}${Math.min(selection.start.ri,selection.end.ri)+1}:${colLetter(Math.max(selection.start.ci,selection.end.ci))}${Math.max(selection.start.ri,selection.end.ri)+1}`:`${colLetter(selection.start.ci)}${selection.start.ri+1}`):"—";

  const numericCols=useMemo(()=>visibleCols.filter(c=>rows.some(r=>!isNaN(Number(r[c.key]))&&r[c.key]!==""&&r[c.key]!==undefined)),[visibleCols,rows]);
  const hasSparklines=Object.values(sparkCols).some(Boolean);
  const frozenLeft=(ci)=>{let left=44+(onDelete?28:0);for(let i=0;i<ci;i++)left+=colW(i);return left;};

  // ── Row/Col Insert+Delete (Phase 4) ───────────────────────────────────────
  const insertRowAbove=(ri)=>{
    setEditing(null);
    const blank=Object.fromEntries(baseCols.map(c=>[c.key,""]));
    updateSheetRows(rs=>{const n=[...rs];n.splice(processedRows[ri]?.__origIdx??ri,0,blank);return n;});
  };
  const insertRowBelow=(ri)=>{
    setEditing(null);
    const blank=Object.fromEntries(baseCols.map(c=>[c.key,""]));
    updateSheetRows(rs=>{const n=[...rs];n.splice((processedRows[ri]?.__origIdx??ri)+1,0,blank);return n;});
  };
  const deleteRow=(ri)=>{
    const origIdx=processedRows[ri]?.__origIdx;
    if(origIdx===undefined)return;
    updateSheetRows(rs=>rs.filter((_,i)=>i!==origIdx));
  };
  // Convert visibleCols index → baseCols index (accounts for hidden cols)
  const toBaseColIdx=(ci)=>{
    const colKey=visibleCols[ci]?.key;
    return baseCols.findIndex(c=>c.key===colKey);
  };
  const insertColLeft=(ci)=>{
    const key="col"+Date.now(); const label="Col "+(baseCols.length+1);
    const bci=toBaseColIdx(ci);
    updateSheetCols(cs=>{const n=[...cs];n.splice(bci<0?0:bci,0,{key,label,width:100});return n;});
    updateSheetRows(rs=>rs.map(r=>({...r,[key]:""})));
  };
  const insertColRight=(ci)=>{
    const key="col"+Date.now(); const label="Col "+(baseCols.length+1);
    const bci=toBaseColIdx(ci);
    updateSheetCols(cs=>{const n=[...cs];n.splice(bci<0?cs.length:bci+1,0,{key,label,width:100});return n;});
    updateSheetRows(rs=>rs.map(r=>({...r,[key]:""})));
  };
  const deleteCol=(ci)=>{
    const col=visibleCols[ci]; if(!col)return;
    updateSheetCols(cs=>cs.filter(c=>c.key!==col.key));
    updateSheetRows(rs=>rs.map(r=>{const n={...r};delete n[col.key];return n;}));
    setColWidths(w=>{const n={...w};delete n[col.key];return n;});
  };

  // ── Merge Cells (Phase 4) ─────────────────────────────────────────────────
  const mergeCells=()=>{
    if(!selection.start)return;
    const {start,end}=selection,e=end||start;
    const r1=Math.min(start.ri,e.ri),r2=Math.max(start.ri,e.ri),c1=Math.min(start.ci,e.ci),c2=Math.max(start.ci,e.ci);
    if(r1===r2&&c1===c2)return;
    // remove any existing merges that overlap
    setMerges(ms=>{const remaining=ms.filter(m=>!(m.r1<=r2&&m.r2>=r1&&m.c1<=c2&&m.c2>=c1));return [...remaining,{r1,c1,r2,c2}];});
  };
  const unmergeCells=()=>{
    if(!selection.start)return;
    const {ri,ci}=selection.start;
    setMerges(ms=>ms.filter(m=>!(m.r1===ri&&m.c1===ci)));
  };

  // ── Export CSV ─────────────────────────────────────────────────────────────
  const exportCSV=()=>{
    const header=visibleCols.map(c=>c.label).join(",");
    const body=processedRows.map(r=>visibleCols.map(c=>{const v=evalCell(r[c.key],0,0);return `"${String(v??"").replace(/"/g,'""')}"`;}).join(",")).join("\n");
    const blob=new Blob([header+"\n"+body],{type:"text/csv"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="table.csv";a.click();
  };

  // ── Click-outside filter & global keys ────────────────────────────────────
  useEffect(()=>{const h=e=>{if(!e.target.closest?.(".xl-filter-anchor"))setOpenFilter(null);};document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);},[]);
  useEffect(()=>{
    const h=e=>{
      if(e.key==="Escape"){setContextMenu(null);setCommentPopover(null);}
      if((e.ctrlKey||e.metaKey)&&e.key==="z"&&!e.shiftKey){e.preventDefault();undo();}
      if((e.ctrlKey||e.metaKey)&&(e.key==="y"||(e.key==="z"&&e.shiftKey))){e.preventDefault();redo();}
      if((e.ctrlKey||e.metaKey)&&e.key==="k"){e.preventDefault();setShowQuickSearch(s=>!s);}
    };
    window.addEventListener("keydown",h);return()=>window.removeEventListener("keydown",h);
  },[undo,redo]);

  // ── Context menu ───────────────────────────────────────────────────────────
  const openContextMenu=(e,ri,ci)=>{e.preventDefault();if(!isSelected(ri,ci))select(ri,ci);setContextMenu({x:e.clientX,y:e.clientY,ri,ci});};

  // ── One-click status cycle ─────────────────────────────────────────────────
  const STATUS_CYCLE=["Pending","In Progress","Done","Blocked"];
  const cycleStatus=(ri)=>{
    const statusCol=visibleCols.find(c=>c.key==="status"||c.label?.toLowerCase()==="status");
    if(!statusCol)return;
    const row=processedRows[ri]; if(!row)return;
    const cur=row[statusCol.key]||"Pending";
    const next=STATUS_CYCLE[(STATUS_CYCLE.indexOf(cur)+1)%STATUS_CYCLE.length];
    pushHistory([{ri:row.__origIdx,key:statusCol.key,val:cur}]);
    onChange(row.__origIdx,statusCol.key,next);
  };

  const _cm=contextMenu;
  const _row=_cm?processedRows[_cm.ri]:null;
  const _col=_cm?visibleCols[_cm.ci]:null;
  const _cellVal=_row&&_col?_row[_col.key]:"";
  const _cellRef=_cm?`${colLetter(_cm.ci)}${_cm.ri+1}`:"";
  const _fmt=_cm?getFmt(_cm.ri,_cm.ci):{};
  const contextItems=_cm?[
    {__section:`Cell ${_cellRef}${_cellVal!==""?" · "+String(_cellVal).slice(0,22):""}`},
    {icon:"✂️",label:"Cut",shortcut:"⌘X",action:()=>handleCopy()},
    {icon:"📋",label:"Copy",shortcut:"⌘C",action:()=>handleCopy()},
    {icon:"📌",label:"Paste",shortcut:"⌘V",action:()=>handlePaste(_cm.ri,_cm.ci)},
    "---",
    {__section:"Font"},
    {icon:"🔤",label:"Font Family",children:[
      ...["Arial","Calibri","Courier New","Georgia","Helvetica","Inter","Montserrat","Poppins","Roboto","Times New Roman","Trebuchet MS","Verdana"].map(f=>({icon:_fmt.fontFamily===f?"✓":"　",label:f,action:()=>applyFmt("fontFamily",f)})),
    ]},
    {icon:"🔡",label:"Font Size",children:[
      ...[8,9,10,11,12,14,16,18,20,24,28,32,36,48,72].map(s=>({icon:_fmt.fontSize===s?"✓":"　",label:`${s} pt`,action:()=>applyFmt("fontSize",s)})),
    ]},
    {icon:"≡",label:"Alignment",children:[
      {__section:"Horizontal"},
      {icon:_fmt.align==="left"||!_fmt.align?"✓":"　",label:"Align Left",action:()=>applyFmt("align","left")},
      {icon:_fmt.align==="center"?"✓":"　",label:"Align Center",action:()=>applyFmt("align","center")},
      {icon:_fmt.align==="right"?"✓":"　",label:"Align Right",action:()=>applyFmt("align","right")},
      "---",
      {__section:"Vertical"},
      {icon:_fmt.valign==="top"?"✓":"　",label:"Top",action:()=>applyFmt("valign","top")},
      {icon:_fmt.valign==="middle"||!_fmt.valign?"✓":"　",label:"Middle",action:()=>applyFmt("valign","middle")},
      {icon:_fmt.valign==="bottom"?"✓":"　",label:"Bottom",action:()=>applyFmt("valign","bottom")},
      "---",
      {icon:"↵",label:_fmt.wrapText?"Wrap Text: ON":"Wrap Text: OFF",action:()=>applyFmt("wrapText",!_fmt.wrapText),badge:_fmt.wrapText?"ON":null},
    ]},
    "---",
    {icon:"𝐁",label:"Bold",shortcut:"⌘B",action:()=>toggleFmt("bold"),badge:_fmt.bold?"ON":null},
    {icon:"𝐼",label:"Italic",action:()=>toggleFmt("italic"),badge:_fmt.italic?"ON":null},
    {icon:"U̲",label:"Underline",action:()=>toggleFmt("underline"),badge:_fmt.underline?"ON":null},
    "---",
    {icon:"🎨",label:"Format Cell",children:[
      {__section:"Font Family"},
      ...["Arial","Calibri","Courier New","Georgia","Helvetica","Inter","Montserrat","Poppins","Roboto","Times New Roman","Trebuchet MS","Verdana"].map(f=>({icon:_fmt.fontFamily===f?"✓":"　",label:f,action:()=>applyFmt("fontFamily",f),badge:_fmt.fontFamily===f?"✓":null})),
      "---",
      {__section:"Font Size"},
      ...([8,9,10,11,12,14,16,18,20,24,28,32,36,48,72]).map(s=>({icon:_fmt.fontSize===s?"✓":"　",label:`${s} pt`,action:()=>applyFmt("fontSize",s),badge:_fmt.fontSize===s?"✓":null})),
      "---",
      {__section:"Style"},
      {icon:"𝐁",label:"Bold",shortcut:"⌘B",bold:true,action:()=>toggleFmt("bold"),badge:_fmt.bold?"ON":null},
      {icon:"𝐼",label:"Italic",action:()=>toggleFmt("italic"),badge:_fmt.italic?"ON":null},
      {icon:"U̲",label:"Underline",action:()=>toggleFmt("underline"),badge:_fmt.underline?"ON":null},
      {icon:"S̶",label:"Strikethrough",action:()=>toggleFmt("strikethrough"),badge:_fmt.strikethrough?"ON":null},
      "---",
      {__section:"Alignment"},
      {icon:_fmt.align==="left"||!_fmt.align?"✓":"　",label:"Align Left",action:()=>applyFmt("align","left")},
      {icon:_fmt.align==="center"?"✓":"　",label:"Align Center",action:()=>applyFmt("align","center")},
      {icon:_fmt.align==="right"?"✓":"　",label:"Align Right",action:()=>applyFmt("align","right")},
      "---",
      {__section:"Vertical Align"},
      {icon:_fmt.valign==="top"?"✓":"　",label:"Top",action:()=>applyFmt("valign","top")},
      {icon:_fmt.valign==="middle"||!_fmt.valign?"✓":"　",label:"Middle",action:()=>applyFmt("valign","middle")},
      {icon:_fmt.valign==="bottom"?"✓":"　",label:"Bottom",action:()=>applyFmt("valign","bottom")},
      {icon:"↵",label:_fmt.wrapText?"Wrap: ON":"Wrap: OFF",action:()=>applyFmt("wrapText",!_fmt.wrapText),badge:_fmt.wrapText?"ON":null},
      "---",
      {__section:"Text Color"},
      {icon:"🔴",label:"Red",action:()=>applyFmt("textColor","#ef4444")},
      {icon:"🟢",label:"Green",action:()=>applyFmt("textColor","#16a34a")},
      {icon:"🔵",label:"Blue",action:()=>applyFmt("textColor","#2563eb")},
      {icon:"🟠",label:"Orange",action:()=>applyFmt("textColor","#ea580c")},
      {icon:"🟣",label:"Purple",action:()=>applyFmt("textColor","#7c3aed")},
      {icon:"⚫",label:"Default",action:()=>applyFmt("textColor","#000000")},
      "---",
      {__section:"Cell Fill / Highlight"},
      {icon:"🟡",label:"Yellow",action:()=>applyFmt("fillColor","#fef08a")},
      {icon:"🟢",label:"Green",action:()=>applyFmt("fillColor","#bbf7d0")},
      {icon:"🔵",label:"Blue",action:()=>applyFmt("fillColor","#bfdbfe")},
      {icon:"🔴",label:"Red",action:()=>applyFmt("fillColor","#fecaca")},
      {icon:"🟤",label:"Peach",action:()=>applyFmt("fillColor","#fed7aa")},
      {icon:"🟣",label:"Lavender",action:()=>applyFmt("fillColor","#ede9fe")},
      {icon:"⬜",label:"Clear Fill",action:()=>applyFmt("fillColor","#ffffff")},
      "---",
      {__section:"Number Format"},
      {icon:_fmt.numFormat==="general"||!_fmt.numFormat?"✓":"　",label:"General",action:()=>applyFmt("numFormat","general")},
      {icon:_fmt.numFormat==="number"?"✓":"　",label:"Number (1,234.00)",action:()=>applyFmt("numFormat","number")},
      {icon:_fmt.numFormat==="currency"?"✓":"　",label:"Currency ($)",action:()=>applyFmt("numFormat","currency")},
      {icon:_fmt.numFormat==="percent"?"✓":"　",label:"Percent (%)",action:()=>applyFmt("numFormat","percent")},
      {icon:_fmt.numFormat==="date"?"✓":"　",label:"Date",action:()=>applyFmt("numFormat","date")},
      {icon:_fmt.numFormat==="scientific"?"✓":"　",label:"Scientific (1.23E+4)",action:()=>applyFmt("numFormat","scientific")},
      "---",
      {icon:"🗑",label:"Clear All Formatting",danger:true,action:()=>{const k=`${_cm.ri}-${_cm.ci}`;setCellFmt(f=>{const n={...f};delete n[k];return n;});}},
    ]},
    {icon:"🔢",label:"Cell",children:[
      {__section:"Insert"},
      {icon:"📅",label:"Today's Date",action:()=>{if(_row&&_col&&onChange)onChange(_row.__origIdx,_col.key,new Date().toLocaleDateString());}},
      {icon:"🕐",label:"Timestamp",action:()=>{if(_row&&_col&&onChange)onChange(_row.__origIdx,_col.key,new Date().toLocaleString());}},
      {icon:"🆔",label:"Generate ID",action:()=>{if(_col&&onChange&&_row)onChange(_row.__origIdx,_col.key,generateId(_col.key));}},
      "---",
      {__section:"Transform"},
      {icon:"🔢",label:"Increment +1",action:()=>{const n=Number(_cellVal);if(!isNaN(n)&&_row&&_col&&onChange)onChange(_row.__origIdx,_col.key,n+1);}},
      {icon:"🔡",label:"UPPERCASE",action:()=>{if(_row&&_col&&onChange)onChange(_row.__origIdx,_col.key,String(_cellVal).toUpperCase());}},
      {icon:"🔠",label:"lowercase",action:()=>{if(_row&&_col&&onChange)onChange(_row.__origIdx,_col.key,String(_cellVal).toLowerCase());}},
      {icon:"✏️",label:"Title Case",action:()=>{if(_row&&_col&&onChange)onChange(_row.__origIdx,_col.key,String(_cellVal).toLowerCase().replace(/(^|\s)\S/g,c=>c.toUpperCase()));}},
      {icon:"✂️",label:"Trim Whitespace",action:()=>{if(_row&&_col&&onChange)onChange(_row.__origIdx,_col.key,String(_cellVal).trim());}},
      {icon:"🔄",label:"Cycle Status",action:()=>cycleStatus(_cm.ri)},
      "---",
      {__section:"Clear"},
      {icon:"🧹",label:"Clear Cell",action:()=>{if(_row&&_col&&onChange)onChange(_row.__origIdx,_col.key,"");}},
      {icon:"🧽",label:"Clear Row",action:()=>{if(_row&&onChange)visibleCols.forEach(c=>onChange(_row.__origIdx,c.key,""));}},
      {icon:"🗑",label:"Clear Formatting",action:()=>{if(!selection.start)return;const keys=[];const sr=selection.start,er=selection.end||selection.start;for(let r=Math.min(sr.ri,er.ri);r<=Math.max(sr.ri,er.ri);r++)for(let c=Math.min(sr.ci,er.ci);c<=Math.max(sr.ci,er.ci);c++)keys.push(`${r}-${c}`);setCellFmt(f=>{const n={...f};keys.forEach(k=>delete n[k]);return n;});}},
      "---",
      {icon:"💬",label:"Add Comment",action:()=>{const k=`${_row?.__origIdx}-${_col?.key}`;setCommentPopover({x:_cm.x,y:_cm.y,cellKey:k});}},
      {icon:"🔗",label:"Merge Cells",action:mergeCells},
      {icon:"⊠",label:"Unmerge",action:unmergeCells},
    ]},
    {icon:"↕️",label:"Rows",children:[
      {icon:"⬆",label:"Insert Above",action:()=>insertRowAbove(_cm.ri)},
      {icon:"⬇",label:"Insert Below",action:()=>insertRowBelow(_cm.ri)},
      {icon:"⧉",label:"Duplicate",action:()=>duplicateRow(_cm.ri)},
      {icon:"🗑",label:"Delete Row",danger:true,action:()=>deleteRow(_cm.ri)},
      "---",
      {icon:"▲",label:"Sort A→Z",action:()=>setSortConfig([{key:_col?.key,dir:"asc"}])},
      {icon:"▼",label:"Sort Z→A",action:()=>setSortConfig([{key:_col?.key,dir:"desc"}])},
      {icon:"🔽",label:"Filter by this value",action:()=>{if(_col&&_cellVal!=="")setFilters(f=>({...f,[_col.key]:new Set([String(_cellVal)])}));}},
      {icon:"✕",label:"Clear Filters",action:()=>setFilters({})},
      {icon:"✕",label:"Clear Sort",action:()=>setSortConfig([])},
      "---",
      {icon:"📌",label:pinnedRows.has(_row?.__origIdx)?"Unpin Row":"Pin to Top",action:()=>togglePinRow(_cm.ri)},
      {icon:"🙈",label:"Hide Row",action:()=>setHiddenRows(s=>{const n=new Set(s);n.add(_cm.ri);return n;})},
      {icon:"👁",label:"Unhide All Rows",action:()=>setHiddenRows(new Set())},
      {icon:"↕️",label:"Set Row Height…",action:()=>{const h=prompt("Row height (px):",26);if(h)setRowHeights(rh=>({...rh,[_cm.ri]:Number(h)}));}},
      {icon:"⊞",label:"Group Selected Rows",action:addRowGroup},
    ]},
    {icon:"↔️",label:"Columns",children:[
      {icon:"⬅",label:"Insert Left",action:()=>insertColLeft(_cm.ci)},
      {icon:"➡",label:"Insert Right",action:()=>insertColRight(_cm.ci)},
      {icon:"🗑",label:"Delete Column",danger:true,action:()=>deleteCol(_cm.ci)},
      "---",
      {icon:"👁",label:"Hide Column",action:()=>setHiddenCols(s=>{const n=new Set(s);n.add(_cm.ci);return n;})},
      {icon:"🙈",label:"Unhide All",action:()=>setHiddenCols(new Set())},
      {icon:"↔",label:"Auto-fit Width",action:()=>{if(!_col)return;const maxLen=Math.max(_col.label.length,...processedRows.map(r=>String(r[_col.key]??"").length));setColWidths(w=>({...w,[_col.key]:Math.min(300,Math.max(60,maxLen*8+16))}));}},
      {icon:"❄",label:frozenCols>_cm.ci?"Unfreeze":"Freeze to this col",action:()=>setFrozenCols(frozenCols>_cm.ci?0:_cm.ci+1)},
      {icon:"⚡",label:sparkCols[_col?.key]?"Remove Sparkline":"Add Sparkline",action:()=>{if(_col)setSparkCols(s=>({...s,[_col.key]:!s[_col.key]}));}},
    ]},
    {icon:"📤",label:"Copy As",children:[
      {icon:"📎",label:"Cell Ref ("+_cellRef+")",action:()=>navigator.clipboard?.writeText(_cellRef)},
      {icon:"📄",label:"Row as CSV",action:()=>{if(_row)navigator.clipboard?.writeText(visibleCols.map(c=>String(_row[c.key]??"")).join(","));}},
      {icon:"{}",label:"Row as JSON",action:()=>{if(_row)navigator.clipboard?.writeText(JSON.stringify(Object.fromEntries(visibleCols.map(c=>[c.key,_row[c.key]]))));}},
      {icon:"📊",label:"Table as CSV",action:()=>exportCSV()},
      {icon:"📋",label:"Table as JSON",action:()=>exportJSON()},
    ]},
    {icon:"🤖",label:"AI Assistant",badge:"✨",children:[
      {__section:"Smart Actions"},
      {icon:"💡",label:"Explain this cell",action:()=>{setRibbonTab("AI");setShowAiPanel(true);runAI(`Explain this spreadsheet value or formula: "${_cellVal}". Cell: ${_cellRef}, Column: "${_col?.label}"`);}},
      {icon:"📐",label:"Suggest formula here",action:()=>{setRibbonTab("AI");setShowAiPanel(true);runAI(`Suggest the best formula for column "${_col?.label}" given columns: ${visibleCols.map(c=>c.label).join(", ")}. Cell: ${_cellRef}. Reply with formula only, starting with =`);}},
      {icon:"🔍",label:"Anomalies in column",action:()=>{setRibbonTab("AI");setShowAiPanel(true);const vals=rows.map(r=>r[_col?.key]).slice(0,50).join(", ");runAI(`Find anomalies or outliers in column "${_col?.label}". Values: ${vals}`);}},
      {icon:"📊",label:"Column stats",action:()=>{setRibbonTab("AI");setShowAiPanel(true);const vals=rows.map(r=>r[_col?.key]).filter(v=>v!=="");runAI(`Brief statistical summary of column "${_col?.label}": ${vals.slice(0,50).join(", ")}`);}},
      {icon:"🧹",label:"Suggest data cleanup",action:()=>{setRibbonTab("AI");setShowAiPanel(true);const sample=rows.slice(0,10).map(r=>visibleCols.map(c=>r[c.key]).join(" | ")).join("\n");runAI(`Review this data and suggest cleanup steps:\n${sample}`);}},
      "---",
      {icon:"🤖",label:"Open AI Panel",action:()=>{setRibbonTab("AI");setShowAiPanel(true);}},
    ]},
    {icon:"📊",label:"Data & View",children:[
      {icon:"🔍",label:"Find & Replace…",shortcut:"⌘F",action:()=>setModal("findreplace")},
      {icon:"📈",label:"Insert Chart…",action:()=>setModal("chart")},
      {icon:"🔲",label:"Pivot Table…",action:()=>{setRibbonTab("Pivot");setShowPivotPanel(true);}},
      {icon:"🎨",label:"Conditional Format…",action:()=>setModal("condfmt")},
      {icon:"✅",label:"Data Validation…",action:()=>setModal("validation")},
      "---",
      {icon:"🌡",label:heatmapOn?"Disable Heatmap":"Enable Heatmap",action:()=>setHeatmapOn(h=>!h)},
      {icon:"📊",label:"Toggle Zebra",action:()=>setZebra(z=>!z)},
      {icon:"⊞",label:"Split Pane",action:()=>setSplitPane(v=>!v)},
      "---",
      {icon:"➕",label:"Add Sheet",action:()=>addSheet()},
      {icon:"⧉",label:"Duplicate Sheet",action:()=>duplicateSheet(activeSheet)},
    ]},
    "---",
    {icon:"↩️",label:"Undo",shortcut:"⌘Z",action:undo,disabled:!history.past.length},
    {icon:"↪️",label:"Redo",shortcut:"⌘Y",action:redo,disabled:!history.future.length},
    "---",
    {icon:"⌨️",label:"Command Palette",shortcut:"⌘P",action:()=>setCmdPaletteOpen(true)},
    // ── Cell ──────────────────────────────────────────────────────────────────
    {icon:"🔢", label:"Cell", children:[
      {icon:"🔄",label:"Cycle Status",action:()=>cycleStatus(_cm.ri)},
      {icon:"📅",label:"Insert Today's Date",action:()=>{if(_row&&_col&&onChange)onChange(_row.__origIdx,_col.key,new Date().toLocaleDateString());}},
      {icon:"🕐",label:"Insert Timestamp",action:()=>{if(_row&&_col&&onChange)onChange(_row.__origIdx,_col.key,new Date().toLocaleString());}},
      {icon:"🆔",label:"Generate ID",action:()=>{if(_col&&onChange&&_row)onChange(_row.__origIdx,_col.key,generateId(_col.key));}},
      {icon:"🔢",label:"Increment Number",action:()=>{const n=Number(_cellVal);if(!isNaN(n)&&_row&&_col&&onChange)onChange(_row.__origIdx,_col.key,n+1);}},
      {icon:"🔡",label:"UPPER case",action:()=>{if(_row&&_col&&onChange)onChange(_row.__origIdx,_col.key,String(_cellVal).toUpperCase());}},
      {icon:"🔠",label:"lower case",action:()=>{if(_row&&_col&&onChange)onChange(_row.__origIdx,_col.key,String(_cellVal).toLowerCase());}},
      {icon:"✏️",label:"Title Case",action:()=>{if(_row&&_col&&onChange)onChange(_row.__origIdx,_col.key,String(_cellVal).replace(/\w/g,c=>c.toUpperCase()));}},
      {icon:"✂️",label:"Trim Whitespace",action:()=>{if(_row&&_col&&onChange)onChange(_row.__origIdx,_col.key,String(_cellVal).trim());}},
    ]},
  ].filter(Boolean):[];

  // ─────────────────────────────────────────────────────────────────────────
  // Ribbon tabs content
  // ─────────────────────────────────────────────────────────────────────────
  const selectedFmt = selection.start ? getFmt(selection.start.ri, selection.start.ci) : {};
  const fontSizes = [6,7,8,9,10,10.5,11,12,13,14,15,16,18,20,22,24,26,28,32,36,40,48,54,60,72,96];

  const renderRibbonHome = () => (
    <div style={{display:"flex",alignItems:"flex-start",gap:0,padding:"4px 8px 0",flexWrap:"wrap"}}>
      <RibbonGroup label="Clipboard">
        <IBtn icon="📋" label="Copy" onClick={handleCopy} title="Copy (Ctrl+C)"/>
        {clipboard&&<IBtn icon="📌" label="Paste" onClick={()=>{if(selection.start)handlePaste(selection.start.ri,selection.start.ci);}} title="Paste (Ctrl+V)"/>}
        <IBtn icon="↩" label="Undo" onClick={undo} disabled={!history.past.length} title="Undo (Ctrl+Z)"/>
        <IBtn icon="↪" label="Redo" onClick={redo} disabled={!history.future.length} title="Redo (Ctrl+Y)"/>
      </RibbonGroup>
      <RibbonGroup label="Font">
        <select value={selectedFmt.fontFamily||"Courier New"} onChange={e=>applyFmt("fontFamily",e.target.value)}
          style={{fontSize:11,padding:"2px 4px",border:"1px solid #ddd",borderRadius:4,height:24,cursor:"pointer",maxWidth:140}}>
          {[
            "── System ──","Courier New","Arial","Arial Black","Arial Narrow","Calibri","Cambria","Candara","Century Gothic","Comic Sans MS","Consolas","Constantia","Corbel","Franklin Gothic Medium","Garamond","Georgia","Gill Sans","Helvetica","Impact","Lucida Console","Lucida Sans Unicode","Microsoft Sans Serif","Palatino Linotype","Segoe UI","Tahoma","Times New Roman","Trebuchet MS","Ubuntu","Verdana","Futura","Baskerville","Didot","Optima","Rockwell","Copperplate",
            "── Google Fonts ──","Roboto","Open Sans","Lato","Montserrat","Raleway","Poppins","Inter","Playfair Display","Merriweather","Source Code Pro","Fira Code","Space Mono","Nunito","Quicksand","Dancing Script","Pacifico","Ubuntu Mono","JetBrains Mono","Crimson Text","EB Garamond",
          ].map(f=>f.startsWith("──")?<option key={f} disabled style={{color:"#999",fontStyle:"italic"}}>{f}</option>:<option key={f} value={f} style={{fontFamily:f}}>{f}</option>)}
        </select>
        <select value={selectedFmt.fontSize||12} onChange={e=>applyFmt("fontSize",Number(e.target.value))}
          style={{fontSize:11,padding:"2px 4px",border:"1px solid #ddd",borderRadius:4,height:24,cursor:"pointer"}}>
          {fontSizes.map(s=><option key={s} value={s}>{s}</option>)}
        </select>
        <IBtn icon="𝐁" label="Bold" onClick={()=>toggleFmt("bold")} active={!!selectedFmt.bold} title="Bold (Ctrl+B)"/>
        <IBtn icon="𝐼" label="Italic" onClick={()=>toggleFmt("italic")} active={!!selectedFmt.italic} title="Italic"/>
        <IBtn icon="<u>U</u>" label="Uline" onClick={()=>toggleFmt("underline")} active={!!selectedFmt.underline} title="Underline"/>
        <IBtn icon="S̶" label="Strike" onClick={()=>toggleFmt("strikethrough")} active={!!selectedFmt.strikethrough} title="Strikethrough"/>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
          <label style={{fontSize:9,color:"#888"}}>Fill</label>
          <input type="color" value={selectedFmt.fillColor||"#ffffff"} onChange={e=>applyFmt("fillColor",e.target.value)} title="Fill Color" style={{width:24,height:18,border:"1px solid #ddd",borderRadius:2,cursor:"pointer",padding:0}}/>
        </div>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
          <label style={{fontSize:9,color:"#888"}}>Text</label>
          <input type="color" value={selectedFmt.textColor||"#000000"} onChange={e=>applyFmt("textColor",e.target.value)} title="Text Color" style={{width:24,height:18,border:"1px solid #ddd",borderRadius:2,cursor:"pointer",padding:0}}/>
        </div>
      </RibbonGroup>
      <RibbonGroup label="Alignment">
        <div style={{display:"flex",flexDirection:"column",gap:2}}>
          <div style={{display:"flex",gap:2}}>
            <IBtn icon={<svg width="14" height="14" viewBox="0 0 14 14"><line x1="1" y1="3" x2="13" y2="3" stroke="currentColor" strokeWidth="1.5"/><line x1="1" y1="6" x2="9" y2="6" stroke="currentColor" strokeWidth="1.5"/><line x1="1" y1="9" x2="11" y2="9" stroke="currentColor" strokeWidth="1.5"/><line x1="1" y1="12" x2="7" y2="12" stroke="currentColor" strokeWidth="1.5"/></svg>} label="Left" onClick={()=>applyFmt("align","left")} active={selectedFmt.align==="left"||!selectedFmt.align} title="Align Left"/>
            <IBtn icon={<svg width="14" height="14" viewBox="0 0 14 14"><line x1="1" y1="3" x2="13" y2="3" stroke="currentColor" strokeWidth="1.5"/><line x1="3" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="1.5"/><line x1="2" y1="9" x2="12" y2="9" stroke="currentColor" strokeWidth="1.5"/><line x1="4" y1="12" x2="10" y2="12" stroke="currentColor" strokeWidth="1.5"/></svg>} label="Ctr" onClick={()=>applyFmt("align","center")} active={selectedFmt.align==="center"} title="Align Center"/>
            <IBtn icon={<svg width="14" height="14" viewBox="0 0 14 14"><line x1="1" y1="3" x2="13" y2="3" stroke="currentColor" strokeWidth="1.5"/><line x1="5" y1="6" x2="13" y2="6" stroke="currentColor" strokeWidth="1.5"/><line x1="3" y1="9" x2="13" y2="9" stroke="currentColor" strokeWidth="1.5"/><line x1="7" y1="12" x2="13" y2="12" stroke="currentColor" strokeWidth="1.5"/></svg>} label="Right" onClick={()=>applyFmt("align","right")} active={selectedFmt.align==="right"} title="Align Right"/>
          </div>
          <div style={{display:"flex",gap:2}}>
            <IBtn icon={<svg width="14" height="14" viewBox="0 0 14 14"><line x1="1" y1="1" x2="13" y2="1" stroke="currentColor" strokeWidth="2"/><rect x="3" y="3" width="8" height="4" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>} label="Top" onClick={()=>applyFmt("valign","top")} active={selectedFmt.valign==="top"} title="Align Top"/>
            <IBtn icon={<svg width="14" height="14" viewBox="0 0 14 14"><line x1="1" y1="7" x2="3" y2="7" stroke="currentColor" strokeWidth="2"/><line x1="11" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="2"/><rect x="3" y="4" width="8" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>} label="Mid" onClick={()=>applyFmt("valign","middle")} active={selectedFmt.valign==="middle"||!selectedFmt.valign} title="Align Middle"/>
            <IBtn icon={<svg width="14" height="14" viewBox="0 0 14 14"><line x1="1" y1="13" x2="13" y2="13" stroke="currentColor" strokeWidth="2"/><rect x="3" y="7" width="8" height="4" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>} label="Bot" onClick={()=>applyFmt("valign","bottom")} active={selectedFmt.valign==="bottom"} title="Align Bottom"/>
          </div>
        </div>
        <div style={{width:1,height:36,background:"#e2e8f0",margin:"0 2px"}}/>
        <div style={{display:"flex",flexDirection:"column",gap:2}}>
          <IBtn icon="↵" label="Wrap" onClick={()=>applyFmt("wrapText",!selectedFmt.wrapText)} active={!!selectedFmt.wrapText} title="Wrap Text"/>
          <div style={{display:"flex",gap:2}}>
            <IBtn icon="→|" label="Indent+" onClick={()=>applyFmt("indent",(selectedFmt.indent||0)+1)} title="Increase Indent"/>
            <IBtn icon="|←" label="Indent-" onClick={()=>applyFmt("indent",Math.max(0,(selectedFmt.indent||0)-1))} title="Decrease Indent"/>
          </div>
        </div>
        <div style={{width:1,height:36,background:"#e2e8f0",margin:"0 2px"}}/>
        <div style={{display:"flex",flexDirection:"column",gap:1,alignItems:"center"}}>
          <label style={{fontSize:9,color:"#888"}}>Rotate°</label>
          <input type="number" min="-90" max="90" value={selectedFmt.rotation||0}
            onChange={e=>applyFmt("rotation",Number(e.target.value))}
            style={{width:46,fontSize:11,padding:"2px 4px",border:"1px solid #ddd",borderRadius:4,textAlign:"center"}}
            title="Text Rotation (-90 to 90)"/>
        </div>
      </RibbonGroup>
      <RibbonGroup label="Number">
        <select value={selectedFmt.numFormat||"general"} onChange={e=>applyFmt("numFormat",e.target.value)}
          style={{fontSize:11,padding:"2px 4px",border:"1px solid #ddd",borderRadius:4,height:24,cursor:"pointer",maxWidth:90}}>
          <option value="general">General</option>
          <option value="number">Number</option>
          <option value="currency">Currency</option>
          <option value="percent">Percent</option>
          <option value="scientific">Scientific</option>
          <option value="date">Date</option>
          <option value="text">Text</option>
        </select>
        <IBtn icon="$" label="$" onClick={()=>applyFmt("numFormat","currency")} active={selectedFmt.numFormat==="currency"} title="Currency Format"/>
        <IBtn icon="%" label="%" onClick={()=>applyFmt("numFormat","percent")} active={selectedFmt.numFormat==="percent"} title="Percent Format"/>
        <IBtn icon=".0+" label="+Dec" onClick={()=>applyFmt("decimals",(selectedFmt.decimals??2)+1)} title="Increase Decimal Places"/>
        <IBtn icon=".0-" label="-Dec" onClick={()=>applyFmt("decimals",Math.max(0,(selectedFmt.decimals??2)-1))} title="Decrease Decimal Places"/>
      </RibbonGroup>
      <RibbonGroup label="Borders">
        <div style={{display:"flex",flexDirection:"column",gap:2}}>
          <select value={selectedFmt.borderStyle||"none"} onChange={e=>applyFmt("borderStyle",e.target.value)}
            style={{fontSize:11,padding:"2px 4px",border:"1px solid #ddd",borderRadius:4,height:22,cursor:"pointer",maxWidth:108}}>
            <option value="none">No Border</option>
            <option value="all">All Borders</option>
            <option value="outer">Outer Box</option>
            <option value="bottom">Bottom Only</option>
            <option value="top">Top Only</option>
            <option value="left">Left Only</option>
            <option value="right">Right Only</option>
            <option value="thick">Thick Box</option>
            <option value="double">Double Bottom</option>
            <option value="dashed">Dashed All</option>
            <option value="dotted">Dotted All</option>
            <option value="inner">Inner Only</option>
            <option value="topbottom">Top & Bottom</option>
            <option value="medium">Medium Box</option>
          </select>
          <div style={{display:"flex",gap:4,alignItems:"center"}}>
            <input type="color" value={selectedFmt.borderColor||"#000000"} onChange={e=>applyFmt("borderColor",e.target.value)} title="Border Color" style={{width:22,height:18,border:"1px solid #ddd",borderRadius:2,cursor:"pointer",padding:0}}/>
            <select value={selectedFmt.borderWidth||1} onChange={e=>applyFmt("borderWidth",Number(e.target.value))}
              style={{fontSize:10,padding:"1px 3px",border:"1px solid #ddd",borderRadius:3,height:20,cursor:"pointer",flex:1}}>
              <option value={1}>Thin (1px)</option>
              <option value={2}>Medium (2px)</option>
              <option value={3}>Thick (3px)</option>
              <option value={4}>Heavy (4px)</option>
            </select>
          </div>
        </div>
      </RibbonGroup>
      <RibbonGroup label="Cells">
        <IBtn icon="🔗" label="Merge" onClick={mergeCells} title="Merge Cells"/>
        <IBtn icon="⊠" label="Unmerge" onClick={unmergeCells} title="Unmerge Cells"/>
        <IBtn icon="💬" label="Comment" onClick={()=>{if(!selection.start)return;const row=processedRows[selection.start.ri];const col=visibleCols[selection.start.ci];const k=`${row?.__origIdx}-${col?.key}`;const rect=document.getElementById(cellId(selection.start.ri,selection.start.ci))?.getBoundingClientRect();setCommentPopover({x:(rect?.right||400)+4,y:rect?.top||200,cellKey:k});}} title="Add/Edit Comment"/>
        <IBtn icon="↵" label="Wrap" onClick={()=>applyFmt("wrapText",!selectedFmt.wrapText)} active={!!selectedFmt.wrapText} title="Toggle Wrap Text"/>
        <IBtn icon="⬡" label="Clear Fmt" onClick={()=>{if(!selection.start||!onChange)return;const{start,end}=selection,e=end||start;for(let r=Math.min(start.ri,e.ri);r<=Math.max(start.ri,e.ri);r++)for(let c=Math.min(start.ci,e.ci);c<=Math.max(start.ci,e.ci);c++){const key=`${activeSheet}-${r}-${c}`;setCellFmts(f=>{const n={...f};delete n[key];return n;});}}} title="Clear Formatting"/>
      </RibbonGroup>
      <RibbonGroup label="Format">
        <IBtn icon="🎨" label="Cond Fmt" onClick={()=>setModal("condfmt")} title="Conditional Formatting"/>
        <IBtn icon="✅" label="Validate" onClick={()=>setModal("validation")} title="Data Validation"/>
        <IBtn icon="📌" label="Ranges" onClick={()=>setModal("namedranges")} title="Named Ranges"/>
      </RibbonGroup>
      <RibbonGroup label="Editing">
        <IBtn icon="🔍" label="Find" onClick={()=>setModal("findreplace")} title="Find & Replace (Ctrl+F)"/>
        {Object.values(filters).some(f=>f?.size>0)&&<IBtn icon="✕" label="Filters" onClick={()=>setFilters({})} title="Clear All Filters"/>}
      </RibbonGroup>
    </div>
  );

  const renderRibbonInsert = () => (
    <div style={{display:"flex",alignItems:"flex-start",gap:0,padding:"4px 8px 0",flexWrap:"wrap"}}>
      <RibbonGroup label="Rows & Cols">
        <IBtn icon="⬆" label="Row ↑" onClick={()=>{if(selection.start)insertRowAbove(selection.start.ri);}} title="Insert Row Above"/>
        <IBtn icon="⬇" label="Row ↓" onClick={()=>{if(selection.start)insertRowBelow(selection.start.ri);}} title="Insert Row Below"/>
        <IBtn icon="⬅" label="Col ←" onClick={()=>{if(selection.start)insertColLeft(selection.start.ci);}} title="Insert Column Left"/>
        <IBtn icon="➡" label="Col →" onClick={()=>{if(selection.start)insertColRight(selection.start.ci);}} title="Insert Column Right"/>
        <IBtn icon="🗑" label="Del Row" onClick={()=>{if(selection.start)deleteRow(selection.start.ri);}} title="Delete Row"/>
        <IBtn icon="🗑" label="Del Col" onClick={()=>{if(selection.start)deleteCol(selection.start.ci);}} title="Delete Column"/>
      </RibbonGroup>
      <RibbonGroup label="Charts">
        <IBtn icon="📊" label="Bar" onClick={()=>setModal("chart")} title="Insert Bar Chart"/>
        <IBtn icon="📈" label="Line" onClick={()=>setModal("chart")} title="Insert Line Chart"/>
        <IBtn icon="🥧" label="Pie" onClick={()=>setModal("chart")} title="Insert Pie Chart"/>
      </RibbonGroup>
      <RibbonGroup label="Sparklines">
        <select value={sparkType} onChange={e=>setSparkType(e.target.value)} style={{fontSize:11,padding:"2px 4px",border:"1px solid #ddd",borderRadius:4,height:24}}>
          <option value="line">Line</option><option value="bar">Bar</option>
        </select>
        {numericCols.slice(0,5).map(c=>(
          <button key={c.key} onClick={()=>setSparkCols(s=>({...s,[c.key]:!s[c.key]}))}
            style={{...tBtn,background:sparkCols[c.key]?"#1a73e8":"#e8eaed",color:sparkCols[c.key]?"#fff":"#333",padding:"2px 5px"}}>
            ⚡{c.label}
          </button>
        ))}
      </RibbonGroup>
      <RibbonGroup label="Export">
        <IBtn icon="⬇️" label="CSV" onClick={exportCSV} title="Export as CSV"/>
        <IBtn icon="📗" label="XLSX" onClick={exportXLSX} title="Export as Excel XLSX (UPGRADE 4)"/>
        <IBtn icon="📋" label="JSON" onClick={exportJSON} title="Export as JSON (UPGRADE 4)"/>
        <IBtn icon="🖨️" label="PDF" onClick={exportPDF} title="Export/Print as PDF (UPGRADE 4)"/>
        <label style={{display:"flex",alignItems:"center",gap:3,fontSize:9,cursor:"pointer",color:"#555"}}>
          <input type="checkbox" checked={exportAllSheets} onChange={e=>setExportAllSheets(e.target.checked)}/> All sheets
        </label>
      </RibbonGroup>
      <RibbonGroup label="Import">
        <label style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1,cursor:"pointer",padding:"2px 6px",border:"1px solid #d0d0d0",borderRadius:4,background:"#e8eaed",fontSize:11,color:"#333"}}>
          <span style={{fontSize:16}}>📤</span>
          <span style={{fontSize:9}}>Import</span>
          <input type="file" accept=".csv,.json" style={{display:"none"}} onChange={e=>{const f=e.target.files[0];if(f)handleImportFile(f);e.target.value="";}}/>
        </label>
      </RibbonGroup>
    </div>
  );

  const renderRibbonFormulas = () => (
    <div style={{display:"flex",alignItems:"flex-start",gap:0,padding:"4px 8px 0",flexWrap:"wrap"}}>
      <RibbonGroup label="Core Math">
        {["=SUM(","=AVERAGE(","=COUNT(","=MAX(","=MIN(","=ROUND(","=ABS(","=POWER(","=SQRT(","=MOD("].map(fn=>(
          <button key={fn} onClick={()=>{if(!selection.start)return;startEdit(selection.start.ri,selection.start.ci,fn);}}
            style={{...tBtn,fontSize:10,padding:"2px 5px"}}>{fn.replace("=","").replace("(","")}</button>
        ))}
      </RibbonGroup>
      <RibbonGroup label="Logic">
        {["=IF(","=IFS(","=IFERROR(","=SWITCH(","=ISBLANK(","=ISNUMBER(","=ISTEXT("].map(fn=>(
          <button key={fn} onClick={()=>{if(!selection.start)return;startEdit(selection.start.ri,selection.start.ci,fn);}}
            style={{...tBtn,fontSize:10,padding:"2px 5px"}}>{fn.replace("=","").replace("(","")}</button>
        ))}
      </RibbonGroup>
      <RibbonGroup label="Lookup">
        {["=VLOOKUP(","=XLOOKUP(","=INDEX(","=MATCH(","=CHOOSE("].map(fn=>(
          <button key={fn} onClick={()=>{if(!selection.start)return;startEdit(selection.start.ri,selection.start.ci,fn);}}
            style={{...tBtn,fontSize:10,padding:"2px 5px"}}>{fn.replace("=","").replace("(","")}</button>
        ))}
      </RibbonGroup>
      <RibbonGroup label="Text">
        {["=TEXTJOIN(","=CONCATENATE(","=LEFT(","=RIGHT(","=MID(","=UPPER(","=LOWER(","=TRIM(","=SUBSTITUTE(","=LEN("].map(fn=>(
          <button key={fn} onClick={()=>{if(!selection.start)return;startEdit(selection.start.ri,selection.start.ci,fn);}}
            style={{...tBtn,fontSize:10,padding:"2px 5px"}}>{fn.replace("=","").replace("(","")}</button>
        ))}
      </RibbonGroup>
      <RibbonGroup label="Date">
        {["=TODAY()","=NOW()","=YEAR(","=MONTH(","=DAY(","=DATEDIF(","=NETWORKDAYS(","=EDATE(","=EOMONTH(","=WEEKNUM("].map(fn=>(
          <button key={fn} onClick={()=>{if(!selection.start)return;const isNoArg=fn.endsWith(")");startEdit(selection.start.ri,selection.start.ci,isNoArg?fn:fn);}}
            style={{...tBtn,fontSize:10,padding:"2px 5px"}}>{fn.replace("=","").replace("(","").replace(")","")}</button>
        ))}
      </RibbonGroup>
      <RibbonGroup label="Stats">
        {["=MEDIAN(","=MODE(","=STDEV(","=VAR(","=RANK(","=PERCENTILE(","=COUNTIF(","=SUMIF("].map(fn=>(
          <button key={fn} onClick={()=>{if(!selection.start)return;startEdit(selection.start.ri,selection.start.ci,fn);}}
            style={{...tBtn,fontSize:10,padding:"2px 5px"}}>{fn.replace("=","").replace("(","")}</button>
        ))}
      </RibbonGroup>
      <RibbonGroup label="Finance">
        {["=PMT(","=NPV(","=ROI(","=CAGR(","=PROFITMARGIN(","=TAXCALC("].map(fn=>(
          <button key={fn} onClick={()=>{if(!selection.start)return;startEdit(selection.start.ri,selection.start.ci,fn);}}
            style={{...tBtn,fontSize:10,padding:"2px 5px",background:"#fffbeb",color:"#92400e"}}>{fn.replace("=","").replace("(","")}</button>
        ))}
      </RibbonGroup>
      <RibbonGroup label="ERP/Factory">
        {["=STOCKLEFT(","=LOWSTOCK(","=EXPIRYDAYS(","=BATCHSTATUS("].map(fn=>(
          <button key={fn} onClick={()=>{if(!selection.start)return;startEdit(selection.start.ri,selection.start.ci,fn);}}
            style={{...tBtn,fontSize:10,padding:"2px 5px",background:"#f0fdf4",color:"#166534"}}>{fn.replace("=","").replace("(","")}</button>
        ))}
      </RibbonGroup>
      <RibbonGroup label="Named Ranges">
        <IBtn icon="📌" label="Manage" onClick={()=>setModal("namedranges")} title="Named Ranges"/>
      </RibbonGroup>
    </div>
  );

  const renderRibbonData = () => (
    <div style={{display:"flex",alignItems:"flex-start",gap:0,padding:"4px 8px 0",flexWrap:"wrap"}}>
      <RibbonGroup label="Sort & Filter">
        <IBtn icon="▲" label="A→Z" onClick={()=>{if(selection.start)setSortConfig([{key:visibleCols[selection.start.ci]?.key,dir:"asc"}]);}} title="Sort Ascending"/>
        <IBtn icon="▼" label="Z→A" onClick={()=>{if(selection.start)setSortConfig([{key:visibleCols[selection.start.ci]?.key,dir:"desc"}]);}} title="Sort Descending"/>
        {Object.values(filters).some(f=>f?.size>0)&&<IBtn icon="✕" label="Clear" onClick={()=>setFilters({})} title="Clear Filters"/>}
        {sortConfig.length>0&&<IBtn icon="✕" label="Clear Sort" onClick={()=>setSortConfig([])} title="Clear All Sorts"/>}
      </RibbonGroup>
      <RibbonGroup label="Clean Data">
        <IBtn icon="🔁" label="Dedup" title="Remove Duplicate Rows" onClick={()=>{
          const seen=new Set();
          updateSheetRows(rs=>rs.filter(r=>{const key=JSON.stringify(Object.values(r));if(seen.has(key))return false;seen.add(key);return true;}));
        }}/>
        <IBtn icon="✂️" label="Trim All" title="Trim whitespace from all cells" onClick={()=>{
          rows.forEach((r,ri)=>baseCols.forEach(c=>{const v=r[c.key];if(typeof v==="string"&&v!==v.trim()&&onChange)onChange(ri,c.key,v.trim());}));
        }}/>
        <IBtn icon="🔡" label="UPPER" title="UPPER case selected column" onClick={()=>{
          if(!selection.start)return;const col=visibleCols[selection.start.ci];
          visibleProcessedRows.forEach(r=>{if(onChange&&r[col.key])onChange(r.__origIdx,col.key,String(r[col.key]).toUpperCase());});
        }}/>
        <IBtn icon="🔠" label="lower" title="lowercase selected column" onClick={()=>{
          if(!selection.start)return;const col=visibleCols[selection.start.ci];
          visibleProcessedRows.forEach(r=>{if(onChange&&r[col.key])onChange(r.__origIdx,col.key,String(r[col.key]).toLowerCase());});
        }}/>
        <IBtn icon="🔢" label="To Num" title="Convert selected column to numbers" onClick={()=>{
          if(!selection.start)return;const col=visibleCols[selection.start.ci];
          visibleProcessedRows.forEach(r=>{const n=Number(String(r[col.key]).replace(/[^0-9.-]/g,""));if(!isNaN(n)&&onChange)onChange(r.__origIdx,col.key,n);});
        }}/>
      </RibbonGroup>
      <RibbonGroup label="Transform">
        <IBtn icon="⚡" label="Flash Fill" title="Auto-fill pattern from first entry (select a col first)" onClick={()=>{
          if(!selection.start)return;const col=visibleCols[selection.start.ci];
          const firstFilled=visibleProcessedRows.find(r=>r[col.key]&&r[col.key]!=="");
          if(!firstFilled)return;alert("Flash Fill: Select a column, set the first row's value as a pattern—the rest will be filled based on adjacent column patterns.");
        }}/>
        <IBtn icon="🔀" label="Split Col" title="Split column by delimiter" onClick={()=>{
          if(!selection.start)return;const col=visibleCols[selection.start.ci];
          const delim=prompt(`Split column "${col.label}" by delimiter:`,",");if(!delim)return;
          const maxParts=Math.max(...rows.map(r=>String(r[col.key]??"").split(delim).length));
          for(let pi=0;pi<maxParts;pi++){
            const newKey=`${col.key}_${pi+1}`;
            if(!baseCols.find(c=>c.key===newKey))updateSheetCols(cs=>[...cs,{key:newKey,label:`${col.label} ${pi+1}`,width:100}]);
            rows.forEach((r,ri)=>{const parts=String(r[col.key]??"").split(delim);if(onChange)onChange(ri,newKey,(parts[pi]||"").trim());});
          }
        }}/>
        <IBtn icon="🔗" label="Concat" title="Concatenate two columns into new column" onClick={()=>{
          const c1=prompt("Column 1 key:");const c2=prompt("Column 2 key:");const sep=prompt("Separator (e.g. space):"," ");
          if(!c1||!c2)return;const newKey=`${c1}_${c2}_concat`;
          updateSheetCols(cs=>[...cs,{key:newKey,label:`${c1}+${c2}`,width:140}]);
          rows.forEach((r,ri)=>{if(onChange)onChange(ri,newKey,`${r[c1]??""}`+sep+`${r[c2]??""}`);});
        }}/>
      </RibbonGroup>
      <RibbonGroup label="Validation">
        <IBtn icon="✅" label="Validate" onClick={()=>setModal("validation")} title="Data Validation"/>
        <IBtn icon="⚠️" label="Errors" title="Highlight validation errors" onClick={()=>{const errs=Object.keys(validErrors).length;alert(errs?`${errs} validation error(s) found. Cells are highlighted in the table.`:"No validation errors!");}}/>
      </RibbonGroup>
      <RibbonGroup label="Find">
        <IBtn icon="🔍" label="Find" onClick={()=>setModal("findreplace")} title="Find & Replace"/>
      </RibbonGroup>
      <RibbonGroup label="Cond Format">
        <IBtn icon="🎨" label="Rules" onClick={()=>setModal("condfmt")} title="Conditional Formatting"/>
        <IBtn icon="🌡️" label="Heatmap" onClick={()=>setHeatmapOn(h=>!h)} active={heatmapOn} title="Toggle Heatmap"/>
      </RibbonGroup>
      <RibbonGroup label="Group By">
        <IBtn icon="🗂" label="Group By" title="Group rows by selected column and aggregate" onClick={()=>{
          if(!selection.start){alert("Select a column to group by first.");return;}
          const groupCol=visibleCols[selection.start.ci];
          const aggCol=visibleCols.find(c=>c.key!==groupCol.key&&rows.some(r=>!isNaN(Number(r[c.key]))));
          if(!aggCol){alert("No numeric column found to aggregate.");return;}
          const fn=prompt(`Aggregate function for "${aggCol.label}":\nSUM / COUNT / AVERAGE / MAX / MIN`,"SUM");
          if(!fn)return;
          const grouped={};
          rows.forEach(r=>{const k=String(r[groupCol.key]??"(blank)");if(!grouped[k])grouped[k]=[];grouped[k].push(Number(r[aggCol.key])||0);});
          const newKey=`${groupCol.key}_grouped_${aggCol.key}`;
          const newRows=Object.entries(grouped).map(([k,vals])=>{
            let agg;const f=fn.toUpperCase();
            if(f==="SUM")agg=vals.reduce((a,b)=>a+b,0);
            else if(f==="COUNT")agg=vals.length;
            else if(f==="AVERAGE")agg=(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2);
            else if(f==="MAX")agg=Math.max(...vals);
            else if(f==="MIN")agg=Math.min(...vals);
            else agg=vals.reduce((a,b)=>a+b,0);
            return{[groupCol.key]:k,[newKey]:agg};
          });
          const newCols=[{key:groupCol.key,label:groupCol.label,width:120},{key:newKey,label:`${f||"SUM"}(${aggCol.label})`,width:140}];
          if(confirm(`Group by "${groupCol.label}" with ${fn.toUpperCase()}("${aggCol.label}")?\nThis will add a new sheet with ${newRows.length} groups.`)){
            const newId="sheet_"+Date.now();
            setSheets(ss=>[...ss,{id:newId,name:`GroupBy_${groupCol.label}`}]);
            setSheetData(sd=>({...sd,[newId]:{rows:newRows,cols:newCols}}));
            setActiveSheet(newId);
          }
        }}/>
      </RibbonGroup>
      <RibbonGroup label="Outliers">
        <IBtn icon="🚨" label="Highlight" title="Highlight outliers in selected column (>2 std devs from mean)" onClick={()=>{
          if(!selection.start){alert("Select a numeric column first.");return;}
          const col=visibleCols[selection.start.ci];
          const vals=rows.map((r,i)=>({i,v:Number(r[col.key])})).filter(x=>!isNaN(x.v)&&x.v!==0||String(rows[x.i][col.key])!=="");
          const nums=vals.map(x=>x.v);
          if(nums.length<3){alert("Need at least 3 numeric values.");return;}
          const mean=nums.reduce((a,b)=>a+b,0)/nums.length;
          const std=Math.sqrt(nums.reduce((a,b)=>a+(b-mean)**2,0)/nums.length);
          if(std===0){alert("No variance in column — no outliers.");return;}
          const outlierIdxs=vals.filter(x=>Math.abs(x.v-mean)>2*std).map(x=>x.i);
          if(!outlierIdxs.length){alert(`No outliers found in "${col.label}" (threshold: mean ± 2σ).`);return;}
          const newRules=[...condFmtRules,{type:"cell",col:col.key,op:"outlier2sd",val:"",val2:"",bg:"#fecaca",fg:"#7f1d1d",bold:true,barColor:"#ef4444",_outlierIdxs:outlierIdxs}];
          setCondFmtRules(newRules);
          alert(`Highlighted ${outlierIdxs.length} outlier(s) in "${col.label}" (mean=${mean.toFixed(2)}, σ=${std.toFixed(2)}).`);
        }}/>
        <IBtn icon="✕" label="Clear" title="Remove outlier highlights" onClick={()=>setCondFmtRules(r=>r.filter(x=>x.op!=="outlier2sd"))}/>
      </RibbonGroup>
      <RibbonGroup label="Saved Filters">
        <IBtn icon="💾" label="Save Filter" onClick={()=>{if(!Object.values(filters).some(f=>f?.size>0)){alert("No active filters to save.");return;}const name=prompt("Filter name:");if(name)setSavedFilters(fs=>[...fs,{name,filters:{...filters}}]);}} title="Save current filter set"/>
        {savedFilters.map((sf,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:2}}>
            <button onClick={()=>setFilters(sf.filters)} style={{...tBtn,fontSize:10,maxWidth:80,overflow:"hidden",textOverflow:"ellipsis"}} title={sf.name}>{sf.name}</button>
            <button onClick={()=>setSavedFilters(fs=>fs.filter((_,j)=>j!==i))} style={{...tBtn,fontSize:9,padding:"0 2px",color:"#ef4444",background:"transparent",border:"none"}}>✕</button>
          </div>
        ))}
      </RibbonGroup>
    </div>
  );

  const renderRibbonView = () => (
    <div style={{display:"flex",alignItems:"flex-start",gap:0,padding:"4px 8px 0",flexWrap:"wrap"}}>
      <RibbonGroup label="Show">
        <IBtn icon={showGridLines?"#":"#"} label="Grid" onClick={()=>setShowGridLines(g=>!g)} active={showGridLines} title="Toggle Grid Lines"/>
        <IBtn icon="≡" label="Zebra" onClick={()=>setZebra(z=>!z)} active={zebra} title="Zebra Stripes"/>
        <IBtn icon="🌡️" label="Heat" onClick={()=>setHeatmapOn(h=>!h)} active={heatmapOn} title="Toggle Heatmap"/>
      </RibbonGroup>
      <RibbonGroup label="Zoom">
        <button onClick={()=>setZoomLevel?.(z=>Math.max(60,z-10))} style={tBtn} title="Zoom Out">−</button>
        <span style={{fontSize:11,background:"#e8eaed",padding:"2px 6px",borderRadius:3,fontFamily:"monospace",minWidth:36,textAlign:"center"}}>{typeof zoomLevel==="number"?zoomLevel:100}%</span>
        <button onClick={()=>setZoomLevel?.(z=>Math.min(200,z+10))} style={tBtn} title="Zoom In">+</button>
        <button onClick={()=>setZoomLevel?.(100)} style={{...tBtn,fontSize:10}} title="Reset Zoom">↺</button>
      </RibbonGroup>
      <RibbonGroup label="Row Height">
        <IBtn icon="⊟" label="Compact" title="Compact rows (18px)" onClick={()=>{const n={};visibleProcessedRows.forEach((_,i)=>n[i]=18);setRowHeights(n);}}/>
        <IBtn icon="⊞" label="Normal" title="Normal rows (26px)" onClick={()=>setRowHeights({})}/>
        <IBtn icon="⊡" label="Tall" title="Tall rows (44px)" onClick={()=>{const n={};visibleProcessedRows.forEach((_,i)=>n[i]=44);setRowHeights(n);}}/>
      </RibbonGroup>
      <RibbonGroup label="Freeze">
        <div style={{display:"flex",alignItems:"center",gap:3}}>
          <span style={{fontSize:10,color:"#888"}}>Cols:</span>
          <button onClick={()=>setFrozenCols(n=>Math.max(0,n-1))} style={tBtn}>−</button>
          <span style={{fontSize:11,background:"#e8eaed",padding:"2px 6px",borderRadius:3,fontFamily:"monospace"}}>{frozenCols}</span>
          <button onClick={()=>setFrozenCols(n=>Math.min(visibleCols.length-1,n+1))} style={tBtn}>+</button>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:3}}>
          <span style={{fontSize:10,color:"#888"}}>Rows:</span>
          <button onClick={()=>setFrozenRows(n=>Math.max(0,n-1))} style={tBtn}>−</button>
          <span style={{fontSize:11,background:"#e8eaed",padding:"2px 6px",borderRadius:3,fontFamily:"monospace"}}>{frozenRows}</span>
          <button onClick={()=>setFrozenRows(n=>Math.min(visibleProcessedRows.length-1,n+1))} style={tBtn}>+</button>
        </div>
      </RibbonGroup>
      <RibbonGroup label="Hidden">
        {hiddenCols.size>0&&<IBtn icon="👁" label={`Show ${hiddenCols.size} col(s)`} onClick={()=>setHiddenCols(new Set())}/>}
        {hiddenRows.size>0&&<IBtn icon="👁" label={`Show ${hiddenRows.size} row(s)`} onClick={()=>setHiddenRows(new Set())}/>}
      </RibbonGroup>
      <RibbonGroup label="Table">
        <IBtn icon="⚙️" label="Customize" onClick={()=>setModal("customize")} title="Customize Table: rename columns, set types, reorder, show/hide"/>
      </RibbonGroup>
      <RibbonGroup label="Pane">
        <IBtn icon="⧠" label="Split" onClick={()=>setSplitPane(s=>!s)} active={splitPane} title="Toggle split pane"/>
      </RibbonGroup>
      <RibbonGroup label="Search">
        <IBtn icon="🔎" label="Quick" onClick={()=>setShowQuickSearch(s=>!s)} active={showQuickSearch} title="Quick search (Ctrl+K)"/>
      </RibbonGroup>
      <RibbonGroup label="Groups">
        <IBtn icon="⊞" label="Group" onClick={addRowGroup} title="Group selected rows"/>
        {rowGroups.map((g,i)=><button key={i} onClick={()=>toggleGroup(i)} style={{...tBtn,fontSize:10,background:g.collapsed?"#fef9c3":"#e8eaed"}}>{g.collapsed?"▶":"▼"} R{g.start+1}:{g.end+1}</button>)}
        {rowGroups.length>0&&<IBtn icon="✕" label="Clear" onClick={()=>setRowGroups([])} title="Remove all groups"/>}
      </RibbonGroup>
      <RibbonGroup label="Bulk Edit">
        <IBtn icon="✏️" label="Set Value" onClick={()=>{const v=prompt("Set all selected cells to:");if(v!==null)bulkSetValue(v);}} title="Bulk set selected cells to a value"/>
        <IBtn icon="🗑" label="Clear" onClick={()=>bulkSetValue("")} title="Clear all selected cells"/>
      </RibbonGroup>
      <RibbonGroup label="Trace">
        <IBtn icon="🔗" label="Trace" onClick={()=>{if(selection.start)setTraceCell(traceCell?null:selection.start);}} active={!!traceCell} title="Toggle formula trace arrows"/>
      </RibbonGroup>
      <RibbonGroup label="Rows">
        <IBtn icon="+" label="+10 Rows" onClick={()=>autoExpandRows(10)} title="Add 10 empty rows"/>
      </RibbonGroup>
      <RibbonGroup label="Col Stats">
        <IBtn icon="σ" label="Stats" title="Show column statistics" onClick={()=>{
          if(!selection.start)return;const col=visibleCols[selection.start.ci];
          const vals=rows.map(r=>r[col.key]).filter(v=>v!==""&&!isNaN(Number(v))).map(Number);
          if(!vals.length){alert(`Column "${col.label}" has no numeric data.`);return;}
          const sum=vals.reduce((a,b)=>a+b,0),avg=sum/vals.length;
          const med=[...vals].sort((a,b)=>a-b),mi=Math.floor(med.length/2);
          alert(`Column: ${col.label}\nCount: ${vals.length}\nSum: ${sum.toFixed(2)}\nAverage: ${avg.toFixed(2)}\nMedian: ${med.length%2?med[mi]:((med[mi-1]+med[mi])/2).toFixed(2)}\nMin: ${Math.min(...vals)}\nMax: ${Math.max(...vals)}\nStdDev: ${Math.sqrt(vals.reduce((a,b)=>a+(b-avg)**2,0)/vals.length).toFixed(2)}`);
        }}/>
      </RibbonGroup>
    </div>
  );

  // ── UPGRADE 2: Pivot ribbon ───────────────────────────────────────────────
  const renderRibbonPivot = () => (
    <div style={{display:"flex",alignItems:"flex-start",gap:0,padding:"4px 8px 0",flexWrap:"wrap"}}>
      <RibbonGroup label="Pivot Table">
        <IBtn icon="📊" label={showPivotPanel?"Hide Panel":"Show Panel"} onClick={()=>setShowPivotPanel(p=>!p)} active={showPivotPanel} title="Toggle Pivot Builder"/>
        {pivotData&&<IBtn icon="⬇️" label="Export CSV" onClick={()=>{
          if(!pivotData)return;
          const { rowVals, colVals, grid, grandTotals } = pivotData;
          const header = [pivotConfig.rowField, ...colVals, "Subtotal"].join(",");
          const body = rowVals.map(rv=>[rv,...colVals.map(cv=>grid[rv][cv]),grid[rv].__subtotal].join(",")).join("\n");
          const footer = ["Grand Total",...colVals.map(cv=>grandTotals[cv]),grandTotals.__subtotal].join(",");
          const csv = [header,body,footer].join("\n");
          const blob=new Blob([csv],{type:"text/csv"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="pivot.csv";a.click();
        }} title="Export Pivot as CSV"/>}
        {pivotData&&<IBtn icon="📋" label="Export JSON" onClick={()=>{
          if(!pivotData)return;
          const blob=new Blob([JSON.stringify({config:pivotConfig,data:pivotData},null,2)],{type:"application/json"});
          const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="pivot.json";a.click();
        }} title="Export Pivot as JSON"/>}
        {pivotData&&<IBtn icon="📈" label="Pivot Chart" onClick={()=>{
          if(!pivotData)return;
          const chartRows=pivotData.rowVals.map(rv=>({__label:rv,...Object.fromEntries(pivotData.colVals.map(cv=>[cv,pivotData.grid[rv][cv]]))}));
          const chartCols=[{key:"__label",label:pivotConfig.rowField},...pivotData.colVals.map(cv=>({key:cv,label:cv}))];
          setModal("chart");
        }} title="Create Chart from Pivot"/>}
      </RibbonGroup>
      <RibbonGroup label="Aggregation">
        {["SUM","COUNT","AVERAGE","MAX","MIN","MEDIAN","STDEV","FIRST","LAST"].map(fn=>(
          <button key={fn} onClick={()=>setPivotConfig(c=>({...c,aggFn:fn}))}
            style={{...tBtn,background:pivotConfig.aggFn===fn?"#6366f1":"#e8eaed",color:pivotConfig.aggFn===fn?"#fff":"#333",fontSize:10,padding:"2px 6px"}}>
            {fn}
          </button>
        ))}
      </RibbonGroup>
    </div>
  );

  // ── UPGRADE 3: AI ribbon ──────────────────────────────────────────────────
  const renderRibbonAI = () => (
    <div style={{display:"flex",alignItems:"flex-start",gap:0,padding:"4px 8px 0",flexWrap:"wrap"}}>
      <RibbonGroup label="AI Chat">
        <IBtn icon="🤖" label={showAiPanel?"Hide Chat":"Open Chat"} onClick={()=>setShowAiPanel(p=>!p)} active={showAiPanel} title="Toggle AI Chat Panel"/>
        <IBtn icon="🗑" label="Clear" onClick={()=>{setAiHistory([]);setAiResult("");}} title="Clear AI chat history"/>
      </RibbonGroup>
      <RibbonGroup label="Smart Actions">
        <IBtn icon="🔍" label="Explain Cell" onClick={()=>{
          if(!selection.start)return;setShowAiPanel(true);
          const val=processedRows[selection.start.ri]?.[visibleCols[selection.start.ci]?.key]??"";
          const ref=`${colLetter(selection.start.ci)}${selection.start.ri+1}`;
          runAI(`Explain this formula or value at cell ${ref}: "${val}"`);
        }} title="Explain selected cell"/>
        <IBtn icon="⚠️" label="Anomalies" onClick={()=>{
          if(!selection.start)return;setShowAiPanel(true);
          const col=visibleCols[selection.start.ci];
          const vals=rows.map(r=>r[col?.key]).filter(v=>v!=="").slice(0,50).join(", ");
          runAI(`Find anomalies, outliers, or data quality issues in column "${col?.label}": ${vals}`);
        }} title="Find anomalies in column"/>
        <IBtn icon="💡" label="Formula" onClick={()=>{
          if(!selection.start)return;setShowAiPanel(true);
          const col=visibleCols[selection.start.ci];
          runAI(`Suggest the best formula for column "${col?.label}" given spreadsheet columns: ${visibleCols.map(c=>c.label).join(", ")}. Reply with the formula only, starting with =`);
        }} title="Suggest formula"/>
        <IBtn icon="📊" label="Analyze" onClick={()=>{
          setShowAiPanel(true);
          const sample=rows.slice(0,10).map(r=>visibleCols.map(c=>r[c.key]).join(" | ")).join("\n");
          runAI(`Analyze this dataset and give me: 1) Key insights, 2) Data quality issues, 3) Suggested formulas to add, 4) Visualization recommendations.\n\nColumns: ${visibleCols.map(c=>c.label).join(", ")}\nSample:\n${sample}`);
        }} title="Full data analysis"/>
        <IBtn icon="🧹" label="Cleanup" onClick={()=>{
          setShowAiPanel(true);
          const sample=rows.slice(0,8).map(r=>visibleCols.map(c=>r[c.key]).join(" | ")).join("\n");
          runAI(`Review this data and give me a specific, actionable cleanup checklist:\n${sample}`);
        }} title="Data cleanup suggestions"/>
        <IBtn icon="📝" label="Generate" onClick={()=>{
          setShowAiPanel(true);
          runAI(`Write 3 useful calculated column formulas for a spreadsheet with columns: ${visibleCols.map(c=>c.label).join(", ")}. For each, show the formula and explain what it calculates.`);
        }} title="Generate formula ideas"/>
      </RibbonGroup>
      <RibbonGroup label="AI Mode">
        <div style={{display:"flex",flexDirection:"column",gap:3}}>
          {[["chat","💬 Chat"],["formula","📐 Formula Mode"]].map(([m,l])=>(
            <button key={m} onClick={()=>{setAiMode(m);setShowAiPanel(true);}}
              style={{...tBtn,background:aiMode===m?"#6366f1":"#e8eaed",color:aiMode===m?"#fff":"#333",fontSize:10,padding:"2px 8px"}}>
              {l}
            </button>
          ))}
        </div>
      </RibbonGroup>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0,flex:1,background:"#fff",fontFamily:"'Segoe UI',system-ui,sans-serif",zoom:zoomLevel!==100?`${zoomLevel}%`:undefined}}
      onKeyDown={e=>{
        if((e.ctrlKey||e.metaKey)&&e.key==="a"){e.preventDefault();if(visibleProcessedRows.length&&visibleCols.length)setSelection({start:{ri:0,ci:0},end:{ri:visibleProcessedRows.length-1,ci:visibleCols.length-1}});}
        // UPGRADE 7: Command Palette
        if((e.ctrlKey||e.metaKey)&&(e.key==="p"||e.key==="P")){e.preventDefault();setCmdPaletteOpen(true);setCmdQuery("");setCmdIndex(0);setTimeout(()=>cmdInputRef.current?.focus(),50);}
      }}>

      {/* ── UPGRADE 7: Command Palette ── */}
      {cmdPaletteOpen&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:99999,display:"flex",alignItems:"flex-start",justifyContent:"center",paddingTop:"15vh"}}
          onClick={()=>setCmdPaletteOpen(false)}>
          <div style={{background:"#fff",borderRadius:10,boxShadow:"0 24px 64px rgba(0,0,0,0.25)",width:540,maxHeight:"60vh",display:"flex",flexDirection:"column",overflow:"hidden"}}
            onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",borderBottom:"1px solid #e5e7eb"}}>
              <span style={{fontSize:16}}>⌨️</span>
              <input ref={cmdInputRef} autoFocus value={cmdQuery} onChange={e=>{setCmdQuery(e.target.value);setCmdIndex(0);}}
                onKeyDown={e=>{
                  if(e.key==="ArrowDown"){e.preventDefault();setCmdIndex(i=>Math.min(i+1,filteredCmds.length-1));}
                  if(e.key==="ArrowUp"){e.preventDefault();setCmdIndex(i=>Math.max(i-1,0));}
                  if(e.key==="Enter"){const cmd=filteredCmds[cmdIndex];if(cmd){cmd.action();setCmdPaletteOpen(false);}}
                  if(e.key==="Escape")setCmdPaletteOpen(false);
                }}
                placeholder="Type a command, formula, or sheet name…"
                style={{flex:1,border:"none",outline:"none",fontSize:14,color:"#0f172a"}}/>
              <kbd style={{fontSize:10,background:"#f1f5f9",border:"1px solid #cbd5e1",borderRadius:3,padding:"1px 5px",color:"#64748b"}}>Esc</kbd>
            </div>
            <div style={{flex:1,overflowY:"auto"}}>
              {filteredCmds.map((cmd,i)=>(
                <div key={i} onClick={()=>{cmd.action();setCmdPaletteOpen(false);}}
                  style={{display:"flex",alignItems:"center",gap:10,padding:"8px 14px",background:i===cmdIndex?"#eff6ff":"transparent",cursor:"pointer",transition:"background 0.1s"}}
                  onMouseEnter={()=>setCmdIndex(i)}>
                  <span style={{fontSize:11,color:"#6366f1",background:"#eef2ff",padding:"1px 6px",borderRadius:3,minWidth:70,textAlign:"center"}}>{cmd.category}</span>
                  <span style={{flex:1,fontSize:13,color:"#0f172a"}}>{cmd.label}</span>
                  {cmd.shortcut&&<kbd style={{fontSize:10,background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:3,padding:"1px 6px",color:"#64748b"}}>{cmd.shortcut}</kbd>}
                </div>
              ))}
              {filteredCmds.length===0&&<div style={{padding:"24px",textAlign:"center",color:"#94a3b8",fontSize:13}}>No commands found</div>}
            </div>
          </div>
        </div>
      )}

      {/* ── Ribbon Tabs ── */}
      <div style={{display:"flex",alignItems:"center",background:"#F8F9FA",borderBottom:`1px solid ${BORDER}`,paddingLeft:8,flexShrink:0}}>
        {["Home","Insert","Formulas","Data","View","Pivot","AI"].map(tab=>(
          <RibbonTab key={tab} label={tab==="Pivot"?"📊 Pivot":tab==="AI"?"🤖 AI":tab} active={ribbonTab===tab} onClick={()=>setRibbonTab(tab)}/>
        ))}
        <div style={{marginLeft:"auto",padding:"0 8px",display:"flex",gap:6,alignItems:"center"}}>
          <span style={{fontSize:10,color:"#6366f1",background:"#eef2ff",padding:"1px 6px",borderRadius:3,cursor:"pointer"}} title="Command Palette (Ctrl+P)" onClick={()=>{setCmdPaletteOpen(true);setTimeout(()=>cmdInputRef.current?.focus(),50);}}>⌨️ Ctrl+P</span>
          <span style={{fontSize:10,color:"#aaa"}}>ExcelTable Pro</span>
        </div>
      </div>

      {/* ── Ribbon Content ── */}
      <div style={{background:"#F8F9FA",borderBottom:`1px solid ${BORDER}`,flexShrink:0,minHeight:58}}>
        {ribbonTab==="Home"&&renderRibbonHome()}
        {ribbonTab==="Insert"&&renderRibbonInsert()}
        {ribbonTab==="Formulas"&&renderRibbonFormulas()}
        {ribbonTab==="Data"&&renderRibbonData()}
        {ribbonTab==="View"&&renderRibbonView()}
        {ribbonTab==="Pivot"&&renderRibbonPivot()}
        {ribbonTab==="AI"&&renderRibbonAI()}
      </div>

      {/* ── UPGRADE 2: Pivot Table Panel ── */}
      {ribbonTab==="Pivot"&&showPivotPanel&&(
        <div style={{background:"#f8faff",borderBottom:"1px solid #c7d2fe",padding:"12px 16px",flexShrink:0,display:"flex",gap:16,flexWrap:"wrap",alignItems:"flex-start"}}>
          {/* Field config */}
          <div style={{display:"flex",flexDirection:"column",gap:8,minWidth:220}}>
            <div style={{fontWeight:700,fontSize:12,color:"#4338ca",marginBottom:4}}>📊 Pivot Builder</div>
            {[["rowField","Row Field"],["colField","Column Field (opt)"],["valueField","Value Field"],["filterField","Filter Field (opt)"]].map(([k,lbl])=>(
              <div key={k} style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:11,color:"#555",width:130,flexShrink:0}}>{lbl}</span>
                <select value={pivotConfig[k]} onChange={e=>setPivotConfig(c=>({...c,[k]:e.target.value}))}
                  style={{flex:1,fontSize:11,padding:"3px 6px",border:"1px solid #c7d2fe",borderRadius:4,background:"#fff"}}>
                  <option value="">(none)</option>
                  {baseCols.map(c=><option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </div>
            ))}
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:11,color:"#555",width:130,flexShrink:0}}>Aggregation</span>
              <select value={pivotConfig.aggFn} onChange={e=>setPivotConfig(c=>({...c,aggFn:e.target.value}))}
                style={{flex:1,fontSize:11,padding:"3px 6px",border:"1px solid #c7d2fe",borderRadius:4,background:"#fff"}}>
                {["SUM","COUNT","AVERAGE","MAX","MIN"].map(f=><option key={f}>{f}</option>)}
              </select>
            </div>
            {pivotConfig.filterField&&(
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:11,color:"#555",width:130,flexShrink:0}}>Filter Value</span>
                <input value={pivotConfig.filterValue} onChange={e=>setPivotConfig(c=>({...c,filterValue:e.target.value}))}
                  style={{flex:1,fontSize:11,padding:"3px 6px",border:"1px solid #c7d2fe",borderRadius:4}}/>
              </div>
            )}
          </div>
          {/* Pivot grid */}
          {pivotData?(
            <div style={{flex:1,overflowX:"auto",maxHeight:300,overflowY:"auto"}}>
              <table style={{borderCollapse:"collapse",fontSize:11,fontFamily:"monospace"}}>
                <thead>
                  <tr>
                    <th style={{background:"#e0e7ff",padding:"4px 8px",border:"1px solid #c7d2fe",fontWeight:700}}>{pivotConfig.rowField}</th>
                    {pivotData.colVals.map(cv=><th key={cv} style={{background:"#e0e7ff",padding:"4px 8px",border:"1px solid #c7d2fe",fontWeight:700,whiteSpace:"nowrap"}}>{cv}</th>)}
                    <th style={{background:"#c7d2fe",padding:"4px 8px",border:"1px solid #a5b4fc",fontWeight:700}}>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {pivotData.rowVals.map((rv,ri)=>(
                    <tr key={rv} style={{background:ri%2===0?"#f8faff":"#fff"}}>
                      <td style={{padding:"3px 8px",border:"1px solid #e0e7ff",fontWeight:600,color:"#3730a3"}}>{rv}</td>
                      {pivotData.colVals.map(cv=><td key={cv} style={{padding:"3px 8px",border:"1px solid #e0e7ff",textAlign:"right"}}>{pivotData.grid[rv][cv]}</td>)}
                      <td style={{padding:"3px 8px",border:"1px solid #c7d2fe",textAlign:"right",fontWeight:700,background:"#eef2ff"}}>{pivotData.grid[rv].__subtotal}</td>
                    </tr>
                  ))}
                  <tr style={{background:"#dde0ff"}}>
                    <td style={{padding:"3px 8px",border:"1px solid #c7d2fe",fontWeight:700,color:"#3730a3"}}>Grand Total</td>
                    {pivotData.colVals.map(cv=><td key={cv} style={{padding:"3px 8px",border:"1px solid #c7d2fe",textAlign:"right",fontWeight:700}}>{pivotData.grandTotals[cv]}</td>)}
                    <td style={{padding:"3px 8px",border:"1px solid #a5b4fc",textAlign:"right",fontWeight:900,background:"#c7d2fe"}}>{pivotData.grandTotals.__subtotal}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ):(
            <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"#94a3b8",fontSize:13,padding:20}}>Select Row Field and Value Field to build pivot</div>
          )}
        </div>
      )}

      {/* ── UPGRADE 3: AI Panel (Full Chat History) ── */}
      {ribbonTab==="AI"&&showAiPanel&&(
        <div style={{background:"#fafafe",borderBottom:"1px solid #e0e7ff",flexShrink:0,display:"flex",flexDirection:"column",maxHeight:340}}>
          {/* Header bar */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 14px 4px",borderBottom:"1px solid #e0e7ff",flexShrink:0}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontWeight:700,fontSize:12,color:"#4338ca"}}>🤖 AI Spreadsheet Assistant</span>
              <span style={{fontSize:10,background:"#eef2ff",color:"#6366f1",padding:"1px 6px",borderRadius:3}}>claude-sonnet-4</span>
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <button onClick={()=>{setAiHistory([]);setAiResult("");}} style={{...tBtn,fontSize:10,color:"#ef4444",background:"transparent",border:"none"}} title="Clear chat">🗑 Clear</button>
              <button onClick={()=>setShowAiPanel(false)} style={{...tBtn,fontSize:11,background:"transparent",border:"none",color:"#888"}}>✕</button>
            </div>
          </div>

          {/* Quick action chips */}
          <div style={{display:"flex",gap:4,padding:"6px 14px",flexWrap:"wrap",borderBottom:"1px solid #e0e7ff",flexShrink:0,background:"#f0f4ff"}}>
            {[
              {label:"💡 Explain cell",prompt:()=>{ const v=selection.start?processedRows[selection.start.ri]?.[visibleCols[selection.start.ci]?.key]??"":"(no cell selected)"; const ref=selection.start?`${colLetter(selection.start.ci)}${selection.start.ri+1}`:""; return `Explain this spreadsheet value or formula: "${v}" at cell ${ref}.`;}},
              {label:"📐 Suggest formula",prompt:()=>`Suggest the best formula for column "${visibleCols[selection.start?.ci]?.label||"selected"}" given columns: ${visibleCols.map(c=>c.label).join(", ")}. Reply with formula starting with =`},
              {label:"🔍 Find anomalies",prompt:()=>{ const col=visibleCols[selection.start?.ci];if(!col)return"Select a column first";const vals=rows.map(r=>r[col.key]).filter(v=>v!=="").slice(0,50).join(", ");return `Find anomalies or outliers in column "${col.label}": ${vals}`;}},
              {label:"📊 Stats summary",prompt:()=>{ const sample=rows.slice(0,10).map(r=>visibleCols.map(c=>r[c.key]).join(" | ")).join("\n");return `Give a brief statistical and data quality summary of this spreadsheet data:\n${sample}`;}},
              {label:"🧹 Cleanup tips",prompt:()=>{ const sample=rows.slice(0,8).map(r=>visibleCols.map(c=>r[c.key]).join(" | ")).join("\n");return `Review this data and suggest specific cleanup steps:\n${sample}`;}},
              {label:"📝 Write formula",prompt:()=>`Write me a formula using columns: ${visibleCols.map(c=>c.label).join(", ")}. What would be a useful calculated field?`},
            ].map((a,i)=>(
              <button key={i} onClick={()=>{setAiQuery("");runAI(typeof a.prompt==="function"?a.prompt():a.prompt);}}
                style={{fontSize:10,padding:"2px 8px",border:"1px solid #c7d2fe",borderRadius:10,background:"#fff",cursor:"pointer",color:"#4338ca",whiteSpace:"nowrap",transition:"background 0.1s"}}
                onMouseEnter={e=>e.currentTarget.style.background="#eef2ff"}
                onMouseLeave={e=>e.currentTarget.style.background="#fff"}>
                {a.label}
              </button>
            ))}
          </div>

          {/* Chat history */}
          <div style={{flex:1,overflowY:"auto",padding:"10px 14px",display:"flex",flexDirection:"column",gap:10,minHeight:0}}>
            {aiHistory.length===0&&(
              <div style={{textAlign:"center",color:"#94a3b8",fontSize:12,padding:"20px 0"}}>
                <div style={{fontSize:24,marginBottom:6}}>🤖</div>
                Ask anything about your data — formulas, analysis, cleanup, insights.<br/>
                <span style={{fontSize:10}}>Your data context is automatically included.</span>
              </div>
            )}
            {aiHistory.map((msg,i)=>(
              <div key={i} style={{display:"flex",gap:8,alignItems:"flex-start",flexDirection:msg.role==="user"?"row-reverse":"row"}}>
                <div style={{width:24,height:24,borderRadius:"50%",background:msg.role==="user"?"#6366f1":"#10b981",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"#fff",fontWeight:700,flexShrink:0}}>
                  {msg.role==="user"?"U":"AI"}
                </div>
                <div style={{maxWidth:"75%",background:msg.role==="user"?"#6366f1":"#f0fdf4",color:msg.role==="user"?"#fff":"#0f172a",borderRadius:10,padding:"8px 12px",fontSize:12,lineHeight:1.5,position:"relative",
                  boxShadow:"0 1px 4px rgba(0,0,0,0.07)",whiteSpace:"pre-wrap",wordBreak:"break-word"}}>
                  {msg.content}
                  {/* Insert formula button */}
                  {msg.role==="assistant"&&msg.content.trim().match(/^=\w+/)&&(
                    <button onClick={()=>{
                      if(!selection.start)return;
                      const row=processedRows[selection.start.ri];const col=visibleCols[selection.start.ci];
                      const formula=msg.content.trim().split("\n")[0];
                      if(row&&col&&onChange){onChange(row.__origIdx,col.key,formula);setAiHistory(h=>[...h,{role:"assistant",content:`✅ Inserted \`${formula}\` into ${colLetter(selection.start.ci)}${selection.start.ri+1}`}]);}
                    }} style={{display:"block",marginTop:6,fontSize:10,padding:"2px 8px",background:"#22c55e",color:"#fff",border:"none",borderRadius:4,cursor:"pointer",fontFamily:"monospace"}}>
                      ⬆ Insert into selected cell
                    </button>
                  )}
                </div>
              </div>
            ))}
            {aiLoading&&(
              <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                <div style={{width:24,height:24,borderRadius:"50%",background:"#10b981",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"#fff",fontWeight:700}}>AI</div>
                <div style={{background:"#f0fdf4",borderRadius:10,padding:"10px 14px",fontSize:12,color:"#64748b"}}>
                  <span style={{display:"inline-flex",gap:3}}>
                    {[0,1,2].map(i=><span key={i} style={{width:6,height:6,borderRadius:"50%",background:"#10b981",display:"inline-block",animation:`bounce 1s ${i*0.2}s infinite`}}/>)}
                  </span>
                </div>
              </div>
            )}
            <div ref={aiChatEndRef}/>
          </div>

          {/* Input row */}
          <div style={{padding:"8px 14px 10px",borderTop:"1px solid #e0e7ff",background:"#fff",flexShrink:0}}>
            <div style={{display:"flex",gap:6,alignItems:"flex-end"}}>
              <textarea value={aiQuery} onChange={e=>setAiQuery(e.target.value)} rows={2}
                onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();if(aiQuery.trim()&&!aiLoading){runAI(aiQuery);setAiQuery("");}}}}
                placeholder="Ask about your data… (Enter to send, Shift+Enter for newline)"
                style={{flex:1,padding:"6px 10px",fontSize:12,border:"1px solid #c7d2fe",borderRadius:8,fontFamily:"inherit",resize:"none",outline:"none",lineHeight:1.4,color:"#0f172a"}}
              />
              <button onClick={()=>{if(aiQuery.trim()&&!aiLoading){runAI(aiQuery);setAiQuery("");}}}
                disabled={aiLoading||!aiQuery.trim()}
                style={{padding:"8px 14px",background:aiLoading||!aiQuery.trim()?"#e0e7ff":"#6366f1",color:aiLoading||!aiQuery.trim()?"#94a3b8":"#fff",border:"none",borderRadius:8,cursor:aiLoading||!aiQuery.trim()?"default":"pointer",fontSize:12,fontWeight:700,flexShrink:0,height:46,transition:"background 0.15s"}}>
                {aiLoading?"⏳":"Send ↑"}
              </button>
            </div>
            <div style={{fontSize:10,color:"#94a3b8",marginTop:4}}>Your column names and sample data are automatically included as context.</div>
          </div>
        </div>
      )}

      {/* ── UPGRADE 4: Import Panel ── */}
      {showImportPanel&&importPreview&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.35)",zIndex:9000,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#fff",borderRadius:10,padding:20,minWidth:520,maxHeight:"80vh",overflowY:"auto",boxShadow:"0 16px 48px rgba(0,0,0,0.2)"}}>
            <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>📥 Import Preview — {importPreview.source}</div>
            <div style={{fontSize:11,color:"#888",marginBottom:12}}>First 5 rows of {importPreview.rows.length} total</div>
            <div style={{overflowX:"auto",marginBottom:12}}>
              <table style={{borderCollapse:"collapse",fontSize:11,fontFamily:"monospace",minWidth:"100%"}}>
                <thead><tr>{importPreview.cols.map(c=><th key={c.key} style={{background:"#e8eaed",padding:"4px 8px",border:"1px solid #ddd",fontWeight:600}}>{c.label}</th>)}</tr></thead>
                <tbody>{importPreview.rows.slice(0,5).map((r,i)=><tr key={i}>{importPreview.cols.map(c=><td key={c.key} style={{padding:"3px 8px",border:"1px solid #eee"}}>{String(r[c.key]??"")}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
              <span style={{fontSize:12,fontWeight:600}}>On import:</span>
              {["replace","append","skip"].map(m=>(
                <label key={m} style={{display:"flex",alignItems:"center",gap:4,fontSize:12,cursor:"pointer"}}>
                  <input type="radio" name="importMode" checked={importPreview.mode===m} onChange={()=>setImportPreview(p=>({...p,mode:m}))}/> {m==="replace"?"Replace all":"skip"===m?"Skip duplicates":"Append rows"}
                </label>
              ))}
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>{setImportPreview(null);setShowImportPanel(false);}} style={tBtn}>Cancel</button>
              <button onClick={commitImport} style={{...tBtn,background:"#1a73e8",color:"#fff"}}>Import</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Formula Bar ── */}
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"3px 8px",background:"#fff",borderBottom:`1px solid ${BORDER}`,flexShrink:0,minHeight:30,position:"relative"}}>
        <div style={{background:"#EEF2FF",border:"1px solid #C7D2FE",borderRadius:4,padding:"2px 10px",minWidth:52,textAlign:"center",fontWeight:700,fontSize:12,color:"#4F46E5",flexShrink:0,fontFamily:"monospace"}}>{selLabel}</div>
        <div style={{width:1,height:16,background:BORDER}}/>
        <span style={{color:"#1a73e8",fontSize:14,fontWeight:700,flexShrink:0}}>ƒx</span>
        <div style={{flex:1,position:"relative"}}>
          <input
            value={editing?editVal:formulaInput}
            onChange={e=>{const v=e.target.value;editing?setEditVal(v):setFormulaInput(v);updateAutocomplete(v);}}
            onKeyDown={e=>{if(editing){handleInputKeyDown(e);return;}if(e.key==="Enter")commitFormulaBar();if(e.key==="Escape")setFormulaInput("");}}
            placeholder="=SUM(A1:A5)  =IF(A1>0,&quot;Yes&quot;,&quot;No&quot;)  =VLOOKUP(…)"
            style={{width:"100%",border:"none",outline:"none",fontSize:12,fontFamily:"'Courier New',monospace",color:formulaInput.startsWith("=")||editVal.startsWith("=")?"#1a73e8":"#333",background:"transparent"}}
          />
          {/* Autocomplete dropdown */}
          {acSuggestions.length>0&&(
            <div style={{position:"absolute",top:"100%",left:0,zIndex:10000,background:"#fff",border:"1px solid #ddd",borderRadius:4,boxShadow:"0 4px 12px rgba(0,0,0,0.15)",minWidth:180}}>
              {acSuggestions.map((fn,i)=>(
                <div key={fn} onClick={()=>applyAutocomplete(fn)}
                  style={{padding:"4px 10px",fontSize:11,fontFamily:"monospace",background:i===acIndex?"#e8f0fe":"transparent",cursor:"pointer",color:i===acIndex?"#1a73e8":"#333"}}
                  onMouseEnter={()=>setAcIndex(i)}>
                  {fn}(
                </div>
              ))}
              <div style={{padding:"3px 8px",fontSize:10,color:"#aaa",borderTop:"1px solid #eee"}}>Tab to complete</div>
            </div>
          )}
        </div>
        {(formulaInput||editVal)&&<button onClick={commitFormulaBar} style={{...tBtn,background:"#1a73e8",color:"#fff",padding:"2px 10px"}}>✓</button>}
      </div>

      {/* ── Quick Search Bar ── */}
      {showQuickSearch&&(
        <div style={{display:"flex",alignItems:"center",gap:8,padding:"3px 8px",background:"#fffbeb",borderBottom:`1px solid #fde68a`,flexShrink:0}}>
          <span style={{fontSize:12,color:"#92400e"}}>🔎 Quick Search</span>
          <input autoFocus value={quickSearch} onChange={e=>setQuickSearch(e.target.value)}
            placeholder="Filter visible rows…"
            style={{flex:1,padding:"3px 8px",fontSize:12,border:"1px solid #fde68a",borderRadius:4,fontFamily:"monospace",background:"#fff"}}
          />
          {quickSearch&&<button onClick={()=>setQuickSearch("")} style={{...tBtn,fontSize:10}}>✕ Clear</button>}
          <button onClick={()=>{setShowQuickSearch(false);setQuickSearch("");}} style={{...tBtn,fontSize:10}}>Close</button>
          <span style={{fontSize:10,color:"#b45309"}}>{visibleProcessedRows.length} row(s) visible · Ctrl+K to toggle</span>
        </div>
      )}

      {/* ── Table (with optional split pane) ── */}
      <div style={{flex:1,minHeight:0,display:"flex",flexDirection:"row",overflow:"hidden"}}>
      {/* ── Table ── */}
      <div ref={tableRef} style={{flex:splitPane?splitRatio:1,minHeight:0,overflow:"auto",position:"relative"}} tabIndex={-1}>
        <table style={{borderCollapse:"collapse",tableLayout:"fixed",fontSize:12,fontFamily:"'Courier New',monospace",minWidth:"100%"}}>
          <thead>
            <tr>
              <th style={{background:"#D8DCE2",width:44,minWidth:44,position:"sticky",left:0,top:0,zIndex:40,textAlign:"center",border:showGridLines?`1px solid ${BORDER}`:"none",fontSize:11,color:"#888",fontWeight:600,height:28,userSelect:"none"}}>#</th>
              {onDelete&&<th style={{background:"#D8DCE2",width:28,minWidth:28,position:"sticky",left:44,top:0,zIndex:40,border:showGridLines?`1px solid ${BORDER}`:"none"}}/>}
              {visibleCols.map((c,ci)=>{
                const isFrozen=ci<frozenCols,hasFilter=filters[c.key]?.size>0,isSorted=sortConfig.some(s=>s.key===c.key),vRule=validation[c.key];
                return (
                  <th key={ci} className="xl-filter-anchor" draggable onDragStart={()=>setColDrag(ci)} onDragOver={e=>{e.preventDefault();setColDragOver(ci);}} onDrop={handleColDragEnd} style={{background:colDragOver===ci?"#c7d2fe":HEADER_BG,padding:"0 4px",textAlign:"left",fontWeight:600,fontSize:11,color:"#555",border:showGridLines?`1px solid ${BORDER}`:"none",whiteSpace:"nowrap",position:"sticky",top:0,left:isFrozen?frozenLeft(ci):undefined,zIndex:isFrozen?30:10,userSelect:"none",height:28,minWidth:colW(ci),width:colW(ci),cursor:"grab"}}>
                    <div style={{display:"flex",alignItems:"center",gap:3,height:"100%",position:"relative"}}>
                      <span style={{color:"#bbb",fontSize:10}}>{colLetter(ci)}</span>
                      <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",cursor:"pointer"}} onClick={e=>{const key=c.key;if(e.shiftKey){setSortConfig(sc=>{const idx=sc.findIndex(s=>s.key===key);if(idx>=0){const n=[...sc];n[idx]={key,dir:n[idx].dir==="asc"?"desc":"asc"};return n;}return [...sc,{key,dir:"asc"}];});}else{setSortConfig(sc=>{const existing=sc.find(s=>s.key===key);return [{key,dir:existing?.dir==="asc"?"desc":"asc"}];});}}}>
                        {c.label}{sortConfig.findIndex(s=>s.key===c.key)>=0&&<span style={{marginLeft:3,color:"#1a73e8"}}>{(sortConfig.find(s=>s.key===c.key)?.dir==="asc"?"▲":"▼")}{sortConfig.length>1&&<sup style={{fontSize:8}}>{sortConfig.findIndex(s=>s.key===c.key)+1}</sup>}</span>}
                      </span>
                      {vRule&&vRule.type!=="none"&&<span title="Validation active" style={{fontSize:9,color:"#16a34a"}}>✓</span>}
                      <button onClick={e=>{e.stopPropagation();setOpenFilter(k=>k===c.key?null:c.key);}}
                        style={{background:"none",border:"none",cursor:"pointer",padding:"0 2px",fontSize:10,color:hasFilter?"#1a73e8":"#bbb",lineHeight:1}}>
                        {hasFilter?"🔽":"▾"}
                      </button>
                      {openFilter===c.key&&<FilterDropdown col={c} rows={rows} activeFilter={filters[c.key]} onSort={dir=>{setSortConfig([{key:c.key,dir}]);setOpenFilter(null);}} onFilter={allowed=>setFilters(f=>({...f,[c.key]:allowed}))} onClose={()=>setOpenFilter(null)}/>}
                      {/* UPGRADE 8: Heatmap legend bar */}
                      {heatmapOn&&heatmapMeta[c.key]&&(
                        <div title={`Min: ${heatmapMeta[c.key].min} Max: ${heatmapMeta[c.key].max}`} style={{position:"absolute",bottom:0,left:0,right:0,height:3,background:"linear-gradient(to right,#bfdbfe,#fff,#ea580c)",borderRadius:0,opacity:0.85}}/>
                      )}
                      <div onMouseDown={e=>startResize(e,ci)} style={{position:"absolute",right:0,top:0,bottom:0,width:4,cursor:"col-resize",background:resizing?.ci===ci?"#1a73e8":"transparent",zIndex:5}}/>
                    </div>
                  </th>
                );
              })}
              {hasSparklines&&<th style={{background:HEADER_BG,border:showGridLines?`1px solid ${BORDER}`:"none",fontSize:11,color:"#555",fontWeight:600,position:"sticky",top:0,zIndex:10,minWidth:100,width:100,padding:"0 6px"}}>Trend</th>}
            </tr>
          </thead>
          <tbody>
            {visibleProcessedRows.map((r,ri)=>{
              const isFrozenRow=ri<frozenRows;
              return (
                <tr key={ri} style={{height:rowHeights[ri]||26,position:isFrozenRow?"sticky":"relative",top:isFrozenRow?28+ri*26:undefined,zIndex:isFrozenRow?20:undefined,background:isFrozenRow?FROZEN_BG:"transparent"}}>
                  <td
                    draggable
                    onDragStart={()=>setRowDrag(ri)}
                    onDragOver={e=>{e.preventDefault();setRowDragOver(ri);}}
                    onDrop={handleRowDragEnd}
                    title="Drag to reorder row"
                    style={{background:rowDragOver===ri?"#c7d2fe":"#E8EAED",textAlign:"center",color:"#888",fontSize:11,fontWeight:600,position:"sticky",left:0,zIndex:isFrozenRow?25:5,border:showGridLines?`1px solid ${BORDER}`:"none",cursor:"grab",height:rowHeights[ri]||26,padding:0,fontFamily:"monospace",width:44,minWidth:44,userSelect:"none"}}
                  >
                    {/* Group toggle indicator */}
                    {rowGroups.map((g,gi)=>g.start===ri?(
                      <span key={gi} onClick={e=>{e.stopPropagation();toggleGroup(gi);}} style={{fontSize:9,cursor:"pointer",marginRight:1}}>{g.collapsed?"▶":"▼"}</span>
                    ):null)}
                    {ri+1}
                  </td>
                  {onDelete&&<td style={{background:"#E8EAED",textAlign:"center",padding:"0 2px",position:"sticky",left:44,zIndex:isFrozenRow?25:5,border:showGridLines?`1px solid ${BORDER}`:"none",width:28,minWidth:28}}><button onClick={()=>onDelete(r.__origIdx)} style={{background:"none",border:"none",cursor:"pointer",color:"#EF4444",fontSize:12,padding:"1px 3px",lineHeight:1}}>✕</button></td>}
                  {visibleCols.map((c,ci)=>{
                    const isEd=editing?.ri===ri&&editing?.ci===ci;
                    const isSel=isSelected(ri,ci);
                    const rawVal=r[c.key]??"";
                    const dispVal=evalCell(rawVal,ri,ci);
                    const isFrozenC=ci<frozenCols;
                    const isFormula=typeof rawVal==="string"&&rawVal.startsWith("=");
                    const condStyle=applyCondFmt(dispVal,condFmtRules,c.key,rows.map(row=>row[c.key]),r.__origIdx);
                    const stableKey=`${r.__origIdx}-${c.key}`;
                    const hasValError=validErrors[stableKey];
                    const vRule=validation[c.key];
                    const isDropdown=isEd&&(vRule?.type==="list"||c.type==="dropdown");
                    const fmt=getFmt(ri,ci);
                    const hasComment=!!comments[stableKey];
                    const rowBg=zebra?(ri%2===0?"#fff":"#FAFAFA"):"#fff";
                    const baseBg=(!condStyle||condStyle.__databar)?undefined:condStyle?.background||(fmt.fillColor&&fmt.fillColor!=="#ffffff"?fmt.fillColor:isSel?SEL_BG:isFrozenC?FROZEN_BG:rowBg);
                    const heatBg=getHeatmapBg(c.key,dispVal);
                    const resolvedBg=heatBg||(baseBg||(fmt.fillColor&&fmt.fillColor!=="#ffffff"?fmt.fillColor:isSel?SEL_BG:isFrozenC?FROZEN_BG:rowBg));
                    // Check merge
                    const merge=isMergeOrigin(merges,ri,ci);
                    const inMerge=cellInMerge(merges,ri,ci);
                    const isHidden=inMerge&&!(inMerge.r1===ri&&inMerge.c1===ci);
                    if(isHidden) return null;
                    return (
                      <td key={ci} id={cellId(ri,ci)} tabIndex={0}
                        colSpan={merge?merge.c2-merge.c1+1:1}
                        rowSpan={merge?merge.r2-merge.r1+1:1}
                        style={{
                          padding:"0 6px",
                          border:showGridLines?`1px solid ${hasValError?"#ef4444":BORDER}`:"none",
                          height:rowHeights[ri]||26,
                          whiteSpace:fmt.wrapText?"normal":"nowrap",cursor:"cell",overflow:"hidden",textOverflow:fmt.wrapText?"clip":"ellipsis",
                          fontSize:fmt.fontSize||12,
                          fontFamily:fmt.fontFamily?`'${fmt.fontFamily}',monospace`:"'Courier New',monospace",
                          fontWeight:condStyle?.fontWeight||(fmt.bold?"bold":"normal"),
                          fontStyle:fmt.italic?"italic":"normal",
                          textDecoration:[fmt.underline?"underline":"",fmt.strikethrough?"line-through":""].filter(Boolean).join(" ")||"none",
                          color:condStyle?.color||fmt.textColor||"inherit",
                          textAlign:fmt.numFormat==="currency"||fmt.numFormat==="number"||fmt.numFormat==="percent"||fmt.numFormat==="scientific"?(fmt.align||"right"):(fmt.align||"left"),
                          verticalAlign:fmt.valign||"middle",
                          paddingLeft:fmt.indent?`${6+fmt.indent*14}px`:"6px",
                          ...(fmt.rotation?{transform:`rotate(${fmt.rotation}deg)`,transformOrigin:"center"}:{}),
                          ...(fmt.borderStyle&&fmt.borderStyle!=="none"?{
                            ...(fmt.borderStyle==="all"?{border:`${fmt.borderWidth||1}px solid ${fmt.borderColor||"#000"}`}:{}),
                            ...(fmt.borderStyle==="outer"?{border:`${(fmt.borderWidth||1)+1}px solid ${fmt.borderColor||"#000"}`}:{}),
                            ...(fmt.borderStyle==="bottom"?{borderBottom:`${fmt.borderWidth||1}px solid ${fmt.borderColor||"#000"}`}:{}),
                            ...(fmt.borderStyle==="top"?{borderTop:`${fmt.borderWidth||1}px solid ${fmt.borderColor||"#000"}`}:{}),
                            ...(fmt.borderStyle==="left"?{borderLeft:`${fmt.borderWidth||1}px solid ${fmt.borderColor||"#000"}`}:{}),
                            ...(fmt.borderStyle==="right"?{borderRight:`${fmt.borderWidth||1}px solid ${fmt.borderColor||"#000"}`}:{}),
                            ...(fmt.borderStyle==="thick"?{border:`${(fmt.borderWidth||1)+2}px solid ${fmt.borderColor||"#000"}`}:{}),
                            ...(fmt.borderStyle==="double"?{borderBottom:`3px double ${fmt.borderColor||"#000"}`}:{}),
                            ...(fmt.borderStyle==="dashed"?{border:`${fmt.borderWidth||1}px dashed ${fmt.borderColor||"#000"}`}:{}),
                            ...(fmt.borderStyle==="dotted"?{border:`${fmt.borderWidth||1}px dotted ${fmt.borderColor||"#000"}`}:{}),
                            ...(fmt.borderStyle==="inner"?{borderRight:`${fmt.borderWidth||1}px solid ${fmt.borderColor||"#000"}`,borderBottom:`${fmt.borderWidth||1}px solid ${fmt.borderColor||"#000"}`}:{}),
                            ...(fmt.borderStyle==="topbottom"?{borderTop:`${fmt.borderWidth||1}px solid ${fmt.borderColor||"#000"}`,borderBottom:`${fmt.borderWidth||1}px solid ${fmt.borderColor||"#000"}`}:{}),
                            ...(fmt.borderStyle==="medium"?{border:`${(fmt.borderWidth||1)+1}px solid ${fmt.borderColor||"#000"}`}:{}),
                          }:{}),
                          outline:isSel?`2px solid ${SEL_COLOR}`:"none",outlineOffset:-2,
                          background:resolvedBg,
                          position:(isFrozenC||isFrozenRow)?"sticky":"relative",
                          left:isFrozenC?frozenLeft(ci):undefined,
                          zIndex:isFrozenC&&isFrozenRow?26:isFrozenC?4:isFrozenRow?21:undefined,
                          minWidth:colW(ci),width:colW(ci)
                        }}
                        onClick={e=>select(ri,ci,e.shiftKey)}
                        onMouseMove={()=>{if(fillHandleDragging&&fillDrag)setFillDrag(fd=>fd?{...fd,endRi:ri,endCi:ci}:fd);}}
                        onDoubleClick={()=>startEdit(ri,ci)}
                        onContextMenu={e=>openContextMenu(e,ri,ci)}
                        onFocus={()=>{if(!editing){setSelection({start:{ri,ci},end:null});const v=r[c.key];setFormulaInput(v!==undefined?String(v):"");}}}
                        onKeyDown={e=>handleCellKeyDown(e,ri,ci)}
                        title={hasValError?hasValError:hasComment?comments[stableKey]:undefined}
                      >
                        {/* Comment indicator */}
                        {hasComment&&!isEd&&<div style={{position:"absolute",top:0,right:0,width:0,height:0,borderStyle:"solid",borderWidth:"0 6px 6px 0",borderColor:"transparent #f59e0b transparent transparent",pointerEvents:"none"}}/>}
                        {isEd?(
                          isDropdown?(
                            <SearchableDropdown
                              options={vRule?.type==="list"?vRule.list.split(",").map(o=>o.trim()):(c.type==="dropdown"?(c.options&&c.options.length?c.options:[...new Set(rows.map(r=>String(r[c.key]??"")))].filter(Boolean).sort()):[...new Set(rows.map(r=>String(r[c.key]??"")))].filter(Boolean).sort())}
                              value={editVal}
                              onChange={v=>{setEditVal(v);commitEdit(ri,ci,v);}}
                              onBlur={()=>commitEdit(ri,ci)}
                            />
                          ):c.type==="date"?(
                            <input type="date" autoFocus value={editVal}
                              onChange={e=>setEditVal(e.target.value)}
                              onBlur={()=>commitEdit(ri,ci)}
                              onKeyDown={e=>{if(e.key==="Enter")commitEdit(ri,ci);if(e.key==="Escape"){setEditing(null);}}}
                              style={{position:"absolute",inset:0,border:"none",outline:`2px solid ${SEL_COLOR}`,padding:"0 4px",fontSize:fmt.fontSize||12,fontFamily:"inherit",background:"#fff",zIndex:10,width:"100%",boxSizing:"border-box"}}/>
                          ):(
                            <input autoFocus value={editVal}
                              onChange={e=>{setEditVal(e.target.value);setFormulaInput(e.target.value);updateAutocomplete(e.target.value);updateInlineSuggest(e.target.value,ri,ci);
                              // Slash command trigger
                              if(e.target.value==="/"){const rect=e.target.getBoundingClientRect();setSlashMenu({ri,ci,x:rect.left,y:rect.bottom,q:""});}
                              else if(slashMenu&&e.target.value.startsWith("/"))setSlashMenu(sm=>sm?{...sm,q:e.target.value.slice(1)}:null);
                              else setSlashMenu(null);
                            }}
                              onBlur={()=>{if(!acSuggestions.length)commitEdit(ri,ci);}}
                              onKeyDown={handleInputKeyDown}
                              style={{position:"absolute",inset:0,border:"none",outline:`2px solid ${SEL_COLOR}`,padding:"0 6px",fontSize:fmt.fontSize||12,fontFamily:"'Courier New',monospace",background:"#fff",zIndex:10,color:editVal.startsWith("=")?"#1a73e8":"#333",width:"100%",boxSizing:"border-box"}}/>
                          )
                        ):(
                          <>
                            {(c.key==="status"||c.label?.toLowerCase()==="status")&&!c.xlRender?(
                              <span style={{position:"relative",zIndex:1}}>
                                {hasValError&&<span title={hasValError} style={{marginRight:4}}>⚠️</span>}
                                <StatusPill value={String(dispVal??"")} onClick={e=>{e.stopPropagation();if(onChange){const row2=processedRows[ri];const cur=row2[c.key]||"Pending";const next=STATUS_CYCLE[(STATUS_CYCLE.indexOf(cur)+1)%STATUS_CYCLE.length];pushHistory([{ri:row2.__origIdx,key:c.key,val:cur}]);onChange(row2.__origIdx,c.key,next);}}}/>
                              </span>
                            ):(
                              <span style={{color:hasValError?"#ef4444":isFormula?"#1a73e8":"inherit",position:"relative",zIndex:1,display:"flex",alignItems:"center",gap:3}}>
                                {hasValError&&<span title={hasValError} style={{marginRight:4}}>⚠️</span>}
                                {c.xlRender?c.xlRender(dispVal,r):
                                  // UPGRADE 6: Type renderers
                                  c.type==="currency"?(<span style={{color:Number(dispVal)>=0?"#16a34a":"#dc2626",fontWeight:600}}>{Number(dispVal)||dispVal===0?`$${Number(dispVal).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`:""}</span>):
                                  c.type==="percent"?(<span style={{position:"relative",display:"inline-flex",alignItems:"center",gap:4}}><div style={{position:"absolute",left:0,top:0,bottom:0,width:`${Math.min(100,Math.abs(Number(dispVal)))}%`,background:"#bfdbfe",opacity:0.5,borderRadius:2}}/><span style={{position:"relative"}}>{Number(dispVal)||dispVal===0?`${Number(dispVal).toFixed(1)}%`:""}</span></span>):
                                  c.type==="date"?(<span>{dispVal?new Date(dispVal).toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric"}):""}</span>):
                                  c.type==="checkbox"?(<span onClick={e=>{e.stopPropagation();if(onChange){const row2=processedRows[ri];const cur=row2[c.key];onChange(row2.__origIdx,c.key,!cur&&cur!=="false"&&cur!==false?false:true);}}} style={{cursor:"pointer",fontSize:14}}>{(!dispVal||dispVal==="false"||dispVal===false)?"☐":"✅"}</span>):
                                  c.type==="email"?(<a href={`mailto:${dispVal}`} onClick={e=>e.stopPropagation()} style={{color:"#2563eb",textDecoration:"underline"}}>{String(dispVal??"")}</a>):
                                  c.type==="url"?(<a href={String(dispVal??"")} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{color:"#2563eb",textDecoration:"underline"}}>🔗 {String(dispVal??"")}</a>):
                                  c.type==="badge"?(<span style={{display:"inline-block",padding:"1px 7px",borderRadius:10,fontSize:10,fontWeight:700,background:`hsl(${(String(dispVal??"").split("").reduce((a,b)=>a+b.charCodeAt(0),0)*37)%360},65%,88%)`,color:`hsl(${(String(dispVal??"").split("").reduce((a,b)=>a+b.charCodeAt(0),0)*37)%360},65%,30%)`}}>{String(dispVal??"")}</span>):
                                  c.type==="rating"?(
                                    <span style={{display:"inline-flex",gap:2}}>{[1,2,3,4,5].map(star=><span key={star} onClick={e=>{e.stopPropagation();if(onChange){const row2=processedRows[ri];onChange(row2.__origIdx,c.key,star);}}} style={{cursor:"pointer",fontSize:13,opacity:Number(dispVal)>=star?1:0.25}}>⭐</span>)}</span>
                                  ):
                                  (()=>{const v=dispVal??"";const n=Number(v);const dec=fmt.decimals??2;if(fmt.numFormat==="currency"&&!isNaN(n)&&v!=="")return<span style={{color:n>=0?"#16a34a":"#dc2626",fontWeight:600}}>{n.toLocaleString("en-US",{style:"currency",currency:"USD",minimumFractionDigits:dec,maximumFractionDigits:dec})}</span>;if(fmt.numFormat==="percent"&&!isNaN(n)&&v!=="")return<span>{(n).toFixed(dec)}%</span>;if(fmt.numFormat==="number"&&!isNaN(n)&&v!=="")return<span>{n.toLocaleString("en-US",{minimumFractionDigits:dec,maximumFractionDigits:dec})}</span>;if(fmt.numFormat==="scientific"&&!isNaN(n)&&v!=="")return<span>{n.toExponential(dec)}</span>;if(fmt.numFormat==="text")return<span>{String(v)}</span>;return String(v);})()
                                }
                              </span>
                            )}
                            {condStyle?.__databar&&<div style={{position:"absolute",left:0,top:0,bottom:0,width:`${condStyle.pct}%`,background:condStyle.color,opacity:0.25,pointerEvents:"none"}}/>}
                            {/* Fill handle – bottom-right corner of selection's last cell */}
                            {isSel&&!isEd&&selection.start&&!selection.end&&selection.start.ri===ri&&selection.start.ci===ci&&(
                              <div
                                onMouseDown={e=>{e.preventDefault();e.stopPropagation();setFillDrag({startRi:ri,startCi:ci,endRi:ri,endCi:ci});setFillHandleDragging(true);}}
                                style={{position:"absolute",right:-4,bottom:-4,width:8,height:8,background:SEL_COLOR,border:"1px solid #fff",cursor:"crosshair",zIndex:20,borderRadius:1}}
                              />
                            )}
                            {/* While dragging, show overlay on cells in range */}
                            {fillHandleDragging&&fillDrag&&ri>=fillDrag.startRi&&ri<=fillDrag.endRi&&ci===fillDrag.startCi&&ri!==fillDrag.startRi&&(
                              <div style={{position:"absolute",inset:0,background:"rgba(26,115,232,0.1)",border:"1px dashed #1a73e8",pointerEvents:"none",zIndex:15}}/>
                            )}
                            {/* Fill handle drag preview */}
                            {fillDrag&&fillHandleDragging&&fillDrag.startRi===ri&&fillDrag.startCi===ci&&fillDrag.endRi!==ri&&(
                              <div style={{position:"absolute",inset:0,border:"2px dashed #1a73e8",pointerEvents:"none",zIndex:25}}/>
                            )}
                            {fillDrag&&ri>fillDrag.startRi&&ri<=fillDrag.endRi&&fillDrag.startCi===ci&&(
                              <div style={{position:"absolute",inset:0,background:"rgba(26,115,232,0.08)",border:"1px dashed #1a73e8",pointerEvents:"none",zIndex:15}}/>
                            )}
                            {/* Trace arrow highlight */}
                            {traceCell&&getTracedCells(traceCell.ri,traceCell.ci).some(t=>t.ri===ri&&t.ci===ci)&&(
                              <div style={{position:"absolute",inset:0,border:`2px solid #f59e0b`,pointerEvents:"none",borderRadius:1,zIndex:12}}/>
                            )}
                            {/* Pin indicator */}
                            {pinnedRows.has(ri)&&ci===0&&<span style={{position:"absolute",left:2,top:2,fontSize:8,opacity:0.5}}>📌</span>}
                          </>
                        )}
                      </td>
                    );
                  })}
                  {hasSparklines&&<td style={{padding:"0 6px",border:showGridLines?`1px solid ${BORDER}`:"none",height:rowHeights[ri]||26,background:zebra?(ri%2===0?"#fff":"#FAFAFA"):"#fff",width:100,minWidth:100}}><Sparkline type={sparkType} values={Object.entries(sparkCols).filter(([,v])=>v).map(([k])=>Number(r[k])).filter(v=>!isNaN(v))}/></td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Split pane second panel ── */}
      {splitPane&&(
        <>
          <div onMouseDown={e=>{const sx=e.clientX;const onMove=ev=>{const dx=ev.clientX-sx;setSplitRatio(r=>Math.max(0.2,Math.min(0.8,r+dx/window.innerWidth)));};const onUp=()=>{window.removeEventListener("mousemove",onMove);window.removeEventListener("mouseup",onUp);};window.addEventListener("mousemove",onMove);window.addEventListener("mouseup",onUp);e.preventDefault();}} style={{width:4,background:BORDER,cursor:"col-resize",flexShrink:0,zIndex:10}}/>
          <div style={{flex:1,minHeight:0,overflow:"auto",borderLeft:`1px solid ${BORDER}`}} tabIndex={-1}>
            <table style={{borderCollapse:"collapse",tableLayout:"fixed",fontSize:12,fontFamily:"'Courier New',monospace",minWidth:"100%"}}>
              <thead><tr>
                <th style={{background:HEADER_BG,width:44,minWidth:44,position:"sticky",left:0,top:0,zIndex:10,textAlign:"center",border:`1px solid ${BORDER}`,fontSize:11,color:"#888",height:28}}>
                  <span style={{fontSize:10}}>⧠</span>
                </th>
                {visibleCols.map((c,ci)=>(
                  <th key={ci} style={{background:HEADER_BG,padding:"0 4px",textAlign:"left",fontWeight:600,fontSize:11,color:"#555",border:`1px solid ${BORDER}`,position:"sticky",top:0,zIndex:10,height:28,minWidth:colW(ci),width:colW(ci)}}>
                    <span style={{color:"#bbb",fontSize:10}}>{colLetter(ci)} </span>{c.label}
                  </th>
                ))}
              </tr></thead>
              <tbody>{visibleProcessedRows.map((r,ri)=>(
                <tr key={ri}>
                  <td style={{background:"#E8EAED",textAlign:"center",color:"#888",fontSize:11,position:"sticky",left:0,border:`1px solid ${BORDER}`,padding:0,width:44,height:rowHeights[ri]||26}}>{ri+1}</td>
                  {visibleCols.map((c,ci)=>{
                    const v=evalCell(r[c.key],ri,ci);
                    return <td key={ci} onClick={e=>select(ri,ci,e.shiftKey)} style={{padding:"0 6px",border:`1px solid ${BORDER}`,fontSize:12,height:rowHeights[ri]||26,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",minWidth:colW(ci),width:colW(ci),background:isSelected(ri,ci)?SEL_BG:"inherit",cursor:"cell"}}>{String(v??"")}</td>;
                  })}
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
      </div>

      {/* ── Sheet Tabs ── */}
      <div style={{display:"flex",alignItems:"center",background:"#F0F2F4",borderTop:`1px solid ${BORDER}`,flexShrink:0,padding:"0 0 0 4px",height:30,overflowX:"auto"}}>
        <button onClick={addSheet} title="Add Sheet" style={{...tBtn,fontSize:14,padding:"0 6px",marginRight:4,background:"transparent",border:"none",color:"#555",fontWeight:700}}>+</button>
        {sheets.map(s=>{
          const tabColor=sheetColors[s.id]||null;
          return (
          <div key={s.id} style={{display:"flex",alignItems:"center",gap:0,marginRight:2,position:"relative"}}>
            <button onClick={()=>setActiveSheet(s.id)} onDoubleClick={()=>renameSheet(s.id)}
              style={{padding:"3px 12px",fontSize:11,borderTop:`1px solid ${BORDER}`,borderLeft:`1px solid ${BORDER}`,borderRight:`1px solid ${BORDER}`,borderBottom:s.id===activeSheet?`2px solid ${tabColor||"#1a73e8"}`:"1px solid transparent",background:s.id===activeSheet?"#fff":"transparent",cursor:"pointer",borderRadius:"4px 4px 0 0",fontWeight:s.id===activeSheet?600:400,color:s.id===activeSheet?(tabColor||"#1a73e8"):"#555",whiteSpace:"nowrap",paddingLeft:tabColor?20:12,position:"relative"}}>
              {tabColor&&<span style={{position:"absolute",left:6,top:"50%",transform:"translateY(-50%)",width:8,height:8,borderRadius:"50%",background:tabColor,display:"inline-block"}}/>}
              {s.name}
            </button>
            <div style={{display:"flex",flexDirection:"column",gap:0}}>
              {sheets.length>1&&<button onClick={()=>deleteSheet(s.id)} title="Delete Sheet"
                style={{...tBtn,padding:"0 3px",fontSize:9,background:"transparent",border:"none",color:"#aaa"}}>✕</button>}
              <button onClick={()=>duplicateSheet(s.id)} title="Duplicate Sheet"
                style={{...tBtn,padding:"0 3px",fontSize:9,background:"transparent",border:"none",color:"#aaa"}}>⧉</button>
            </div>
            {/* Tab color picker */}
            <input type="color" title="Tab color" value={sheetColors[s.id]||"#1a73e8"}
              onChange={e=>setSheetColors(c=>({...c,[s.id]:e.target.value}))}
              style={{width:14,height:14,border:"none",borderRadius:2,cursor:"pointer",padding:0,opacity:0.6,flexShrink:0}}/>
          </div>
          );
        })}
        <span style={{marginLeft:"auto",fontSize:10,color:"#aaa",padding:"0 8px"}}>Double-click tab to rename · ⧉ duplicate · color dot</span>
      </div>

      {/* ── Status Bar ── */}
      <div style={{display:"flex",alignItems:"center",gap:16,padding:"3px 12px",background:"#1a73e8",color:"#fff",fontSize:11,flexShrink:0,fontFamily:"monospace"}}>
        <span>{visibleProcessedRows.length}/{rows.length} rows</span>
        {Object.values(filters).some(f=>f?.size>0)&&<span style={{background:"rgba(255,255,255,0.25)",padding:"1px 6px",borderRadius:3}}>🔽 Filtered</span>}
        {sortConfig.length>0&&<span>Sorted: {sortConfig.map(s=>`${s.key} ${s.dir==="asc"?"▲":"▼"}`).join(", ")}</span>}
        {Object.keys(validErrors).length>0&&<span style={{background:"rgba(239,68,68,0.3)",padding:"1px 6px",borderRadius:3}}>⚠️ {Object.keys(validErrors).length} error(s)</span>}
        {merges.length>0&&<span>🔗 {merges.length} merge(s)</span>}
        {Object.keys(comments).length>0&&<span>💬 {Object.keys(comments).length} comment(s)</span>}
        {history.past.length>0&&<span style={{opacity:0.7}}>↩ {history.past.length}</span>}
        {statusStats&&<><span>Count: {statusStats.count}</span><span>Sum: {statusStats.sum}</span><span>Avg: {statusStats.avg}</span><span>Min: {statusStats.min}</span><span>Max: {statusStats.max}</span></>}
        <span style={{marginLeft:"auto",opacity:0.6}}>Shift+click · Ctrl+C/V · Ctrl+Z/Y · F2 · Del · Ctrl+F</span>
      </div>

      {/* ── Modals ── */}
      {modal==="findreplace"&&<FindReplaceModal rows={processedRows} cols={visibleCols} onChange={(ri,key,val)=>onChange(ri,key,val)} onClose={()=>setModal(null)}/>}
      {modal==="condfmt"&&<CondFmtModal cols={visibleCols} rules={condFmtRules} onChange={setCondFmtRules} onClose={()=>setModal(null)}/>}
      {modal==="validation"&&<DataValidationModal cols={visibleCols} validation={validation} onChange={setValidation} onClose={()=>setModal(null)}/>}
      {modal==="namedranges"&&<NamedRangeModal namedRanges={namedRanges} onChange={setNamedRanges} onClose={()=>setModal(null)}/>}
      {modal==="chart"&&<ChartModal rows={processedRows} cols={visibleCols} selection={selection} onClose={()=>setModal(null)}/>}
      {modal==="customize"&&<CustomizeTableModal cols={baseCols} hiddenCols={hiddenCols} onCols={updateSheetCols} onHidden={setHiddenCols} onClose={()=>setModal(null)}/>}

      {/* ── Context Menu ── */}
      {contextMenu&&<ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextItems} onClose={()=>setContextMenu(null)}/>}

      {/* ── Comment Popover ── */}
      {commentPopover&&<CommentPopover x={commentPopover.x} y={commentPopover.y} cellKey={commentPopover.cellKey} comment={comments[commentPopover.cellKey]||""} onChange={text=>{setComments(c=>text?{...c,[commentPopover.cellKey]:text}:(()=>{const n={...c};delete n[commentPopover.cellKey];return n;})());}} onClose={()=>setCommentPopover(null)}/>}
    </div>
  );
};

export default ExcelTable;
