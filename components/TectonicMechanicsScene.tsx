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

type Pair=[number,number];
type BasemapFeature={
  type:"Feature";
  properties:{name:string;code:string|null;sovereign:string|null;label:{lon:number;lat:number}|null};
  geometry:{type:"Polygon";coordinates:Pair[][]}|{type:"MultiPolygon";coordinates:Pair[][][]};
};
type BasemapResponse={type:"FeatureCollection";features:BasemapFeature[];attribution:string;warning?:string};
type CameraPreset="top"|"oblique"|"profile"|"event"|"selection";

function dispose(object:THREE.Object3D) {
  object.traverse(child=>{
    const item=child as THREE.Mesh;
    item.geometry?.dispose();
    if(item.material) for(const m of Array.isArray(item.material)?item.material:[item.material]) {
      const withMap=m as THREE.Material & {map?:THREE.Texture|null};
      withMap.map?.dispose();
      m.dispose();
    }
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
function textSprite(text:string,color="#dfe9e3",background="rgba(5,14,26,.78)",fontPx=30) {
  const canvas=document.createElement("canvas"),ctx=canvas.getContext("2d");
  if(!ctx)return null;
  ctx.font=`600 ${fontPx}px system-ui, sans-serif`;
  const width=Math.ceil(ctx.measureText(text).width)+34,height=fontPx+26;
  canvas.width=Math.min(1024,Math.max(128,width));canvas.height=height;
  ctx.font=`600 ${fontPx}px system-ui, sans-serif`;
  ctx.fillStyle=background;ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.strokeStyle="rgba(160,190,205,.38)";ctx.strokeRect(.5,.5,canvas.width-1,canvas.height-1);
  ctx.fillStyle=color;ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(text,canvas.width/2,canvas.height/2+1);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false,depthTest:false}));
  const heightWorld=24,widthWorld=heightWorld*(canvas.width/canvas.height);sprite.scale.set(widthWorld,heightWorld,1);sprite.renderOrder=30;
  return sprite;
}
function polygons(feature:BasemapFeature) {
  return feature.geometry.type==="Polygon"?[feature.geometry.coordinates]:feature.geometry.coordinates;
}
function inBox(point:Pair,bounds:MechanicsDataset["bounds"],margin=1.5) {
  return point[0]>=bounds.west-margin && point[0]<=bounds.east+margin && point[1]>=bounds.south-margin && point[1]<=bounds.north+margin;
}
function surfaceMesh(ring:Pair[],world:(p:Location)=>THREE.Vector3) {
  if(ring.length<4 || ring.length>700)return null;
  const contour=(ring.at(-1)?.[0]===ring[0][0] && ring.at(-1)?.[1]===ring[0][1]?ring.slice(0,-1):ring).map(([lon,lat])=>new THREE.Vector2(lon,lat));
  if(contour.length<3)return null;
  try {
    const geometry=new THREE.ShapeGeometry(new THREE.Shape(contour));
    const position=geometry.getAttribute("position") as THREE.BufferAttribute;
    for(let i=0;i<position.count;i++) {
      const point=world({lon:position.getX(i),lat:position.getY(i),depth:-0.18});
      position.setXYZ(i,point.x,point.y,point.z);
    }
    position.needsUpdate=true;geometry.computeVertexNormals();
    const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:"#314b42",side:THREE.DoubleSide,transparent:true,opacity:.72,depthWrite:false}));
    mesh.renderOrder=2;return mesh;
  } catch { return null; }
}
const cubeIndices=[0,1,2,0,2,3,4,6,5,4,7,6,0,4,5,0,5,1,1,5,6,1,6,2,2,6,2,6,7,2,7,3,3,7,4,3,4,0];
const fieldColor=(value:number,limit:number)=>new THREE.Color(value>=0?"#5ce5a6":"#69a8ff").lerp(new THREE.Color("#718297"),1-Math.min(1,Math.abs(value)/limit));

