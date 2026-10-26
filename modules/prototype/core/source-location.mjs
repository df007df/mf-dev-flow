import fs from 'node:fs';
import path from 'node:path';

export function resolvePortableHtmlSource(source, workspaceRoot) {
  if (source?.type !== 'html' || !workspaceRoot || !source.workspaceRoot || !source.location) return source;
  const originalRoot = path.resolve(source.workspaceRoot);
  const originalLocation = path.resolve(source.location);
  const relativeLocation = path.relative(originalRoot, originalLocation);
  if (!relativeLocation || relativeLocation.startsWith(`..${path.sep}`) || path.isAbsolute(relativeLocation)) return source;
  const relocatedRoot = path.resolve(workspaceRoot);
  const relocatedLocation = path.resolve(relocatedRoot, relativeLocation);
  const relocatedRelative = path.relative(relocatedRoot, relocatedLocation);
  if (!relocatedRelative || relocatedRelative.startsWith(`..${path.sep}`) || path.isAbsolute(relocatedRelative) || !fs.existsSync(relocatedLocation)) return source;
  return { ...source, workspaceRoot: relocatedRoot, location: relocatedLocation };
}
