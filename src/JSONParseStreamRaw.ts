// This is based on https://github.com/qwtel/jsonparse/ by Florian Klampfer but assumes the input is already a utf8 string, so it gets rid of a lot of complexity dealing with character encoding, and also seems to make it faster. That library in turn was based on https://github.com/creationix/jsonparse by Tim Caswell. Both of those libraries were released under the MIT license.

type Token =
	| "LEFT_BRACE"
	| "RIGHT_BRACE"
	| "LEFT_BRACKET"
	| "RIGHT_BRACKET"
	| "COLON"
	| "COMMA"
	| "TRUE"
	| "FALSE"
	| "NULL"
	| "STRING"
	| "NUMBER";

type ParserState = "VALUE" | "KEY" | "VALUE_AFTER_COMMA" | "KEY_AFTER_COMMA";

type TokenizerState =
	| "START"
	| "TRUE1"
	| "TRUE2"
	| "TRUE3"
	| "FALSE1"
	| "FALSE2"
	| "FALSE3"
	| "FALSE4"
	| "NULL1"
	| "NULL2"
	| "NULL3"
	| "NUMBER-" // After negative sign, needs a digit
	| "NUMBER0" // After a leading 0 (either no negative sign, or after negative sign), can't be followed by another digit
	| "NUMBER" // Integer digits after a leading 1-9
	| "NUMBER_DOT" // After decimal point, needs a digit
	| "NUMBER_FRACTION" // Digits after decimal point
	| "NUMBER_E" // After e/E, needs a sign or digit
	| "NUMBER_E_SIGN" // After sign of exponent, needs a digit
	| "NUMBER_EXPONENT" // Digits of exponent
	| "STRING1"
	| "STRING2"
	| "STRING3"
	| "STRING4"
	| "STRING5"
	| "STRING6";

type Mode = "OBJECT" | "ARRAY";

type Key = string | number;

type Value = any;

export type Stack = {
	key: Key | undefined;
	// oxlint-disable-next-line no-redundant-type-constituents
	value: Value | undefined;
	mode: Mode | undefined;
}[];

type OnPopPush = (stackLength: number) => void;
type OnValue = (value: Value) => void;

const isWhitespace = (n: string) =>
	n === " " || n === "\n" || n === "\r" || n === "\t";

export class JSONParseStreamRaw {
	tokenizerState: TokenizerState = "START";
	state: Token | ParserState = "VALUE";
	mode: Mode | undefined;
	stack: Stack = [];
	string: string | undefined;
	key: Key | undefined;
	value: Value;
	position = 0;
	onKey: OnPopPush | undefined;
	onPop: OnPopPush | undefined;
	onPush: OnPopPush | undefined;
	onValue: OnValue;
	unicode: string | undefined;
	seenRootObject = false;
	multi: boolean | undefined;
	multiIndex = 0;

	// Called at the start of each object/array. If it returns true, then the caller doesn't need any events from inside this object/array, so it can be parsed all at once by JSON.parse, which is much faster than parsing character by character. Only the structure of the JSON is tracked while "capturing" the text of the value (depth of nesting, and whether we're inside a string) to find where it ends, and JSON.parse does the validation. If JSON.parse fails, the captured text is re-parsed by the normal parser, to produce the same error messages as normal.
	parseWholeValue: (() => boolean) | undefined;
	captureDisabled = false;
	capturePieces: string[] | undefined;
	captureStart = 0;
	captureDepth = 0;
	captureInString = false;
	captureEscaped = false;

	constructor({
		multi,
		onKey,
		onPop,
		onPush,
		onValue,
		parseWholeValue,
	}: {
		multi?: boolean;
		onKey?: OnPopPush;
		onPop?: OnPopPush;
		onPush?: OnPopPush;
		onValue: OnValue;
		parseWholeValue?: () => boolean;
	}) {
		this.multi = multi;
		this.onKey = onKey;
		this.onPop = onPop;
		this.onPush = onPush;
		this.onValue = onValue;
		this.parseWholeValue = parseWholeValue;
	}

	charError(char: string, i: number) {
		throw new Error(
			`Unexpected ${JSON.stringify(char)} at position ${
				this.position + i
			} in state ${this.tokenizerState}`,
		);
	}

	parseError(token: Token, value: Value, i: number) {
		throw new Error(
			`Unexpected ${token}${
				value ? `(${JSON.stringify(value)})` : ""
			} at position ${this.position + i} in state ${this.state}`,
		);
	}