export function TectonicMechanicsScene({data,frame,params,layers,view,anchorId,plateCode,onInspect}:Props) {
  const host=useRef<HTMLDivElement>(null);
  const state=useRef<{renderer:THREE.WebGLRenderer;scene:THREE.Scene;camera:THREE.PerspectiveCamera;controls:OrbitControls;group:THREE.Group}|null>(null);
  const focusPoint=useRef<THREE.Vector3|null>(null);
  const [error,setError]=useState("");
  const [basemap,setBasemap]=useState<BasemapResponse|null>(null);

  useEffect(()=>{
    const controller=new AbortController();
    const bbox=[data.bounds.west,data.bounds.south,data.bounds.east,data.bounds.north].join(",");
    fetch(`/api/tectonic-mechanics/basemap?bbox=${encodeURIComponent(bbox)}`,{signal:controller.signal,cache:"force-cache"})
      .then(async response=>{const body=await response.json() as BasemapResponse & {error?:string};if(!response.ok)throw new Error(body.error??`HTTP ${response.status}`);return body;})
      .then(setBasemap)
      .catch(reason=>{if(!controller.signal.aborted)setBasemap({type:"FeatureCollection",features:[],attribution:"Natural Earth 1:50m",warning:String(reason)});});
    return()=>controller.abort();
  },[data.bounds.east,data.bounds.north,data.bounds.south,data.bounds.west]);

  useEffect(()=>{
    const element=host.current;if(!element)return;
    let renderer:THREE.WebGLRenderer;
    try { renderer=new THREE.WebGLRenderer({antialias:true,alpha:false}); } catch {setError("WebGL no disponible. El inspector numérico y la exportación siguen disponibles.");return;}
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.6));
    renderer.setClearColor("#04111d");renderer.localClippingEnabled=true;
    renderer.domElement.setAttribute("aria-label","Mapa tectónico mecánico 3D: arrastrar para rotar, rueda para acercar, clic para inspeccionar");
    renderer.domElement.setAttribute("role","img");renderer.domElement.style.display="block";
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

  const worldFor=(p:Location)=>{
    const origin={lat:(data.bounds.south+data.bounds.north)/2,lon:(data.bounds.west+data.bounds.east)/2,depth:0};
    const basis=enuBasis(origin.lat,origin.lon),center=ecef(origin);
    const depthDisplay=(d:number)=>d*view.depthScale+(view.exploded?(d>70?150:d>30?80:0):0);
    const v=mv(basis,add(ecef({...p,depth:depthDisplay(p.depth)}),scale(center,-1)));
    return new THREE.Vector3(v[0]/1000,v[2]/1000,-v[1]/1000);
  };
  const cameraDistance=()=>{
    const lat=(data.bounds.south+data.bounds.north)/2*Math.PI/180;
    const span=Math.max((data.bounds.north-data.bounds.south)*111.2,(data.bounds.east-data.bounds.west)*111.2*Math.max(.25,Math.cos(lat)));
    return Math.max(520,Math.min(2100,span*1.55));
  };
  const setCameraPreset=(preset:CameraPreset)=>{
    const s=state.current;if(!s)return;
    let target=new THREE.Vector3(0,-Math.min(180,view.depthMax*.22),0);
    if(preset==="selection" && focusPoint.current)target=focusPoint.current.clone();
    if(preset==="event") {
      const anchor=data.events.find(event=>event.externalId===anchorId);if(anchor)target=worldFor({lat:anchor.latitude,lon:anchor.longitude,depth:anchor.depthKm});
    }
    const d=cameraDistance();s.camera.up.set(0,1,0);
    if(preset==="top") {s.camera.up.set(0,0,-1);s.camera.position.set(target.x,target.y+d,target.z+.01);}
    else if(preset==="profile") s.camera.position.set(target.x+d,target.y+40,target.z);
    else if(preset==="event" || preset==="selection") s.camera.position.set(target.x+d*.62,target.y+d*.55,target.z+d*.72);
    else s.camera.position.set(target.x+d*.62,target.y+d*.58,target.z+d*.75);
    s.controls.target.copy(target);s.camera.lookAt(target);s.controls.update();
  };

  useEffect(()=>{
    const s=state.current;if(!s)return;
    if(view.mode==="globe") {s.controls.target.set(0,-6371,0);s.camera.position.set(9000,4500,10000);s.camera.up.set(0,1,0);}
    else {const d=cameraDistance();s.controls.target.set(0,-Math.min(180,view.depthMax*.22),0);s.camera.position.set(d*.62,d*.58,d*.75);s.camera.up.set(0,1,0);}
    s.controls.update();
  // cameraDistance is deterministic from current bounds.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[view.mode,data.bounds.east,data.bounds.north,data.bounds.south,data.bounds.west]);

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
    const addLabel=(text:string,p:Location,color="#e5eee8",scaleFactor=1)=>{
      const sprite=textSprite(text,color);if(!sprite)return;sprite.position.copy(world(p));sprite.position.y+=8;sprite.scale.multiplyScalar(scaleFactor);s.group.add(sprite);
    };
    // Global clipping plane in local East; all intersected primitives are cut by the GPU.
    s.renderer.clippingPlanes=view.cut?[new THREE.Plane(new THREE.Vector3(-1,0,0),view.cutKm)]:[];

    if(layers.globe) {
      const earth=new THREE.Mesh(new THREE.SphereGeometry(6371,96,56),new THREE.MeshBasicMaterial({color:"#0b3550",transparent:true,opacity:view.mode==="globe"?.13:.08,depthWrite:false}));earth.position.set(0,-6371,0);s.group.add(earth);
      if(view.mode==="globe") {
        for(let lat=-60;lat<=60;lat+=30) s.group.add(lines(Array.from({length:145},(_,i)=>world({lat,lon:-180+i*2.5,depth:0})),"#31556e",0.22));
        for(let lon=-180;lon<180;lon+=30) s.group.add(lines(Array.from({length:73},(_,i)=>world({lat:-90+i*2.5,lon,depth:0})),"#31556e",0.22));
      } else if(view.depthMin===0) {
        // A curved reference surface makes the regional scene readable before mechanical overlays are interpreted.
        for(let lat=Math.floor(data.bounds.south);lat<=Math.ceil(data.bounds.north);lat+=1) {
          s.group.add(lines(Array.from({length:Math.ceil((data.bounds.east-data.bounds.west)*5)+1},(_,i)=>world({lat,lon:data.bounds.west+i*.2,depth:.08})),"#2a596d",.27));
          addLabel(`${lat}°N`,{lat,lon:data.bounds.west+.08,depth:-.3},"#7898a8",.64);
        }
        for(let lon=Math.floor(data.bounds.west);lon<=Math.ceil(data.bounds.east);lon+=1) {
          s.group.add(lines(Array.from({length:Math.ceil((data.bounds.north-data.bounds.south)*5)+1},(_,i)=>world({lat:data.bounds.south+i*.2,lon,depth:.08})),"#2a596d",.27));
          addLabel(`${Math.abs(lon)}°${lon<0?"W":"E"}`,{lat:data.bounds.south+.08,lon,depth:-.3},"#7898a8",.64);
        }
      }

      if(view.depthMin===0 && basemap) for(const feature of basemap.features) {
        for(const polygon of polygons(feature)) {
          const outer=polygon[0]??[];
          const fillable=outer.length>=4 && outer.every(point=>inBox(point,data.bounds,2.2));
          if(fillable) {
            const mesh=surfaceMesh(outer,world);if(mesh){mesh.userData.info={layer:"Base geográfica Natural Earth",name:feature.properties.name,code:feature.properties.code,meaning:"Referencia cartográfica; no entra en el modelo mecánico."};s.group.add(mesh);}
          }
          for(const ring of polygon) {
            let segment:THREE.Vector3[]=[];
            const flush=()=>{if(segment.length>1){const coast=lines(segment,"#d5d8c4",.72);coast.userData.info={layer:"Costa / límite político",name:feature.properties.name,source:"Natural Earth 1:50m"};s.group.add(coast);}segment=[];};
            for(const pair of ring) {if(inBox(pair,data.bounds,1.7))segment.push(world({lon:pair[0],lat:pair[1],depth:-.28}));else flush();}flush();
          }
        }
        const label=feature.properties.label;
        if(label && inBox([label.lon,label.lat],data.bounds,.5)) addLabel(feature.properties.name,{lat:label.lat,lon:label.lon,depth:-.7},"#eff3dc",.9);
      }

      if(view.mode==="region" && view.depthMin===0) {
        const corner={lat:data.bounds.north-.28,lon:data.bounds.west+.3,depth:-.8};
        const o=world(corner),east=world({...corner,lon:corner.lon+.45}),north=world({...corner,lat:corner.lat+.45});
        const eastArrow=new THREE.ArrowHelper(east.clone().sub(o).normalize(),o,45,"#6fd5f2",10,5);const northArrow=new THREE.ArrowHelper(north.clone().sub(o).normalize(),o,45,"#f4d27c",10,5);s.group.add(eastArrow,northArrow);
        addLabel("E",{...corner,lon:corner.lon+.48},"#6fd5f2",.62);addLabel("N",{...corner,lat:corner.lat+.48},"#f4d27c",.62);
      }
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
        const flush=()=>{if(segment.length>1)s.group.add(lines(segment,"#96becd",0.76));segment=[];};
        for(const [lon,lat] of ring) {const p={lat,lon,depth:-.45};if(view.mode==="globe" || insideBounds(p,{west:data.bounds.west-2,east:data.bounds.east+2,south:data.bounds.south-2,north:data.bounds.north+2})) segment.push(world(p));else flush();}flush();
      }
    }
    if(layers.slab) {
      const contours=(data.structure?.slabContours??[]).filter(c=>visible({lat:0,lon:0,depth:c.depthKm}));
      for(const c of contours) {
        const line=lines(c.points.map(p=>world({lat:p.lat,lon:p.lng,depth:c.depthKm})),"#b996dc",0.62);line.userData.info={layer:"Slab2",region:c.region,depthKm:c.depthKm,geometry:"Isobata del modelo; no espesor ni esfuerzo",source:"Hayes et al. 2018 / USGS"};s.group.add(line);
      }
      // Short nearest-neighbour contour strips only. Long or unmatched gaps stay empty.
      for(const c of contours) {
        const next=contours.filter(n=>n.region===c.region && n.depthKm>c.depthKm && n.depthKm-c.depthKm<=30).sort((a,b)=>a.depthKm-b.depthKm)[0];if(!next)continue;
        for(let i=1;i<c.points.length;i++) {
          const a=world({lat:c.points[i-1].lat,lon:c.points[i-1].lng,depth:c.depthKm}),b=world({lat:c.points[i].lat,lon:c.points[i].lng,depth:c.depthKm});
          const near=next.points.map(p=>world({lat:p.lat,lon:p.lng,depth:next.depthKm})).sort((x,y)=>x.distanceTo(a)-y.distanceTo(a))[0];
          if(near && near.distanceTo(a)<130*view.depthScale && a.distanceTo(b)<100) {
            const m=primitive([a,b,near],[0,1,2],"#9276b2",0.055);m.userData.info={layer:"Slab2",geometry:"Interpolación entre isobatas separadas ≤30 km; puentes limitados espacialmente. Resolución no publicada en este producto."};s.group.add(m);
          }
        }
      }
    }
    if(layers.faults && visible({lat:0,lon:0,depth:0})) for(const f of data.faults?.features??[]) {
      const parts=f.geometry?.type==="LineString"?[f.geometry.coordinates as number[][]]:(f.geometry?.coordinates??[]) as number[][][];
      for(const part of parts) {
        const line=lines(part.map(([lon,lat])=>world({lat,lon,depth:-.6})),"#f2b46e",.96);
        const middle=part[Math.floor(part.length/2)];
        line.userData.info={layer:"Falla activa GEM",...f.properties,...(middle?{lat:middle[1],lon:middle[0],depth:0}:{}),meaning:"Traza superficial; no implica que toda la falla esté cargada uniformemente."};s.group.add(line);
      }
    }
    if(layers.events) for(const e of data.events) if(Date.parse(e.timeUtc)<=Date.parse(frame.timestamp)) {
      point({lat:e.latitude,lon:e.longitude,depth:e.depthKm},e.externalId===anchorId?"#ffdb96":"#dfaaa0",e.externalId===anchorId?8:Math.max(2,(e.magnitude-3)*1.6),{layer:"Sismo observado",...e},0.85);
      if(e.externalId===anchorId && view.mode==="region") addLabel(`M${e.magnitude.toFixed(1)} · ${e.place}`,{lat:e.latitude,lon:e.longitude,depth:Math.max(0,e.depthKm-7)},"#ffdfa6",.82);
    }
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
    if(view.mode==="region" && view.depthMin===0) {
      const lat=origin.lat,halfLon=.45/Math.max(.3,Math.cos(lat*Math.PI/180));
      const a=world({lat:data.bounds.south+.18,lon:origin.lon-halfLon,depth:-.8}),b=world({lat:data.bounds.south+.18,lon:origin.lon+halfLon,depth:-.8});s.group.add(lines([a,b],"#edf4f8",.95));
      addLabel("≈100 km",{lat:data.bounds.south+.28,lon:origin.lon,depth:-1},"#edf4f8",.62);
    }

    const raycaster=new THREE.Raycaster();raycaster.params.Points={threshold:14};raycaster.params.Line={threshold:4};
    let down=[0,0];const onDown=(e:PointerEvent)=>{down=[e.clientX,e.clientY];};
    const inspect=(event:PointerEvent)=>{
      if(Math.hypot(event.clientX-down[0],event.clientY-down[1])>5)return;
      const rect=s.renderer.domElement.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),s.camera);
      const hits=raycaster.intersectObjects(s.group.children,true).filter(hit=>(!view.cut || hit.point.x<=view.cutKm) && (hit.object.userData.info || hit.object.userData.items));
      const hit=hits.find(h=>h.object.userData.items || h.object.type!=="Mesh")??hits[0];
      if(hit){focusPoint.current=hit.point.clone();onInspect(hit.object.userData.items?.[hit.index??0]??hit.object.userData.info);}
    };
    s.renderer.domElement.addEventListener("pointerdown",onDown);s.renderer.domElement.addEventListener("pointerup",inspect);
    return ()=>{s.renderer.domElement.removeEventListener("pointerdown",onDown);s.renderer.domElement.removeEventListener("pointerup",inspect);};
  },[data,frame,params,layers,view,anchorId,plateCode,onInspect,basemap]);

  const buttonStyle:React.CSSProperties={background:"rgba(8,24,39,.9)",border:"1px solid rgba(135,174,195,.45)",color:"#dce9ef",borderRadius:6,padding:"6px 8px",fontSize:11,cursor:"pointer"};
  return <div ref={host} style={{height:"100%",minHeight:520,width:"100%",position:"relative",overflow:"hidden"}}>
    <div style={{position:"absolute",zIndex:5,top:10,right:10,display:"flex",flexWrap:"wrap",justifyContent:"flex-end",gap:5,maxWidth:"70%",pointerEvents:"auto"}} aria-label="Vistas rápidas del mapa mecánico">
      <button type="button" style={buttonStyle} onClick={()=>setCameraPreset("top")}>Vista superior</button>
      <button type="button" style={buttonStyle} onClick={()=>setCameraPreset("oblique")}>Oblicua</button>
      <button type="button" style={buttonStyle} onClick={()=>setCameraPreset("profile")}>Perfil E–O</button>
      <button type="button" style={buttonStyle} onClick={()=>setCameraPreset("event")}>Centrar evento</button>
      <button type="button" style={buttonStyle} disabled={!focusPoint.current} onClick={()=>setCameraPreset("selection")}>Centrar selección</button>
    </div>
    <div style={{position:"absolute",zIndex:4,left:10,bottom:10,background:"rgba(4,17,29,.82)",border:"1px solid rgba(105,145,166,.28)",borderRadius:6,padding:"6px 8px",fontSize:10,color:"#92aaba",pointerEvents:"none"}}>
      {basemap?.features.length?`Base geográfica: Natural Earth 1:50m · ${basemap.features.length} unidades visibles`:"Base geográfica no disponible"}<br/>
      Costa/país = referencia · GEM = falla · Slab2 = profundidad · color mecánico = estado modelado
    </div>
    {error && <p role="alert" style={{position:"absolute",zIndex:6,left:20,top:60,padding:12,color:"#eebc80",background:"#20160fdd"}}>{error}</p>}
    {basemap?.warning && <p style={{position:"absolute",zIndex:4,left:10,top:10,maxWidth:360,padding:"7px 9px",color:"#d6b77e",background:"rgba(44,31,14,.82)",fontSize:10}}>Base geográfica degradada: {basemap.warning}</p>}
  </div>;
}
