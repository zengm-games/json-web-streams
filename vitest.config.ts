import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// https://vitest.dev/guide/testing-types says:
		// When using @ts-expect-error syntax, you might want to make sure that you didn't make a typo. You can do that by including your type files in test.include config option, so Vitest will also actually run these tests and fail with ReferenceError.
		include: [...configDefaults.include, ...configDefaults.typecheck.include],
		typecheck: {
			enabled: true,
		},
	},
});
