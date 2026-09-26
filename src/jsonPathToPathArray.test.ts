import { assert, test } from "vitest";
import { jsonPathToPathArray } from "./jsonPathToPathArray.ts";

test("Different child segment syntaxes are supported the same", async () => {
	const normal = jsonPathToPathArray("$.foo.bar");
	const brackets = [
		"$['foo']['bar']",
		'$["foo"]["bar"]',
		"$.foo['bar']",
		"$['foo'].bar",
	] as const;

	for (const bracket of brackets) {
		const pathArray = jsonPathToPathArray(bracket);
		assert.deepStrictEqual(pathArray, normal, bracket);
	}
});

test("Wildcards", async () => {
	const normal = jsonPathToPathArray("$.foo[*]");
	const brackets = ["$.foo.*", "$['foo'][*]"] as const;

	for (const bracket of brackets) {
		const pathArray = jsonPathToPathArray(bracket);
		assert.deepStrictEqual(pathArray, normal, bracket);
	}
});

test("Multiple selectors in brackets are not supported", async () => {
	const paths = [
		"$['foo','bar']",
		"$['foo', 'bar']",
		"$['foo',*]",
		"$[*,*]",
	] as const;

	for (const path of paths) {
		assert.throws(() => jsonPathToPathArray(path), /not supported/, path);
	}
});
