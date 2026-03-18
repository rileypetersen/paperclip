import { defineConfig } from "vitest/config";
import path from "node:path";

const sdkSrc = path.resolve(
  __dirname,
  "node_modules/@paperclipai/plugin-sdk/src",
);

export default defineConfig({
  resolve: {
    alias: {
      // Map sub-path exports to their src equivalents so tests work without building the SDK
      "@paperclipai/plugin-sdk/testing": path.join(sdkSrc, "testing.ts"),
      "@paperclipai/plugin-sdk/protocol": path.join(sdkSrc, "protocol.ts"),
      "@paperclipai/plugin-sdk/types": path.join(sdkSrc, "types.ts"),
      "@paperclipai/plugin-sdk/bundlers": path.join(sdkSrc, "bundlers.ts"),
      "@paperclipai/plugin-sdk": path.join(sdkSrc, "index.ts"),
    },
  },
  test: {
    include: ["tests/**/*.spec.ts"],
    environment: "node",
  },
});
