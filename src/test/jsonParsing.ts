import { glob, readFile } from 'node:fs/promises';
import path from "node:path";
import { assert, describe, test } from "vitest";
import { JSONParseStream } from '../JSONParseStream.ts';

const parseWholeJson = async (json: string) => {
    const readableStream =  new ReadableStream({
        start(controller) {
            controller.enqueue(json);
            controller.close();
        },
    });

    const stream = readableStream.pipeThrough(new JSONParseStream([[]]));

    // With queryPath [] (return root object) it should only emit one chunk
    for await (const [object] of stream) {
        console.log('here', object);
        return object;
    }
};

describe('JSON parsing', async () => {
    for await (const entry of glob(path.join(__dirname, 'jsonParsing/**/*.json'))) {
        const filename = path.basename(entry);
        const shouldPass = filename.startsWith("pass");

        test(filename, async () => {
            const json = await readFile(entry, "utf8");

            let object;
            try {
                object = await parseWholeJson(json);
                if (!shouldPass) {
                    throw new Error("Expected invalid JSON, but parsing succeeded");
                }
            } catch (error) {
                if (shouldPass) {
                    throw new Error("Expected valid JSON, but parsing failed", { cause: error });
                }

                // We expected an error and got it - nothing more to do here
                return;
            }

            // If we expected a pass, confirm the parsed object matches JSON.parse
            const object2 = JSON.parse(json);
            assert.deepStrictEqual(object, object2);
        });
    }
});
