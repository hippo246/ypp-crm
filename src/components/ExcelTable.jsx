import { useState, useCallback, useRef, useEffect, useMemo, useReducer } from "react";

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
const applyCondFmt = (value, rules, colKey, allColValues) => {
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

// ─── Context Menu ─────────────────────────────────────────────────────────────
const ContextMenu = ({ x, y, items, onClose }) => {
  const ref=useRef(null);
  useEffect(()=>{const h=e=>{if(ref.current&&!ref.current.contains(e.target))onClose();};document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);},[]);
  return (
    <div ref={ref} style={{position:"fixed",left:x,top:y,zIndex:9999,background:"#fff",border:"1px solid #ddd",borderRadius:6,boxShadow:"0 8px 28px rgba(0,0,0,0.18)",minWidth:200,padding:"4px 0",fontSize:12}}>
      {items.map((item,i)=>item==="---"?<div key={i} style={{height:1,background:"#eee",margin:"3px 0"}}/>:(
        <div key={i} onClick={()=>{item.action?.();onClose();}}
          style={{padding:"6px 14px",cursor:item.disabled?"default":"pointer",color:item.danger?"#ef4444":item.disabled?"#aaa":"#222",display:"flex",alignItems:"center",gap:8,userSelect:"none"}}
          onMouseEnter={e=>{if(!item.disabled)e.currentTarget.style.background="#f3f4f6";}}
          onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
          <span style={{width:16,textAlign:"center"}}>{item.icon}</span>{item.label}
          {item.shortcut&&<span style={{marginLeft:"auto",color:"#aaa",fontSize:10}}>{item.shortcut}</span>}
        </div>
      ))}
    </div>
  );
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

// ─── Chart Modal (Phase 5) ────────────────────────────────────────────────────
const ChartModal = ({ rows, cols, selection, onClose }) => {
  const [chartType, setChartType] = useState("bar");
  const [labelCol, setLabelCol]   = useState(cols[0]?.key||"");
  const [valueCol, setValueCol]   = useState(cols[1]?.key||cols[0]?.key||"");

  const numericCols = cols.filter(c=>rows.some(r=>!isNaN(Number(r[c.key]))&&r[c.key]!==""));

  const chartData = useMemo(() => {
    const useRows = selection?.start && selection?.end
      ? rows.slice(Math.min(selection.start.ri, selection.end.ri), Math.max(selection.start.ri, selection.end.ri)+1)
      : rows.slice(0, 12);
    return useRows.map(r=>({ label: String(r[labelCol]??""), value: Number(r[valueCol])||0 })).filter(d=>d.label);
  }, [rows, labelCol, valueCol, selection]);

  const W=480, H=220, PAD=40, chartW=W-PAD*2, chartH=H-PAD*2;
  const maxVal = Math.max(...chartData.map(d=>d.value), 1);
  const colors = ["#1a73e8","#34a853","#fbbc04","#ea4335","#9c27b0","#00bcd4","#ff5722","#607d8b","#795548","#ff9800","#4caf50","#2196f3"];

  const renderBarChart = () => {
    const bw = Math.min(chartW / Math.max(chartData.length, 1) - 4, 50);
    return chartData.map((d, i) => {
      const bh = (d.value / maxVal) * chartH;
      const x = PAD + i * (chartW / chartData.length) + (chartW / chartData.length - bw) / 2;
      const y = PAD + chartH - bh;
      return (
        <g key={i}>
          <rect x={x} y={y} width={bw} height={bh} fill={colors[i % colors.length]} rx={3} opacity={0.85}/>
          <text x={x + bw/2} y={H - PAD + 14} textAnchor="middle" fontSize={9} fill="#555" fontFamily="monospace">{String(d.label).slice(0,8)}</text>
          <text x={x + bw/2} y={y - 3} textAnchor="middle" fontSize={9} fill="#333" fontFamily="monospace">{d.value}</text>
        </g>
      );
    });
  };

  const renderLineChart = () => {
    if (chartData.length < 2) return null;
    const pts = chartData.map((d, i) => {
      const x = PAD + (i / (chartData.length - 1)) * chartW;
      const y = PAD + chartH - (d.value / maxVal) * chartH;
      return { x, y, d };
    });
    const pathD = pts.map((p,i)=>`${i===0?"M":"L"} ${p.x} ${p.y}`).join(" ");
    return (
      <g>
        <path d={pathD} fill="none" stroke="#1a73e8" strokeWidth={2.5} strokeLinejoin="round"/>
        {pts.map((p,i)=>(
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={4} fill="#1a73e8" stroke="#fff" strokeWidth={1.5}/>
            <text x={p.x} y={p.y - 8} textAnchor="middle" fontSize={9} fill="#333" fontFamily="monospace">{p.d.value}</text>
            <text x={p.x} y={H - PAD + 14} textAnchor="middle" fontSize={9} fill="#555" fontFamily="monospace">{String(p.d.label).slice(0,8)}</text>
          </g>
        ))}
      </g>
    );
  };

  const renderPieChart = () => {
    const total = chartData.reduce((a,b)=>a+b.value, 0) || 1;
    const cx = W/2, cy = H/2 - 10, r = Math.min(chartW, chartH) / 2 - 10;
    let angle = -Math.PI / 2;
    return chartData.map((d, i) => {
      const slice = (d.value / total) * 2 * Math.PI;
      const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
      angle += slice;
      const x2 = cx + r * Math.cos(angle), y2 = cy + r * Math.sin(angle);
      const mid = angle - slice / 2;
      const mx = cx + (r * 0.65) * Math.cos(mid), my = cy + (r * 0.65) * Math.sin(mid);
      const large = slice > Math.PI ? 1 : 0;
      return (
        <g key={i}>
          <path d={`M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} Z`} fill={colors[i%colors.length]} opacity={0.85} stroke="#fff" strokeWidth={1}/>
          {slice > 0.3 && <text x={mx} y={my} textAnchor="middle" fontSize={9} fill="#fff" fontWeight="bold" fontFamily="monospace">{Math.round(d.value/total*100)}%</text>}
        </g>
      );
    });
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.35)",zIndex:9000,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:"#fff",borderRadius:10,padding:20,minWidth:560,boxShadow:"0 16px 48px rgba(0,0,0,0.22)"}}>
        <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>📊 Insert Chart</div>
        <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
          {["bar","line","pie"].map(t=><button key={t} onClick={()=>setChartType(t)} style={{...tBtn,background:chartType===t?"#1a73e8":"#e8eaed",color:chartType===t?"#fff":"#333",textTransform:"capitalize"}}>{t==="bar"?"📊 Bar":t==="line"?"📈 Line":"🥧 Pie"}</button>)}
          <span style={{fontSize:11,color:"#888",marginLeft:8}}>Labels:</span>
          <select value={labelCol} onChange={e=>setLabelCol(e.target.value)} style={{fontSize:11,padding:"3px 6px",border:"1px solid #ddd",borderRadius:4}}>{cols.map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</select>
          <span style={{fontSize:11,color:"#888"}}>Values:</span>
          <select value={valueCol} onChange={e=>setValueCol(e.target.value)} style={{fontSize:11,padding:"3px 6px",border:"1px solid #ddd",borderRadius:4}}>{numericCols.map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</select>
        </div>
        <div style={{border:"1px solid #e5e7eb",borderRadius:6,overflow:"hidden",background:"#fafafa"}}>
          <svg width={W} height={H}>
            {/* Grid lines */}
            {chartType!=="pie"&&[0,0.25,0.5,0.75,1].map((t,i)=>{
              const y=PAD+chartH*(1-t);
              return <g key={i}><line x1={PAD} y1={y} x2={W-PAD} y2={y} stroke="#e5e7eb" strokeWidth={1}/><text x={PAD-4} y={y+4} textAnchor="end" fontSize={9} fill="#999" fontFamily="monospace">{Math.round(maxVal*t)}</text></g>;
            })}
            {chartType==="bar"&&renderBarChart()}
            {chartType==="line"&&renderLineChart()}
            {chartType==="pie"&&renderPieChart()}
          </svg>
        </div>
        {/* Legend for pie */}
        {chartType==="pie"&&(
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8}}>
            {chartData.map((d,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:4,fontSize:10,fontFamily:"monospace"}}>
                <div style={{width:10,height:10,borderRadius:2,background:colors[i%colors.length]}}/>
                {String(d.label).slice(0,12)}
              </div>
            ))}
          </div>
        )}
        <div style={{display:"flex",justifyContent:"flex-end",marginTop:12}}>
          <button onClick={onClose} style={{...tBtn,background:"#1a73e8",color:"#fff"}}>Close</button>
        </div>
      </div>
    </div>
  );
};

