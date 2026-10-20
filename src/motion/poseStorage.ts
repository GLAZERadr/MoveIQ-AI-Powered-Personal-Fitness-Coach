/**
 * Local storage for retained landmark sequences (never uploaded, excluded from exports/backups).
 * Files live in the app's private documents directory and are deleted by the retention policy,
 * by deleting the workout, or by "Delete all data".
 */
import { Directory, File, Paths } from 'expo-file-system';
import { RetainedFrame } from './analyzer';

function dir(): Directory {
  const d = new Directory(Paths.document, 'pose-sequences');
  if (!d.exists) d.create({ idempotent: true, intermediates: true });
  return d;
}

export function savePoseSequence(setId: string, frames: RetainedFrame[], meta: { exerciseId: string; analyzerVersion: number }): string {
  const f = new File(dir(), `${setId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
  f.write(JSON.stringify({ v: 1, ...meta, frames }));
  return f.uri;
}

export async function readPoseSequence(uri: string): Promise<{ exerciseId: string; analyzerVersion: number; frames: RetainedFrame[] } | null> {
  const f = new File(uri);
  if (!f.exists) return null;
  return JSON.parse(await f.text()) as { exerciseId: string; analyzerVersion: number; frames: RetainedFrame[] };
}

export function deletePoseFiles(uris: string[]): void {
  for (const uri of uris) {
    try {
      const f = new File(uri);
      if (f.exists) f.delete();
    } catch {
      // Already gone or inaccessible: nothing else to do.
    }
  }
}
