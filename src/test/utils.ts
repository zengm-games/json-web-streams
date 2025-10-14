export const makeReadableStreamFromJson = (json: string) => {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(json);
			controller.close();
		},
	});
};
