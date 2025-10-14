# JSON Web Streams

Streaming JSON parser built on top of web streams.

## Use case

Imagine you have some JSON like:

```json
[{ "x": 1 }, { "x": 2 }, { "x": 3 }]
```

You can just `JSON.parse` it and get whatever you want from it. But what if there are so many objects that it becomes very slow to do that, or you even run out of memory?

By using this library, you can stream through the JSON object. This code will do that, printing out each object as it is parsed, without reading the entire JSON file into memory:

```js
import { JSONParseStream } from "@dumbmatter/json-web-streams";

const response = await fetch("https://example.com/data.json");
const stream = response.body.pipeThrough(new JSONParseStream(["$[*]"]));
for await (const [object, index] of stream) {
	console.log(object);
}

// Output:
// {"x": 1}
// {"x": 2}
// {"x": 3}
```

## API

`new JSONParseStream(jsonPaths: string[])` - The parameter is an array of strings, where each string represents one type of element that you want to emit from your stream. The syntax is a subset of JSONPath - only string keys and wildcard arrays are supported. For instance `$.foo[*]` means "every element of the array inside the property "foo" of the root object", like if you had this data:

```json
{ "foo": [{ "x": 1 }, { "x": 2 }, { "x": 3 }] }
```

(It can also be written in the more verbose syntax `$["foo"][*]` which is necessary if the key contains a character you need to escape.)

For a property inside the array (like getting all the values of `key` from `{ "foo": [{ "x": 1 }, { "x": 2 }, { "x": 3 }] }`), you'd write it as `$.foo[*].key` and it would emit the values `1`, `2`, and `3`.

Or if the array is at the root if the object like the initial example `[{ "x": 1 }, { "x": 2 }, { "x": 3 }]` then you'd write something like `$[*]` to emit each object, or `$[*].key` to emit just the numbers.

And to collect the whole object (okay in that case you wouldn't use this library, but maybe just for testing) you just use `$`.

The `jsonPaths` parameter is an array so you can pass multiple query paths to `JSONParseStream`, in which case they will all be listened for (even if they overlap, like one is the child of another) and they will all be emitted as they come in the JSON stream. To distinguish between them, the emitted objects look like `[any, number]` where `any` is the object found in the JSON, and `number` is the index of its query path in the `queryPaths` argument (0 for the first one, 1 for the second, etc.)

## Plan

overwrite every value with undefined, or just object/array? which is faster?

name package "JSON Web Stream" or "JSON Web Streams"

https://github.com/nst/JSONTestSuite

typescript - queryStrings must have length at least 1, or it's not doing anything

test memory usage (delete values we are not interested in) - can expose parser internals somehow

stringify

## Future

Support wildcard keys of an object, somehow emit the wildcard value or full path as 3rd argument

Make queryPaths more like JSONPath https://chatgpt.com/c/68ed9b56-2b98-8330-976f-51b459db49ce

- jsonpath-rfc9535/parser
- https://github.com/P0lip/nimma/blob/master/src/parser/parser.mjs
