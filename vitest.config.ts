import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		exclude: ["src/test/types.ts", "src/test/utils.ts"],
		include: ["src/test/**/*.ts"],
		typecheck: {
			enabled: true,
			include: ["src/test/types.ts"],
		},
	},
});
