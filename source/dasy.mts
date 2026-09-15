import { applyDiffs, diffDeep, JSONPath, getByPath, setByPath, assertNoReferenceRedundancies, 
    type DiffEntry, JSONUndoBuffer, type DiffKind } from './json_tools.mjs';
import { html, svg, type HTMLAttributeValue, type TemplateParams } from './html.mjs';

type DasyPathArgument = JSONPath | string;
type DasyWatcherKind = 'each' | 'use' | 'inspect' | 'item';

type DasyTemplateResult = Node | HTMLAttributeValue;
type DasyTemplateContext = {
    each(path: DasyPathArgument, template: DasyTemplateFunction, emptyTemplate?: DasyTemplateFunction): 
        (parent: Element, params: TemplateParams) => DocumentFragment;
    use(path: DasyPathArgument, template: DasyTemplateFunction): 
        (parent: Element | Attr, params: TemplateParams) => DasyTemplateResult;
    inspect(path: DasyPathArgument, template: DasyTemplateFunction): 
        (parent: Element | Attr, params: TemplateParams) => DasyTemplateResult;
    set(path: DasyPathArgument | unknown, value?: unknown): void;
    html(chunks: TemplateStringsArray, ...values: unknown[]): DocumentFragment;
    svg(chunks: TemplateStringsArray, ...values: unknown[]): DocumentFragment;
    refresh(): void;
}
type DasyTemplateFunction = (
    data: unknown,
    root: DasyTemplateContext,
    parent: Element | Attr,
    path: string,
) => DasyTemplateResult;

type DasyWatcherParams = {
    dasy: Dasy;
    path: JSONPath;
    parent: Element | Attr;
    attributeOwner?: Element;
    template: DasyTemplateFunction;
    ownerParent?: DasyWatcher;
    kind?: DasyWatcherKind;
    children?: DasyWatcher[];
    emptyTemplate?: DasyTemplateFunction;
}

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// DasyDataSource
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

type DasyDataSourceSubscriber = {
    dasy: Dasy;
    basePath: JSONPath | undefined;
    beforeRefresh?: (data: object) => void;
};

/**
 * Shared data source for multiple Dasy instances.
 *
 * Owns the data model, its backup, and the diff computation.
 * Dasy instances subscribe with an optional JSONPath filter; on refresh()
 * the source computes one diff for the whole data, then forwards
 * the relevant full-data diff entries to each subscriber.
 */
class DasyDataSource {
    #data: object;
    #backup: object | undefined;
    #subscribers: Set<DasyDataSourceSubscriber> = new Set();

    constructor(data: object) {
        assertNoReferenceRedundancies(data, 'dasy data source data');
        this.#data = data;
        this.#backup = structuredClone(data);
    }

    get data(): object {
        return this.#data;
    }

    /**
        * Registers a Dasy subscriber with an optional JSONPath filter.
     * Returns an unsubscribe function.
     */
    subscribe(dasy: Dasy, path: JSONPath | undefined, beforeRefresh?: (data: object) => void): () => void {
        const subscriber: DasyDataSourceSubscriber = { dasy, basePath: path, beforeRefresh };
        this.#subscribers.add(subscriber);
        return () => this.#subscribers.delete(subscriber);
    }

