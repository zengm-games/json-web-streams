# 1.2.0 (2026-09-26)

- Performance improvements, around 3x faster for typical usage.

- More informative error messages for invalid numbers, pointing to the specific character that made the number invalid

- JSONPath queries with multiple selectors in brackets, like `$["foo", "bar"]` or `$["foo", *]`, now throw an error. Previously they were incorrectly treated as nested keys (`$.foo.bar`), but in the JSONPath spec they mean "foo or bar", which is not supported yet

- Fixed a lone `0` or `-0` as the entire JSON input failing to parse

- Fixed incomplete input (like `tru` or an unterminated string) being silently accepted at the end of the stream in `multi` mode

- Fixed invalid `\u` escapes in strings (like `\u12zz`) being accepted rather than causing an error

- Fixed unpaired surrogates from `\u` escapes (like `"\uD800abc"`) being dropped or moved into a later string, rather than being preserved like in `JSON.parse`

# 1.1.0 (2025-10-21)

- Significant performance improvements, particularly when using many JSONPath queries at once

- The `path` property on output objects is now named `key`, and its value can be overwritten by corresponding `key` values in the `jsonPaths` parameter

# 1.0.0 (2025-10-18)

- Initial release
