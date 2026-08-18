import {dateShift} from './analytics.js?v=7.1.0';

const DATE_KEY=/^\d{4}-\d{2}-\d{2}$/;

export function uniqueActivityDates(dates=[]){
  return [...new Set(dates.filter(date=>DATE_KEY.test(String(date))))].sort();
}

export function anchoredAnalysisRange({anchor,period='1',activityDates=[]}){
  const dates=uniqueActivityDates(activityDates).filter(date=>date<=anchor);
  if(period==='1')return {from:anchor,to:anchor,label:'1일'};
  if(period==='7')return {from:dateShift(anchor,-6),to:anchor,label:'최근 7일'};
  if(period==='30')return {from:dateShift(anchor,-29),to:anchor,label:'최근 30일'};
  if(period==='90')return {from:dateShift(anchor,-89),to:anchor,label:'최근 90일'};
  if(period==='season')return {from:`${anchor.slice(0,4)}-01-01`,to:anchor,label:`${anchor.slice(0,4)} 시즌`};
  return {from:dates[0]||anchor,to:anchor,label:'누적'};
}

export function activityDateNavigation(anchor,activityDates=[]){
  const dates=uniqueActivityDates(activityDates);
  return {
    dates,
    previous:[...dates].reverse().find(date=>date<anchor)||null,
    next:dates.find(date=>date>anchor)||null,
    hasRecord:dates.includes(anchor)
  };
}

export function activityDatesInRange(activityDates=[],range){
  return uniqueActivityDates(activityDates).filter(date=>date>=range.from&&date<=range.to);
}
