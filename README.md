# json-web-streams

Streaming JSON parser built on top of the Web Streams API, so it works in web browsers and Node.js.

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

```js
import { JSONParseStream } from "json-web-streams";

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
> If you don't have to support Safari, [most other environments](https://caniuse.com/mdn-api_readablestream_--asynciterator) let you use a nicer syntax for consuming stream output:
>
> ```js
> const stream = response.body
> 	.pipeThrough(new TextDecoderStream())
> 	.pipeThrough(new JSONParseStream(["$[*]"]));
> for await (const { value } of stream) {
> 	console.log(value);
> }
> ```
>
> Another nice function is `Array.fromAsync` which you can use like:
>
> ```js
> const values = await Array.fromAsync(stream, (chunk) => chunk.value);
> // values now contains [{ "x": 1 }, { "x": 2 }, { "x": 3 }]
> ```

## API

`const jsonParseStream = new JSONParseStream(jsonPaths: string[], options?: Options)`

### `jsonpaths: string[]`

The first argument to `JSONParseStream` is an array of strings specifying what objects to emit from the stream. In many cases, you'll just have one value in this array, like:

```js
["$.foo[*]"];
```

but you can have as many as you want:

```js
["$.foo[*]", "$.bar", "$.bar.baz"];
```

The syntax for these strings is a subset of [JSONPath](https://en.wikipedia.org/wiki/JSONPath). Currently the only supported components are:

- **Child segments** which are like accessing a property in a JS object. For instance if you have an object like `{ foo: { bar: 5 } }`, then `$.foo.bar` refers to the value `5`. You can also write this in the more verbose bracket notation like `$["foo"]["bar"]`, which is useful if your key names include characters that need escaping. You can also mix them like `$.foo["bar"]` or use single quotes like `$['foo']['bar']` - all of these JSONPath queries have the same meaning.

- **Wildcard arrays** which select every element in an array. For example, with an object `{ foo: [1, 2, 3] }`, the JSONPath query `$.foo[*]` would emit the three individual numbers. If instead you have an array of objects, you can select values inside those individual objects with a query like `$.foo[*].bar`.

### `options?: Options`

### `JSONParseStream` input

`new JSONParseStream(jsonPaths)` returns a [TransformStream](https://developer.mozilla.org/en-US/docs/Web/API/TransformStream), meaning that it receives some input (e.g. from a ReadableStream) and emits some output (e.g. to a WritableStream).

Input to `JSONParseStream` must be strings. If you have a stream emitting some binary encoded text (such as from `fetch`), then you can pipe it through `TextDecoderStream` first:

```js
const response = await fetch("https://example.com/data.json");
const stream = response.body
	.pipeThrough(new TextDecoderStream())
	.pipeThrough(new JSONParseStream(["$.foo[*]"]));
```

### `JSONParseStream` output

Output from `JSONParseStream` has this format:

```js
{
    value: unknown,
    index: number,
}
```

`value` is the value selected from one of your JSONPath queries.

`index` is the index in the `jsonPaths` array for the specific JSONPath query that matched `value`.

If you only have one JSONPath query, you can ignore `index`. But if you have more than one, `index` may be helpful when processing stream output, for example:

```js
// readableStream emits { foo: [1, 2], bar: ["a", "b", "c"] }
const stream = readableStream.pipeThrough(
	new JSONParseStream(["$.bar[*]", "$.foo[*]"]),
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

#### TypeScript for `JSONParseStream` output

If you know the types of the values you are emitting, you can use TypeScript. `JSONParseStream` accepts one generic type, an array of the same size as the `jsonPaths` array, where each element corresponds to the type of object emitted by each JSONPath.

```js
// readableStream emits { foo: [1, 2], bar: ["a", "b", "c"] }
const stream = readableStream.pipeThrough(
	new JSONParseStream() < string,
	number > ["$.bar[*]", "$.foo[*]"],
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

It would emit `{ "x": 1 }`, `{ "x": 2 }`, and `{ "x": 3 }`.

For a property inside the array (like getting all the values of `x` from `{ "foo": [{ "x": 1 }, { "x": 2 }, { "x": 3 }] }`), you'd write it as `$.foo[*].x` and it would emit the values `1`, `2`, and `3`.

Or if the array is at the root if the object like the initial example `[{ "x": 1 }, { "x": 2 }, { "x": 3 }]` then you'd write something like `$[*]` to emit each object, or `$[*].key` to emit just the numbers.

And to collect the whole object (okay in that case you wouldn't use this library, but maybe just for testing) you just use `$`.

## Plan

support JSON Lines, NDJSON, json-seq, or just multiple JSON objects, with an option

- support all these https://en.wikipedia.org/wiki/JSON_streaming#Approaches
- remove check for seenRootObject and ignore delimeter, whatever it is. whitespace already automatically gets ignored
- option multi: true enables all of these
- add to options and output docs
- is multi the best name for the option? which spec is most common, could call it that?

output jsonPath or index? or both?

Support validating schema of emitted objects

- use this to determine the type of emitted objects too, rather than generic

add example for multiple jsonPaths

$[*] should select all keys of an object

$['foo','bar'] syntax

## Future

stringify

More JSONPath stuff https://www.rfc-editor.org/rfc/rfc9535.html

- in array
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
- wildcard keys
  - emit the matched keys as an array
- multiple selectors in bracket notation like ['foo', 'bar]

Would be nice to emit multiIndex property like in e6decb064d6a8ba9594c33a5d9f9e6dc5acd74d7 but I couldn't figure out how to get it to play nice with TypeScript
