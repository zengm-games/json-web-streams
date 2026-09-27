import type { StandardSchemaV1 } from "@standard-schema/spec";
import { JSONParseStreamRaw, type Stack } from "./JSONParseStreamRaw.ts";
import {
	jsonPathToPathArray,
	type JSONPath,
	type PathArray,
} from "./jsonPathToPathArray.ts";

// Does a component of a JSONPath query match a component of the path to the current value in the JSON being parsed?
const isEqual = (
	x: PathArray[number],
	y: Pick<Stack[number], "key" | "mode">,
) => {
	if (x.type === "wildcard") {
		// Wildcard matches every value in an array or object
		return y.mode === "ARRAY" || y.mode === "OBJECT";
	}

	// Key needs to match exactly
	return y.mode === "OBJECT" && x.value === y.key;
};

type JSONParseStreamOutput<T> = T extends {
	key?: infer K | undefined;
	path: infer P extends JSONPath;
	schema?: infer S extends StandardSchemaV1 | undefined;
}
	? {
			value: S extends StandardSchemaV1
				? StandardSchemaV1.InferOutput<S>
				: unknown;
			wildcardKeys?: string[];
		} & (undefined extends K ? { key: P } : { key: K })
	: T extends JSONPath
		? { key: T; value: unknown; wildcardKeys?: string[] }
		: never;

export class JSONParseStream<
	const Key extends unknown,
	T extends readonly (
		| JSONPath
		| { key?: Key; path: JSONPath; schema?: StandardSchemaV1 }
	)[],
> extends TransformStream<string, JSONParseStreamOutput<T[number]>> {
	_parser: JSONParseStreamRaw;

	constructor(
		jsonPaths: T,
		options?: {
			multi?: boolean;
		},
	) {
		let parser: JSONParseStreamRaw;

		type JSONPathInfo = {
			key: Key | undefined;
			path: JSONPath;
			pathArray: PathArray;
			validate: StandardSchemaV1["~standard"]["validate"] | undefined;
			wildcardIndexes: number[] | undefined;
		};

		const jsonPathInfos: JSONPathInfo[] = jsonPaths.map((row) => {
			let key;
			let path;
			let schema;
			if (typeof row === "string") {
				path = row;
			} else {
				key = row.key;
				path = row.path;
				schema = row.schema;
			}

			const pathArray = jsonPathToPathArray(path);

			let wildcardIndexes: number[] | undefined;
			for (const [i, component] of pathArray.entries()) {
				if (component.type === "wildcard") {
					if (wildcardIndexes === undefined) {
						wildcardIndexes = [];
					}
					wildcardIndexes.push(i);
				}
			}

			return {
				key,
				path,
				pathArray,
				validate: schema?.["~standard"].validate,
				wildcardIndexes,
			};
		});

		// levels[depth] tracks the JSONPath queries that match the path to the current value at that depth (depth being the number of objects/arrays it's inside of). As the parser enters/leaves objects/arrays and sees new object keys, levels is updated by checking just one component of each query, rather than the entire query.
		type Level = {
			// Queries where the first `depth` components match the path to the current value
			jsonPathInfos: JSONPathInfo[];

			// Some query matches the current value, meaning it should be emitted
			matchesHere: boolean;

			// Some query matches a value containing the current value, so the current value needs to be kept in memory until that is emitted
			matchesAbove: boolean;

			// Some query could match something inside the current value (if it is an object/array)
			matchesBelow: boolean;
		};

		const makeLevel = (
			jsonPathInfos: JSONPathInfo[],
			depth: number,
			matchesAbove: boolean,
		): Level => {
			return {
				jsonPathInfos,
				matchesHere: jsonPathInfos.some(
					(info) => info.pathArray.length === depth,
				),
				matchesAbove,
				matchesBelow: jsonPathInfos.some(
					(info) => info.pathArray.length > depth,
				),
			};
		};

		// At the root, all queries match so far
		const levels = [makeLevel(jsonPathInfos, 0, false)];

		// Called when entering an object/array or seeing a new object key, to find which queries from the parent level also match the last component of the current path
		const updateLevel = (depth: number) => {
			const parent = levels[depth - 1]!;
			const jsonPathInfos = parent.jsonPathInfos.filter(
				(info) =>
					info.pathArray.length >= depth &&
					isEqual(info.pathArray[depth - 1]!, parser),
			);
			levels[depth] = makeLevel(
				jsonPathInfos,
				depth,
				parent.matchesAbove || parent.matchesHere,
			);
		};

		super({
			start(controller) {
				parser = new JSONParseStreamRaw({
					multi: options?.multi,

					// An object/array can be parsed all at once if no JSONPath query could match anything inside it
					parseWholeValue: () => !levels[parser.stack.length]!.matchesBelow,

					onKey: updateLevel,
					onPush: updateLevel,
					onPop: (depth) => {
						levels.length = depth + 1;
					},

					onValue: (value) => {
						const depth = parser.stack.length;
						const level = levels[depth]!;

						if (level.matchesHere) {
							for (const {
								key,
								path,
								pathArray,
								validate,
								wildcardIndexes,
							} of level.jsonPathInfos) {
								if (pathArray.length !== depth) {
									continue;
								}

								let valueToEmit;
								if (validate) {
									const result = validate(value);
									if (result instanceof Promise) {
										throw new TypeError(
											"Schema validation must be synchronous",
										);
									}

									// if the `issues` field exists, the validation failed
									if (result.issues) {
										throw new Error(JSON.stringify(result.issues, null, 2));
									}

									valueToEmit = result.value;
								} else {
									valueToEmit = value;
								}

								let wildcardKeys: string[] | undefined;
								if (wildcardIndexes) {
									for (const index of wildcardIndexes) {
										const stackComponent = parser.stack[index + 1] ?? parser;
										if (
											stackComponent.mode === "OBJECT" &&
											stackComponent.key !== undefined
										) {
											if (!wildcardKeys) {
												wildcardKeys = [];
											}
											wildcardKeys.push(stackComponent.key as string);
										}
									}
								}

								// Casting to any is needed because jsonPathInfos is broader than it should be - it should be constrained so path is one of the input paths, and valueToEmit is the correct type if a schema is present
								if (wildcardKeys) {
									controller.enqueue({
										key: key ?? path,
										value: valueToEmit,
										wildcardKeys,
									} as any);
								} else {
									controller.enqueue({
										key: key ?? path,
										value: valueToEmit,
									} as any);
								}
							}
						}

						if (level.matchesAbove) {
							// Still building a larger value to emit later, so we need to keep this
							return;
						}

						// Doesn't match pathArray, don't need to keep, but only worry about arrays/objects. Or delete this branch and it will overwrite these primitive values too.
						const type = typeof value;
						if (
							!(
								type === "string" ||
								type === "number" ||
								type === "boolean" ||
								value === null
							)
						) {
							// Now that we have emitted the object we want, we no longer need to keep track of all the values on the stack. This avoids keeping the whole JSON object in memory.
							for (const row of parser.stack) {
								row.value = undefined;
							}

							// Also, when processing an array/object, this.value will contain the current state of the array/object. So we should delete the value there too, but leave the array/object so it can still be used by the parser
							if (
								typeof parser.value === "object" &&
								parser.value !== null &&
								parser.key !== undefined
							) {
								parser.value[parser.key] = undefined;
							}
						}
					},
				});
			},

			transform(chunk) {
				parser.write(chunk);
			},

			flush() {
				parser.checkEnd();
			},
		});

		// We know parser is defined because `start` runs synchronously
		this._parser = parser!;
	}
}
