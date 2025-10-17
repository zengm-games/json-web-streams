# json-web-streams

Streaming JSON parser built on top of the Web Streams API, so it works in web browsers, Node.js, and many other environments.

## Installation

```sh
npm install json-web-streams
```

## Basic example

Imagine you have some JSON like:

```json
[{ "x": 1 }, { "x": 2 }, { "x": 3 }]
```

You can just `JSON.parse` it and then do whatever you want. But what if it's so big that it's very slow to do that, or you even run out of memory?

By using json-web-streams, you can stream through the JSON object without having to read it all into memory. Here's an example that prints out each object as it is parsed:

```ts
import { createJSONParseStream } from "json-web-streams";

const response = await fetch("https://example.com/data.json");
await response.body
	.pipeThrough(new TextDecoderStream())
	.pipeThrough(createJSONParseStream(["$[*]"]))
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
> If you don't have to support Safari, [most other environments](https://caniuse.com/mdn-api_readablestream_--asynciterator) let you use this nice syntax for consuming stream output as an async iterator:
>
> ```ts
> const stream = response.body
> 	.pipeThrough(new TextDecoderStream())
> 	.pipeThrough(createJSONParseStream(["$[*]"]));
> for await (const { value } of stream) {
> 	console.log(value);
> }
> ```

## API

```ts
const jsonParseStream = createJSONParseStream(
    jsonPaths: JSONPath[],
    options?: { multi?: boolean },
);
```

### `jsonpaths: JSONPath[]`

The first argument to `JSONParseStream` is an array of strings specifying what objects to emit from the stream. The syntax for these strings is a subset of [JSONPath](https://en.wikipedia.org/wiki/JSONPath), which is a query language for JSON.

(The `JSONPath` type here is just a slightly more restrictive version of a string. I wish it could completely parse and validate the JSONPath syntax, but currently it just enforces some little things like that it must start with a `$`.)

In many cases, you'll just have one JSONPath query, like:

```json
["$.foo[*]"]
```

but you can have as many as you want:

```json
["$.foo[*]", "$.bar", "$.bar.baz"]
```

As mentioned above, json-web-streams only supports a subset of JSONPath. Currently the only supported components are:

- **Name selectors** which are like accessing a property in a JS object. For instance if you have an object like `{ "foo": { bar: 5 } }`, then `$.foo.bar` refers to the value `5`. You can also write this in the more verbose bracket notation like `$["foo"]["bar"]` or `$["foo", "bar"]`, which is useful if your key names include characters that need escaping. You can also mix them like `$.foo["bar"]` or use single quotes like `$['foo']['bar']` - all of these JSONPath queries have the same meaning.

- **Wildcard selectors** which select every value in an array or object. For object values, with an object like `{ "foo": { "a": 1, "b": 2, "c": 3 } }`, the JSONPath query `$.foo[*]` would emit the three individual numbers `1`, `2`, and `3`. And for array values, with an object `{ "foo": [1, 2, 3] }`, the same JSONPath query `$.foo[*]` would emit those same values.

> [!TIP]
> You can combine these selectors as deep as you want. For instance, if instead you have an array of objects rather than numbers like in the previous example, you can select values inside those individual objects with a query like `$.foo[*].bar`.

See the [JSONPath examples](#jsonpath-examples) section below for more examples.

### `options?: { multi?: boolean }`

There exist various [JSON streaming formats](https://en.wikipedia.org/wiki/JSON_streaming) that basically make it more convenient to stream JSON by omitting the opening/closing tags and instead emitting multiple JSON objects sequentially. Some of these formats are:

- JSON Lines (JSONL) aka Newline Delimited JSON (NDJSON) - JSON objects are separated by \n
- JSON Text Sequences aka json-seq - JSON objects are separated by the unicode record separator character ␞
- Concatenated JSON - JSON objects are simply concatenated with nothing in between.

Setting `multi` to `true` enables support for all of those streaming JSON formats. It's actually a little more permissive - it allows any combination of whitespace and the unicode record separator between JSON objects.

> [!TIP]
> If you want to emit every one of these individual JSON objects, use the JSONPath query `$` which normally means "emit the entire object", but in `multi` mode it will emit each of the individual objects.

### `JSONParseStream` input

`createJSONParseStream(jsonPaths)` returns a [TransformStream](https://developer.mozilla.org/en-US/docs/Web/API/TransformStream), meaning that it receives some input (e.g. from a ReadableStream) and emits some output (e.g. to a WritableStream).

Input to `JSONParseStream` must be strings. If you have a stream emitting some binary encoded text (such as from `fetch`), pipe it through `TextDecoderStream` first:

```ts
const response = await fetch("https://example.com/data.json");
const stream = response.body
	.pipeThrough(new TextDecoderStream())
	.pipeThrough(createJSONParseStream(["$.foo[*]"]));
