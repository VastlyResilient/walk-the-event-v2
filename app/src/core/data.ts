import type { WalkMeta } from '../walk/frames';

export const BASE = import.meta.env.BASE_URL;
export const asset = (p: string) => `${BASE}${p.replace(/^\//, '')}`;

export type FloorId = 'downstairs' | 'upstairs';

export interface Chapter { id: string; title: string; start: number; end: number; blurb: string }
export interface Beat { t: number; visible: string }

export interface CameraTrack {
  name: string;
  fps: number;
  frames: number;
  intrinsics: { fx: number; fy: number; cx: number; cy: number };
  camera_height_m: number;
  pos: number[];
  quat: number[];
  conf: number[];
  depth_a: number[];
  depth_b: number[];
  floor_points_xz: [number, number][];
}

export interface Station {
  id: string;
  label: string;
  artist: string | null;
  work: string;
  year: number | null;
  title: string;
  one_liner: string;
  body: string;
  body_source: string;
  highlights: string[];
  photos: string[];
  photo_urls: string[];
  hero_url: string;
  pod_url: string;
  video_timestamp: number;
  click_frame: number;
  visibility_window: [number, number];
  screen_region_track: { start: number; polys: number[][]; inside: number[] };
  world_position: [number, number, number];
  offscreen: boolean;
  transition?: { url: string; reverse_url?: string; first_frame: number; model?: string } | null;
  in_video: boolean;
}

export interface Floor {
  id: FloorId;
  meta: WalkMeta;
  cam: CameraTrack;
  chapters: Chapter[];
  beats: Beat[];
  duration: number;
  /** Last walkable footage frame (the scroll's end). Usually meta.frames - 1; see WALK_END. */
  end: number;
}

export interface GuideLines {
  presets: Record<string, PresetLines>;
}
export interface PresetLines {
  label: string;
  intro: string[];
  tutorial: Record<string, string>;
  chapters: Record<string, string[]>;
  stations: Record<string, { teaser: string[]; open: string[]; close: string[] }>;
  idle: string[];
  suggest_next: string;
  reverse: string[];
  stairs: string[];
  upstairs_details: { t: number; line: string }[];
  dark: string[];
  race_start?: string[];
  race_go?: string[];
  race_wait?: string[];
  dance?: string[];
  crowd?: string[]; // (owner) light remarks when people are in her way: warm, never at anyone's expense
  slow?: string[]; // the visitor taking it slow (savouring, not slacking)
  jog?: string[]; // she breaks into a jog (a hard press on the walk pad)
  nudge?: string[]; // (guide: after 60 s without input she turns to the visitor and nudges them on; {title} = next station)
  outro: string[];
  ask_fallback: string;
}

const j = async <T>(p: string): Promise<T> => (await fetch(asset(p))).json();

/**
 * Where a floor's walk ends, when that is before the last footage frame. Upstairs: the final ~2 s of footage look
 * straight down over the glass balustrade into the atrium; there is no balcony floor in frame where the guide could
 * stand fully in view and >= 0.6 m from the glass (the walkway beside the glass is ~0.7 m wide there), so she would
 * either vanish or stand over the drop. Frame 3805 is the last one where she stands on verified balcony floor, fully
 * in frame, clear of the glass, with the atrium below still in view (checked on screenshots; docs/DECISIONS.md #48).
 */
// (round 6: pulled back to 3770, the last frame where the offline blocking solver (pipeline/blocking.py) has a fully
// valid spot for her on the balcony; DECISIONS #52)
export const WALK_END: Partial<Record<FloorId, number>> = { upstairs: 3770 };

export async function loadFloor(id: FloorId): Promise<Floor> {
  const [meta, cam, beats] = await Promise.all([
    j<WalkMeta>(`media/walk/${id}/meta.json`),
    j<CameraTrack>(`data/camera_${id}.json`),
    j<{ beats: Beat[]; chapters: Chapter[] }>(`data/beats_${id}.json`),
  ]);
  const end = Math.min(meta.frames - 1, WALK_END[id] ?? meta.frames - 1);
  return { id, meta, cam, chapters: beats.chapters, beats: beats.beats, duration: (end + 1) / meta.fps, end };
}

export async function loadStations(): Promise<Station[]> {
  return (await j<{ stations: Station[] }>('data/stations.json')).stations;
}

export async function loadLines(): Promise<GuideLines> {
  return j<GuideLines>('data/guide_lines.json');
}

export const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
