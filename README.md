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
import { JSONParserStream } from "json-web-streams";

const response = await fetch("https://example.com/data.json");
await response.body
	.pipeThrough(new TextDecoderStream())
	.pipeThrough(new JSONParserStream(["$[*]"]))
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
> 	.pipeThrough(new JSONParserStream(["$[*]"]));
> for await (const { value } of stream) {
> 	console.log(value);
> }
> ```

## API

```ts
const jsonParserStream = new JSONParserStream(
    jsonPaths: string[],
    options?: { multi?: boolean },
);
```

### `jsonpaths: string[]`

The first argument to `JSONParserStream` is an array of strings specifying what objects to emit from the stream. In many cases, you'll just have one value in this array, like:

```ts
["$.foo[*]"];
```

but you can have as many as you want:

```ts
["$.foo[*]", "$.bar", "$.bar.baz"];
```

The syntax for these strings is a subset of [JSONPath](https://en.wikipedia.org/wiki/JSONPath). Currently the only supported components are:

- **Name selectors** which are like accessing a property in a JS object. For instance if you have an object like `{ "foo": { bar: 5 } }`, then `$.foo.bar` refers to the value `5`. You can also write this in the more verbose bracket notation like `$["foo"]["bar"]` or `$["foo", "bar"]`, which is useful if your key names include characters that need escaping. You can also mix them like `$.foo["bar"]` or use single quotes like `$['foo']['bar']` - all of these JSONPath queries have the same meaning.

- **Wildcard selectors** which select every value in an array or object. For object values, with an object like `{ "foo": { "a": 1, "b": 2, "c": 3 } }`, the JSONPath query `$.foo[*]` would emit the three individual numbers `1`, `2`, and `3`. And for array values, with an object `{ "foo": [1, 2, 3] }`, the same JSONPath query `$.foo[*]` would emit those same values.

> [!TIP]
> You can combine these selectors as deep as you want. For instance, if instead you have an array of objects rather than numbers like in the previous example, you can select values inside those individual objects with a query like `$.foo[*].bar`.

### `options?: { multi?: boolean }`

There exist various [JSON streaming formats](https://en.wikipedia.org/wiki/JSON_streaming) that basically make it more convenient to stream JSON by omitting the opening/closing tags and instead emitting multiple JSON objects sequentially. Some of these formats are:

- JSON Lines (JSONL) aka Newline Delimited JSON (NDJSON) - JSON objects are separated by \n
- JSON Text Sequences aka json-seq - JSON objects are separated by the unicode record separator character ␞
- Concatenated JSON - JSON objects are simply concatenated with nothing in between.

Setting `multi` to `true` enables support for all of those streaming JSON formats. It's actually a little more permissive - it allows any combination of whitespace and the unicode record separator between JSON objects.

> [!TIP]
> If you want to emit every one of these individual JSON objects, use the JSONPath query `$` which normally means "emit the entire object", but in `multi` mode it will emit each of the individual objects.

### `JSONParserStream` input

`new JSONParserStream(jsonPaths)` returns a [TransformStream](https://developer.mozilla.org/en-US/docs/Web/API/TransformStream), meaning that it receives some input (e.g. from a ReadableStream) and emits some output (e.g. to a WritableStream).

Input to `JSONParserStream` must be strings. If you have a stream emitting some binary encoded text (such as from `fetch`), pipe it through `TextDecoderStream` first:

```ts
const response = await fetch("https://example.com/data.json");
const stream = response.body
	.pipeThrough(new TextDecoderStream())
	.pipeThrough(new JSONParserStream(["$.foo[*]"]));
```

### `JSONParserStream` output

Output from `JSONParserStream` has this format:

```ts
{
    value: unknown,
    index: number,
    wildcardKeys?: string[],
}
```

`value` is the value selected from one of your JSONPath queries.

`index` is the index in the `jsonPaths` array for the specific JSONPath query that matched `value`.

If you only have one JSONPath query, you can ignore `index`. But if you have more than one, `index` may be helpful when processing stream output, for example:

```ts
// readableStream emits { foo: [1, 2], bar: ["a", "b", "c"] }
const stream = readableStream.pipeThrough(
	new JSONParserStream(["$.bar[*]", "$.foo[*]"]),
);
const records = await Array.fromAsync(stream, (chunk) => chunk.value);
// records now contains [
// 	{ value: 1, index: 1 },
// 	{ value: 2, index: 1 },
// 	{ value: "a", index: 0 },
// 	{ value: "b", index: 0 },
// 	{ value: "c", index: 0 },
// ]
```

The children of `foo` have `index: 0` and the children of `bar` have `index: 1`.

`wildcardKeys` is defined when you have a wildcard in an object (not an array) somewhere in your JSONPath. For example:

```ts
// readableStream emits { foo: [1, 2], bar: ["a", "b", "c"] }
const stream = readableStream.pipeThrough(new JSONParserStream(["$[*]"]));
const records = await Array.fromAsync(stream, (chunk) => chunk.value);
// records now contains [
// 	{ value: [1, 2], index: 0, wildcardKeys: ["foo"] },
// 	{ value: ["a", "b", "c"], index: 1, wildcardKeys: ["bar"] },
// ]
```

The purpose of `wildcardKeys` is to allow you to easily distinguish different types of objects. `wildcardKeys` has one entry for each wildcard object in your JSONPath query.

#### TypeScript for `JSONParserStream` output

If you know the types of the values you are emitting, you can use TypeScript. `JSONParserStream` accepts one generic type, an array of the same size as the `jsonPaths` array, where each element corresponds to the type of object emitted by each JSONPath.

```ts
// readableStream emits { foo: [1, 2], bar: ["a", "b", "c"] }
const stream = readableStream.pipeThrough(
	new JSONParserStream<string, number>(["$.bar[*]", "$.foo[*]"]),
);
const records = await Array.fromAsync(stream, (chunk) => chunk.value);
// type of records is [{ value: string; index: 0 } | { value: number; index: 1 }]
for (const record of records) {
	if (record.index === 0) {
		// type of record.value is string
	} else {
		// type of record.value is number
	}
}
```

If you don't specify the generic type parameter, then the type of `record` is `[{ value: unknown; index: 0 } | { value: unknown; index: 1 }]`.

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

output jsonPath or index? or both?

- consider what the API would be with validator functions, might be an object with jsonPath keys and function values

Support validating schema of emitted objects

- https://github.com/standard-schema/standard-schema
- use this to determine the type of emitted objects too, rather than generic
- how does this work with wildcardKeys, might want to use that to apply different types
- could this replace the generic class parameter? if so, maybe add back multiIndex
- can this also support arbitray TypeScript type guards? or read the return type of a function or something?
- https://github.com/standard-schema/standard-schema?tab=readme-ov-file#how-do-i-accept-standard-schemas-in-my-library
- do i need to support async? https://github.com/standard-schema/standard-schema?tab=readme-ov-file#how-to-only-allow-synchronous-validation
- clone still needed?
  - included in zod parse https://zod.dev/basics?id=parsing-data what about others?
- can we keep the array syntax as a backup? if not, then the "no validation" syntax would be weird, like {"$.foo": null}

wildcardKeys - how does it work with types?

benchmark?

## Future

JSONStringifyStream - Whenever I've had to do this in the past, it winds up being some messy ad hoc thing, but also it's a lot easier to write than messy ad hoc parsing code. So this is less valuable than JSONParserStream, and I'm less sure what the API should be.

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

Would be nice to emit multiIndex property like in e6decb064d6a8ba9594c33a5d9f9e6dc5acd74d7 but I couldn't figure out how to get it to play nice with TypeScript
