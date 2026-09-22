(() => {
  const encoder = new TextEncoder();
  let crcTable;

  function getCrcTable() {
    if (crcTable) return crcTable;
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c >>> 0;
    }
    return crcTable;
  }

  function crc32(bytes) {
    const table = getCrcTable();
    let c = 0xffffffff;
    for (const b of bytes) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function u16(value) {
    const a = new Uint8Array(2);
    new DataView(a.buffer).setUint16(0, value, true);
    return a;
  }

  function u32(value) {
    const a = new Uint8Array(4);
    new DataView(a.buffer).setUint32(0, value >>> 0, true);
    return a;
  }

  function concat(parts) {
    const total = parts.reduce((sum, p) => sum + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) { out.set(part, offset); offset += part.length; }
    return out;
  }

  async function bytesOf(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
    if (typeof value === "string") return encoder.encode(value);
    throw new TypeError("Unsupported ZIP entry payload");
  }

  async function build(entries) {
    const locals = [];
    const centrals = [];
    let localOffset = 0;

    for (const entry of entries) {
      const name = encoder.encode(entry.name);
      const data = await bytesOf(entry.data);
      const crc = crc32(data);
      const flags = 0x0800;

      const local = concat([
        u32(0x04034b50), u16(20), u16(flags), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0),
        name, data
      ]);
      locals.push(local);

      const central = concat([
        u32(0x02014b50), u16(20), u16(20), u16(flags), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0),
        u16(0), u16(0), u32(0), u32(localOffset), name
      ]);
      centrals.push(central);
      localOffset += local.length;
    }

    const centralData = concat(centrals);
    const end = concat([
      u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
      u32(centralData.length), u32(localOffset), u16(0)
    ]);
    return new Blob([...locals, centralData, end], { type: "application/zip" });
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  window.ZipStore = { build, download, crc32 };
})();
