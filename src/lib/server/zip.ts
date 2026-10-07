import zlib from 'node:zlib';

/**
 * Minimal ZIP support for project bundles, using only Node built-ins.
 *
 * Writer: stored/deflated entries, UTF-8 names, no ZIP64 (bundles are limited well below 4 GB).
 * Reader: strict and defensive – it is fed untrusted uploads. It rejects absolute paths, `..`,
 * backslashes, drive letters, duplicate names, symlinks and other non-regular entries, encrypted
 * entries, unknown compression methods and multi-disk archives; it verifies CRC-32 and enforces
 * per-entry and total size limits plus a compression-ratio guard against zip bombs.
 */

export class ZipError extends Error {}

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const UTF8_FLAG = 0x0800;

export const ZIP_LIMITS = {
	entries: 65_000,
	/** Uncompressed size of one entry. */
	entryBytes: 50 * 1024 * 1024,
	/** Uncompressed total. */
	totalBytes: 1024 * 1024 * 1024,
	/** Maximum compression ratio (zip bomb guard) for entries above 1 MB. */
	ratio: 200
};

function dosTime(d: Date) {
	return {
		time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
		date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
	};
}

/**
 * Streaming ZIP writer: call `add()` for each entry (sequentially), then `finish()`. Each call
 * returns the bytes to send, so large bundles are never held in memory as a whole.
 */
export class ZipWriter {
	private offset = 0;
	private central: Buffer[] = [];
	private names = new Set<string>();
	private readonly when = dosTime(new Date());

