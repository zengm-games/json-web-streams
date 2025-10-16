import { assertType, test } from "vitest";
import * as z from "zod";
import { createJSONParserStream } from "./createJSONParserStream.ts";
import { makeReadableStreamFromJson } from "./test/utils.ts";

test("Generic types match input indexes", async () => {
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

	// Can discriminate in loop
	for (const chunk of chunks) {
		if (chunk.jsonPath === "$.foo") {
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
