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
			{ value: 1, index: 0 },
			{ value: 2, index: 0 },
		]);
	});

	test("streams values from two paths", async () => {
		const stream = makeReadableStreamFromJson(json).pipeThrough(
			new JSONParseStream(["$[*].foo[*]", "$[*].bar[*]"]),
		);
		const chunks = await Array.fromAsync(stream);
		assert.deepStrictEqual(chunks, [
			{ value: 1, index: 0 },
			{ value: 2, index: 0 },
			{ value: { x: 3 }, index: 1 },
			{ value: { x: 4 }, index: 1 },
		]);
	});

	test("streams values from two paths, where one is nested in the other", async () => {
		const stream = makeReadableStreamFromJson(json).pipeThrough(
			new JSONParseStream(["$[*].bar[*]", "$[*].bar[*].x"]),
		);
		const chunks = await Array.fromAsync(stream);
		assert.deepStrictEqual(chunks, [
			{ value: 3, index: 1 },
			{ value: { x: 3 }, index: 0 },
			{ value: 4, index: 1 },
			{ value: { x: 4 }, index: 0 },
		]);
	});

	test("nested objects are distinct objects, one is not the child of the other", async () => {
		const json = JSON.stringify({ foo: { bar: 1 } });
		const stream = makeReadableStreamFromJson(json).pipeThrough(
			new JSONParseStream(["$.foo", "$"]),
		);
		const chunks = await Array.fromAsync(stream, (row) => row.value);
		assert.deepStrictEqual(chunks, [{ bar: 1 }, { foo: { bar: 1 } }]);
		chunks[0].bar = 2;
		assert.deepStrictEqual(chunks, [{ bar: 2 }, { foo: { bar: 1 } }]);
	});

	test("streams values from non-overlapping paths at different levels, without clobbering each other", async () => {
		const stream = makeReadableStreamFromJson(
			'{"bar": [1,2,3], "foo": [{"key": 1}]}',
		).pipeThrough(
			// Why does order of jsonPaths matter?
			new JSONParseStream(["$.foo", "$.bar[*]"]),
		);

		const chunks = await Array.fromAsync(stream);
		const foo = chunks
			.filter((chunk) => chunk.index === 0)
			.map((chunk) => chunk.value);
		assert.deepStrictEqual(foo, [[{ key: 1 }]]);
	});

	test("confirm that we're not just reading everything into memory all the time", async () => {
		let maxStackSize = 0;

		// Monkey patch to track the size of the stack
		const monkeyPatch = (stream: JSONParseStream) => {
			const prevOnValue = stream._parser.onValue;
			stream._parser.onValue = (value, stack) => {
				// This is not a very accurate way to get stack size, but works enough for these purposes.
				const stackSize = JSON.stringify(stack).length;
				maxStackSize = Math.max(maxStackSize, stackSize);
				prevOnValue(value, stack);
			};
			return stream;
		};

		// This stream emits the whole object ($) so it has to read the whole object into memory at some point
		await makeReadableStreamFromJson(json)
			.pipeThrough(monkeyPatch(new JSONParseStream(["$"])))
			.pipeTo(new WritableStream());
		const maxStackSize0 = maxStackSize;

		// This stream only emits part of the object, so it should use less memory than the previous stream
		maxStackSize = 0;
		await makeReadableStreamFromJson(json)
			.pipeThrough(monkeyPatch(new JSONParseStream(["$[*].bar[*]"])))
			.pipeTo(new WritableStream());
		const maxStackSize1 = maxStackSize;

		// The first stream should use more memory than the second
		assert.isAbove(maxStackSize0, maxStackSize1);
	});
});
