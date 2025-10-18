# json-web-streams

- **Stream large JSON files** without loading everything into memory
- Built on the **Web Streams API** so it runs in web browsers, Node.js, and more
- Query with **JSONPath** to extract only the data you need
- Integrated **schema validation** with full **TypeScript** support
- Tested on the [JSON Parsing Test Suite](https://github.com/nst/JSONTestSuite) and other edge cases

## Installation

```sh
npm install json-web-streams
```

## Getting started

Imagine you have some JSON like:

```json
[{ "x": 1 }, { "x": 2 }, { "x": 3 }]
```

You can just `JSON.parse` it and then do whatever you want. But what if it's so large that parsing it all at once is slow or impossible?

By using json-web-streams, you can stream through the JSON object without having to read it all into memory. Here's an example that prints out each object as it is parsed:

```ts
import { JSONParseStream } from "json-web-streams";

// data.json contains: [{ "x": 1 }, { "x": 2 }, { "x": 3 }]
const response = await fetch("https://example.com/data.json");
await response.body
	.pipeThrough(new TextDecoderStream())
	.pipeThrough(new JSONParseStream(["$[*]"]))
	.pipeTo(
		new WritableStream({
			write({ value }) {
				console.log(value);
			},
		}),
	);

// Output:
// {"x": 1}
// {"x": 2}
// {"x": 3}
```

> [!TIP]
> If you don't have to support Safari, [most other environments](https://caniuse.com/mdn-api_readablestream_--asynciterator) let you use a nicer syntax for consuming stream output as an async iterator:
>
> ```ts
> const stream = response.body
> 	.pipeThrough(new TextDecoderStream())
> 	.pipeThrough(new JSONParseStream(["$[*]"]));
> for await (const { value } of stream) {
> 	console.log(value);
> }
> ```

## API

```ts
const jsonParseStream = new JSONParseStream(
    jsonPaths: (JSONPath | { path: JSONPath; schema: StandardSchemaV1 })[],
    options?: { multi?: boolean },
);
```

### `jsonPaths: (JSONPath | { path: JSONPath; schema: StandardSchemaV1 })[]`

The first argument to `JSONParseStream` is an array specifying what objects to emit from the stream. The `JSONPath` type is a string containing a JSONPath query. JSONPath is a query language for JSON to let you pick out specific values from a JSON object.

(The `JSONPath` type is just a slightly more restrictive version of a string. I wish it could completely parse and validate the JSONPath syntax, but currently it just enforces some little things like that it must start with a `$`.)

In many cases, you'll just have one JSONPath query, like:

```json
["$.foo[*]"]
```

but you can have as many as you want:

```json
["$.foo[*]", "$.bar", "$.bar.baz"]
```

> [!IMPORTANT]
> **json-web-streams only supports a subset of JSONPath.** See the [JSONPath](#jsonpath) section below for more details and examples. But to briefly explain what a typical JSONPath query means:
>
> `$.foo[*]` can be broken into three parts:
>
> `$` refers to the root node of the JSON object\
> `.foo` is similar to accessing an object property in JS, so this is the `foo` property of the root node\
> `[*]` means "every value in this array or object"
>
> In total this query means "emit every value in the array/object in the `foo` property of the overall JSON object". So for this JSON `{ foo: ["A", "B", "C"] }` it would emit the three values `"A"`, `"B"`, and `"C"`.

The values of the `jsonPaths` array can either be `JSONPath` strings, or objects like `{ path: JSONPath; schema: StandardSchemaV1 }` where `schema` is a schema validator from any library supporting the [Standard Schema specification](https://github.com/standard-schema/standard-schema) such as Zod, Valibot, or ArkType. When you supply a schema like this, each value will be validated before it is emitted by the stream, and emitted values will have correct TypeScript types rather than being `unknown`. For more details, see the [Schema validation and types for `JSONParseStream` output](#schema-validation-and-types-for-jsonparsestream-output) section below.

### `options?: { multi?: boolean }`

There are various [JSON streaming formats](https://en.wikipedia.org/wiki/JSON_streaming) that make it more convenient to stream JSON by omitting the opening/closing tags and instead emitting multiple JSON objects sequentially. Some of these formats are:

- JSON Lines (JSONL) aka Newline Delimited JSON (NDJSON) - JSON objects are separated by \n
- JSON Text Sequences aka json-seq - JSON objects are separated by the unicode record separator character ␞
- Concatenated JSON - JSON objects are simply concatenated with nothing in between.

Setting `multi` to `true` enables support for all of those streaming JSON formats. It's actually a little more permissive - it allows any combination of whitespace and the unicode record separator between JSON objects.

> [!TIP]
> If you want to emit every one of these individual JSON objects, use the JSONPath query `$` which means "emit the entire object", so in `multi` mode it will emit each of the individual objects.

### `JSONParseStream` input

`new JSONParseStream(jsonPaths)` returns a [TransformStream](https://developer.mozilla.org/en-US/docs/Web/API/TransformStream), meaning that it receives some input (e.g. from a ReadableStream) and emits some output (e.g. to a WritableStream).

Inputs to the `JSONParseStream` stream must be strings. If you have a stream emitting some binary encoded text (such as from `fetch`), pipe it through `TextDecoderStream` first:

```ts
const response = await fetch("https://example.com/data.json");
const stream = response.body
	.pipeThrough(new TextDecoderStream())
	.pipeThrough(new JSONParseStream(["$.foo[*]"]));
```

### `JSONParseStream` output

Output from `JSONParseStream` has this format:

```ts
type JSONParseStreamOutput<T = unknown> = {
	value: T;
	path: JSONPath;
	wildcardKeys?: string[];
};
```

`value` is the value selected by one of your JSONPath queries.

`path` is the JSONPath query (from the `jsonPaths` parameter of `JSONParseStream`) that matched `value`.

If you only have one JSONPath query, you can ignore `path`. But if you have more than one, `path` may be helpful when processing stream output to distinguish between different types of values. For example:

<!-- prettier-ignore -->
```ts
await new ReadableStream({
		start(controller) {
			controller.enqueue('{ "foo": [1, 2], "bar": ["a", "b", "c"] }');
			controller.close();
		},
	})
	.pipeThrough(new JSONParseStream(["$.bar[*]", "$.foo[*]"]))
	.pipeTo(
		new WritableStream({
			write(record) {
				if (record.path === "$.bar[*]") {
					// Do something with the values from bar
				} else {
					// Do something with the values from foo
				}
			},
		}),
	);
```

`wildcardKeys` is defined when you have a wildcard in an object (not an array) somewhere in your JSONPath. For example:

<!-- prettier-ignore -->
```ts
await new ReadableStream({
		start(controller) {
			controller.enqueue('{ "foo": [1, 2], "bar": ["a", "b", "c"] }');
			controller.close();
		},
	})
	.pipeThrough(new JSONParseStream(["$[*]"]))
	.pipeTo(
		new WritableStream({
			write(record) {
				console.log(record);
			},
		}),
	);
// Output:
// { path: "$[*]", value: [1, 2], wildcardKeys: ["foo"] },
// { path: "$[*]", value: ["a", "b", "c"], wildcardKeys: ["bar"] },
```

The purpose of `wildcardKeys` is to allow you to easily distinguish different types of objects. `wildcardKeys` has one entry for each wildcard object in your JSONPath query.

> [!WARNING]
> It is possible to have two JSONPath queries that output overlapping objects, like if your data is `{ "foo": [1, 2] }` and you query for both `$` and `$.foo`. This will emit two objects: `{ foo: [1, 2] }` and `[1, 2]`. Due to how json-web-streams works internally, both of those objects share the same array instance, meaning that if the array in one is mutated it will affect the other.
>
> Some schema validation libraries do a deep clone of objects they validate. In that case, you won't have this issue. Otherwise, in the rare case that you query for overlapping objects, you will have to handle this problem, such as by deep cloning one of the objects.

#### Schema validation and types for `JSONParseStream` output

If you want to validate the objects as they stream in, json-web-streams integrates with any schema validation library that supports the [Standard Schema specification](https://github.com/standard-schema/standard-schema), such as Zod, Valibot, and ArkType.

To use schema validation for a JSONPath query, then pass an object `{ path: JSONPath; schema: StandardSchemaV1 }` rather just a string `JSONPath`. Then each value will be validated before being output by the stream, and the correct TypeScript types will be propagated through the stream as well.

<!-- prettier-ignore -->
```ts
import * as z from "zod";

await new ReadableStream({
		start(controller) {
			controller.enqueue('{ "foo": [1, 2], "bar": ["a", "b", "c"] }');
			controller.close();
		},
	})
	.pipeThrough(
		new JSONParseStream([
			{ path: "$.foo[*]", schema: z.number() },
			{ path: "$.bar[*]", schema: z.string() },
		]),
	)
	.pipeTo(
		new WritableStream({
			write(record) {
				if (record.path === "$.foo[*]") {
					// Type of record.value is number
				} else {
					// Type of record.value is string
				}
			},
		}),
	);
```

> [!TIP]
> If you only want to validate some values, you can mix `{ path: JSONPath; schema: StandardSchemaV1 }` and `JSONPath` in the `jsonPaths` array.

For JSONPath queries with no schema, emitted values will have the `unknown` type.

## JSONPath

json-web-streams supports a subset of JSONPath. Currently the supported components are:

- **The root node**, represented by the symbol `$` which must be the first character of any JSONPath query.

- **Name selectors** which are like accessing a property in a JS object. For instance if you have an object like `{ "foo": { bar: 5 } }`, then `$.foo.bar` refers to the value `5`. You can also write this in the more verbose bracket notation like `$["foo"]["bar"]` or `$["foo", "bar"]`, which is useful if your key names include characters that need escaping. You can also mix them like `$.foo["bar"]` or use single quotes like `$['foo']['bar']` - all of these JSONPath queries have the same meaning.

- **Wildcard selectors** which select every value in an array or object. With this JSON `{ "foo": { "a": 1, "b": 2, "c": 3 } }`, the JSONPath query `$.foo[*]` would emit the three individual numbers `1`, `2`, and `3`. If the inner object was changed to an array like `{ "foo": [1, 2, 3] }`, the same JSONPath query would emit the same values.

You can combine these selectors as deep as you want. For instance, if instead you have an array of objects you can select values inside those individual objects with a query like `$.foo[*].bar`. Applying that to this data:

```json
{ "foo": [{ "bar": 1 }, { "bar": 2 }, { "bar": 3 }] }
```

would emit `1`, `2`, and `3`.

Or if the array is at the root if the object like this data:

```json
[{ "x": 1 }, { "x": 2 }, { "x": 3 }]
```

then you'd write something like `$[*]` to emit each object (`{ x: 1}`, `{x: 2}`, `{x: 3}`), or `$[*].key` to emit just the numbers (`1`, `2`, `3`).

To emit the whole object at once (okay in that case you wouldn't use this library, but maybe just for testing, or for `multi` mode) you just use `$`.

> [!TIP]
> If you want to play around with JSONPath queries to make sure you understand what they are doing, [jsonpath.com](https://jsonpath.com/) is a great website that lets you easily run a JSONPath query on some data.

## JSONParseStream examples

There are several examples above in code blocks throughout the README, and here are a few more!

### `wildcardKeys` vs. multiple entries in `jsonPaths`

Sometimes there are multiple ways to achieve your goal.

Let's say you have this JSON:

```json
{ "foo": [1, 2], "bar": ["a", "b", "c"] }
```

You want to get all the values in `foo` and all the values in `bar`. You could define them as two separate JSONPath queries and then distinguish the output with `.path`:

<!-- prettier-ignore -->
```ts
await new ReadableStream({
		start(controller) {
			controller.enqueue('{ "foo": [1, 2], "bar": ["a", "b", "c"] }');
			controller.close();
		},
	})
	.pipeThrough(
		new JSONParseStream(["$.foo[*]", "$.bar[*]"]),
	)
	.pipeTo(
		new WritableStream({
			write(record) {
				if (record.path === "$.foo[*]") {
					// 1, 2
				} else {
					// a, b, c
				}
			},
		}),
	);
```

Or you could use one JSONPath query with a wildcard, and then use `.wildcardKeys` to distinguish the objects:

<!-- prettier-ignore -->
```ts
await new ReadableStream({
		start(controller) {
			controller.enqueue('{ "foo": [1, 2], "bar": ["a", "b", "c"] }');
			controller.close();
		},
	})
	.pipeThrough(
		new JSONParseStream(["$[*][*]"]),
	)
	.pipeTo(
		new WritableStream({
			write(record) {
				if (record.wildcardKeys[0] === "foo") {
					// 1, 2
				} else {
					// a, b, c
				}
			},
		}),
	);
```

Using multiple JSONPath queries is a little more explicit, but using wildcard keys is more concise, especially if you had more than just two types of objects. And instead of known keys like `foo` and `bar` your JSON had some unknown keys, then using a wildcard would be your only option.

But a nice thing about multiple JSONPath queries is that you can add schema validation to ensure your data is the correct format and give you nice TypeScript types. Whereas if you are using `wildcardKeys` to distinguish types, there is currently no way to use that information in schema validation.

In this example, Zod schemas enforce that `record.value` is either a `string` or `number` as appropriate, rather than `unknown`:

<!-- prettier-ignore -->
```ts
import * as z from "zod";

await new ReadableStream({
		start(controller) {
			controller.enqueue('{ "foo": [1, 2], "bar": ["a", "b", "c"] }');
			controller.close();
		},
	})
	.pipeThrough(
		new JSONParseStream([
			{ path: "$.foo[*]", schema: z.number() },
			{ path: "$.bar[*]", schema: z.string() },
		]),
	)
	.pipeTo(
		new WritableStream({
			write(record) {
				if (record.path === "$.foo[*]") {
					// 1, 2
				} else {
					// a, b, c
				}
			},
		}),
	);
```

## Future

JSONStringifyStream - Whenever I've had to do this in the past, it winds up being some messy ad hoc thing, but also it's a lot easier to write than messy ad hoc parsing code. So this is less valuable than JSONParseStream, and I'm less sure what the API should be.

Would be nice to emit multiIndex property like in e6decb064d6a8ba9594c33a5d9f9e6dc5acd74d7 but the TypeScript gets complicated

More JSONPath stuff https://www.rfc-editor.org/rfc/rfc9535.html

- in array (stackToPathArray will need to get more specific than assuming every array is "wildcard")
  - index
  - negative index
  - slice with one side unbounded
  - slice with negative index and one side unbounded
  - slice between two numbers
  - step size like 1:2:9, in all of the above situations
  - filter expression (starting with ?)
- functions at tail end of path (like min, max, etc)
  - can there be multiple?
  - @ referencing this object
  - $ referencing root object
- .. deep scan

better JSONPath type

more concise examples, when browser support is better

- consume with for await rather than WriteableStream
- use ReadableStream.from rather than more verbose syntax
