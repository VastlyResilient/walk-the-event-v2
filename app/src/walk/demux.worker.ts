import { createFile, DataStream, Endianness, MP4BoxBuffer } from 'mp4box';

/**
 * Fetch + demux one footage segment off the main thread, progressively: the files are fast-start (moov first), so
 * samples are extracted as the bytes arrive and posted a GOP at a time. Parsing a whole 2-9 MB MP4 on the main thread
 * was a 50-160 ms hitch mid-swipe; waiting for the whole file before showing any of it made the walk stop at every
 * segment boundary on a phone connection. Each batch comes back packed into one transferable buffer with offsets.
 */
export type DemuxMsg =
  | { id: number; type: 'config'; codec: string; width: number; height: number; description?: Uint8Array; total: number }
  | { id: number; type: 'samples'; start: number; data: Uint8Array; offsets: Uint32Array; keys: Uint8Array }
  | { id: number; type: 'done'; bytes: number }
  | { id: number; type: 'error'; error: string };

const post = (m: DemuxMsg, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

self.onmessage = async (e: MessageEvent<{ id: number; url: string }>) => {
  const { id, url } = e.data;
  try {
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const file = createFile(true);
    let sent = 0;
    file.onError = (err: unknown) => post({ id, type: 'error', error: String(err) });
    file.onReady = (info: any) => {
      const track = info.videoTracks[0];
      let description: Uint8Array | undefined;
      const trak: any = file.getTrackById(track.id);
      for (const en of trak.mdia.minf.stbl.stsd.entries) {
        const box = en.avcC || en.hvcC;
        if (box) {
          const s = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
          box.write(s);
          description = new Uint8Array(s.buffer, 8).slice();
        }
      }
      post({ id, type: 'config', codec: track.codec, width: track.video.width, height: track.video.height, description, total: track.nb_samples });
      file.setExtractionOptions(track.id, null, { nbSamples: 10 });
      file.start();
    };
    file.onSamples = (_id: number, _u: unknown, s: any[]) => {
      const offsets = new Uint32Array(s.length + 1);
      for (let k = 0; k < s.length; k++) offsets[k + 1] = offsets[k] + s[k].data.byteLength;
      const data = new Uint8Array(offsets[s.length]);
      const keys = new Uint8Array(s.length);
      s.forEach((x, k) => { data.set(new Uint8Array(x.data), offsets[k]); keys[k] = x.is_rap ? 1 : 0; });
      post({ id, type: 'samples', start: sent, data, offsets, keys }, [data.buffer, offsets.buffer, keys.buffer]);
      sent += s.length;
      file.releaseUsedSamples(_id, sent);
    };
    const rd = res.body.getReader();
    let pos = 0;
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      const ab = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
      file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(ab, pos));
      pos += value.byteLength;
    }
    file.flush();
    post({ id, type: 'done', bytes: pos });
  } catch (err) {
    post({ id, type: 'error', error: String(err) });
  }
};
