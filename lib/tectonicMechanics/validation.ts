/** Retrospective, frozen-field association test. No operational earthquake forecast. */
export interface Window { start:string; end:string }
export interface ValidationBin { id:string; areaKm2:number; deltaCfsPa:number; calibrationCount:number; validationCount:number; controlCount:number }
export interface ValidationInput {
  calibration:Window; validation:Window; control:Window;
  sourceEventIds:string[]; sourceOriginTimes:string[];
  calibrationEventIds:string[]; validationEventIds:string[]; controlEventIds:string[];
  bins:ValidationBin[]; excludedEvents:number;
}
function interval(w:Window) {return [Date.parse(w.start),Date.parse(w.end)];}
function duration(w:Window) {const [a,b]=interval(w);return (b-a)/86400000;}
function overlap(a:Window,b:Window) {const x=interval(a),y=interval(b);return Math.max(x[0],y[0])<Math.min(x[1],y[1]);}
function pearson(x:number[],y:number[]):number|null {
  if(x.length<3)return null;const mx=x.reduce((s,v)=>s+v,0)/x.length,my=y.reduce((s,v)=>s+v,0)/y.length;
  const xx=x.reduce((s,v)=>s+(v-mx)**2,0),yy=y.reduce((s,v)=>s+(v-my)**2,0);
  return xx>0 && yy>0?x.reduce((s,v,i)=>s+(v-mx)*(y[i]-my),0)/Math.sqrt(xx*yy):null;
}
/** Equal-score samples enter together; tie-correct ROC and average precision. */
export function classificationMetrics(scores:number[],labels:boolean[],threshold:number) {
  const positives=labels.filter(Boolean).length,negatives=labels.length-positives;
  let tp=0,fp=0,tn=0,fn=0; scores.forEach((s,i)=>{if(s>=threshold){if(labels[i])tp++;else fp++;}else if(labels[i])fn++;else tn++;});
  if(!positives || !negatives)return {tp,fp,tn,fn,rocAuc:null,averagePrecision:null};
  const sorted=scores.map((s,i)=>({s,label:labels[i]})).sort((a,b)=>b.s-a.s);
  let t=0,f=0,auc=0,ap=0;
  for(let i=0;i<sorted.length;) {
    let j=i,dt=0,df=0;while(j<sorted.length && sorted[j].s===sorted[i].s){if(sorted[j].label)dt++;else df++;j++;}
    const nextT=t+dt,nextF=f+df;
    auc+=(nextF-f)/negatives*(nextT+t)/(2*positives);
    ap+=dt/positives*nextT/(nextT+nextF);
    t=nextT;f=nextF;i=j;
  }
  return {tp,fp,tn,fn,rocAuc:auc,averagePrecision:ap};
}
export function evaluateRetrospective(input:ValidationInput) {
  const warnings:string[]=[];
  for(const w of [input.calibration,input.validation,input.control])if(!interval(w).every(Number.isFinite) || duration(w)<=0)throw new Error("Ventanas temporales inválidas.");
  if(overlap(input.calibration,input.validation)||overlap(input.calibration,input.control)||overlap(input.validation,input.control))throw new Error("Calibración, validación y control deben ser disjuntos.");
  if(Date.parse(input.calibration.end)>Date.parse(input.validation.start))throw new Error("La validación debe empezar después de calibrar.");
  if(input.sourceOriginTimes.some(t=>!Number.isFinite(Date.parse(t))||Date.parse(t)>Date.parse(input.calibration.start)))throw new Error("Fuga temporal: una fuente ocurrió después de congelar el campo.");
  const sets=[input.sourceEventIds,input.calibrationEventIds,input.validationEventIds,input.controlEventIds];
  const seen=new Set<string>();for(const set of sets)for(const id of set){if(seen.has(id))throw new Error("Fuga de eventos: ID reutilizado entre fuentes y ventanas.");seen.add(id);}
  if(input.bins.some(b=>!Number.isFinite(b.deltaCfsPa)||!Number.isFinite(b.areaKm2)||b.areaKm2<=0||![b.calibrationCount,b.validationCount,b.controlCount].every(n=>Number.isInteger(n)&&n>=0)))throw new Error("Celdas de validación inválidas.");
  const bins=input.bins,calCount=bins.reduce((s,b)=>s+b.calibrationCount,0),valCount=bins.reduce((s,b)=>s+b.validationCount,0);
  if(calCount<5 || valCount<5 || bins.length<10)return {status:"insufficient constraints" as const,calibrationCount:calCount,validationCount:valCount,excludedEvents:input.excludedEvents,metrics:null,warnings:["Se requieren ≥5 eventos independientes por ventana y ≥10 celdas con ΔCFS. El entorno de la ruptura está excluido del kernel puntual."]};
  const totalArea=bins.reduce((s,b)=>s+b.areaKm2,0),calDays=duration(input.calibration),valDays=duration(input.validation);
  const baselineRate=calCount/(totalArea*calDays);
  const scaled=bins.map(b=>Math.max(-5,Math.min(5,b.deltaCfsPa/10000)));
  function weights(beta:number) {const raw=scaled.map(x=>Math.exp(beta*x));const mean=raw.reduce((s,w,i)=>s+w*bins[i].areaKm2,0)/totalArea;return raw.map(x=>x/mean);}
  // Fit only to the calibration counts. No tuning on validation/control observations.
  let beta=0,best=-Infinity;
  for(let i=-20;i<=20;i++) {
    const w=weights(i/10),ll=bins.reduce((s,b,j)=>{const lambda=baselineRate*b.areaKm2*calDays*w[j];return s+b.calibrationCount*Math.log(lambda)-lambda;},0);
    if(ll>best){best=ll;beta=i/10;}
  }
  const w=weights(beta),model=bins.map((b,i)=>baselineRate*b.areaKm2*valDays*w[i]),baseline=bins.map(b=>baselineRate*b.areaKm2*valDays);
  const logGain=bins.reduce((s,b,i)=>s+b.validationCount*Math.log(model[i]/baseline[i])-(model[i]-baseline[i]),0);
  const probs=model.map(n=>1-Math.exp(-n));
  const threshold=1-Math.exp(-baselineRate*(totalArea/bins.length)*valDays);
  if(input.excludedEvents)warnings.push(`${input.excludedEvents} eventos quedan fuera del dominio resuelto; las métricas describen solo ese dominio.`);
  warnings.push("Completeness, clustering and receiver assumptions can confound association. Control is a pre-event placebo using the same frozen spatial field. No prospective validation.");
  return {status:"retrospective-only" as const,calibrationCount:calCount,validationCount:valCount,excludedEvents:input.excludedEvents,
    metrics:{betaPer10kPa:beta,spatialLogLikelihoodGain:logGain,likelihoodGainPerEvent:Math.exp(logGain/valCount),...classificationMetrics(probs,bins.map(b=>b.validationCount>0),threshold),threshold,
      cfsSeismicityCorrelation:pearson(bins.map(b=>b.deltaCfsPa),bins.map(b=>b.validationCount/(b.areaKm2*valDays))),controlCorrelation:pearson(bins.map(b=>b.deltaCfsPa),bins.map(b=>b.controlCount/(b.areaKm2*duration(input.control)))),deformationActivityCorrelation:null},warnings};
}