	shouldCapture() {
		return (
			this.parseWholeValue !== undefined &&
			!this.captureDisabled &&
			(this.state === "VALUE" || this.state === "VALUE_AFTER_COMMA") &&
			this.parseWholeValue()
		);
	}

	// Start capturing the object/array beginning at text[i]. Returns the index the main loop in write should continue from (before its i++), which is either the end of the value or the end of this chunk
	startCapture(text: string, i: number) {
		this.captureStart = this.position + i;
		this.captureDepth = 0;
		this.captureInString = false;
		this.captureEscaped = false;

		const end = this.scanCapture(text, i);
		if (end === -1) {
			// Value continues in the next chunk
			this.capturePieces = [text.slice(i)];
			return text.length - 1;
		}

		this.endCapture(text.slice(i, end + 1));
		return end;
	}

	// Find the end of the value being captured. Returns the index of the closing bracket, or -1 if the value continues past the end of this chunk
	scanCapture(text: string, start: number) {
		const l = text.length;
		let j = start;
		if (this.captureEscaped && j < l) {
			// Previous chunk ended with a backslash in a string, so skip the escaped character
			this.captureEscaped = false;
			j += 1;
		}

		let depth = this.captureDepth;
		let inString = this.captureInString;
		for (; j < l; j++) {
			const code = text.charCodeAt(j);
			if (inString) {
				if (code === 0x5c) {
					// Backslash, skip the escaped character
					j += 1;
					if (j === l) {
						this.captureEscaped = true;
					}
				} else if (code === 0x22) {
					// "
					inString = false;
				}
			} else if (code === 0x22) {
				// "
				inString = true;
			} else if (code === 0x7b || code === 0x5b) {
				// { or [
				depth += 1;
			} else if (code === 0x7d || code === 0x5d) {
				// } or ]
				depth -= 1;
				if (depth === 0) {
					return j;
				}
			}
		}

		this.captureDepth = depth;
		this.captureInString = inString;
		return -1;
	}

	endCapture(json: string) {
		this.capturePieces = undefined;

		let value;
		try {
			value = JSON.parse(json);
		} catch {
			// Invalid JSON, so parse it again with the normal parser to get an error message consistent with the rest of the parser
			this.parseCaptureStrict(json);

			// Normally the line above will throw an error, but just in case it's valid JSON that JSON.parse rejected, it will have been parsed normally and there's nothing more to do here
			return;
		}

		if (this.stack.length === 0) {
			this.seenRootObject = true;
		}
		if (this.value) {
			this.value[this.key!] = value;
		}
		this.emit(value);
	}

	parseCaptureStrict(json: string) {
		const position = this.position;
		this.position = this.captureStart;
		this.captureDisabled = true;
		this.write(json);
		this.captureDisabled = false;
		this.position = position;
	}

