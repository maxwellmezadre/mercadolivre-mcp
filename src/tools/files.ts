import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

// The only place a tool may write a user-visible file is MERCADOLIVRE_EXPORT_DIR.
// The caller picks the directory; the name is reduced to a basename and the
// resolved path is checked against the directory, so a model choosing
// arguments cannot turn an export into an arbitrary write.

/** Strips any directory component and leading dots. */
export const sanitizeName = (name: string): string => name.replace(/[/\\]/g, "_").replace(/^\.+/, "");

/** Creates the directory (0700) and returns the confined absolute path for `name`. */
export function exportPath(dir: string, name: string): string {
  const root = resolve(dir);
  const target = resolve(join(root, sanitizeName(name)));
  if (!target.startsWith(`${root}/`)) {
    throw new Error(`Caminho fora de MERCADOLIVRE_EXPORT_DIR (${root}). Só é possível gravar dentro desse diretório.`);
  }
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return target;
}
