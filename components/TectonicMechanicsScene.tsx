"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Location, MaterialAssumptions, MechanicsDataset, MechanicsFrame, Vec3 } from "@/lib/tectonicMechanics/types";
import { add, ecef, enuBasis, eulerVelocity, gnssResidual, mv, planeVectors, scale, transpose } from "@/lib/tectonicMechanics/physics";
import { insideBounds, plateAt, volumeGrid } from "@/lib/tectonicMechanics/geometry";
import { acceptedTomography, observedGnssAt } from "@/lib/tectonicMechanics/adapters";

export interface MechanicsLayers {
  globe:boolean;plates:boolean;slab:boolean;faults:boolean;events:boolean;rupture:boolean;
  euler:boolean;velocity:boolean;residual:boolean;gnss:boolean;rays:boolean;
  reactions:boolean;grid:boolean;deform:boolean;insar:boolean;
}
export interface MechanicsView { mode:"region"|"globe"; exploded:boolean;depthMin:number;depthMax:number;depthScale:number;cut:boolean;cutKm:number;field:"support"|"cfs"|"stress"|"dvp"|"dvs";gain:number;motionScale:number }
interface Props { data:MechanicsDataset;frame:MechanicsFrame;params:MaterialAssumptions;layers:MechanicsLayers;view:MechanicsView;anchorId:string;plateCode:string;onInspect:(value:Record<string,unknown>)=>void }
function dispose(object:THREE.Object3D) {
  object.traverse(child=>{
    const item=child as THREE.Mesh;
    item.geometry?.dispose();
    if(item.material) for(const m of Array.isArray(item.material)?item.material:[item.material]) m.dispose();
  });
}
function clear(group:THREE.Group) { for(const child of [...group.children]) {group.remove(child);dispose(child);} }
function lines(points:THREE.Vector3[],color:string,opacity=0.65) {
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color,transparent:true,opacity,depthWrite:false}));
}
function primitive(vertices:THREE.Vector3[],indices:number[],color:string,opacity:number,wireframe=false) {
  const g=new THREE.BufferGeometry().setFromPoints(vertices);g.setIndex(indices);g.computeVertexNormals();
  return new THREE.Mesh(g,new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,transparent:true,opacity,depthWrite:false,wireframe}));
}
const cubeIndices=[0,1,2,0,2,3,4,6,5,4,7,6,0,4,5,0,5,1,1,5,6,1,6,2,2,6,7,2,7,3,3,7,4,3,4,0];
const fieldColor=(value:number,limit:number)=>new THREE.Color(value>=0?"#5ce5a6":"#69a8ff").lerp(new THREE.Color("#718297"),1-Math.min(1,Math.abs(value)/limit));

