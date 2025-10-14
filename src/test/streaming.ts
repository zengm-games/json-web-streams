import { assert, describe, test } from "vitest";
import { JSONParseStream } from "../JSONParseStream.ts";
import { makeReadableStreamFromJson } from "./utils.ts";

describe("Streaming", () => {
	const json = JSON.stringify([{ foo: [1, 2] }, { bar: [{ x: 3 }, { x: 4 }] }]);

	test("streams values", async () => {
		const stream = makeReadableStreamFromJson(json).pipeThrough(
			new JSONParseStream(["$[*].foo[*]"]),
		);
		const chunks = await Array.fromAsync(stream);
		assert.deepStrictEqual(chunks, [
			[1, 0],
			[2, 0],
		]);
	});

	test("streams values from two paths", async () => {
		const stream = makeReadableStreamFromJson(json).pipeThrough(
			new JSONParseStream(["$[*].foo[*]", "$[*].bar[*]"]),
		);
		const chunks = await Array.fromAsync(stream);
		assert.deepStrictEqual(chunks, [
			[1, 0],
			[2, 0],
			[{ x: 3 }, 1],
			[{ x: 4 }, 1],
		]);
	});

	test("streams values from two paths, where one is nested in the other", async () => {
		const stream = makeReadableStreamFromJson(json).pipeThrough(
			new JSONParseStream(["$[*].bar[*]", "$[*].bar[*].x"]),
		);
		const chunks = await Array.fromAsync(stream);
		assert.deepStrictEqual(chunks, [
			[3, 1],
			[{ x: 3 }, 0],
			[4, 1],
			[{ x: 4 }, 0],
		]);
	});
});
