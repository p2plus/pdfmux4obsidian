import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";

const ctx = await esbuild.context({
  entryPoints: ["main.ts"],
  bundle:      true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/*",
    "@lezer/*",
    "@codemirror/state",
    "node:*",
  ],
  format:    "cjs",
  target:    "es2018",
  logLevel:  "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile:   "main.js",
  platform:  "node",
});

if (prod) {
  await ctx.rebuild();
  process.exit(0);
} else {
  await ctx.watch();
}