export function TectonicMechanicsScene({data,frame,params,layers,view,anchorId,plateCode,onInspect}:Props) {
  const host=useRef<HTMLDivElement>(null);
  const state=useRef<{renderer:THREE.WebGLRenderer;scene:THREE.Scene;camera:THREE.PerspectiveCamera;controls:OrbitControls;group:THREE.Group}|null>(null);
  const [error,setError]=useState("");
  useEffect(()=>{
    const element=host.current;if(!element)return;
    let renderer:THREE.WebGLRenderer;
    try { renderer=new THREE.WebGLRenderer({antialias:true,alpha:false}); } catch {setError("WebGL no disponible. El inspector numérico y la exportación siguen disponibles.");return;}
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.6));
    renderer.setClearColor("#050e1a");renderer.localClippingEnabled=true;
    renderer.domElement.setAttribute("aria-label","Volumen tectónico 3D: arrastrar para rotar, rueda para acercar, clic para inspeccionar");
    renderer.domElement.setAttribute("role","img");
    element.appendChild(renderer.domElement);
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(42,1,1,40000),group=new THREE.Group();scene.add(group);
    camera.position.set(720,720,1050);
    const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,-180,0);controls.enableDamping=true;controls.minDistance=40;controls.maxDistance=25000;
    state.current={renderer,scene,camera,controls,group};
    const resize=new ResizeObserver(()=>{const w=element.clientWidth,h=element.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();});resize.observe(element);
    let handle=0;const draw=()=>{handle=requestAnimationFrame(draw);controls.update();renderer.render(scene,camera);};draw();
    const lost=(event:Event)=>{event.preventDefault();setError("Se perdió el contexto WebGL. Vuelve a abrir esta pestaña para recuperar el visor.");};renderer.domElement.addEventListener("webglcontextlost",lost);
    return ()=>{cancelAnimationFrame(handle);resize.disconnect();controls.dispose();clear(group);renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();state.current=null;};
  },[]);
  useEffect(()=>{
    const s=state.current;if(!s)return;
    if(view.mode==="globe") {s.controls.target.set(0,-6371,0);s.camera.position.set(9000,4500,10000);}
    else {s.controls.target.set(0,-180,0);s.camera.position.set(720,720,1050);}
    s.controls.update();
  },[view.mode,data.bounds]);

  useEffect(()=>{
    const s=state.current;if(!s)return;
    clear(s.group);
    const origin={lat:(data.bounds.south+data.bounds.north)/2,lon:(data.bounds.west+data.bounds.east)/2,depth:0};
    const basis=enuBasis(origin.lat,origin.lon),center=ecef(origin);
    const depthDisplay=(d:number)=>d*view.depthScale+(view.exploded?(d>70?150:d>30?80:0):0);
    const world=(p:Location)=>{
      const v=mv(basis,add(ecef({...p,depth:depthDisplay(p.depth)}),scale(center,-1)));
      return new THREE.Vector3(v[0]/1000,v[2]/1000,-v[1]/1000);
    };
    const direction=(p:Location,v:Vec3)=>{
      const w=mv(basis,mv(transpose(enuBasis(p.lat,p.lon)),v));return new THREE.Vector3(w[0],w[2],-w[1]);
    };
    const visible=(p:Location)=>p.depth>=view.depthMin && p.depth<=view.depthMax;
    const point=(p:Location,color:string,size:number,info?:Record<string,unknown>,opacity=1)=>{
      if(!visible(p))return;
      const sphere=new THREE.Mesh(new THREE.SphereGeometry(size,8,6),new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false}));sphere.position.copy(world(p));if(info)sphere.userData.info=info;s.group.add(sphere);
    };
    const arrow=(p:Location,v:Vec3,color:string,factor:number,info:Record<string,unknown>,opacity=0.7)=>{
      if(!visible(p))return;
      const d=direction(p,v),length=d.length()*factor;
      if(length<0.01 || !Number.isFinite(length))return;
      const a=new THREE.ArrowHelper(d.normalize(),world(p),Math.min(280,length),color,Math.min(12,length*0.25),Math.min(6,length*0.15));
      a.traverse(child=>{child.userData.info=info;const m=(child as THREE.Mesh).material as THREE.Material|undefined;if(m){m.transparent=true;m.opacity=opacity;}});s.group.add(a);
    };
    // Global clipping plane in local East; all intersected primitives are cut by the GPU.
    s.renderer.clippingPlanes=view.cut?[new THREE.Plane(new THREE.Vector3(-1,0,0),view.cutKm)]:[];
    if(layers.globe) {
      const earth=new THREE.Mesh(new THREE.SphereGeometry(6371,72,40),new THREE.MeshBasicMaterial({color:"#294c67",transparent:true,opacity:0.04,depthWrite:false}));earth.position.set(0,-6371,0);s.group.add(earth);
      for(let lat=-60;lat<=60;lat+=30) s.group.add(lines(Array.from({length:145},(_,i)=>world({lat,lon:-180+i*2.5,depth:0})),"#2c4f6a",0.16));
      for(let lon=-180;lon<180;lon+=30) s.group.add(lines(Array.from({length:73},(_,i)=>world({lat:-90+i*2.5,lon,depth:0})),"#2c4f6a",0.16));
    }
    const grid=volumeGrid(data.bounds).filter(n=>n.depth===10);
    if(layers.plates) {
      const layerDepths=[0,Math.min(20,params.crustKm/2),params.crustKm,params.lithosphereKm,300,700];
      const colors=["#8fb1c6","#c19b74","#62a8b5","#8a81bb","#736791"];
      const groups=new Map<number,number[]>();
      for(const cell of grid) {
        const plate=plateAt(data.structure?.platePolygons??null,cell);if(!plate)continue;
        for(let k=0;k<layerDepths.length-1;k++) {
          const top=Math.max(view.depthMin,layerDepths[k]),bottom=Math.min(view.depthMax,layerDepths[k+1]);if(top>=bottom)continue;
          const coords=[[-.25,-.25],[.25,-.25],[.25,.25],[-.25,.25]];
          const node=frame.voxels.find(v=>v.lat===cell.lat && v.lon===cell.lon && Math.abs(v.depth-(top+bottom)/2)<80 && v.ux!==null);
          const deformation=layers.deform && node ? direction(cell,[node.ux!,node.uy!,node.uz!]).multiplyScalar(view.gain/1000) : new THREE.Vector3();
          const vertices=[top,bottom].flatMap(depth=>coords.map(([lon,lat])=>world({lat:cell.lat+lat,lon:cell.lon+lon,depth}).add(deformation)));
          const bucket=groups.get(k)??[];cubeIndices.forEach(i=>bucket.push(...vertices[i].toArray()));groups.set(k,bucket);
        }
      }
      groups.forEach((vertices,k)=>{
        const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(vertices,3));
        const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:colors[k],side:THREE.DoubleSide,transparent:true,opacity:k<3?0.075:0.025,depthWrite:false}));
        m.userData.info={layer:["Corteza superior","Corteza inferior","Manto litosférico","Astenosfera","Manto superior"][k],geometry:"Celdas curvadas de 0.5° clasificadas por GPlates. Espesores asumidos; sin CRUST1.0 ni LAB observado.",supportScore:0,resolutionScore:0,uncertainty:null};s.group.add(m);
      });
    }
    // Actual GPlates outlines remain visible even if assumed volumes are disabled.
    if(layers.plates && view.depthMin===0) for(const feature of data.structure?.platePolygons.features??[]) {
      const rings=feature.geometry?.type==="Polygon"?feature.geometry.coordinates as number[][][]:feature.geometry?.type==="MultiPolygon"?(feature.geometry.coordinates as number[][][][]).flat():[];
      for(const ring of rings) {
        let segment:THREE.Vector3[]=[];
        const flush=()=>{if(segment.length>1)s.group.add(lines(segment,"#96becd",0.7));segment=[];};
        for(const [lon,lat] of ring) {const p={lat,lon,depth:0};if(view.mode==="globe" || insideBounds(p,{west:data.bounds.west-2,east:data.bounds.east+2,south:data.bounds.south-2,north:data.bounds.north+2})) segment.push(world(p));else flush();}flush();
      }
    }
    if(layers.slab) {
      const contours=(data.structure?.slabContours??[]).filter(c=>visible({lat:0,lon:0,depth:c.depthKm}));
      for(const c of contours) {
        const line=lines(c.points.map(p=>world({lat:p.lat,lon:p.lng,depth:c.depthKm})),"#b996dc",0.55);line.userData.info={layer:"Slab2",region:c.region,depthKm:c.depthKm,geometry:"Isobata del modelo; no espesor ni esfuerzo",source:"Hayes et al. 2018 / USGS"};s.group.add(line);
      }
      // Short nearest-neighbour contour strips only. Long or unmatched gaps stay empty.
      for(const c of contours) {
        const next=contours.filter(n=>n.region===c.region && n.depthKm>c.depthKm && n.depthKm-c.depthKm<=30).sort((a,b)=>a.depthKm-b.depthKm)[0];if(!next)continue;
        for(let i=1;i<c.points.length;i++) {
          const a=world({lat:c.points[i-1].lat,lon:c.points[i-1].lng,depth:c.depthKm}),b=world({lat:c.points[i].lat,lon:c.points[i].lng,depth:c.depthKm});
          const near=next.points.map(p=>world({lat:p.lat,lon:p.lng,depth:next.depthKm})).sort((x,y)=>x.distanceTo(a)-y.distanceTo(a))[0];
          if(near && near.distanceTo(a)<130*view.depthScale && a.distanceTo(b)<100) {
            const m=primitive([a,b,near],[0,1,2],"#9276b2",0.045);m.userData.info={layer:"Slab2",geometry:"Interpolación entre isobatas separadas ≤30 km; puentes limitados espacialmente. Resolución no publicada en este producto."};s.group.add(m);
          }
        }
      }
    }
    if(layers.faults && visible({lat:0,lon:0,depth:0})) for(const f of data.faults?.features??[]) {
      const parts=f.geometry?.type==="LineString"?[f.geometry.coordinates as number[][]]:(f.geometry?.coordinates??[]) as number[][][];
      for(const part of parts) {const line=lines(part.map(([lon,lat])=>world({lat,lon,depth:0})),"#e6bb7c",0.85);line.userData.info={layer:"GEM",...f.properties};s.group.add(line);}
    }
    if(layers.events) for(const e of data.events) if(Date.parse(e.timeUtc)<=Date.parse(frame.timestamp)) point({lat:e.latitude,lon:e.longitude,depth:e.depthKm},e.externalId===anchorId?"#ffdb96":"#dfaaa0",e.externalId===anchorId?8:Math.max(2,(e.magnitude-3)*1.6),{layer:"Sismo observado",...e},0.85);
    if(layers.rupture) for(const source of data.sources.filter(src=>frame.activeSourceIds.includes(src.eventId))) {
      const g=source.ruptureGeometry;if(!g)continue;const p=source.centroid??source;
      const planes=[g,...(g.alternativePlane?[g.alternativePlane]:[])];
      planes.forEach((plane,index)=>{
        const {along,down,slip}=planeVectors(plane.strike,plane.dip,plane.rake);
        const a=direction(p,along).multiplyScalar(g.lengthKm/2),b=direction(p,down).multiplyScalar(g.widthKm/2),o=world(p);
        const corners=[o.clone().sub(a).sub(b),o.clone().add(a).sub(b),o.clone().add(a).add(b),o.clone().sub(a).add(b)];
        if(!visible(p))return;const mesh=primitive(corners,[0,1,2,0,2,3],index?"#b2a6d6":"#ffca84",index?0.14:0.6,index===1);mesh.userData.info={layer:`Plano nodal ${index+1}`,event:source.eventId,...g,...plane,centroid:source.centroid,assumptions:source.assumptions};s.group.add(mesh);
        if(!index)arrow(p,slip,"#ffca84",g.lengthKm*0.8,{layer:"Dirección de slip sobre NP1",event:source.eventId,assumption:"Plano nodal candidato, escala visual de ruptura"});
      });
    }
    if(layers.euler) for(const code of [plateCode,"NA"]) {
      const pole=data.poles.find(p=>p.plate===code);if(!pole)continue;
      for(const p of grid.filter((_,i)=>i%18===0)) {
        const plate=plateAt(data.structure?.platePolygons??null,p);if(!plate || (code==="NA"?!/north america/i.test(plate.name):!/carib|puerto/i.test(plate.name)))continue;
        const v=eulerVelocity(pole,p);arrow({...p,depth:0},v,"#eccc78",view.motionScale,{layer:"Euler · mm/año",pole,velocityENU:v});
      }
    }
    for(const station of data.velocities) if(insideBounds(station,data.bounds)) {
      const pole=data.poles.find(p=>p.plate===plateCode),residual=pole?gnssResidual(station,pole):null;
      if(layers.velocity) arrow(station,[station.eastMmYr,station.northMmYr,station.upMmYr],"#67d5ea",view.motionScale,{layer:"MIDAS observado · mm/año",...station});
      if(layers.residual && residual)arrow(station,residual,"#e698e6",view.motionScale,{layer:"Residual GNSS − Euler · mm/año",...station,residualENU:residual,plateAssignment:`Hipótesis seleccionada ${plateCode}; puede fallar en microbloques.`});
    }
    if(layers.gnss && data.gnssEventId===anchorId) for(const station of data.gnss?.stations??[]) {
      const p={lat:station.latitude,lon:station.longitude,depth:0},observation=observedGnssAt(station,frame.timestamp);
      point(p,"#6eddef",3,{layer:"Estación GNSS IGS20",code:station.code,quality:station.qualityScore,epoch:observation?.timeUtc??"Sin observación diaria en este instante"});
      if(observation)arrow(p,[observation.eastMm/1000,observation.northMm/1000,observation.upMm/1000],"#6eddef",view.gain/1000,{layer:"GNSS ENU detrended · mm",station:station.code,...observation},Math.max(.1,station.qualityScore/100));
    }
    if(layers.grid) {
      const buckets=new Map<string,{positions:number[];colors:number[];ids:Record<string,unknown>[]}>();
      for(const voxel of frame.voxels.filter(v=>!v.id.startsWith("fault:") && visible(v))) {
        let color=new THREE.Color("#748293"),opacity=.1;
        if(voxel.status==="modeled") {
          if(view.field==="cfs" && voxel.deltaCFS!==null){color=fieldColor(voxel.deltaCFS,10000);opacity=.3;}
          else if(view.field==="stress" && voxel.stressTensor){const magnitude=Math.sqrt(voxel.stressTensor.flat().reduce((sum,v)=>sum+v*v,0));color=new THREE.Color("#536478").lerp(new THREE.Color("#dbb06e"),Math.min(1,magnitude/10000));opacity=.3;}
          else if(view.field==="support"){color=new THREE.Color("#a6b8ca");opacity=.22;}
          else continue;
        } else if(view.field!=="support")continue;
        const key=String(opacity),bucket=buckets.get(key)??{positions:[],colors:[],ids:[]};
        const position=world(voxel);if(layers.deform && voxel.ux!==null)position.add(direction(voxel,[voxel.ux,voxel.uy!,voxel.uz!]).multiplyScalar(view.gain/1000));
        bucket.positions.push(...position.toArray());bucket.colors.push(...color.toArray());bucket.ids.push({layer:"Voxel mecánico · SI",...voxel});buckets.set(key,bucket);
      }
      buckets.forEach((bucket,opacity)=>{const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(bucket.positions,3));geometry.setAttribute("color",new THREE.Float32BufferAttribute(bucket.colors,3));const cloud=new THREE.Points(geometry,new THREE.PointsMaterial({size:7,sizeAttenuation:false,vertexColors:true,transparent:true,opacity:Number(opacity),depthWrite:false}));cloud.userData.items=bucket.ids;s.group.add(cloud);});
      if(view.field==="dvp" || view.field==="dvs") for(const voxel of acceptedTomography(data.phase3)) {
        const value=view.field==="dvp"?voxel.deltaVpPct:voxel.deltaVsPct;if(value===null)continue;
        point({lat:voxel.latitude,lon:voxel.longitude,depth:voxel.depthKm},value>0?"#82b8f4":"#eba486",10,{layer:"Tomografía experimental · δV %",...voxel,meaning:"Velocidad de propagación; no stress"},(voxel.resolutionScore/100)**2);
      }
    }
    if(layers.reactions) for(const v of frame.reactions.filter((v,i)=>v.id.startsWith("fault:") || i%12===0)) arrow(v,[v.dx,v.dy,v.dz],v.deltaCFS>0?"#5ce5a6":"#69a8ff",view.gain/1000,{layer:"Reaction Vector · m / Pa",...v},v.resolutionScore/100);
    if(layers.rays) for(const ray of data.rays) {
      const source=data.sources.find(e=>e.eventId===ray.eventId);if(!source)continue;
      const elapsed=(Date.parse(frame.timestamp)-Date.parse(source.originTime))/1000;
      if(elapsed<0 || elapsed>ray.travelTimeSec+30)continue;
      const reached=ray.points.filter(p=>p.travelSec<=elapsed && visible(p));
      if(reached.length>1) {const l=lines(reached.map(world),ray.phase.startsWith("P")?"#edc96b":"#a6b7ff",0.65);l.userData.info={layer:"Trayectoria dinámica transitoria",phase:ray.phase,station:ray.station,provenance:ray.provenance,amplitudePa:null};s.group.add(l);}
    }
    if(layers.insar) for(const los of data.insar) if(Date.parse(los.time)<=Date.parse(frame.timestamp))point(los,los.losM>0?"#dfb497":"#8cafce",5,{layer:"InSAR LOS · m",...los},(los.resolutionScore/100)**2);
    // A true 100 km reference segment on the spherical surface.
    if(view.mode==="region") {
      const a=world({lat:data.bounds.south,lon:origin.lon-.48,depth:0}),b=world({lat:data.bounds.south,lon:origin.lon+.48,depth:0});s.group.add(lines([a,b],"#d6e3ed",.9));
    }
    const raycaster=new THREE.Raycaster();raycaster.params.Points={threshold:14};raycaster.params.Line={threshold:4};
    let down=[0,0];const onDown=(e:PointerEvent)=>{down=[e.clientX,e.clientY];};
    const inspect=(event:PointerEvent)=>{
      if(Math.hypot(event.clientX-down[0],event.clientY-down[1])>5)return;
      const rect=s.renderer.domElement.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),s.camera);
      const hits=raycaster.intersectObjects(s.group.children,true).filter(hit=>(!view.cut || hit.point.x<=view.cutKm) && (hit.object.userData.info || hit.object.userData.items));
      const hit=hits.find(h=>h.object.userData.items || h.object.type!=="Mesh")??hits[0];
      if(hit)onInspect(hit.object.userData.items?.[hit.index??0]??hit.object.userData.info);
    };
    s.renderer.domElement.addEventListener("pointerdown",onDown);s.renderer.domElement.addEventListener("pointerup",inspect);
    return ()=>{s.renderer.domElement.removeEventListener("pointerdown",onDown);s.renderer.domElement.removeEventListener("pointerup",inspect);};
  },[data,frame,params,layers,view,anchorId,plateCode,onInspect]);
  return <div ref={host} style={{height:"100%",minHeight:520,width:"100%",position:"relative"}}>{error && <p role="alert" style={{padding:24,color:"#eebc80"}}>{error}</p>}</div>;
}