    /**
     * Recomputes the diff for the whole shared data, notifies every
        * subscriber's beforeRefresh, then forwards filtered full-data diffs.
     * The backup is updated after the subscribers have been notified.
     */
    refresh(): void {
        for (const oSubscriber of this.#subscribers) {
            oSubscriber.beforeRefresh?.(this.#data);
        }

        const diffs = diffDeep(this.#backup as object, this.#data);
        for (const oSubscriber of this.#subscribers) {
            const aRelevantDiffs = oSubscriber.basePath ? diffs.filter(([diffPath]) => 
                oSubscriber.basePath!.matches(diffPath)) : diffs;
            if (aRelevantDiffs.length)
                oSubscriber.dasy.receiveDiffs(aRelevantDiffs);
        }

        this.#backup = applyDiffs(this.#backup as object, diffs).target;
    }
}

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Watcher
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * This is a data binding observer.
 * Holds the path, the parent DOM element/attr, the template function,
 * and the inner watcher tree structure (each/use directives).
 */
class DasyWatcher {
    dasy: Dasy | undefined = undefined; // Parent dasy instance
    path: JSONPath | undefined = undefined; // Path of the watched data in the dasy's JSON
    parent: Element | Attr | undefined = undefined; // Parent DOM element
    attributeOwner: Element | undefined = undefined; // Original owner element for attribute watchers
    startNode: Text | undefined = undefined; // DOM bookmark in parent before the template's own value
    endNode: Text | undefined = undefined; // DOM bookmark in parent after the template's own value
    template: DasyTemplateFunction | undefined = undefined; // Template function which produce the dasy
    ownerParent: DasyWatcher | undefined = undefined; // Watcher that owns this watcher's lifecycle
    templateAPI: DasyTemplateContext | undefined = undefined; // Functions which are available in the template function
    kind: DasyWatcherKind = 'use';
    children: DasyWatcher[] | undefined = undefined; // Owned watcher subtree
    timedAttributes: Array<{ attr: Attr, ownerElement: Element }> | undefined = undefined; // ps* attribute collection
    emptyTemplate: DasyTemplateFunction | undefined = undefined; // Template rendered when a 'each' array is empty
    controller: AbortController; // Used to erase events if the watcher is destroyed

    constructor(oParams: DasyWatcherParams) {
        Object.assign(this, oParams);
        const ownerDocument = this.parent instanceof Attr ? this.parent.ownerElement?.ownerDocument : this.parent?.ownerDocument;
        const AbortControllerType = ownerDocument?.defaultView?.AbortController ?? AbortController;
        this.controller = new AbortControllerType();
        const signal = this.controller.signal;
        if (!this.attributeOwner && this.parent instanceof Attr)
            this.attributeOwner = this.parent.ownerElement ?? undefined;
        const templateAPI: DasyTemplateContext = {
            each: (path, template, emptyTemplate) => (parent: Element, params: TemplateParams) => 
                this.renderEach(path, template, emptyTemplate, parent, params),
            use: (path, template) => (parent: Element | Attr, params: TemplateParams) => this.renderUse(path, template, parent, params),
            inspect: (path, template) => (parent: Element | Attr, params: TemplateParams) => this.renderInspect(path, template, parent, params),
            set: this.set,
            refresh: this.refresh,
            html: (chunks: TemplateStringsArray, ...values: unknown[]) => html({ signal, parentWatcher: this })(chunks, ...values),
            svg: (chunks: TemplateStringsArray, ...values: unknown[]) => svg({ signal, parentWatcher: this })(chunks, ...values),
        };
        this.templateAPI = Object.freeze(templateAPI);
    }

    /**
     * Creates another watcher within the same Dasy instance.
     * This keeps watcher construction consistent across each/use/rebuild paths.
     */
    createWatcher(oParams: Omit<DasyWatcherParams, 'dasy'>): DasyWatcher {
        return new DasyWatcher({ dasy: this.dasy as Dasy, ...oParams });
    }

    ownWatcher(oParams: Omit<DasyWatcherParams, 'dasy' | 'ownerParent'>): DasyWatcher {
        const watcher = this.createWatcher({ ...oParams, ownerParent: this });
        (this.children ??= []).push(watcher);
        (this.dasy as Dasy).addWatcher(watcher);
        return watcher;
    }

    parentWatcherFrom(params: TemplateParams): DasyWatcher {
        const parentWatcher = params.parentWatcher as DasyWatcher | undefined;
        if (!parentWatcher)
            throw new TypeError('each(), use() and inspect() require context html/svg templates. Use the template context\'s html`...` or svg`...` so signal and watcher ownership are available.');
        return parentWatcher;
    }

    registerTimedAttribute(attr: Attr, ownerElement: Element): void {
        (this.timedAttributes ??= []).push({ attr, ownerElement });
    }

    reapplyTimedAttributes(): void {
        for (const { attr, ownerElement } of this.timedAttributes ?? []) {
            if (attr.ownerElement !== ownerElement)
                continue;
            (this.dasy as Dasy).applyAttributeBindingValue(attr, attr.value, ownerElement);
        }
    }

    /**
     * If parent is Attr, calls renderAttribute, otherwise
     * calls renderTemplate with wrapFragment (startNode/endNode sentinels).
     */
    render(data: unknown): DocumentFragment | HTMLAttributeValue {
        if (this.parent instanceof Attr)
            return this.renderAttribute(data);
        this.timedAttributes = undefined;
        const dasy = this.dasy as Dasy;
        const template = this.template as DasyTemplateFunction;
        const parent = this.parent as Element;
        return this.wrapFragment(dasy.renderTemplate(template, data, this, parent));
    }

    /**
     * For attribute binding: renders the template with the value.
     */
    renderAttribute(data: unknown): HTMLAttributeValue {
        const dasy = this.dasy as Dasy;
        const template = this.template as DasyTemplateFunction;
        const parent = this.parent as Attr;
        return dasy.renderTemplateValue(template, data, this, parent);
    }

    get templateParams(): TemplateParams {
        return { signal: this.controller.signal, parentWatcher: this };
    }

    /**
     * Creates sentinel text nodes (startNode, endNode) for
     * clearing and re-rendering content based on diff.
     */
    wrapFragment(oContentFragment: Node): DocumentFragment {
        this.startNode = document.createTextNode('');
        this.endNode = document.createTextNode('');
        const fragment = document.createDocumentFragment();
        fragment.append(this.startNode, oContentFragment, this.endNode);
        return fragment;
    }

    /**
     * Removes DOM nodes between startNode and endNode
     * (the previous dynamic content) before re-rendering.
     */
    clearContentDOMNodes(): void {
        let current = this.startNode?.nextSibling;
        while (current && current !== this.endNode) {
            const next = current.nextSibling;
            current.remove();
            current = next;
        }
    }

    /**
     * Resolves a relative path based on the watcher's own base path.
     * If JSONPath or empty string/undefined, returns the base path.
     * Otherwise appends the given path to the base path.
     */
    resolvePath(path: DasyPathArgument = ''): JSONPath {
        const basePath = this.path as JSONPath;
        if (path instanceof JSONPath)
            return path.length ? new JSONPath([...basePath, ...path]) : new JSONPath(basePath);
        if (path === '' || path === undefined)
            return new JSONPath(basePath);
        return new JSONPath([...basePath, ...new JSONPath(path)]);
    }

    /**
     * Renders the `for` directive:
     * 1. Resolves the full path, fetches the data (must be an array).
     * 2. Creates a baseWatcher and a wrapped fragment.
     * 3. For each array item, creates a new watcher, renders it,
     *    and inserts it into the fragment between startNode/endNode sentinels.
     * 4. Registers the baseWatcher and inner watchers in the dasy.
     */
    renderEach(path: DasyPathArgument | DasyTemplateFunction, template: DasyTemplateFunction | undefined, 
        emptyTemplate: DasyTemplateFunction | undefined, parent: Element, params: TemplateParams): DocumentFragment {
        const dasy = this.dasy as Dasy;
        if (!(parent instanceof Element))
            throw new TypeError('"each" must be used inside an element parent');
        if (template === undefined && typeof path === 'function') { template = path; path = ''; }
        const fullPath = this.resolvePath(path as DasyPathArgument);
        const data = getByPath(dasy.data, fullPath);
        if (!Array.isArray(data)) throw new TypeError('"each" only usable for arrays');
        const parentWatcher = this.parentWatcherFrom(params);
        const baseWatcher = parentWatcher.ownWatcher({
            path: fullPath,
            parent,
            template: template as DasyTemplateFunction,
            kind: 'each',
            emptyTemplate,
        });
        const allItems = baseWatcher.wrapFragment(document.createDocumentFragment());
        data.forEach((value, index) => {
            const newWatcher = baseWatcher.ownWatcher({
                path: new JSONPath([...fullPath, index]),
                parent,
                template: template as DasyTemplateFunction,
                kind: 'item',
            });
            const fragment = newWatcher.render(value);
            allItems.insertBefore(fragment as Node, baseWatcher.endNode as Text);
        });
        if (data.length === 0 && emptyTemplate) {
            const emptyWatcher = baseWatcher.ownWatcher({
                path: fullPath,
                parent,
                template: emptyTemplate,
            });
            const fragment = emptyWatcher.render(data);
            allItems.insertBefore(fragment as Node, baseWatcher.endNode as Text);
        }
        return allItems;
    }

    renderScoped(path: DasyPathArgument, template: DasyTemplateFunction, parent: Element | Attr, params: TemplateParams,
        kind: 'use' | 'inspect'): DasyTemplateResult {
        const dasy = this.dasy as Dasy;
        const attributeBinding = parent instanceof Attr;
        if (!attributeBinding && !(parent instanceof Element))
            throw new TypeError(`"${kind}" must be used inside an element parent`);
        const jsonPath = this.resolvePath(path);
        const data = getByPath(dasy.data, jsonPath);
        if (data === null || typeof data !== 'object' || (kind === 'use' && Array.isArray(data)))
            throw new TypeError(`"${kind}" only usable for ${kind === 'use' ? 'objects' : 'objects or arrays'}`);
        const parentWatcher = this.parentWatcherFrom(params);
        const newWatcher = parentWatcher.ownWatcher({ path: jsonPath, parent, template, kind });
        const result = newWatcher.render(data);
        return result;
    }

    /**
     * Renders the `use` directive:
     * 1. Resolves the full path, fetches the data (must be an object).
     * 2. Creates a new watcher with the full path.
     * 3. Renders the template with the data, and registers the watcher.
     */
    renderUse(path: DasyPathArgument, template: DasyTemplateFunction, parent: Element | Attr, params: TemplateParams): DasyTemplateResult {
        return this.renderScoped(path, template, parent, params, 'use');
    }

    /**
     * Renders the `inspect` directive. Unlike `use`, it also rerenders when
     * any descendant path below the watched subtree changes.
     */
    renderInspect(path: DasyPathArgument, template: DasyTemplateFunction, parent: Element | Attr, params: TemplateParams): DasyTemplateResult {
        return this.renderScoped(path, template, parent, params, 'inspect');
    }

    /**
     * Sets a value in the data model at the given path.
     * If value is undefined, then value=path, path=''.
     * If value is Event, uses target.value.
     * Then triggers the dasy refresh.
     */
    set = (path: DasyPathArgument, value?: unknown): void => {
        if (value === undefined) { value = path; path = ''; }
        if (value instanceof Event) {
            const source = value.target as HTMLInputElement | HTMLSelectElement;
            if (!source.validity.valid)
                return;
            value = source.value;
        }
        const dasy = this.dasy as Dasy;
        const jsonPath = this.resolvePath(path);
        // Autoconvert value type to the target field
        setByPath(dasy.data as any, jsonPath, value, true);
        if (dasy.dataSource)
            dasy.dataSource.refresh();
        else
            dasy.refresh();
    };

    /**
     * Calls the dasy instance refresh method.
     */
    refresh = (): void => {
        (this.dasy as Dasy).refresh();
    };

    /**
     * Removes all owned child watchers via dasy removeWatcher.
     */
    clearChildren(): void {
        while (this.children?.length)
            (this.dasy as Dasy).removeWatcher(this.children[this.children.length - 1]);
    }

    /**
     * Full cleanup: removes DOM nodes, clears owned child watchers,
     * sets all properties to undefined.
     */
    disconnect(): void {
        this.controller.abort();
        this.clearContentDOMNodes();
        this.startNode?.remove(); this.startNode = undefined;
        this.endNode?.remove(); this.endNode = undefined;
        this.clearChildren();
        this.dasy = undefined; this.path = undefined; this.parent = undefined; this.template = undefined; 
        this.ownerParent = undefined;
        this.attributeOwner = undefined;
        this.templateAPI = undefined;
        this.timedAttributes = undefined;
    }
}

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Dasy
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

type DasyRootParams = {
    data?: object; // JSON object for the dasy's data source
    dataSource?: DasyDataSource; // shared data source
    dataPath?: DasyPathArgument; // Optional JSONPath scope inside the shared data for filtering notifications
    container: HTMLElement; // DOM container of the dasy DOM output
    beforeRefresh?: (data: object) => void; // called before each refresh pass
    afterRefresh?: (data: object) => void; // called after each refresh pass
};

/**
 * Dasy — the main rendering class.
 *
 * Responsibilities:
 * 1. Data model management (#data) and backup (#backup) storage.
 * 2. DOM tree rendering from template based on data.
 * 3. Watcher indexing by path (#map) for diff-based
 *    updates.
 * 4. Diff generation between backup and data, and efficient
 *    DOM tree synchronization with changes.
 */
class Dasy {
    #rootWatcher: DasyWatcher | undefined;
    #map: Map<string, Set<DasyWatcher>> | undefined = new Map();
    #data: object | undefined; // Dasy's JSON data source
    #backup: object | undefined; // Copy of the JSON data
    #container: HTMLElement | undefined; // Parent DOM element
    #beforeRefresh: ((data: object) => void) | undefined;
    #afterRefresh: ((data: object) => void) | undefined;
    #dataSource: DasyDataSource | undefined; // Optional shared data source
    #unsubscribe: (() => void) | undefined; // Unsubscribe from the shared data source

    /**
     * Constructor: validates the data (no redundant references),
     * creates a backup when needed, creates the rootWatcher, and renders
     * the initial DOM tree into the container.
     */
    constructor(oParams: DasyRootParams, template: DasyTemplateFunction) {
        const container = oParams.container;
        this.#container = container;
        this.#beforeRefresh = oParams.beforeRefresh;
        this.#afterRefresh = oParams.afterRefresh;

        let data: object;
        if ('dataSource' in oParams) {
            const path = oParams.dataPath ? new JSONPath(oParams.dataPath) : undefined; // Ensure if it is a JSONPath
            data = oParams.dataSource!.data;
            this.#dataSource = oParams.dataSource;
            this.#unsubscribe = oParams.dataSource!.subscribe(this, path, oParams.beforeRefresh);
        } else if ('data' in oParams) {
            data = oParams.data!;
            assertNoReferenceRedundancies(data, 'dasy data');
            this.#backup = structuredClone(data);
        } else
            throw new TypeError('Constructor parameter "dataSource" or "data" required');

        this.#data = data;
        this.#rootWatcher = new DasyWatcher({ dasy: this, path: new JSONPath([]), parent: container, template });
        container.append(this.renderTemplate(template, data, this.#rootWatcher, container));
    }

    get data(): object {
        return this.#data as object;
    }

    get container(): HTMLElement {
        return this.#container as HTMLElement;
    }

    /**
     * The shared data source when the dasy was created in data-source mode.
     */
    get dataSource(): DasyDataSource | undefined {
        return this.#dataSource;
    }

    #invokeTemplate(template: DasyTemplateFunction, data: unknown, oWatcher: DasyWatcher, parent: Element | Attr): unknown {
        let value: unknown = template(data, oWatcher.templateAPI as DasyTemplateContext, parent, (oWatcher.path as JSONPath).asPath());
        if (typeof value === 'function')
            value = (value as ((parent: Element | Attr, params: TemplateParams) => unknown))(parent, oWatcher.templateParams);
        if (typeof value === 'function')
            this.throwNestedRenderFunction(template);
        return value;
    }

    throwNestedRenderFunction = (position: unknown): never => {
        throw new TypeError('Render function leaked into output. The template returned another render function instead of DOM or an attribute value.\n' + String(position));
    }

    /**
     * Renders template to a DOM node.
     *
     * 1. Calls the template function (data, templateAPI, parent, path, ...).
    * 2. If it returns one render function, executes it with the current parent and watcher params.
    * 3. Handles the final return value:
     *    - undefined/null/false → empty DocumentFragment
    *    - function → error (render function leak)
     *    - primitive → wrapped in text node
     *    - Node → returned directly
     */
    renderTemplate(template: DasyTemplateFunction, data: unknown, oWatcher: DasyWatcher, parent: Element | Attr): Node {
        const fragment = this.#invokeTemplate(template, data, oWatcher, parent);
        if (fragment === undefined || fragment === null || fragment === false)
            return document.createDocumentFragment();
        if (typeof fragment !== 'object') {
            const node = document.createDocumentFragment();
            node.append(document.createTextNode(String(fragment)));
            return node;
        }
        return fragment as Node;
    }

    /**
     * Renders template for an attribute value.
     *
     * Same flow as renderTemplate, but:
     * - Only allows string/number/boolean/null/undefined values.
     * - Returns HTMLAttributeValue, not Node.
     */
    renderTemplateValue(template: DasyTemplateFunction, data: unknown, oWatcher: DasyWatcher, parent: Attr): HTMLAttributeValue {
        const value = this.#invokeTemplate(template, data, oWatcher, parent);
        if (value === null || value === undefined)
            return value;
        const type = typeof value;
        if (type !== 'string' && type !== 'number' && type !== 'boolean')
            throw new TypeError('Attribute binding only usable for string, number, boolean, null or undefined values');
        return value as HTMLAttributeValue;
    }

    /**
     * Registers a watcher in the path-based index map.
     * The key is path.asKey() (with null-byte delimiter), the value is a Set<DasyWatcher>.
     */
    addWatcher(oNewWatcher: DasyWatcher): void {
        const key = (oNewWatcher.path as JSONPath).asKey();
        const map = this.#map as Map<string, Set<DasyWatcher>>;
        let node = map.get(key);
        if (!node)
            map.set(key, node = new Set());
        node.add(oNewWatcher);
    }

    /**
     * Removes a watcher from the path-based index map.
     * If the Set is empty, also deletes the key from the Map.
     */
    #removeWatcherFromMap(oWatcher: DasyWatcher): void {
        const key = (oWatcher.path as JSONPath).asKey();
        const map = this.#map as Map<string, Set<DasyWatcher>>;
        const node = map.get(key);
        if (!node)
            return;
        node.delete(oWatcher);
        if (node.size === 0)
            map.delete(key);
    }

    /**
     * Removes a watcher from the system.
     *
     * 1. Removes from the map (#removeWatcherFromMap).
     * 2. Removes from the ownerParent children list.
     * 3. Calls the watcher disconnect (DOM + property cleanup).
     */
    removeWatcher(oWatcher: DasyWatcher): void {
        this.#removeWatcherFromMap(oWatcher);
        const ownedWatchers = oWatcher.ownerParent?.children;
        if (ownedWatchers) {
            const index = ownedWatchers.indexOf(oWatcher);
            if (index !== -1)
                ownedWatchers.splice(index, 1);
        }
        oWatcher.disconnect();
    }

    /**
     * Updates a watcher's content based on the current data.
     *
     * - For Attr: clearChildren → renderAttribute → applyAttributeBindingValue.
     * - For Element: clearChildren → clearContentDOMNodes → renderTemplate → insertBefore(endNode).
     */
    #update(oWatcher: DasyWatcher): void {
        if (oWatcher.parent instanceof Attr) {
            oWatcher.clearChildren();
            const value = oWatcher.renderAttribute(getByPath(this.#data as object, oWatcher.path as JSONPath));
            this.applyAttributeBindingValue(oWatcher.parent, value, oWatcher.attributeOwner);
            return;
        }
        oWatcher.clearChildren();
        oWatcher.clearContentDOMNodes();
        (oWatcher.parent as Element).insertBefore(this.renderTemplate(oWatcher.template as DasyTemplateFunction, getByPath(this.#data as object, oWatcher.path as JSONPath), oWatcher, oWatcher.parent as Element), oWatcher.endNode as Text);
        this.#reapplyAncestorTimedAttributes(oWatcher);
    }

    #reapplyAncestorTimedAttributes(oWatcher: DasyWatcher): void {
        for (let parent = oWatcher.ownerParent; parent; parent = parent.ownerParent)
            parent.reapplyTimedAttributes();
    }

    applyAttributeBindingValue(oAttr: Attr, vValue: unknown, ownerElement = oAttr.ownerElement ?? undefined) {
        if (vValue === undefined || vValue === null) {
            if (ownerElement && ownerElement.namespaceURI !== 'http://www.w3.org/2000/svg') {
                const properties = ownerElement as unknown as Record<string, unknown>;
                properties[oAttr.name] = typeof properties[oAttr.name] === 'boolean' ? false : '';
            }
            ownerElement?.removeAttribute(oAttr.name);
            return;
        }
        if (ownerElement && oAttr.ownerElement !== ownerElement)
            ownerElement.setAttributeNode(oAttr);
        const sValue = String(vValue);
        oAttr.value = sValue;
        if (ownerElement && ownerElement.namespaceURI !== 'http://www.w3.org/2000/svg')
            (ownerElement as unknown as Record<string, string>)[oAttr.name] = sValue;
    };

    /**
     * Rebuilds the array watcher subtree from iStartIndex.
     *
     * 1. Deletes inner watchers starting from iStartIndex (reverse order).
     * 2. Creates new watchers according to the data array length,
     *    renders them, and inserts them into the DOM.
     * Called after diff del/ins operations.
     */
    #rebuildTail(oBaseWatcher: DasyWatcher, iStartIndex: number): void {
        const { path, parent, template, emptyTemplate } = oBaseWatcher;
        const children = oBaseWatcher.children ??= [];
        const data = getByPath(this.#data as object, path as JSONPath) as any[];
        for (let i = children.length - 1; i >= iStartIndex; i--)
            this.removeWatcher(children[i]);
        for (let i = iStartIndex; i < data.length; i++) {
            const newWatcher = oBaseWatcher.ownWatcher({
                path: new JSONPath([...(path as JSONPath), i]),
                parent: parent as Element | Attr,
                template: template as DasyTemplateFunction,
                kind: 'item',
            });
            const fragment = newWatcher.render(data[i]);
            (parent as Element).insertBefore(fragment as Node, oBaseWatcher.endNode as Text);
        }
        if (data.length === 0 && emptyTemplate) {
            const emptyWatcher = oBaseWatcher.ownWatcher({
                path: path as JSONPath,
                parent: parent as Element | Attr,
                template: emptyTemplate,
            });
            const fragment = emptyWatcher.render(data);
            (parent as Element).insertBefore(fragment as Node, oBaseWatcher.endNode as Text);
        }
        this.#reapplyAncestorTimedAttributes(oBaseWatcher);
    }

    /**
     * Collects the starting indices of structural array changes (ins/del).
     *
     * If an ins/del diff modifies an index within another array,
     * previous indices need to be updated so the rebuild starts
     * from the correct position.
     *
     * E.g., if [.items] del 2 and [.items[1].x] exists,
     * the [.items] del start decreases to 1, because the [1] index
     * was before the del.
     */
    #collectStructuralArrayRebuildStarts(aDiffs: DiffEntry[]): Map<string, number> {
        const arrayDiffs: { key: string; path: JSONPath; start: number }[] = [];
        for (const [path, type, key] of aDiffs)
            if (type === 'ins' || type === 'del')
                arrayDiffs.push({ key: path.asKey(), path, start: key as number });
        for (const [path] of aDiffs)
            for (const arrayDiff of arrayDiffs) {
                if (path.length <= arrayDiff.path.length)
                    continue;
                let prefix = true;
                for (let i = 0; i < arrayDiff.path.length; i++)
                    if (path[i] !== arrayDiff.path[i]) {
                        prefix = false;
                        break;
                    }
                if (!prefix)
                    continue;
                const index = path[arrayDiff.path.length];
                if (typeof index === 'number' && index < arrayDiff.start)
                    arrayDiff.start = index;
            }
        return new Map(arrayDiffs.map(entry => [entry.key, entry.start]));
    }

    /**
     * Filters watchers based on diff type.
     *
        * - When an array path has both each and inspect watchers, ins/del/val must update all of them.
     * - Otherwise (val/set/rem): prefers kind='with' watchers,
     *   because value changes affect the content.
     * If the first group is empty, chooses from the other.
     */
    #selectWatchersForDiff(aWatchersAtPath: DasyWatcher[], sType: DiffKind): DasyWatcher[] {
        if ((sType === 'ins' || sType === 'del' || sType === 'val') && aWatchersAtPath.some(watcher => watcher.kind === 'each'))
            return aWatchersAtPath.filter(watcher => watcher.kind !== 'item');
        const preferredKind: DasyWatcherKind = sType === 'ins' || sType === 'del' ? 'each' : 'use';
        const preferredWatchers = aWatchersAtPath.filter(watcher => watcher.kind === preferredKind);
        if (preferredWatchers.length)
            return preferredWatchers;
        return aWatchersAtPath.filter(watcher => watcher.kind !== preferredKind); // fallbackWatchers
    }

    #collectInspectWatchers(path: JSONPath, seen: Set<DasyWatcher>): DasyWatcher[] {
        const inspectWatchers: DasyWatcher[] = [];
        for (let i = path.length; i >= 0; i--) {
            const prefix = new JSONPath(path.slice(0, i));
            for (const watcher of this.#map?.get(prefix.asKey()) ?? []) {
                if (watcher.kind !== 'inspect' || seen.has(watcher))
                    continue;
                seen.add(watcher);
                inspectWatchers.push(watcher);
            }
        }
        return inspectWatchers;
    }

    #updateEachValue(oBaseWatcher: DasyWatcher, key: string | number | undefined): void {
        if (typeof key !== 'number') {
            this.#rebuildTail(oBaseWatcher, 0);
            return;
        }
        const watcher = oBaseWatcher.children?.[key];
        if (!watcher) {
            this.#rebuildTail(oBaseWatcher, 0);
            return;
        }
        this.#update(watcher);
    }

    /**
     * Applies the given diffs to the DOM tree without touching the backup.
     * Used both by the local refresh path and by data-source subscribers.
     */
    #syncDiffsToDOM(aDiffs: DiffEntry[]): void {
        const arrayRebuildStarts = this.#collectStructuralArrayRebuildStarts(aDiffs);
        const updatedInspectWatchers = new Set<DasyWatcher>();
        aDiffs.forEach(([path, type, key, value]) => {
            const diffKey = path.asKey();
            const watchersAtPath = Array.from(this.#map?.get(diffKey) ?? []);
            const watchers = this.#selectWatchersForDiff(watchersAtPath, type);
            for (const watcher of this.#collectInspectWatchers(path, updatedInspectWatchers))
                if (!watchers.includes(watcher))
                    watchers.push(watcher);
            for (const watcher of watchers) {
                if (watcher.dasy !== this)
                    continue;
                if (watcher.kind === 'each' && (type === 'ins' || type === 'del'))
                    this.#rebuildTail(watcher, arrayRebuildStarts.get(diffKey) ?? (key as number));
                else if (watcher.kind === 'each' && type === 'val')
                    this.#updateEachValue(watcher, key);
                else {
                    if (watcher.kind === 'inspect')
                        updatedInspectWatchers.add(watcher);
                    this.#update(watcher);
                }
            }
        });
    }

    /**
     * Syncs DOM changes and replays the same diffs onto the local backup.
     * Only used when the Dasy owns its own data and backup.
     */
    #applyDiffsAndSync(aDiffs: DiffEntry[]): void {
        this.#syncDiffsToDOM(aDiffs);
        this.#backup = applyDiffs(this.#backup as object, aDiffs).target;
    }

    /**
    * Entry point used by DasyDataSource to deliver filtered full-data diffs.
     */
    receiveDiffs(aDiffs: DiffEntry[]): void {
        assertNoReferenceRedundancies(this.data, 'dasy data');
        this.#syncDiffsToDOM(aDiffs);
        this.#afterRefresh?.(this.data);
    }

    /**
     * Top-level update method.
     *
     * 1. Validates the data (no redundant references).
     * 2. Generates diff between backup and data (diffDeep).
     * 3. Applies diffs and DOM synchronization (#applyDiffsAndSync).
     */
    refresh(): void {
        if (this.#dataSource) return;
        this.#beforeRefresh?.(this.#data as object);
        assertNoReferenceRedundancies(this.#data as object, 'dasy data');
        const diffs = diffDeep(this.#backup as object, this.#data as object);
        this.#applyDiffsAndSync(diffs);
        this.#afterRefresh?.(this.#data as object);
    }

    /**
     * Full disconnect: rootWatcher disconnect, map/data/backup cleanup.
     */
    disconnect(): void {
        this.#unsubscribe?.(); this.#unsubscribe = undefined;
        this.#rootWatcher!.disconnect(); this.#rootWatcher = undefined;
        this.#map!.clear(); this.#map = undefined;
        this.#backup = undefined; this.#data = undefined;
        this.#container = undefined;
        this.#dataSource = undefined;
        this.#unsubscribe = undefined;
    }

    /**
     * Debug / diagnostic method.
     *
     * Returns a detailed description of the Dasy state:
     * - root watcher tree structure
     * - watchers for each path
     * - dangling (unreachable) indexed watchers
     * - unindexed reachable watchers
     *
     * Usage: for debugging, memory leak detection,
     * watcher tree validation.
     */
    dump(): any {
        if (!this.#map) {
            return {
                disconnected: true,
                reachableWatcherCount: 0,
                indexedWatcherCount: 0,
                mapPathCount: 0,
                root: null,
                paths: [],
                danglingIndexedWatchers: [],
                unindexedReachableWatchers: [],
            };
        }

        const formatPath = (watcher: DasyWatcher | undefined): string => {
            if (!watcher?.path)
                return '<disconnected>';
            return watcher.path.asPath();
        };
        const describeWatcher = (watcher: DasyWatcher) => ({
            path: formatPath(watcher),
            type: watcher.kind,
            innerCount: watcher.children?.length ?? 0,
            connected: Boolean(watcher.startNode?.isConnected || watcher.endNode?.isConnected || watcher.parent instanceof Attr),
        });
        const describeTree = (watcher: DasyWatcher | undefined): any => watcher ? ({
            ...describeWatcher(watcher),
            children: (watcher.children ?? []).map(describeTree),
        }) : null;

        const reachable = new Set<DasyWatcher>();
        const reachableList: DasyWatcher[] = [];
        const visit = (watcher: DasyWatcher | undefined): void => {
            if (!watcher || reachable.has(watcher))
                return;
            reachable.add(watcher);
            reachableList.push(watcher);
            for (const inner of watcher.children ?? [])
                visit(inner);
        };
        visit(this.#rootWatcher);

        const indexedWatchers: DasyWatcher[] = [];
        const paths = Array.from(this.#map.values(), watchers => {
            const list = Array.from(watchers);
            indexedWatchers.push(...list);
            return {
                path: formatPath(list[0]),
                count: list.length,
                watchers: list.map(describeWatcher),
            };
        }).sort((a, b) => a.path.localeCompare(b.path));

        const indexed = new Set(indexedWatchers);
        return {
            disconnected: false,
            reachableWatcherCount: reachableList.length,
            indexedWatcherCount: indexedWatchers.length,
            mapPathCount: this.#map.size,
            root: describeTree(this.#rootWatcher),
            paths,
            danglingIndexedWatchers: indexedWatchers.filter(watcher => !reachable.has(watcher)).map(describeWatcher),
            unindexedReachableWatchers: reachableList.filter(watcher => watcher !== this.#rootWatcher && !indexed.has(watcher)).map(describeWatcher),
        };
    }
}

/**
 * Creates a Dasy instance.
 *
 * Parameters:
 * - data: the data model (object, no redundant references)
 * - container: the DOM element where the rendered content goes
 * - template: the template function (html`...` or svg`...`)
 *
 * Returns: a Dasy instance that controls rendering and updates.
 */
function dasy(oParams: DasyRootParams, fTemplate: DasyTemplateFunction): Dasy {
    return new Dasy(oParams, fTemplate);
}

export { html, svg, dasy, DasyDataSource, JSONUndoBuffer };