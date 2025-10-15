# json-web-streams

Streaming JSON parser built on top of web streams.

## Use case

Imagine you have some JSON like:

```json
[{ "x": 1 }, { "x": 2 }, { "x": 3 }]
```

You can just `JSON.parse` it and get whatever you want from it. But what if it's so big that it's very slow to do that, or you even run out of memory?

By using this library, you can stream through the JSON object. Here's an example that prints out each object as it is parsed, without ever reading the entire JSON object into memory:

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

## API

`new JSONParseStream(jsonPaths: string[])` - The `jsonPaths` parameter is an array of strings, where each string represents one type of element that you want to emit from your stream. The syntax is a subset of [JSONPath](https://en.wikipedia.org/wiki/JSONPath) - currently only string keys and wildcard arrays are supported. For instance `$.foo[*]` means "every element of the array inside the property "foo" of the root object". (It can also be written in the more verbose syntax `$["foo"][*]` which is necessary if the key contains a character you need to escape.) Like if you had this data:

```json
{ "foo": [{ "x": 1 }, { "x": 2 }, { "x": 3 }] }
```

It would emit `{ "x": 1 }`, `{ "x": 2 }`, and `{ "x": 3 }`.

For a property inside the array (like getting all the values of `x` from `{ "foo": [{ "x": 1 }, { "x": 2 }, { "x": 3 }] }`), you'd write it as `$.foo[*].x` and it would emit the values `1`, `2`, and `3`.

Or if the array is at the root if the object like the initial example `[{ "x": 1 }, { "x": 2 }, { "x": 3 }]` then you'd write something like `$[*]` to emit each object, or `$[*].key` to emit just the numbers.

And to collect the whole object (okay in that case you wouldn't use this library, but maybe just for testing) you just use `$`.

The `jsonPaths` parameter is an array so you can pass multiple query paths to `JSONParseStream`, in which case they will all be listened for (even if they overlap, like one is the child of another) and they will all be emitted as they come in the JSON stream. To distinguish between them, the emitted objects look like `[any, number]` where `any` is the object found in the JSON, and `number` is the index of its query path in the `queryPaths` argument (0 for the first one, 1 for the second, etc.)

## Plan

name package "JSON Web Stream" or "JSON Web Streams"

stringify

support JSON Lines, json-seq, or just multiple JSON objects, with an option

- remove check for seenRootObject and ignore delimeter, whatever it is. whitespace already automatically gets ignored
- option multi: true enables all of this, and also emits multiIndex saying which row it is

output jsonPath or index? or both?

typescript generic for output objects/indexes

Support validating schema of emitted objects

add example for multiple jsonPaths

Do I need to structuredClone value on emit? Consider nested objects, confusing if they are linked

## Future

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