	write(text: string) {
		let i = 0;

		if (this.capturePieces !== undefined) {
			// Continue capturing a value from a previous chunk
			const end = this.scanCapture(text, 0);
			if (end === -1) {
				this.capturePieces.push(text);
				this.position += text.length;
				return;
			}
			this.capturePieces.push(text.slice(0, end + 1));
			this.endCapture(this.capturePieces.join(""));
			i = end + 1;
		}

		for (const l = text.length; i < l; i++) {
			const n = text[i]!;
			//console.log('character', n, this.tokenizerState);

			// Handle any non-whitespace after the root object has closed
			if (
				!this.multi &&
				this.stack.length === 0 &&
				this.seenRootObject &&
				!isWhitespace(n)
			) {
				return this.charError(n, i);
			}

			if (this.tokenizerState === "START") {
				if (n === "{") {
					if (this.shouldCapture()) {
						i = this.startCapture(text, i);
					} else {
						this.onToken("LEFT_BRACE", "{", i);
					}
				} else if (n === "}") {
					this.onToken("RIGHT_BRACE", "}", i);
				} else if (n === "[") {
					if (this.shouldCapture()) {
						i = this.startCapture(text, i);
					} else {
						this.onToken("LEFT_BRACKET", "[", i);
					}
				} else if (n === "]") {
					this.onToken("RIGHT_BRACKET", "]", i);
				} else if (n === ":") {
					this.onToken("COLON", ":", i);
				} else if (n === ",") {
					this.onToken("COMMA", ",", i);
				} else if (n === "t") {
					this.tokenizerState = "TRUE1";
				} else if (n === "f") {
					this.tokenizerState = "FALSE1";
				} else if (n === "n") {
					this.tokenizerState = "NULL1";
				} else if (n === '"') {
					// "
					this.string = "";
					this.tokenizerState = "STRING1";
				} else if (n === "-") {
					this.string = "-";
					this.tokenizerState = "NUMBER-";
				} else if (n === "0") {
					this.string = n;
					this.tokenizerState = "NUMBER0";
				} else if (n >= "1" && n <= "9") {
					this.string = n;
					this.tokenizerState = "NUMBER";
				} else if (isWhitespace(n)) {
					// Ignore whitespace
				} else if (n === "␞" && this.multi && this.stack.length === 0) {
					// Ignore json-seq separator in multi mode
				} else {
					return this.charError(n, i);
				}
			} else if (this.tokenizerState === "STRING1") {
				if (n === '"') {
					this.tokenizerState = "START";
					this.onToken("STRING", this.string, i);
					this.string = undefined;
				} else if (n === "\\") {
					this.tokenizerState = "STRING2";
				} else {
					// Scan ahead to the next character that needs special handling, so the whole run of normal characters can be appended at once rather than one at a time
					let j = i;
					for (; j < l; j++) {
						const code = text.charCodeAt(j);
						if (code === 0x22 || code === 0x5c) {
							// " or \
							break;
						}
						if (code <= 0x1f) {
							// Control characters are not valid inside JSON strings
							return this.charError(text[j]!, j);
						}
					}

					this.string += text.slice(i, j);

					// Continue the main loop from the " or \ (or the end of this chunk)
					i = j - 1;
				}
			} else if (this.tokenizerState === "STRING2") {
				// After backslash
				if (n === '"') {
					this.string += '"';
					this.tokenizerState = "STRING1";
				} else if (n === "\\") {
					this.string += "\\";
					this.tokenizerState = "STRING1";
				} else if (n === "/") {
					this.string += "/";
					this.tokenizerState = "STRING1";
				} else if (n === "b") {
					this.string += "\b";
					this.tokenizerState = "STRING1";
				} else if (n === "f") {
					this.string += "\f";
					this.tokenizerState = "STRING1";
				} else if (n === "n") {
					this.string += "\n";
					this.tokenizerState = "STRING1";
				} else if (n === "r") {
					this.string += "\r";
					this.tokenizerState = "STRING1";
				} else if (n === "t") {
					this.string += "\t";
					this.tokenizerState = "STRING1";
				} else if (n === "u") {
					this.unicode = "";
					this.tokenizerState = "STRING3";
				} else {
					return this.charError(n, i);
				}
			} else if (
				this.tokenizerState === "STRING3" ||
				this.tokenizerState === "STRING4" ||
				this.tokenizerState === "STRING5" ||
				this.tokenizerState === "STRING6"
			) {
				// Unicode hex codes
				if (
					!(
						(n >= "0" && n <= "9") ||
						(n >= "a" && n <= "f") ||
						(n >= "A" && n <= "F")
					)
				) {
					return this.charError(n, i);
				}
				this.unicode += n;
				if (this.tokenizerState === "STRING3") {
					this.tokenizerState = "STRING4";
				} else if (this.tokenizerState === "STRING4") {
					this.tokenizerState = "STRING5";
				} else if (this.tokenizerState === "STRING5") {
					this.tokenizerState = "STRING6";
				} else if (this.tokenizerState === "STRING6") {
					const intVal = Number.parseInt(this.unicode!, 16);
					this.unicode = undefined;
					this.string += String.fromCharCode(intVal);
					this.tokenizerState = "STRING1";
				}
			} else if (this.tokenizerState === "NUMBER") {
				if (n >= "0" && n <= "9") {
					this.string += n;
				} else if (n === ".") {
					this.string += n;
					this.tokenizerState = "NUMBER_DOT";
				} else if (n === "e" || n === "E") {
					this.string += n;
					this.tokenizerState = "NUMBER_E";
				} else {
					this.endNumber(i);

					// Process this character (n) again, since it's not part of the number
					i--;
				}
			} else if (this.tokenizerState === "NUMBER_FRACTION") {
				if (n >= "0" && n <= "9") {
					this.string += n;
				} else if (n === "e" || n === "E") {
					this.string += n;
					this.tokenizerState = "NUMBER_E";
				} else {
					this.endNumber(i);

					// Process this character (n) again, since it's not part of the number
					i--;
				}
			} else if (this.tokenizerState === "NUMBER0") {
				if (n >= "0" && n <= "9") {
					// The error is the previous character, which must be a leading 0
					return this.charError("0", i - 1);
				} else if (n === ".") {
					this.string += n;
					this.tokenizerState = "NUMBER_DOT";
				} else if (n === "e" || n === "E") {
					this.string += n;
					this.tokenizerState = "NUMBER_E";
				} else {
					this.endNumber(i);

					// Process this character (n) again, since it's not part of the number
					i--;
				}
			} else if (this.tokenizerState === "NUMBER-") {
				if (n === "0") {
					this.string += n;
					this.tokenizerState = "NUMBER0";
				} else if (n >= "1" && n <= "9") {
					this.string += n;
					this.tokenizerState = "NUMBER";
				} else {
					return this.charError(n, i);
				}
			} else if (this.tokenizerState === "NUMBER_DOT") {
				if (n >= "0" && n <= "9") {
					this.string += n;
					this.tokenizerState = "NUMBER_FRACTION";
				} else {
					return this.charError(n, i);
				}
			} else if (this.tokenizerState === "NUMBER_E") {
				if (n >= "0" && n <= "9") {
					this.string += n;
					this.tokenizerState = "NUMBER_EXPONENT";
				} else if (n === "+" || n === "-") {
					this.string += n;
					this.tokenizerState = "NUMBER_E_SIGN";
				} else {
					return this.charError(n, i);
				}
			} else if (this.tokenizerState === "NUMBER_E_SIGN") {
				if (n >= "0" && n <= "9") {
					this.string += n;
					this.tokenizerState = "NUMBER_EXPONENT";
				} else {
					return this.charError(n, i);
				}
			} else if (this.tokenizerState === "NUMBER_EXPONENT") {
				if (n >= "0" && n <= "9") {
					this.string += n;
				} else {
					this.endNumber(i);

					// Process this character (n) again, since it's not part of the number
					i--;
				}
			} else if (this.tokenizerState === "TRUE1") {
				if (n === "r") {
					this.tokenizerState = "TRUE2";
				} else {
					return this.charError(n, i);
				}
			} else if (this.tokenizerState === "TRUE2") {
				if (n === "u") {
					this.tokenizerState = "TRUE3";
				} else {
					return this.charError(n, i);
				}
			} else if (this.tokenizerState === "TRUE3") {
				if (n === "e") {
					this.tokenizerState = "START";
					this.onToken("TRUE", true, i);
				} else {
					return this.charError(n, i);
				}
			} else if (this.tokenizerState === "FALSE1") {
				if (n === "a") {
					this.tokenizerState = "FALSE2";
				} else {
					return this.charError(n, i);
				}
			} else if (this.tokenizerState === "FALSE2") {
				if (n === "l") {
					this.tokenizerState = "FALSE3";
				} else {
					return this.charError(n, i);
				}
			} else if (this.tokenizerState === "FALSE3") {
				if (n === "s") {
					this.tokenizerState = "FALSE4";
				} else {
					return this.charError(n, i);
				}
			} else if (this.tokenizerState === "FALSE4") {
				if (n === "e") {
					this.tokenizerState = "START";
					this.onToken("FALSE", false, i);
				} else {
					return this.charError(n, i);
				}
			} else if (this.tokenizerState === "NULL1") {
				if (n === "u") {
					this.tokenizerState = "NULL2";
				} else {
					return this.charError(n, i);
				}
			} else if (this.tokenizerState === "NULL2") {
				if (n === "l") {
					this.tokenizerState = "NULL3";
				} else {
					return this.charError(n, i);
				}
			} else if (this.tokenizerState === "NULL3") {
				if (n === "l") {
					this.tokenizerState = "START";
					this.onToken("NULL", null, i);
				} else {
					return this.charError(n, i);
				}
			}
		}

		this.position += text.length;
	}