// ─── Comment Popover ──────────────────────────────────────────────────────────
const CommentPopover = ({ x, y, cellKey, comment, onChange, onClose }) => {
  const [val, setVal] = useState(comment||"");
  const ref = useRef(null);
  useEffect(()=>{const h=e=>{if(ref.current&&!ref.current.contains(e.target))onClose();};document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);},[]);
  return (
    <div ref={ref} style={{position:"fixed",left:x,top:y,zIndex:9999,background:"#fff",border:"1px solid #ddd",borderRadius:8,boxShadow:"0 8px 28px rgba(0,0,0,0.18)",padding:10,minWidth:200}}>
      <div style={{fontSize:11,fontWeight:600,color:"#555",marginBottom:6}}>💬 Comment</div>
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
  <button onClick={onClick} style={{padding:"4px 14px",fontSize:12,border:"none",borderBottom:active?"2px solid #1a73e8":"2px solid transparent",background:"transparent",cursor:"pointer",color:active?"#1a73e8":"#444",fontWeight:active?600:400,fontFamily:"'Segoe UI',sans-serif",marginBottom:-1,transition:"color 0.15s"}}>
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
    style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minWidth:32,padding:"2px 4px",border:"1px solid transparent",borderRadius:4,background:active?"#e8f0fe":"transparent",cursor:disabled?"default":"pointer",opacity:disabled?0.4:1,fontSize:16,lineHeight:1,transition:"background 0.1s"}}
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

