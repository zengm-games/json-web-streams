import { assert, test } from "vitest";
import { jsonPathToQueryPath, type JSONPath } from "./jsonPathToQueryPath.ts";

test("Different child segment syntaxes are supported the same", async () => {
	const normal = jsonPathToQueryPath("$.foo.bar");
	const brackets: JSONPath[] = [
		"$['foo']['bar']",
		'$["foo"]["bar"]',
		"$.foo['bar']",
		"$['foo'].bar",
		"$['foo','bar']",
		"$['foo', 'bar']",
	];

	for (const bracket of brackets) {
		const queryPath = jsonPathToQueryPath(bracket);
		assert.deepStrictEqual(queryPath, normal, bracket);
	}
});

test("Wildcards", async () => {
	const normal = jsonPathToQueryPath("$.foo[*]");
	const brackets: JSONPath[] = ["$.foo.*", "$['foo',*]"];

	for (const bracket of brackets) {
		const queryPath = jsonPathToQueryPath(bracket);
		assert.deepStrictEqual(queryPath, normal, bracket);
	}
});