	add(name: string, data: Buffer, compress = true): Buffer {
		if (this.names.has(name)) throw new ZipError(`Duplicate entry ${name}`);
		this.names.add(name);
		if (this.names.size > ZIP_LIMITS.entries) throw new ZipError('Too many entries');
		const nameBuf = Buffer.from(name, 'utf8');
		const crc = zlib.crc32(data);
		const deflated = compress ? zlib.deflateRawSync(data, { level: 6 }) : null;
		const useDeflate = !!deflated && deflated.length < data.length;
		const body = useDeflate ? deflated! : data;
		if (this.offset + body.length > 0xffffffff - 1024)
			throw new ZipError('The bundle is too large (over 4 GB)');
		const local = Buffer.alloc(30);
		local.writeUInt32LE(LOCAL, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(UTF8_FLAG, 6);
		local.writeUInt16LE(useDeflate ? 8 : 0, 8);
		local.writeUInt16LE(this.when.time, 10);
		local.writeUInt16LE(this.when.date, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(body.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBuf.length, 26);
		local.writeUInt16LE(0, 28);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(CENTRAL, 0);
		central.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix, v2.0
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(UTF8_FLAG, 8);
		central.writeUInt16LE(useDeflate ? 8 : 0, 10);
		central.writeUInt16LE(this.when.time, 12);
		central.writeUInt16LE(this.when.date, 14);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(body.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(nameBuf.length, 28);
		central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // regular file, rw-r--r--
		central.writeUInt32LE(this.offset, 42);
		this.central.push(central, nameBuf);

		const out = Buffer.concat([local, nameBuf, body]);
		this.offset += out.length;
		return out;
	}

	finish(): Buffer {
		const dir = Buffer.concat(this.central);
		const end = Buffer.alloc(22);
		end.writeUInt32LE(END, 0);
		end.writeUInt16LE(this.names.size, 8);
		end.writeUInt16LE(this.names.size, 10);
		end.writeUInt32LE(dir.length, 12);
		end.writeUInt32LE(this.offset, 16);
		return Buffer.concat([dir, end]);
	}
}

/** Builds a whole ZIP in memory (tests and small bundles). */
export function zipBuffer(entries: { name: string; data: Buffer }[]) {
	const w = new ZipWriter();
	return Buffer.concat([...entries.map((e) => w.add(e.name, e.data)), w.finish()]);
}

export interface ZipEntry {
	name: string;
	size: number;
	compressedSize: number;
	method: number;
	crc: number;
	offset: number;
}

/** Validates an entry name: relative, no traversal, no backslashes or drive letters. */
export function safeZipName(name: string) {
	if (
		!name ||
		name.startsWith('/') ||
		name.includes('\\') ||
		/^[a-zA-Z]:/.test(name) ||
		name.split('/').some((p) => p === '..' || p === '.') ||
		// eslint-disable-next-line no-control-regex
		/[\u0000-\u001f]/.test(name)
	)
		throw new ZipError(`Unsafe path in bundle: ${JSON.stringify(name.slice(0, 120))}`);
	return name;
}

/** Reads the central directory of an untrusted ZIP (entries only; data is read on demand). */
export function readZipDirectory(buf: Buffer): ZipEntry[] {
	const min = Math.max(0, buf.length - 22 - 0xffff);
	let end = -1;
	for (let i = buf.length - 22; i >= min; i--)
		if (buf.readUInt32LE(i) === END) {
			end = i;
			break;
		}
	if (end < 0) throw new ZipError('Not a ZIP file (or the file is truncated)');
	if (buf.readUInt16LE(end + 4) !== 0 || buf.readUInt16LE(end + 6) !== 0)
		throw new ZipError('Multi-part ZIP files are not supported');
	const count = buf.readUInt16LE(end + 10);
	const dirSize = buf.readUInt32LE(end + 12);
	let p = buf.readUInt32LE(end + 16);
	if (count === 0xffff || p === 0xffffffff) throw new ZipError('ZIP64 bundles are not supported');
	if (count > ZIP_LIMITS.entries) throw new ZipError('Too many entries in the bundle');
	if (p + dirSize > end) throw new ZipError('Corrupt ZIP directory');
	const entries: ZipEntry[] = [];
	const seen = new Set<string>();
	let total = 0;
	for (let i = 0; i < count; i++) {
		if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL)
			throw new ZipError('Corrupt ZIP directory');
		const flags = buf.readUInt16LE(p + 8);
		const method = buf.readUInt16LE(p + 10);
		const crc = buf.readUInt32LE(p + 16);
		const compressedSize = buf.readUInt32LE(p + 20);
		const size = buf.readUInt32LE(p + 24);
		const nameLen = buf.readUInt16LE(p + 28);
		const extraLen = buf.readUInt16LE(p + 30);
		const commentLen = buf.readUInt16LE(p + 32);
		const madeBy = buf.readUInt16LE(p + 4) >> 8;
		const external = buf.readUInt32LE(p + 38);
		const offset = buf.readUInt32LE(p + 42);
		const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
		p += 46 + nameLen + extraLen + commentLen;
		if (flags & 0x1) throw new ZipError(`Encrypted entries are not supported: ${name}`);
		if (name.endsWith('/')) {
			safeZipName(name.slice(0, -1));
			continue; // directory
		}
		safeZipName(name);
		// Unix file type in the upper bits of the external attributes: only regular files.
		if (madeBy === 3) {
			const type = (external >>> 16) & 0o170000;
			if (type === 0o120000) throw new ZipError(`Symbolic links are not allowed: ${name}`);
			if (type !== 0 && type !== 0o100000)
				throw new ZipError(`Only regular files are allowed: ${name}`);
		}
		if (method !== 0 && method !== 8) throw new ZipError(`Unsupported compression in ${name}`);
		if (seen.has(name)) throw new ZipError(`Duplicate entry: ${name}`);
		seen.add(name);
		if (size > ZIP_LIMITS.entryBytes) throw new ZipError(`Entry too large: ${name}`);
		if (size > 1024 * 1024 && compressedSize > 0 && size / compressedSize > ZIP_LIMITS.ratio)
			throw new ZipError(`Suspicious compression ratio: ${name}`);
		total += size;
		if (total > ZIP_LIMITS.totalBytes) throw new ZipError('The bundle is too large when unpacked');
		entries.push({ name, size, compressedSize, method, crc, offset });
	}
	return entries;
}

/** Reads one entry's data, inflating with a hard output limit and checking size and CRC-32. */
export function readZipEntry(buf: Buffer, e: ZipEntry): Buffer {
	if (e.offset + 30 > buf.length || buf.readUInt32LE(e.offset) !== LOCAL)
		throw new ZipError(`Corrupt entry: ${e.name}`);
	const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
	const end = start + e.compressedSize;
	if (end > buf.length) throw new ZipError(`Truncated entry: ${e.name}`);
	const raw = buf.subarray(start, end);
	let data: Buffer;
	try {
		data =
			e.method === 0
				? Buffer.from(raw)
				: zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, e.size) });
	} catch {
		throw new ZipError(`Corrupt or oversized entry: ${e.name}`);
	}
	if (data.length !== e.size) throw new ZipError(`Size mismatch: ${e.name}`);
	if (zlib.crc32(data) !== e.crc) throw new ZipError(`CRC mismatch: ${e.name}`);
	return data;
}
