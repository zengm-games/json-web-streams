# JSON Web Streams

Streaming JSON parser built on top of web streams.

## Use case

Imagine you have some JSON like:

```json
[{"key": 1}, {"key": 2}, {"key": 3}]
```

You can just `JSON.parse` it and get whatever you want from it. But what if there are so many objects that it becomes very slow to do that, or you even run out of memory?

By using this library, you can stream through the JSON object. This code will do that, printing out each object as it is parsed, without reading the entire JSON file into memory:

```js
import { JSONParseStream } from "@dumbmatter/json-web-streams";

const response = await fetch("https://example.com/data.json");
const stream = response.body.pipeThrough(new JSONParseStream([["[*]"]]));
for await (const [object, index] of stream) {
    console.log(object);
}

// Output:
// {"key": 1}
// {"key": 2}
// {"key": 3}
```

## API

`new JSONParseStream(queryPaths: QueryPath[])` - A "query path" defines which objects are emitted by the stream. It is an array of strings, with each element in the array going deeper into the object.

In the example above, `["[*]"]` means "emit every object within the array at the root of the JSON object.

If you were interested in a nested array, something like `{"foo": [{"key": 1}, {"key": 2}, {"key": 3}]}`, you'd write it as `["foo", "[*]"]`.

Or a property inside the array (like getting all the values of `key` from `{"foo": [{"key": 1}, {"key": 2}, {"key": 3}]}`), you'd write it as `["foo", "[*]", "key"]`.

Or to collect the whole object (okay in this case you wouldn't use this library, but maybe just for testing) you're use an empty array `[]`.

You can pass multiple query paths to `JSONParseStream`, in which case they will all be listened for (even if they overlap, like one is the child of another) and they will all be emitted as they come in the JSON stream. To distinguish between them, the emitted objects look like `[any, number]` where `any` is the object found in the JSON, and `number` is the index of its query path in the `queryPaths` argument (0 for the first one, 1 for the second, etc.)

## Plan

Error if root is not array or object

overwrite every value with undefined, or just object/array?

name package "JSON Web Stream" or "JSON Web Streams"

test JSON parser strictness
- https://github.com/nst/JSONTestSuite

typescript - queryStrings must have length at least 1, or it's not doing anything

## Future

Support wildcard keys of an object, somehow emit the wildcard value or full path as 3rd argument

Make queryPaths more like JSONPath https://chatgpt.com/c/68ed9b56-2b98-8330-976f-51b459db49ce
