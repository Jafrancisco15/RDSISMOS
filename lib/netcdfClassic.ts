export type NetcdfNumericType = 1 | 3 | 4 | 5 | 6;

export interface NetcdfDimension {
  name: string;
  size: number;
}

export interface NetcdfVariable {
  name: string;
  dimensionIds: number[];
  type: NetcdfNumericType;
  valueSize: number;
  begin: number;
}

export interface NetcdfClassicHeader {
  version: 1 | 2;
  dimensions: NetcdfDimension[];
  variables: NetcdfVariable[];
}

const NC_DIMENSION = 10;
const NC_VARIABLE = 11;
const NC_ATTRIBUTE = 12;

function align4(value: number) {
  return (value + 3) & ~3;
}

class Reader {
  offset = 0;

  constructor(private readonly view: DataView) {}

  private ensure(bytes: number) {
    if (this.offset + bytes > this.view.byteLength) {
      throw new Error("Encabezado NetCDF incompleto.");
    }
  }

  u32() {
    this.ensure(4);
    const value = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return value;
  }

  u64() {
    this.ensure(8);
    const high = this.view.getUint32(this.offset, false);
    const low = this.view.getUint32(this.offset + 4, false);
    this.offset += 8;
    const value = high * 0x1_0000_0000 + low;
    if (!Number.isSafeInteger(value)) throw new Error("Offset NetCDF fuera del rango seguro de JavaScript.");
    return value;
  }

  string() {
    const length = this.u32();
    this.ensure(align4(length));
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length);
    const value = new TextDecoder().decode(bytes);
    this.offset += align4(length);
    return value;
  }

  skip(bytes: number) {
    this.ensure(bytes);
    this.offset += bytes;
  }
}

export function netcdfTypeSize(type: number) {
  if (type === 1 || type === 2) return 1;
  if (type === 3) return 2;
  if (type === 4 || type === 5) return 4;
  if (type === 6) return 8;
  throw new Error(`Tipo NetCDF ${type} no soportado.`);
}

function skipAttributes(reader: Reader) {
  const tag = reader.u32();
  const count = reader.u32();
  if (tag === 0 && count === 0) return;
  if (tag !== NC_ATTRIBUTE) throw new Error(`Lista de atributos NetCDF inválida (${tag}).`);
  for (let index = 0; index < count; index += 1) {
    reader.string();
    const type = reader.u32();
    const length = reader.u32();
    reader.skip(align4(length * netcdfTypeSize(type)));
  }
}

export function parseNetcdfClassicHeader(buffer: ArrayBuffer): NetcdfClassicHeader {
  const view = new DataView(buffer);
  if (view.byteLength < 8) throw new Error("Archivo NetCDF demasiado corto.");
  if (view.getUint8(0) !== 0x43 || view.getUint8(1) !== 0x44 || view.getUint8(2) !== 0x46) {
    throw new Error("La fuente EMC no es un archivo NetCDF clásico.");
  }
  const versionByte = view.getUint8(3);
  if (versionByte !== 1 && versionByte !== 2) {
    throw new Error(`Versión NetCDF CDF-${versionByte} no soportada.`);
  }
  const version = versionByte as 1 | 2;
  const reader = new Reader(view);
  reader.offset = 4;
  reader.u32(); // numrecs

  const dimensions: NetcdfDimension[] = [];
  const dimensionTag = reader.u32();
  const dimensionCount = reader.u32();
  if (!(dimensionTag === 0 && dimensionCount === 0)) {
    if (dimensionTag !== NC_DIMENSION) throw new Error(`Lista de dimensiones NetCDF inválida (${dimensionTag}).`);
    for (let index = 0; index < dimensionCount; index += 1) {
      dimensions.push({ name: reader.string(), size: reader.u32() });
    }
  }

  skipAttributes(reader);

  const variables: NetcdfVariable[] = [];
  const variableTag = reader.u32();
  const variableCount = reader.u32();
  if (!(variableTag === 0 && variableCount === 0)) {
    if (variableTag !== NC_VARIABLE) throw new Error(`Lista de variables NetCDF inválida (${variableTag}).`);
    for (let index = 0; index < variableCount; index += 1) {
      const name = reader.string();
      const dimensionCountForVariable = reader.u32();
      const dimensionIds = Array.from({ length: dimensionCountForVariable }, () => reader.u32());
      skipAttributes(reader);
      const type = reader.u32() as NetcdfNumericType;
      const valueSize = reader.u32();
      const begin = version === 1 ? reader.u32() : reader.u64();
      variables.push({ name, dimensionIds, type, valueSize, begin });
    }
  }

  return { version, dimensions, variables };
}

export function decodeNetcdfNumericSlice(buffer: ArrayBuffer, type: NetcdfNumericType, count: number) {
  const bytesPerValue = netcdfTypeSize(type);
  if (buffer.byteLength < count * bytesPerValue) {
    throw new Error("La sección binaria NetCDF llegó incompleta.");
  }
  const view = new DataView(buffer);
  const values = new Array<number>(count);
  for (let index = 0; index < count; index += 1) {
    const offset = index * bytesPerValue;
    if (type === 1) values[index] = view.getInt8(offset);
    else if (type === 3) values[index] = view.getInt16(offset, false);
    else if (type === 4) values[index] = view.getInt32(offset, false);
    else if (type === 5) values[index] = view.getFloat32(offset, false);
    else if (type === 6) values[index] = view.getFloat64(offset, false);
    else throw new Error(`Tipo NetCDF ${type} no soportado.`);
  }
  return values;
}
