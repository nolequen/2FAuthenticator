const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const END_SIGNATURE = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const DOS_DATE_1980 = 0x21;
const UTF8_FLAG = 0x0800;

function readEntries(file) {
  const zip = fs.readFileSync(file);
  const end = zip.lastIndexOf(END_SIGNATURE);
  if (end < 0) {
    throw new Error(`${file} is not a ZIP file.`);
  }
  const entries = [];
  let offset = zip.readUInt32LE(end + 16);
  for (let count = zip.readUInt16LE(end + 10); count > 0; count--) {
    const nameLength = zip.readUInt16LE(offset + 28);
    const name = zip.toString("utf8", offset + 46, offset + 46 + nameLength);
    const method = zip.readUInt16LE(offset + 10);
    const size = zip.readUInt32LE(offset + 20);
    const local = zip.readUInt32LE(offset + 42);
    offset +=
      46 +
      nameLength +
      zip.readUInt16LE(offset + 30) +
      zip.readUInt16LE(offset + 32);
    if (name.endsWith("/")) {
      continue;
    }
    const start =
      local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + size);
    if (method === 0) {
      entries.push({ name, data });
    } else if (method === 8) {
      entries.push({ name, data: zlib.inflateRawSync(data) });
    } else {
      throw new Error(`${file}: ${name} uses unsupported compression ${method}.`);
    }
  }
  return entries;
}

function readEntry(file, name) {
  const entry = readEntries(file).find((item) => item.name === name);
  if (!entry) {
    throw new Error(`${name} not found in ${file}.`);
  }
  return entry.data;
}

function extract(file, dir) {
  const root = path.resolve(dir);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  for (const { name, data } of readEntries(file)) {
    const target = path.resolve(root, name);
    if (!target.startsWith(root + path.sep)) {
      throw new Error(`${file}: ${name} points outside the folder.`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }
}

function write(file, entries) {
  const records = [];
  const directory = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const compressed = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_DATE_1980, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_DATE_1980, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    records.push(local, nameBytes, compressed);
    directory.push(central, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(
    directory.reduce((size, part) => size + part.length, 0),
    12
  );
  end.writeUInt32LE(offset, 16);
  fs.writeFileSync(file, Buffer.concat([...records, ...directory, end]));
}

module.exports = { readEntries, readEntry, extract, write };
