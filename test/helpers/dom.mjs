import { JSDOM } from 'jsdom';

export const withDOM = (fn) => {
	const dom = new JSDOM('<!doctype html><html><body></body></html>');
	const globalKeys = ['window', 'document', 'Node', 'Element', 'Attr', 'Event', 'MouseEvent'];
	const previousValues = Object.fromEntries(globalKeys.map(key => [key, globalThis[key]]));

	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	globalThis.Node = dom.window.Node;
	globalThis.Element = dom.window.Element;
	globalThis.Attr = dom.window.Attr;
	globalThis.Event = dom.window.Event;
	globalThis.MouseEvent = dom.window.MouseEvent;

	try {
		fn(dom.window);
	} finally {
		dom.window.close();
		for (const key of globalKeys) {
			if (previousValues[key] === undefined)
				delete globalThis[key];
			else
				globalThis[key] = previousValues[key];
		}
	}
};