	// Start a new object/array, and only then call onPush, so the callback can see the mode of the new object/array
	push(mode: Mode, value: object) {
		this.stack.push({ value: this.value, key: this.key, mode: this.mode });
		if (this.value) {
			this.value[this.key!] = value;
		}
		this.value = value;
		this.mode = mode;
		this.key = mode === "ARRAY" ? 0 : undefined;
		this.onPush?.(this.stack.length);
	}

	pop() {
		const value = this.value;
		const parent = this.stack.pop()!;
		this.value = parent.value;
		this.key = parent.key;
		this.mode = parent.mode;
		this.emit(value);
		this.onPop?.(this.stack.length);
		if (!this.mode) {
			this.state = "VALUE";
		}
	}

	// Set a new key in an object
	setKey(key: string) {
		this.key = key;
		this.onKey?.(this.stack.length);
	}

	emit(value: Value) {
		if (this.mode) {
			this.state = "COMMA";
		}

		if (value === undefined) {
			// Must have been deleted by JSONParseStream as irrelevant, so no need to emit
			return;
		}

		this.onValue(value);
	}

	onToken(token: Token, value: Value, i: number) {
		//console.log('onToken', token, value, this.state)
		if (this.stack.length === 0) {
			if (!this.seenRootObject) {
				this.seenRootObject = true;
			}
		}

		if (this.state === "VALUE" || this.state === "VALUE_AFTER_COMMA") {
			if (
				token === "STRING" ||
				token === "NUMBER" ||
				token === "TRUE" ||
				token === "FALSE" ||
				token === "NULL"
			) {
				if (this.value) {
					this.value[this.key!] = value;
				}
				this.emit(value);
			} else if (token === "LEFT_BRACE") {
				this.push("OBJECT", {});
				this.state = "KEY";
			} else if (token === "LEFT_BRACKET") {
				this.push("ARRAY", []);
				this.state = "VALUE";
			} else if (token === "RIGHT_BRACE") {
				if (this.mode === "OBJECT" && this.state !== "VALUE_AFTER_COMMA") {
					this.pop();
				} else {
					return this.parseError(token, value, i);
				}
			} else if (token === "RIGHT_BRACKET") {
				if (this.mode === "ARRAY" && this.state !== "VALUE_AFTER_COMMA") {
					this.pop();
				} else {
					return this.parseError(token, value, i);
				}
			} else {
				return this.parseError(token, value, i);
			}
		} else if (this.state === "KEY" || this.state === "KEY_AFTER_COMMA") {
			if (token === "STRING") {
				this.setKey(value);
				this.state = "COLON";
			} else if (token === "RIGHT_BRACE" && this.state !== "KEY_AFTER_COMMA") {
				this.pop();
			} else {
				return this.parseError(token, value, i);
			}
		} else if (this.state === "COLON") {
			if (token === "COLON") {
				this.state = "VALUE";
			} else {
				return this.parseError(token, value, i);
			}
		} else if (this.state === "COMMA") {
			if (token === "COMMA") {
				if (this.mode === "ARRAY") {
					// @ts-expect-error
					this.key++;
					this.state = "VALUE_AFTER_COMMA";
				} else if (this.mode === "OBJECT") {
					this.state = "KEY_AFTER_COMMA";
				}
			} else if (
				(token === "RIGHT_BRACKET" && this.mode === "ARRAY") ||
				(token === "RIGHT_BRACE" && this.mode === "OBJECT")
			) {
				this.pop();
			} else {
				return this.parseError(token, value, i);
			}
		} else {
			return this.parseError(token, value, i);
		}
	}

