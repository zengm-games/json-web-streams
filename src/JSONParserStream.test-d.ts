import { assertType, test } from "vitest";
import * as z from "zod";
import { createJSONParserStream } from "./createJSONParserStream.ts";
import { makeReadableStreamFromJson } from "./test/utils.ts";

test("Object input with validator -> types of values are known", async () => {
	const json = "[]";
	const stream = makeReadableStreamFromJson(json).pipeThrough(
		createJSONParserStream({ "$.foo": z.string(), "$.bar": z.number() }),
	);
	const chunks = await Array.fromAsync(stream);
	assertType<
		(
			| {
					jsonPath: "$.foo";
					value: string;
			  }
			| {
					jsonPath: "$.bar";
					value: number;
			  }
		)[]
	>(chunks);

	for (const chunk of chunks) {
		if (chunk.jsonPath === "$.foo") {
			assertType<string>(chunk.value);
		} else {
			assertType<number>(chunk.value);
		}
	}
});

test("Object input without validator -> types of values are unknown", async () => {
	const json = "[]";
	const stream = makeReadableStreamFromJson(json).pipeThrough(
		createJSONParserStream({ "$.foo": z.string(), "$.bar": null }),
	);
	const chunks = await Array.fromAsync(stream);
	assertType<
		(
			| {
					jsonPath: "$.foo";
					value: string;
			  }
			| {
					jsonPath: "$.bar";
					value: unknown;
			  }
		)[]
	>(chunks);

	for (const chunk of chunks) {
		if (chunk.jsonPath === "$.foo") {
			assertType<string>(chunk.value);
		} else {
			assertType<unknown>(chunk.value);
		}
	}
});

test("Array input -> types of values are unknown", async () => {
	const json = "[]";
	const stream = makeReadableStreamFromJson(json).pipeThrough(
		createJSONParserStream(["$.foo", "$.bar"]),
	);
	const chunks = await Array.fromAsync(stream);
	assertType<
		(
			| {
					jsonPath: "$.foo";
					value: unknown;
			  }
			| {
					jsonPath: "$.bar";
					value: unknown;
			  }
		)[]
	>(chunks);
});

test("makeReadableStreamFromJson parameter is being checked as JSONPath", async () => {
	try {
		// @ts-expect-error
		createJSONParserStream(["x"]);

		// @ts-expect-error
		createJSONParserStream({ x: null });
	} catch {}
});
