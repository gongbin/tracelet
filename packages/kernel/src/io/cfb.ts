/**
 * 最小 OLE2 / CFB（Compound File Binary）读取器：Altium 的 .PcbDoc / .SchDoc 都是这种容器。
 * 只实现读取：头部、DIFAT/FAT、目录树、mini stream。纯 Uint8Array，浏览器与 Node 通用。
 */
export interface CfbEntry { name: string; path: string; type: 'storage' | 'stream' | 'root'; size: number; start: number; children: CfbEntry[] }

const MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ENDOFCHAIN = 0xfffffffe, FREESECT = 0xffffffff;

export class CfbFile {
  private view: DataView;
  private sectorSize: number;
  private miniSectorSize: number;
  private fat: Uint32Array;
  private miniFat: Uint32Array;
  private miniStream: Uint8Array;
  private miniCutoff: number;
  readonly root: CfbEntry;
  private streams = new Map<string, CfbEntry>();

  constructor(private data: Uint8Array) {
    if (data.length < 512 || MAGIC.some((b, i) => data[i] !== b)) throw new Error('不是 OLE 复合文档（Altium .PcbDoc / .SchDoc 应为此格式）');
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const sectorShift = this.view.getUint16(0x1e, true), miniShift = this.view.getUint16(0x20, true);
    this.sectorSize = 1 << sectorShift; this.miniSectorSize = 1 << miniShift;
    const fatCount = this.view.getUint32(0x2c, true);
    const dirStart = this.view.getUint32(0x30, true);
    this.miniCutoff = this.view.getUint32(0x38, true);
    const miniFatStart = this.view.getUint32(0x3c, true), miniFatCount = this.view.getUint32(0x40, true);
    const difatStart = this.view.getUint32(0x44, true), difatCount = this.view.getUint32(0x48, true);
    // DIFAT：前 109 个在头部，其余链在 DIFAT 扇区里
    const fatSectors: number[] = [];
    for (let i = 0; i < 109 && fatSectors.length < fatCount; i++) { const s = this.view.getUint32(0x4c + i * 4, true); if (s !== FREESECT) fatSectors.push(s); }
    let ds = difatStart;
    for (let k = 0; k < difatCount && ds !== ENDOFCHAIN && ds !== FREESECT; k++) {
      const off = this.sectorOffset(ds);
      const per = this.sectorSize / 4 - 1;
      for (let i = 0; i < per && fatSectors.length < fatCount; i++) { const s = this.view.getUint32(off + i * 4, true); if (s !== FREESECT) fatSectors.push(s); }
      ds = this.view.getUint32(off + per * 4, true);
    }
    const entriesPerSector = this.sectorSize / 4;
    this.fat = new Uint32Array(fatSectors.length * entriesPerSector);
    fatSectors.forEach((s, i) => { const off = this.sectorOffset(s); for (let j = 0; j < entriesPerSector; j++) this.fat[i * entriesPerSector + j] = this.view.getUint32(off + j * 4, true); });
    // 目录
    const dirBytes = this.readChain(dirStart);
    const entries: (CfbEntry & { left: number; right: number; child: number })[] = [];
    for (let off = 0; off + 128 <= dirBytes.length; off += 128) {
      const dv = new DataView(dirBytes.buffer, dirBytes.byteOffset + off, 128);
      const nameLen = dv.getUint16(0x40, true);
      let name = '';
      for (let i = 0; i + 1 < nameLen; i += 2) { const c = dv.getUint16(i, true); if (c) name += String.fromCharCode(c); }
      const t = dv.getUint8(0x42);
      const type = t === 5 ? 'root' : t === 1 ? 'storage' : 'stream';
      entries.push({ name, path: '', type, size: dv.getUint32(0x78, true), start: dv.getUint32(0x74, true), children: [], left: dv.getInt32(0x44, true), right: dv.getInt32(0x48, true), child: dv.getInt32(0x4c, true) });
    }
    // mini stream 放在根目录项的链上
    this.miniFat = miniFatCount ? this.chainToArray(this.readChain(miniFatStart)) : new Uint32Array(0);
    this.miniStream = entries.length ? this.readChain(entries[0].start, entries[0].size) : new Uint8Array(0);
    const build = (idx: number, parentPath: string, into: CfbEntry[], depth: number) => {
      if (idx < 0 || idx >= entries.length || depth > 4096) return;
      const e = entries[idx];
      build(e.left, parentPath, into, depth + 1);
      e.path = parentPath ? `${parentPath}/${e.name}` : e.name;
      into.push(e);
      if (e.type === 'stream') this.streams.set(e.path, e);
      if (e.child >= 0) build(e.child, e.path, e.children, depth + 1);
      build(e.right, parentPath, into, depth + 1);
    };
    const rootEntry = entries[0];
    rootEntry.path = '';
    this.root = rootEntry;
    if (rootEntry.child >= 0) build(rootEntry.child, '', rootEntry.children, 0);
  }

  private sectorOffset(sector: number): number { return (sector + 1) * this.sectorSize; }
  private chainToArray(bytes: Uint8Array): Uint32Array { const out = new Uint32Array(bytes.length / 4); const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); for (let i = 0; i < out.length; i++) out[i] = dv.getUint32(i * 4, true); return out; }

  private readChain(start: number, size = Infinity): Uint8Array {
    const chunks: Uint8Array[] = []; let total = 0; let s = start; let guard = 0;
    while (s !== ENDOFCHAIN && s !== FREESECT && s < this.fat.length && total < size && guard++ < 1e7) {
      const off = this.sectorOffset(s);
      chunks.push(this.data.subarray(off, Math.min(off + this.sectorSize, this.data.length)));
      total += this.sectorSize; s = this.fat[s];
    }
    const out = new Uint8Array(Math.min(total, size === Infinity ? total : size)); let p = 0;
    for (const c of chunks) { const n = Math.min(c.length, out.length - p); out.set(c.subarray(0, n), p); p += n; if (p >= out.length) break; }
    return out;
  }

  private readMiniChain(start: number, size: number): Uint8Array {
    const out = new Uint8Array(size); let p = 0; let s = start; let guard = 0;
    while (s !== ENDOFCHAIN && s !== FREESECT && p < size && s < this.miniFat.length && guard++ < 1e7) {
      const off = s * this.miniSectorSize; const n = Math.min(this.miniSectorSize, size - p);
      out.set(this.miniStream.subarray(off, off + n), p); p += n; s = this.miniFat[s];
    }
    return out;
  }

  /** 列出全部流路径（如 "Board6/Data"）。 */
  list(): string[] { return [...this.streams.keys()]; }
  has(path: string): boolean { return this.streams.has(path); }
  /** 读取一个流；不存在返回 null。 */
  read(path: string): Uint8Array | null {
    const e = this.streams.get(path); if (!e) return null;
    if (e.size === 0) return new Uint8Array(0);
    return e.size < this.miniCutoff ? this.readMiniChain(e.start, e.size) : this.readChain(e.start, e.size);
  }
}