	endNumber(i: number) {
		// The tokenizer already validated this against the JSON number grammar, and for valid JSON numbers Number gives the same result as JSON.parse
		const number = Number(this.string);
		this.string = undefined;
		this.tokenizerState = "START";

		this.onToken("NUMBER", number, i);
	}

	checkEnd() {
		if (this.capturePieces !== undefined) {
			// Input ended in the middle of a captured value. Parse what we have normally, and then the checks below will produce the appropriate error.
			const json = this.capturePieces.join("");
			this.capturePieces = undefined;
			this.parseCaptureStrict(json);
		}

		if (this.stack.length > 0) {
			throw new Error(
				`Unexpected end of input at position ${this.position} in state ${this.state}`,
			);
		}

		// Check for lonely number - other vaues have a defined end (like null is always 4 letters, so we can emit it after the 4th letter), but for lonely numbers there is no way to tell when the end is
		if (
			this.tokenizerState === "NUMBER" ||
			this.tokenizerState === "NUMBER0" ||
			this.tokenizerState === "NUMBER_FRACTION" ||
			this.tokenizerState === "NUMBER_EXPONENT"
		) {
			this.endNumber(this.position - 1);
		}

		// Input ended in the middle of a string, an incomplete number like "1." or "-", or a literal like true/false/null
		if (this.tokenizerState !== "START") {
			throw new Error(
				`Unexpected end of input at position ${this.position} in state ${this.tokenizerState}`,
			);
		}

		if (!this.seenRootObject) {
			// Check for empty input
			throw new Error("No data in input");
		}
	}
}
