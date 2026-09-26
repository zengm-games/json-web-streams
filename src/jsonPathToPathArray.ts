import parser from "jsonpath-rfc9535/parser";

export type PathArray = (
	| {
			type: "key";
			value: string;
	  }
	| {
			type: "wildcard";
	  }
)[];

// Would be nice to be more strict than this, but I think it's not possible
export type JSONPath = "$" | `$${"." | "["}${string}`;

export const jsonPathToPathArray = (path: JSONPath): PathArray => {
	let parsed;
	try {
		parsed = parser(path);
	} catch (error) {
		throw new Error(`Error parsing JSONPath "${path}"`, { cause: error });
	}
	return parsed.segments.map((segment) => {
		if (segment.type === "ChildSegment") {
			const node = segment.node;
			if (node.type === "MemberNameShorthand") {
				return { type: "key", value: node.value };
			} else if (node.type === "BracketedSelection") {
				// Multiple selectors like $['foo','bar'] are a union (select foo OR bar), which is not supported
				if (node.selectors.length !== 1) {
					throw new Error(
						`Multiple selectors in brackets are not supported in JSONPath "${path}"`,
					);
				}
				const selector = node.selectors[0]!;
				if (selector.type === "NameSelector") {
					return {
						type: "key",
						value: selector.value,
					};
				} else if (selector.type === "WildcardSelector") {
					return { type: "wildcard" };
				} else {
					throw new Error(`Unsupported node: ${JSON.stringify(node)}`);
				}
			} else if (node.type === "WildcardSelector") {
				return { type: "wildcard" };
			} else {
				throw new Error(`${segment.type} node type not supported`);
			}
		} else {
			throw new Error(`${segment.type} segment type not supported`);
		}
	});
};
