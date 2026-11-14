import esbuild from "esbuild";

const isProduction = process.argv.includes("production");

// Point this at your vault when you want the build copied into Obsidian:
//   OBSIDIAN_PLUGIN_DIR="/path/to/vault/.obsidian/plugins/research-annotations" npm run build
const outDir = (process.env.OBSIDIAN_PLUGIN_DIR ?? "dist").replace(/\/+$/, "");

const buildOptions = {
    entryPoints: ["src/main.ts"],
    bundle: true,
    outfile: `${outDir}/main.js`,
    format: "cjs",
    target: "es2022",
    external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
    sourcemap: "inline",
    logLevel: "info",
};

if (isProduction) {
    await esbuild.build({
        ...buildOptions,
        sourcemap: false,
        minify: true,
    });
} else {
    const context = await esbuild.context(buildOptions);
    await context.watch();
    console.log("Watching for changes...");
}
