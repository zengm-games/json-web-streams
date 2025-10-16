import { assertType, test } from "vitest";
import { createJSONParserStream } from "./createJSONParserStream.ts";
import { makeReadableStreamFromJson } from "./test/utils.ts";

test("Generic types match input indexes", async () => {
	const json = "[]";
	const stream = makeReadableStreamFromJson(json).pipeThrough(
		createJSONParserStream<[string, number]>(["$.foo", "$.bar"]),
	);
	const chunks = await Array.fromAsync(stream);
	assertType<
		(
			| {
					value: string;
					index: 0;
			  }
			| {
					value: number;
					index: 1;
			  }
		)[]
	>(chunks);

	// Can discriminate in loop
	for (const chunk of chunks) {
		if (chunk.index === 0) {
			assertType<string>(chunk.value);
		} else {
			assertType<number>(chunk.value);
		}
	}
});

test("With no generic, output values are `unknown`", async () => {
	const json = "[]";
	const stream = makeReadableStreamFromJson(json).pipeThrough(
		createJSONParserStream(["$.foo", "$.bar"]),
	);
	const chunks = await Array.fromAsync(stream);
	assertType<
		(
			| {
					value: unknown;
					index: 0;
			  }
			| {
					value: unknown;
					index: 1;
			  }
		)[]
	>(chunks);
});

test("Generic array can't be shorter than jsonPaths array", async () => {
	const json = "[]";
	await makeReadableStreamFromJson(json)
		.pipeThrough(
			// @ts-expect-error
			createJSONParserStream<[string]>(["$.foo", "$.bar"]),
		)
		.pipeTo(new WritableStream());
});

test("Generic array can't be shorter than jsonPaths array", async () => {
	const json = "[]";
	await makeReadableStreamFromJson(json)
		.pipeThrough(
			// @ts-expect-error
			createJSONParserStream<[string, number]>(["$.foo"]),
		)
		.pipeTo(new WritableStream());
});
