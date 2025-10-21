import { assertType, describe, test } from "vitest";
import * as z from "zod";
import { JSONParseStream } from "./JSONParseStream.ts";
import { makeReadableStreamFromJson } from "./test/utils.ts";

test("Object input with validator -> types of values are known", async () => {
	const json = "[]";
	const stream = makeReadableStreamFromJson(json).pipeThrough(
		new JSONParseStream([
			{ path: "$.foo", schema: z.string() },
			{ path: "$.bar", schema: z.number() },
		]),
	);
	const chunks = await Array.fromAsync(stream);
	assertType<
		(
			| {
					path: "$.foo";
					value: string;
			  }
			| {
					path: "$.bar";
					value: number;
			  }
		)[]
	>(chunks);

	for (const chunk of chunks) {
		if (chunk.path === "$.foo") {
			assertType<string>(chunk.value);
		} else {
			assertType<number>(chunk.value);
		}
	}
});

test("Object input with validator mixed with string input -> some types of values are unknown", async () => {
	const json = "[]";
	const stream = makeReadableStreamFromJson(json).pipeThrough(
		new JSONParseStream([{ path: "$.foo", schema: z.string() }, "$.bar"]),
	);
	const chunks = await Array.fromAsync(stream);
	assertType<
		(
			| {
					path: "$.foo";
					value: string;
			  }
			| {
					path: "$.bar";
					value: unknown;
			  }
		)[]
	>(chunks);

	for (const chunk of chunks) {
		if (chunk.path === "$.foo") {
			assertType<string>(chunk.value);
		} else {
			assertType<unknown>(chunk.value);
		}
	}
});

test("Object input without validator -> types of values are unknown", async () => {
	const json = "[]";
	const stream = makeReadableStreamFromJson(json).pipeThrough(
		new JSONParseStream([
			{ path: "$.foo", schema: z.string() },
			{ path: "$.bar" },
		]),
	);
	const chunks = await Array.fromAsync(stream);
	assertType<
		(
			| {
					path: "$.foo";
					value: string;
			  }
			| {
					path: "$.bar";
					value: unknown;
			  }
		)[]
	>(chunks);

	for (const chunk of chunks) {
		if (chunk.path === "$.bar") {
			assertType<unknown>(chunk.value);
		} else {
			assertType<string>(chunk.value);
		}
	}
});

test("Array input -> types of values are unknown", async () => {
	const json = "[]";
	const stream = makeReadableStreamFromJson(json).pipeThrough(
		new JSONParseStream(["$.foo", "$.bar"]),
	);
	const chunks = await Array.fromAsync(stream);
	assertType<
		(
			| {
					path: "$.foo";
					value: unknown;
			  }
			| {
					path: "$.bar";
					value: unknown;
			  }
		)[]
	>(chunks);
});

test("makeReadableStreamFromJson parameter is being checked as JSONPath", async () => {
	try {
		// @ts-expect-error
		new JSONParseStream(["x"]);

		// @ts-expect-error
		new JSONParseStream({ x: null });
	} catch {}
});

describe("key property", () => {
	test("propagated from input to output", async () => {
		const json = "[]";
		const stream = makeReadableStreamFromJson(json).pipeThrough(
			new JSONParseStream([{ key: "foo", path: "$.foo" }, { path: "$.bar" }]),
		);
		const chunks = await Array.fromAsync(stream);
		assertType<
			(
				| {
						key: string;
						path: "$.foo";
						value: unknown;
				  }
				| {
						path: "$.bar";
						value: unknown;
				  }
			)[]
		>(chunks);
	});

	test("two different types", async () => {
		const json = "[]";
		const stream = makeReadableStreamFromJson(json).pipeThrough(
			new JSONParseStream([
				{ key: "foo", path: "$.foo" },
				{ key: 4, path: "$.bar" },
			]),
		);
		const chunks = await Array.fromAsync(stream);
		assertType<
			(
				| {
						key: string;
						path: "$.foo";
						value: unknown;
				  }
				| {
						key: number;
						path: "$.bar";
						value: unknown;
				  }
			)[]
		>(chunks);
	});
});
