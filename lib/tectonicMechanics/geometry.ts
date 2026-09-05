import type { GeoFeatureCollection } from "../plateDynamics";
import type { Location, MechanicsDataset } from "./types";

export function insideBounds(point: Location, bounds: MechanicsDataset["bounds"]) {
  const longitude = bounds.west<=bounds.east ? point.lon>=bounds.west && point.lon<=bounds.east : point.lon>=bounds.west || point.lon<=bounds.east;
  return longitude && point.lat>=bounds.south && point.lat<=bounds.north;
}
function insideRing(lat:number,lon:number,ring:number[][]) {
  let inside=false;
  const unwrap=(x:number)=>lon+((x-lon+540)%360)-180;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const xi=unwrap(ring[i][0]),xj=unwrap(ring[j][0]),yi=ring[i][1],yj=ring[j][1];
    if(Math.abs(xi-xj)>180) continue;
    if((yi>lat)!==(yj>lat) && lon<(xj-xi)*(lat-yi)/(yj-yi)+xi) inside=!inside;
  }
  return inside;
}
export function plateAt(plates:GeoFeatureCollection | null,point:Location) {
  for(const f of plates?.features??[]) {
    const polygons=f.geometry?.type==="Polygon"?[f.geometry.coordinates as number[][][]]:f.geometry?.type==="MultiPolygon"?f.geometry.coordinates as number[][][][]:[];
    if(polygons.some(rings=>rings.length && insideRing(point.lat,point.lon,rings[0]) && !rings.slice(1).some(r=>insideRing(point.lat,point.lon,r)))) {
      return {id:String(f.properties.PLATEID1??f.properties.plateId??f.properties.plate_id??f.id??"unknown"),name:String(f.properties.plateName??f.properties.NAME??f.properties.name??"Placa")};
    }
  }
  return null;
}
/** Cell membership is a rasterized GPlates topology, not a measured thickness. */
export function volumeGrid(bounds:MechanicsDataset["bounds"],step=0.5) {
  const nodes:Array<Location & {id:string}>=[];
  const east=bounds.east<bounds.west?bounds.east+360:bounds.east;
  for(let lat=bounds.south+step/2;lat<bounds.north;lat+=step) for(let lng=bounds.west+step/2;lng<east;lng+=step) for(const depth of [10,30,55,110,225,410,600]) {
    const lon=((lng+540)%360)-180;
    nodes.push({id:`${lat.toFixed(3)}:${lon.toFixed(3)}:${depth}`,lat,lon,depth});
  }
  return nodes;
}
