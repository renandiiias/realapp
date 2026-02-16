/* eslint-disable no-console */
/**
 * Postinstall patches to keep `expo start` working on this workstation.
 *
 * Why this exists:
 * - This project targets Expo SDK 54.
 * - On this machine, Expo CLI v54 has intermittently crashed due to CJS/ESM interop edge-cases
 *   when importing transitive deps (notably `@urql/core` and `@expo/env`).
 *
 * Goal:
 * - Make the dev server start reliably without changing the app code.
 * - Keep patches idempotent and scoped to the exact files we depend on.
 */

const fs = require("node:fs");
const path = require("node:path");

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeText(filePath, text) {
  fs.writeFileSync(filePath, text, "utf8");
}

function safePatchFile(filePath, patchFn) {
  try {
    if (!fs.existsSync(filePath)) return { filePath, status: "missing" };
    const before = readText(filePath);
    const after = patchFn(before);
    if (after === before) return { filePath, status: "unchanged" };
    writeText(filePath, after);
    return { filePath, status: "patched" };
  } catch (err) {
    return { filePath, status: "error", err };
  }
}

function patchExpoUrqlInterop(src) {
  const marker = "/* real-mobile-mvp patch: urql interop */";
  if (src.includes(marker)) return src;

  // Insert a small helper that normalizes CJS/ESM exports for @urql/core.
  // We patch by anchoring on the next function in the file to avoid brittle offsets.
  const helper = [
    marker,
    "function __urqlCore() {",
    "    const m = _core();",
    "    return m && typeof m.createClient === 'function' ? m : (m && m.default ? m.default : m);",
    "}",
    "",
  ].join("\n");

  const anchor = "\nfunction _exchangeretry() {";
  if (!src.includes(anchor)) return src;
  src = src.replace(anchor, `\n${helper}function _exchangeretry() {`);

  // Update references to use the normalized core module.
  src = src.replace("return _core().CombinedError;", "return __urqlCore().CombinedError;");
  src = src.replace("(0, _core().createClient)({", "(0, __urqlCore().createClient)({");
  src = src.replace("_core().cacheExchange", "__urqlCore().cacheExchange");
  src = src.replace("_core().fetchExchange", "__urqlCore().fetchExchange");

  return src;
}

function patchExpoEnvInterop(src) {
  const marker = "/* real-mobile-mvp patch: @expo/env interop */";
  if (src.includes(marker)) return src;

  const target = "function loadEnvFiles(projectRoot, options) {\n    return _env().load(projectRoot, options);\n}";
  if (!src.includes(target)) return src;

  const replacement = [
    "function loadEnvFiles(projectRoot, options) {",
    `    ${marker}`,
    "    const mod = _env();",
    "    const load = (mod && mod.load) || (mod && mod.default && mod.default.load);",
    "    if (typeof load !== 'function') {",
    "        return;",
    "    }",
    "    return load(projectRoot, options);",
    "}",
  ].join("\n");

  return src.replace(target, replacement);
}

function patchExpoMetroConfigInterop(src) {
  const marker = "/* real-mobile-mvp patch: metro-config interop */";
  if (src.includes(marker)) return src;

  const postcssLine = "            postcssHash: (0, postcss_1.getPostcssConfigHash)(projectRoot),";
  if (src.includes(postcssLine)) {
    src = src.replace(
      postcssLine,
      [
        `            ${marker}`,
        "            postcssHash: typeof postcss_1.getPostcssConfigHash === 'function'",
        "                ? (0, postcss_1.getPostcssConfigHash)(projectRoot)",
        "                : (postcss_1.default && typeof postcss_1.default.getPostcssConfigHash === 'function'",
        "                    ? postcss_1.default.getPostcssConfigHash(projectRoot)",
        "                    : null),",
      ].join("\n")
    );
  }

  const returnLine =
    "    return (0, withExpoSerializers_1.withExpoSerializers)(metroConfig, { unstable_beforeAssetSerializationPlugins });";
  if (src.includes(returnLine)) {
    src = src.replace(
      returnLine,
      [
        `    ${marker}`,
        "    const withExpoSerializers =",
        "        withExpoSerializers_1.withExpoSerializers ||",
        "        (withExpoSerializers_1.default && withExpoSerializers_1.default.withExpoSerializers) ||",
        "        withExpoSerializers_1.default;",
        "    if (typeof withExpoSerializers !== 'function') {",
        "        return metroConfig;",
        "    }",
        "    return withExpoSerializers(metroConfig, { unstable_beforeAssetSerializationPlugins });",
      ].join("\n")
    );
  }

  return src;
}

function main() {
  const projectRoot = process.cwd();

  const expoGraphqlClient = path.join(
    projectRoot,
    "node_modules",
    "expo",
    "node_modules",
    "@expo",
    "cli",
    "build",
    "src",
    "api",
    "graphql",
    "client.js"
  );

  const expoNodeEnv = path.join(
    projectRoot,
    "node_modules",
    "expo",
    "node_modules",
    "@expo",
    "cli",
    "build",
    "src",
    "utils",
    "nodeEnv.js"
  );

  const expoMetroConfig = path.join(
    projectRoot,
    "node_modules",
    "expo",
    "node_modules",
    "@expo",
    "metro-config",
    "build",
    "ExpoMetroConfig.js"
  );

  const results = [
    safePatchFile(expoGraphqlClient, patchExpoUrqlInterop),
    safePatchFile(expoNodeEnv, patchExpoEnvInterop),
    safePatchFile(expoMetroConfig, patchExpoMetroConfigInterop),
  ];

  const errors = results.filter((r) => r.status === "error");
  if (errors.length) {
    console.warn("postinstall: some patches failed (continuing)");
    for (const e of errors) {
      console.warn(`- ${e.filePath}: ${e.err && e.err.message ? e.err.message : String(e.err)}`);
    }
  }
}

main();
