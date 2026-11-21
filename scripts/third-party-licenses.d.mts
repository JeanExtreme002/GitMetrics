export interface BundledPackage {
  name: string;
  version: string;
  license: string;
  text: string | null;
  repository: string | null;
}
export function packageRoot(file: string): string | null;
export function collect(files: string[], cwd?: string): BundledPackage[];
export function render(packages: BundledPackage[]): string;
