import { assert, test } from "vitest";
import { jsonPathToQueryPath } from "./jsonPathToQueryPath.ts";

test("Different child segment syntaxes are supported the same", async () => {
	const normal = jsonPathToQueryPath("$.foo.bar");
	const brackets = [
		"$['foo']['bar']",
		'$["foo"]["bar"]',
		"$.foo['bar']",
		"$['foo'].bar",
		"$['foo','bar']",
		"$['foo', 'bar']",
	] as const;

	for (const bracket of brackets) {
		const queryPath = jsonPathToQueryPath(bracket);
		assert.deepStrictEqual(queryPath, normal, bracket);
	}
});

test("Wildcards", async () => {
	const normal = jsonPathToQueryPath("$.foo[*]");
	const brackets = ["$.foo.*", "$['foo',*]"] as const;

	for (const bracket of brackets) {
		const queryPath = jsonPathToQueryPath(bracket);
		assert.deepStrictEqual(queryPath, normal, bracket);
	}
});
