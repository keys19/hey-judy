import { defineConfig } from "nitro";

export default defineConfig({
  vercel: {
    functions: {
      runtime: "nodejs24.x",
      maxDuration: 300,
      regions: ["dub1"],
    },
  },
});
