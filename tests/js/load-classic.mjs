// Loads a classic (non-module) web/ script into a fresh VM context and returns one of its globals.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export const WEB = fileURLToPath(new URL("../../web/", import.meta.url));

export function loadGlobal(file, name, extra = {}) {
  const ctx = vm.createContext({ console, URLSearchParams, Date, Math, setTimeout, clearTimeout, ...extra });
  vm.runInContext(readFileSync(WEB + file, "utf8") + `\n;globalThis.__out = ${name};`, ctx, { filename: file });
  return ctx.__out;
}

export function fixture(name) {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8"));
}
