/**
 * Just enough zip and tar to read what GitHub hands back, with no dependency.
 *
 * A run record is a zip artifact and a repository snapshot is a gzipped tarball. Both are read
 * the same way on your machine and on a Worker, through the `DecompressionStream` both have, so
 * roster still installs nothing at run time.
 */

/** Inflate with the platform's own stream, falling back to zlib where a Node lacks the format. */
async function inflate(bytes: Uint8Array, format: "gzip" | "deflate-raw"): Promise<Uint8Array> {
  try {
    const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
      .stream()
      .pipeThrough(new DecompressionStream(format as "gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (err) {
    // Node only grew "deflate-raw" in 21; zlib has always had it. Workers never get here.
    const zlib = await import("node:zlib").catch(() => null);
    if (!zlib) throw err;
    return new Uint8Array(format === "gzip" ? zlib.gunzipSync(bytes) : zlib.inflateRawSync(bytes));
  }
}

/** Every file in a zip, by name. Stored and deflated entries; anything else is skipped. */
export async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record is in the last 64 KiB plus its own 22 bytes.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file");

  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  const names = new TextDecoder();

  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = names.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/")) continue;
    // The local header repeats the name and has its own extra field, which may differ in length.
    const dataAt = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(dataAt, dataAt + size);
    if (method === 0) out.set(name, data);
    else if (method === 8) out.set(name, await inflate(data, "deflate-raw"));
  }
  return out;
}

export interface TarEntry {
  /** Relative to the archive's single top directory, which GitHub names `owner-repo-sha/`. */
  path: string;
  size: number;
  /** Absent when `keep` said no: its size is known, its body was not kept. */
  data?: Uint8Array;
}

/**
 * The files in a gzipped tarball, as GitHub's `tarball` endpoint produces it.
 *
 * `keep` says which bodies to hold on to. A brain holds screenshots and recordings
 * beside its notes, and holding a megabyte of PNG in memory to answer "what changed in memory"
 * is the wrong trade; those are fetched on their own when somebody opens one.
 */
export async function untargz(
  bytes: Uint8Array,
  keep: (path: string, size: number) => boolean = () => true,
): Promise<TarEntry[]> {
  const tar = await inflate(bytes, "gzip");
  const out: TarEntry[] = [];
  const text = new TextDecoder();
  const field = (at: number, len: number) =>
    text.decode(tar.subarray(at, at + len)).replace(/\0.*$/s, "");

  let at = 0;
  let longName: string | null = null;
  let paxPath: string | null = null;
  while (at + 512 <= tar.length) {
    const name = field(at, 100);
    if (!name && tar[at] === 0) break;
    const size = Number.parseInt(field(at + 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(tar[at + 156] || 48);
    const prefix = field(at + 345, 155);
    const body = tar.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;

    if (type === "L") {
      longName = text.decode(body).replace(/\0.*$/s, "");
      continue;
    }
    if (type === "x") {
      const m = /\d+ path=([^\n]*)\n/.exec(text.decode(body));
      paxPath = m ? m[1]! : null;
      continue;
    }
    if (type === "g") continue; // the global header, which carries the commit sha
    const full = paxPath ?? longName ?? (prefix ? `${prefix}/${name}` : name);
    longName = null;
    paxPath = null;
    if (type !== "0" && type !== "\0") continue;

    const path = full.slice(full.indexOf("/") + 1);
    if (!path) continue;
    out.push(keep(path, size) ? { path, size, data: body.slice() } : { path, size });
  }
  return out;
}