```

### `JSONParseStream` output

Output from `JSONParseStream` has this format:

```ts
{
    value: unknown,
    jsonPath: JSONPath,
    wildcardKeys?: string[],
}
```

`value` is the value selected from one of your JSONPath queries.

`jsonPath` is the JSONPath query (from the `jsonPaths` parameter of `createJSONParseStream`) that matched `value`.

If you only have one JSONPath query, you can ignore `jsonPath`. But if you have more than one, `jsonPath` may be helpful when processing stream output to distinguish between object types. For example:

```ts
// readableStream emits { "foo": [1, 2], "bar": ["a", "b", "c"] }
await readableStream
	.pipeThrough(createJSONParseStream(["$.bar[*]", "$.foo[*]"]))
	.pipeTo(
		new WritableStream({
			write(record) {
				if (record.jsonPath === "$.bar[*]") {
					// Do something with the values from bar
				} else {
					// Do something with the values from foo
				}
			},
		}),
	);
```

`wildcardKeys` is defined when you have a wildcard in an object (not an array) somewhere in your JSONPath. For example:

```ts
// readableStream emits { "foo": [1, 2], "bar": ["a", "b", "c"] }
await readableStream.pipeThrough(createJSONParseStream(["$[*]"])).pipeTo(
	new WritableStream({
		write(record) {
			console.log(record);
		},
	}),
);
// Output:
// { value: [1, 2], jsonPath: "$[*]", wildcardKeys: ["foo"] },
// { value: ["a", "b", "c"], jsonPath: "$[*]", wildcardKeys: ["bar"] },
```

The purpose of `wildcardKeys` is to allow you to easily distinguish different types of objects. `wildcardKeys` has one entry for each wildcard object in your JSONPath query.

> [!WARNING]
> It is possible to have two JSONPath queries that output overlapping objects, like if your data is `{ "foo": [1, 2] }` and you query for both `$` and `$.foo`. This will emit two objects: `{ foo: [1, 2] }` and `[1, 2]`. Due to how json-web-streams works internally, both of those objects share the same array instance, meaning that if the array in one is mutated it will affect the other.
>
> Some schema validation libraries do a deep clone of objects they validate. In that case, you won't have this issue. Otherwise, in the rare case that you query for overlapping objects, you will have to handle this problem, such as by deep cloning one of the objects.

#### Schema validation and types for `JSONParseStream` output

If you want to validate the objects as they stream in, json-web-streams integrates with any schema validation library that supports the [Standard Schema specification](https://github.com/standard-schema/standard-schema), such as Zod, Valibot, and ArkType. To use schema validation, then pass an object of `<JSONPath, StandardSchemaV1 | null>` rather than a `JSONPath[]` array.

```ts
import * as z from "zod";

// readableStream emits { "foo": [1, 2], "bar": ["a", "b", "c"] }
await readableStream
	.pipeThrough(
		createJSONParseStream({
			"$.foo[*]": z.string(),
			"$.bar[*]": z.number(),
		}),
	)
	.pipeTo(
		new WritableStream({
			write(record) {
				if (record.jsonPath === "$.foo[*]") {
					// Type of record.value is string
				} else {
					// Type of record.value is number
				}
			},
		}),
	);
```

If you only want to validate some values, use `null` rather than a schema and those values will come through as `unknown`.

If you don't want to validate any values, then you can just use the simpler `JSONPath[]` syntax, which is the same as specifying a `null` validator for each JSONPath. Then all the values will have the type `unknown`.

## JSONPath examples

`$.foo[*]` (or `$['foo'][*]` or `$["foo"][*]` in bracket notation) means "every element of the array inside the property "foo" of the root object". Like if you had this data:

```json
{ "foo": [{ "x": 1 }, { "x": 2 }, { "x": 3 }] }
```

It would emit `{ x: 1 }`, `{ x: 2 }`, and `{ x: 3 }`.

For a property inside the array (like getting all the values of `x` from `{ "foo": [{ "x": 1 }, { "x": 2 }, { "x": 3 }] }`), you'd write it as `$.foo[*].x` and it would emit the values `1`, `2`, and `3`.

Or if the array is at the root if the object like the initial example `[{ "x": 1 }, { "x": 2 }, { "x": 3 }]` then you'd write something like `$[*]` to emit each object, or `$[*].key` to emit just the numbers.

And to collect the whole object (okay in that case you wouldn't use this library, but maybe just for testing, or for `multi` mode) you just use `$`.

## Plan

Support validating schema of emitted objects

- how does this work with wildcardKeys, might want to use that to apply different types
  - https://zod.dev/api#custom or something, make an example/test
- can this also support arbitray TypeScript type guards? or read the return type of a function or something?
  - maybe https://zod.dev/api#custom is good to mention

benchmark?

More examples

something about why to use this library (web streams, well tested, JSONPath, integrated schema validation / TypeScript)

## Future

JSONStringifyStream - Whenever I've had to do this in the past, it winds up being some messy ad hoc thing, but also it's a lot easier to write than messy ad hoc parsing code. So this is less valuable than JSONParseStream, and I'm less sure what the API should be.

Would be nice to emit multiIndex property like in e6decb064d6a8ba9594c33a5d9f9e6dc5acd74d7 but the TypeScript gets complicated

More JSONPath stuff https://www.rfc-editor.org/rfc/rfc9535.html

- in array (stackToQueryPath will need to get more specific than assuming every array is "wildcard")
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