// ─── Main ExcelTable Component ────────────────────────────────────────────────
const ExcelTable = ({ cols: initialCols, rows: initialRows, onChange, onDelete }) => {
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
  const [sortConfig, setSortConfig]         = useState({key:null,dir:"asc"});
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
  // ── Drag-to-fill ──────────────────────────────────────────────────────────
  const [fillDrag, setFillDrag]             = useState(null); // {startRi,startCi,endRi,endCi}
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
  // validErrors keyed by "origIdx-colKey" so they survive sort/filter
  const validErrKey=(ri,ci)=>`${processedRows[ri]?.__origIdx}-${visibleCols[ci]?.key}`;

  // ── Processed rows ─────────────────────────────────────────────────────────
  const processedRows = useMemo(()=>{
    let result=rows.map((r,i)=>({...r,__origIdx:i}));
    Object.entries(filters).forEach(([key,allowed])=>{if(allowed?.size>0)result=result.filter(r=>allowed.has(String(r[key]??"")));});
    if(sortConfig.key){result=[...result].sort((a,b)=>{const av=a[sortConfig.key],bv=b[sortConfig.key],an=Number(av),bn=Number(bv);const cmp=!isNaN(an)&&!isNaN(bn)?an-bn:String(av).localeCompare(String(bv));return sortConfig.dir==="asc"?cmp:-cmp;});}
    return result;
  },[rows,filters,sortConfig]);

  const visibleCols = useMemo(()=>baseCols.filter((_,i)=>!hiddenCols.has(i)),[baseCols,hiddenCols]);

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
    setEditing(null);
    setAcSuggestions([]);
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

  const applyAutocomplete=(fn)=>{
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
      case "v":if(e.ctrlKey||e.metaKey){e.preventDefault();handlePaste(ri,ci);}break;
      case "z":if(e.ctrlKey||e.metaKey){e.preventDefault();e.shiftKey?redo():undo();}break;
      case "y":if(e.ctrlKey||e.metaKey){e.preventDefault();redo();}break;
      case "f":if(e.ctrlKey||e.metaKey){e.preventDefault();setModal("findreplace");}break;
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
    if(e.key==="Enter"){e.preventDefault();commitEdit(ri,ci);setTimeout(()=>move(ri,ci,1,0),0);}
    if(e.key==="Tab"){e.preventDefault();commitEdit(ri,ci);setTimeout(()=>move(ri,ci,0,e.shiftKey?-1:1),0);}
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
  const detectPattern = (startRi, startCi) => {
    // Look at up to 3 values above the start cell in the same column
    const colKey = visibleCols[startCi]?.key;
    const vals = [];
    for(let r = Math.max(0, startRi - 3); r <= startRi; r++) {
      const v = processedRows[r]?.[colKey];
      if(v !== "" && v !== undefined) vals.push(v);
    }
    const nums = vals.map(Number);
    if(nums.length >= 2 && nums.every(n=>!isNaN(n))) {
      const diffs = nums.slice(1).map((n,i)=>n-nums[i]);
      if(diffs.every(d=>d===diffs[0])) return { type:"arithmetic", step:diffs[0], lastVal:nums[nums.length-1] };
    }
    return { type:"repeat", val:processedRows[startRi]?.[colKey] };
  };
  const applyFillDrag = useCallback(() => {
    if (!fillDrag || !onChange) return;
    const { startRi, startCi, endRi, endCi } = fillDrag;
    if (startRi === endRi && startCi === endCi) return;
    const snapshot = [];
    if (endRi !== startRi) {
      const pat = detectPattern(startRi, startCi);
      for (let r = Math.min(startRi + 1, endRi); r <= Math.max(endRi, startRi); r++) {
        if (r >= processedRows.length) break;
        const row = processedRows[r]; const col = visibleCols[startCi];
        const steps = r - startRi;
        let val = pat.type === "arithmetic"
          ? pat.lastVal + pat.step * steps
          : pat.val;
        snapshot.push({ ri: row.__origIdx, key: col.key, val: row[col.key] });
        onChange(row.__origIdx, col.key, val);
      }
    } else {
      const srcVal = processedRows[startRi]?.[visibleCols[startCi]?.key];
      for (let c = Math.min(startCi + 1, endCi); c <= Math.max(endCi, startCi); c++) {
        if (c >= visibleCols.length) break;
        const row = processedRows[startRi]; const col = visibleCols[c];
        snapshot.push({ ri: row.__origIdx, key: col.key, val: row[col.key] });
        onChange(row.__origIdx, col.key, srcVal);
      }
    }
    if (snapshot.length) pushHistory(snapshot);
    setFillDrag(null);
  }, [fillDrag, processedRows, visibleCols, onChange, pushHistory]);

  // ── Fill drag window-level tracking ────────────────────────────────────────
  useEffect(()=>{
    if(!fillDrag)return;
    const onUp=()=>applyFillDrag();
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
  const contextItems=contextMenu?[
    {icon:"✂️",label:"Cut",shortcut:"Ctrl+X",action:()=>handleCopy()},
    {icon:"📋",label:"Copy",shortcut:"Ctrl+C",action:()=>handleCopy()},
    {icon:"📌",label:"Paste",shortcut:"Ctrl+V",action:()=>handlePaste(contextMenu.ri,contextMenu.ci)},
    "---",
    {icon:"⬆",label:"Insert Row Above",action:()=>insertRowAbove(contextMenu.ri)},
    {icon:"⬇",label:"Insert Row Below",action:()=>insertRowBelow(contextMenu.ri)},
    {icon:"🗑",label:"Delete Row",danger:true,action:()=>deleteRow(contextMenu.ri)},
    "---",
    {icon:"⬅",label:"Insert Col Left",action:()=>insertColLeft(contextMenu.ci)},
    {icon:"➡",label:"Insert Col Right",action:()=>insertColRight(contextMenu.ci)},
    {icon:"🗑",label:"Delete Column",danger:true,action:()=>deleteCol(contextMenu.ci)},
    "---",
    {icon:"🔗",label:"Merge Cells",action:mergeCells},
    {icon:"⊠",label:"Unmerge Cells",action:unmergeCells},
    {icon:"💬",label:"Add Comment",action:()=>{const row=processedRows[contextMenu.ri];const col=visibleCols[contextMenu.ci];const k=`${row?.__origIdx}-${col?.key}`;setCommentPopover({x:contextMenu.x,y:contextMenu.y,cellKey:k});}},
    "---",
    {icon:"👁",label:"Hide Column",action:()=>setHiddenCols(s=>{const n=new Set(s);n.add(contextMenu.ci);return n;})},
    {icon:"🙈",label:"Hide Row",action:()=>setHiddenRows(s=>{const n=new Set(s);n.add(contextMenu.ri);return n;})},
    {icon:"↕️",label:"Set Row Height",action:()=>{const h=prompt("Row height (px):",26);if(h)setRowHeights(rh=>({...rh,[contextMenu.ri]:Number(h)}));}},
    "---",
    {icon:"🎨",label:"Conditional Format…",action:()=>setModal("condfmt")},
    {icon:"✅",label:"Data Validation…",action:()=>setModal("validation")},
    {icon:"📌",label:"Named Ranges…",action:()=>setModal("namedranges")},
    "---",
    {icon:"⧉",label:"Duplicate Row",shortcut:"",action:()=>duplicateRow(contextMenu.ri)},
    {icon:"📌",label:pinnedRows.has(contextMenu.ri)?"Unpin Row":"Pin Row",action:()=>togglePinRow(contextMenu.ri)},
    {icon:"⊞",label:"Group Selected Rows",action:addRowGroup},
    "---",
    {icon:"↩️",label:"Undo",shortcut:"Ctrl+Z",action:undo,disabled:!history.past.length},
    {icon:"↪️",label:"Redo",shortcut:"Ctrl+Y",action:redo,disabled:!history.future.length},
    onDelete&&"---",
    onDelete&&{icon:"🗑",label:"Delete Row (Prop)",danger:true,action:()=>onDelete(processedRows[contextMenu.ri]?.__origIdx)},
  ].filter(Boolean):[];

  // ─────────────────────────────────────────────────────────────────────────
  // Ribbon tabs content
  // ─────────────────────────────────────────────────────────────────────────
  const selectedFmt = selection.start ? getFmt(selection.start.ri, selection.start.ci) : {};
  const fontSizes = [8,9,10,11,12,14,16,18,20,24,28,36];

  const renderRibbonHome = () => (
    <div style={{display:"flex",alignItems:"flex-start",gap:0,padding:"4px 8px 0",flexWrap:"wrap"}}>
      <RibbonGroup label="Clipboard">
        <IBtn icon="📋" label="Copy" onClick={handleCopy} title="Copy (Ctrl+C)"/>
        {clipboard&&<IBtn icon="📌" label="Paste" onClick={()=>{if(selection.start)handlePaste(selection.start.ri,selection.start.ci);}} title="Paste (Ctrl+V)"/>}
        <IBtn icon="↩" label="Undo" onClick={undo} disabled={!history.past.length} title="Undo (Ctrl+Z)"/>
        <IBtn icon="↪" label="Redo" onClick={redo} disabled={!history.future.length} title="Redo (Ctrl+Y)"/>
      </RibbonGroup>
      <RibbonGroup label="Font">
        <select value={selectedFmt.fontSize||12} onChange={e=>applyFmt("fontSize",Number(e.target.value))}
          style={{fontSize:11,padding:"2px 4px",border:"1px solid #ddd",borderRadius:4,height:24,cursor:"pointer"}}>
          {fontSizes.map(s=><option key={s} value={s}>{s}</option>)}
        </select>
        <IBtn icon="𝐁" label="Bold" onClick={()=>toggleFmt("bold")} active={!!selectedFmt.bold} title="Bold (Ctrl+B)"/>
        <IBtn icon="𝐼" label="Italic" onClick={()=>toggleFmt("italic")} active={!!selectedFmt.italic} title="Italic"/>
        <IBtn icon="<u>U</u>" label="Uline" onClick={()=>toggleFmt("underline")} active={!!selectedFmt.underline} title="Underline"/>
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
        <IBtn icon="⬛" label="Left" onClick={()=>applyFmt("align","left")} active={selectedFmt.align==="left"} title="Align Left"/>
        <IBtn icon="▬" label="Center" onClick={()=>applyFmt("align","center")} active={selectedFmt.align==="center"} title="Center"/>
        <IBtn icon="⬛" label="Right" onClick={()=>applyFmt("align","right")} active={selectedFmt.align==="right"} title="Align Right"/>
      </RibbonGroup>
      <RibbonGroup label="Cells">
        <IBtn icon="🔗" label="Merge" onClick={mergeCells} title="Merge Cells"/>
        <IBtn icon="⊠" label="Unmerge" onClick={unmergeCells} title="Unmerge Cells"/>
        <IBtn icon="💬" label="Comment" onClick={()=>{if(!selection.start)return;const row=processedRows[selection.start.ri];const col=visibleCols[selection.start.ci];const k=`${row?.__origIdx}-${col?.key}`;const rect=document.getElementById(cellId(selection.start.ri,selection.start.ci))?.getBoundingClientRect();setCommentPopover({x:(rect?.right||400)+4,y:rect?.top||200,cellKey:k});}} title="Add/Edit Comment"/>
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
        <IBtn icon="▲" label="A→Z" onClick={()=>{if(selection.start)setSortConfig({key:visibleCols[selection.start.ci]?.key,dir:"asc"});}} title="Sort Ascending"/>
        <IBtn icon="▼" label="Z→A" onClick={()=>{if(selection.start)setSortConfig({key:visibleCols[selection.start.ci]?.key,dir:"desc"});}} title="Sort Descending"/>
        {Object.values(filters).some(f=>f?.size>0)&&<IBtn icon="✕" label="Clear" onClick={()=>setFilters({})} title="Clear Filters"/>}
      </RibbonGroup>
      <RibbonGroup label="Validation">
        <IBtn icon="✅" label="Validate" onClick={()=>setModal("validation")} title="Data Validation"/>
      </RibbonGroup>
      <RibbonGroup label="Find">
        <IBtn icon="🔍" label="Find" onClick={()=>setModal("findreplace")} title="Find & Replace"/>
      </RibbonGroup>
      <RibbonGroup label="Cond Format">
        <IBtn icon="🎨" label="Rules" onClick={()=>setModal("condfmt")} title="Conditional Formatting"/>
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
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0,flex:1,background:"#fff",fontFamily:"'Segoe UI',system-ui,sans-serif"}}
      onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key==="a"){e.preventDefault();if(visibleProcessedRows.length&&visibleCols.length)setSelection({start:{ri:0,ci:0},end:{ri:visibleProcessedRows.length-1,ci:visibleCols.length-1}});}}}>

      {/* ── Ribbon Tabs ── */}
      <div style={{display:"flex",alignItems:"center",background:"#F8F9FA",borderBottom:`1px solid ${BORDER}`,paddingLeft:8,flexShrink:0}}>
        {["Home","Insert","Formulas","Data","View"].map(tab=>(
          <RibbonTab key={tab} label={tab} active={ribbonTab===tab} onClick={()=>setRibbonTab(tab)}/>
        ))}
        <div style={{marginLeft:"auto",padding:"0 8px",display:"flex",gap:6,alignItems:"center"}}>
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
      </div>

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
                const isFrozen=ci<frozenCols,hasFilter=filters[c.key]?.size>0,isSorted=sortConfig.key===c.key,vRule=validation[c.key];
                return (
                  <th key={ci} className="xl-filter-anchor" draggable onDragStart={()=>setColDrag(ci)} onDragOver={e=>{e.preventDefault();setColDragOver(ci);}} onDrop={handleColDragEnd} style={{background:colDragOver===ci?"#c7d2fe":HEADER_BG,padding:"0 4px",textAlign:"left",fontWeight:600,fontSize:11,color:"#555",border:showGridLines?`1px solid ${BORDER}`:"none",whiteSpace:"nowrap",position:"sticky",top:0,left:isFrozen?frozenLeft(ci):undefined,zIndex:isFrozen?30:10,userSelect:"none",height:28,minWidth:colW(ci),width:colW(ci),cursor:"grab"}}>
                    <div style={{display:"flex",alignItems:"center",gap:3,height:"100%",position:"relative"}}>
                      <span style={{color:"#bbb",fontSize:10}}>{colLetter(ci)}</span>
                      <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",cursor:"pointer"}} onClick={()=>setSortConfig(s=>({key:c.key,dir:s.key===c.key&&s.dir==="asc"?"desc":"asc"}))}>
                        {c.label}{isSorted&&<span style={{marginLeft:3,color:"#1a73e8"}}>{sortConfig.dir==="asc"?"▲":"▼"}</span>}
                      </span>
                      {vRule&&vRule.type!=="none"&&<span title="Validation active" style={{fontSize:9,color:"#16a34a"}}>✓</span>}
                      <button onClick={e=>{e.stopPropagation();setOpenFilter(k=>k===c.key?null:c.key);}}
                        style={{background:"none",border:"none",cursor:"pointer",padding:"0 2px",fontSize:10,color:hasFilter?"#1a73e8":"#bbb",lineHeight:1}}>
                        {hasFilter?"🔽":"▾"}
                      </button>
                      {openFilter===c.key&&<FilterDropdown col={c} rows={rows} activeFilter={filters[c.key]} onSort={dir=>{setSortConfig({key:c.key,dir});setOpenFilter(null);}} onFilter={allowed=>setFilters(f=>({...f,[c.key]:allowed}))} onClose={()=>setOpenFilter(null)}/>}
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
                    const condStyle=applyCondFmt(dispVal,condFmtRules,c.key,rows.map(row=>row[c.key]));
                    const stableKey=`${r.__origIdx}-${c.key}`;
                    const hasValError=validErrors[stableKey];
                    const vRule=validation[c.key];
                    const isDropdown=vRule?.type==="list"&&isEd;
                    const fmt=getFmt(ri,ci);
                    const hasComment=!!comments[stableKey];
                    const rowBg=zebra?(ri%2===0?"#fff":"#FAFAFA"):"#fff";
                    const baseBg=(!condStyle||condStyle.__databar)?undefined:condStyle?.background||(fmt.fillColor&&fmt.fillColor!=="#ffffff"?fmt.fillColor:isSel?SEL_BG:isFrozenC?FROZEN_BG:rowBg);
                    const resolvedBg=baseBg||(fmt.fillColor&&fmt.fillColor!=="#ffffff"?fmt.fillColor:isSel?SEL_BG:isFrozenC?FROZEN_BG:rowBg);
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
                          whiteSpace:"nowrap",cursor:"cell",overflow:"hidden",textOverflow:"ellipsis",
                          fontSize:fmt.fontSize||12,
                          fontFamily:"'Courier New',monospace",
                          fontWeight:condStyle?.fontWeight||(fmt.bold?"bold":"normal"),
                          fontStyle:fmt.italic?"italic":"normal",
                          textDecoration:fmt.underline?"underline":"none",
                          color:condStyle?.color||fmt.textColor||"inherit",
                          textAlign:fmt.align||"left",
                          outline:isSel?`2px solid ${SEL_COLOR}`:"none",outlineOffset:-2,
                          background:resolvedBg,
                          position:(isFrozenC||isFrozenRow)?"sticky":"relative",
                          left:isFrozenC?frozenLeft(ci):undefined,
                          zIndex:isFrozenC&&isFrozenRow?26:isFrozenC?4:isFrozenRow?21:undefined,
                          minWidth:colW(ci),width:colW(ci)
                        }}
                        onClick={e=>select(ri,ci,e.shiftKey)}
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
                            <select autoFocus value={editVal} onChange={e=>setEditVal(e.target.value)} onBlur={()=>commitEdit(ri,ci)}
                              style={{position:"absolute",inset:0,border:"none",outline:`2px solid ${SEL_COLOR}`,padding:"0 6px",fontSize:12,fontFamily:"'Courier New',monospace",background:"#fff",zIndex:10,width:"100%",boxSizing:"border-box"}}>
                              <option value="">—</option>
                              {vRule.list.split(",").map(o=><option key={o} value={o.trim()}>{o.trim()}</option>)}
                            </select>
                          ):(
                            <input autoFocus value={editVal}
                              onChange={e=>{setEditVal(e.target.value);setFormulaInput(e.target.value);updateAutocomplete(e.target.value);}}
                              onBlur={()=>{if(!acSuggestions.length)commitEdit(ri,ci);}}
                              onKeyDown={handleInputKeyDown}
                              style={{position:"absolute",inset:0,border:"none",outline:`2px solid ${SEL_COLOR}`,padding:"0 6px",fontSize:fmt.fontSize||12,fontFamily:"'Courier New',monospace",background:"#fff",zIndex:10,color:editVal.startsWith("=")?"#1a73e8":"#333",width:"100%",boxSizing:"border-box"}}/>
                          )
                        ):(
                          <>
                            <span style={{color:hasValError?"#ef4444":isFormula?"#1a73e8":"inherit",position:"relative",zIndex:1}}>
                              {hasValError&&<span title={hasValError} style={{marginRight:4}}>⚠️</span>}
                              {c.xlRender?c.xlRender(dispVal,r):String(dispVal??"")}
                            </span>
                            {condStyle?.__databar&&<div style={{position:"absolute",left:0,top:0,bottom:0,width:`${condStyle.pct}%`,background:condStyle.color,opacity:0.25,pointerEvents:"none"}}/>}
                            {/* Fill handle – bottom-right corner of selection's last cell */}
                            {isSel&&!isEd&&selection.start&&!selection.end&&selection.start.ri===ri&&selection.start.ci===ci&&(
                              <div
                                onMouseDown={e=>{e.preventDefault();e.stopPropagation();setFillDrag({startRi:ri,startCi:ci,endRi:ri,endCi:ci});}}
                                onMouseMove={e=>{if(fillDrag){setFillDrag(fd=>fd?{...fd,endRi:ri,endCi:ci}:fd);}}}
                                onMouseUp={applyFillDrag}
                                style={{position:"absolute",right:-4,bottom:-4,width:8,height:8,background:SEL_COLOR,border:"1px solid #fff",cursor:"crosshair",zIndex:20,borderRadius:1}}
                              />
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
              style={{padding:"3px 12px",fontSize:11,border:`1px solid ${BORDER}`,borderBottom:s.id===activeSheet?`2px solid ${tabColor||"#1a73e8"}`:"1px solid transparent",background:s.id===activeSheet?"#fff":"transparent",cursor:"pointer",borderRadius:"4px 4px 0 0",fontWeight:s.id===activeSheet?600:400,color:s.id===activeSheet?(tabColor||"#1a73e8"):"#555",whiteSpace:"nowrap",paddingLeft:tabColor?20:12,position:"relative"}}>
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
        {sortConfig.key&&<span>Sorted: {sortConfig.key} {sortConfig.dir==="asc"?"▲":"▼"}</span>}
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
