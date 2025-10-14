import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		exclude: ["src/test/utils.ts"],
		include: ["src/test/**/*.ts"],
	},
});
