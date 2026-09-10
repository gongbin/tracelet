declare module 'occt-import-js' {
  export default function init(options?: { locateFile?: (path: string) => string; print?: (s: string) => void; printErr?: (s: string) => void }): Promise<{
    ReadStepFile(bytes: Uint8Array, options: { linearUnit: string; linearDeflectionType: string; linearDeflection: number; angularDeflection: number }): { success: boolean; meshes: import('./stepGeometry.js').CadMesh[] };
  }>;
}
