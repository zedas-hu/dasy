/**
 * JSONPath — string path parsing and object traversal.
 *
 * Parses `.prop`, `[index]`, `["quoted"]`, `['quoted']`
 * syntax and stores tokens as an array.
 * The asKey() method generates a unique string key for the path using null-byte delimiter (for map indexing).
 * The asPath() method converts the array back to a string.
 */
declare class JSONPath extends Array<string | number | null> {
    #private;
    /**
     * Constructor: parse string path with regex, or copy array tokens.
     *
     * For string:
     * - .prop → identifier token
     * - [3] → numeric token
     * - ['key'] / ["key"] → string token (unescape)
     * - Validation: position matching, bracket pairing
     */
    constructor(sPath?: string | Array<string | number | null>);
    /**
     * Factory: creates a JSONPath instance from JSONPath or string input.
     * If already JSONPath, returns it as-is (no copy).
     */
    static from(v: string | JSONPath | Array<string | number>): JSONPath;
    /**
     * A path-t egyedi string kulcská alakítja null-byte delimiterrel.
     * Használja a map-based watcher indexelésben.
     */
    asKey(): string;
    /**
     * Converts the token array back to string path format.
     * - number → [index]
     * - simple identifier → .prop
     * - special characters → ['quoted']
     */
    asPath(): string;
    /**
     * Navigates along tokens on the target object/array.
     * Returns undefined if any intermediate is undefined/null/non-object.
     */
    selectFrom(target: Object): any;
    matches(aPath: JSONPath): boolean;
    /**
     * Wildcard-supported path traversal: at null (*) tokens,
     * collects all values of the current object/array, and if there
     * are further tokens, recurses through each child.
     *
     * Examples:
     * - '.a.*' → { a: { x: 1, y: 2 } } → [1, 2]
     * - '.a.*.name' → { a: [{ name: 'first' }, { name: 'second' }] } → ['first', 'second']
     * - '.*' → { a: 1, b: 2 } → [1, 2]
     *
     * Returns: array of all matched values (empty if none).
     */
    selectAllFrom(target: Object): any[];
}
/**
 * Reads a value from object/array by path.
 *
 * Path can be string or JSONPath. Returns undefined if any
 * intermediate level is missing or not object/array.
 */
declare function getByPath(target: any, path: string | JSONPath): any;
/**
 * Writes a value into object/array by path.
 *
 * Automatically creates missing intermediate levels:
 * - numeric next token → []
 * - string next token → {}
 *
 * Path must not be empty.
 *
 * Autoconvert will aoutomatically convert the value to the target field's type.
 */
declare function setByPath(target: any, path: string | JSONPath, value: any, autoConvert: boolean): any;
/**
 * Diff operation types:
 * - 'val': value changed
 * - 'set': new property set
 * - 'rem': property removed
 * - 'ins': array insert
 * - 'del': array delete
 */
type DiffKind = 'val' | 'set' | 'rem' | 'ins' | 'del';
/**
 * Diff entry: [path, type, key, value, removedValue?]
 *
 * - path: the modified location
 * - type: the operation type
 * - key: property name or array index
 * - value: the new value (array for ins/del)
 * - removedValue: the removed value (optional for del)
 */
type DiffEntry = [
    path: JSONPath,
    type: DiffKind,
    key: string | number | undefined,
    value: any,
    removedValue?: any
];
/**
 * applyDiffs result: the modified target and inverseDiffs.
 * inverseDiffs reverses the modifications.
 */
type ApplyDiffsResult = {
    target: any;
    inverseDiffs: DiffEntry[];
};
/**
 * Computes deep difference between two objects/arrays.
 *
 * Returns a list of diffEntries that, when applied,
 * transform object 'a' into object 'b'.
 *
 * Algorithm:
 * - Primitives: 'val' diff
 * - Objects: key comparison (rem/set)
 * - Arrays: Longest Common Subsequence (LCS) based
 *   - prefix/suffix matching
 *   - middle section: ins/del operations
 *   - equalPairs memoization for recursion optimization
 * - Cycle detection: localVisited Set to detect circular references
 *
 * Function values inside the second parameter ('b') are treated as
 * computed values: they are invoked with the whole 'b' object and the
 * current path string, and the returned value is used for comparison.
 *
 * The typeOf helper distinguishes undefined from null
 * and array from object.
 */
declare const diffDeep: (a: any, b: any) => DiffEntry[];
/**
 * Deep merge: recursively writes source object contents into target.
 *
 * - Objects merge recursively (key-to-key)
 * - Other types overwrite the target
 * - Arrays overwrite index-by-index (target length does not shrink)
 *
 * Target is modified and also returned.
 */
declare const mergeDeep: (target: any, ...sources: any[]) => any;
/**
 * Deep merge that also removes excess elements from target.
 *
 * Difference from mergeDeep:
 * - Array lengths are set to match source
 * - Keys in target that are not in source are deleted
 */
declare const forceDeep: (target: any, ...sources: any[]) => any;
/**
 * Recursively removes all empty objects and arrays.
 *
 * Returns: true if the object becomes empty after the operation.
 * Deletion proceeds backwards (longer indices first) so that
 * delete operations do not shift yet-to-be-processed indices.
 */
declare function cleanDeep(o: any): boolean;
/**
 * Renames keys at every level of an object/array tree.
 *
 * The fKeyMapper callback receives the [key, mappedValue] pair and can return:
 * - [newKey, newValue] → included in result
 * - null/undefined/false → element skipped
 */
declare function mapDeep(source: any, fKeyMapper: (entry: [string, any]) => [string, any] | null | undefined | false): any;
/**
 * Deep equality comparison between two objects/arrays.
 *
 * - Primitives: === comparison
 * - Objects: keys sorted, recursive equality
 * - Arrays: length + element-wise equality
 * - Cycle detection: osVisited Set to detect circular references
 *   (same object reference)
 */
declare function equalDeep(a: any, b: any, osVisited?: Set<any>): boolean;
/**
 * Finds reference redundancies in an object/array tree.
 *
 * Detects structures containing the same object multiple times
 * (e.g., { a: shared, b: shared } where shared is an object).
 *
 * Algorithm:
 * - WeakMap: object → first occurrence path
 * - WeakSet: current traversal stack (cycle detection)
 * - DFS traversal, for each object:
 *   - if already seen → redundancy
 *   - if on stack → cycle (skip)
 *   - otherwise → mark as seen, traverse children
 */
declare function findReferenceRedundancies(target: any): {
    firstPath: JSONPath;
    duplicatePath: JSONPath;
}[];
/**
 * Checks if the object/array contains redundant
 * object references. If so, throws TypeError.
 *
 * Usage: data validation in dasy constructor
 * to prevent infinite loops in diff.
 */
declare function assertNoReferenceRedundancies(target: any, sLabel?: string): void;
/**
 * Applies diff entries to a target object/array.
 *
 * Applies diffs in sequence and collects inverseDiffs via unshift
 * (in reverse order so undo runs correctly).
 *
 * Operations:
 * - 'val' (key undefined): full target replacement
 * - 'val' (key defined): property value modification
 * - 'set': create new property / overwrite existing
 * - 'rem': delete property
 * - 'ins': array insert via splice
 * - 'del': array delete via splice
 *
 * inverseDiffs contains the original value for each operation
 * so it can be reversed.
 */
declare function applyDiffs(target: any, aDiffs: DiffEntry[]): ApplyDiffsResult;
/**
 * JSONUndoBuffer — undo/redo buffer for objects/arrays.
 *
 * Records target state changes via diffs and can reverse or
 * reapply modifications using inverseDiffs.
 *
 * Operations:
 * - snapshot(): record new state (diff between previous snapshot vs current)
 * - undo(): revert (apply inverseDiffs)
 * - redo(): reapply (apply forward diffs)
 * - clear(): clear undo/redo stacks, update current snapshot
 *
 * snapshot() automatically detects if there is no change
 * and returns false (except when bForced=true).
 */
declare class JSONUndoBuffer {
    #private;
    /**
     * Constructor: validates target and initializes
     * with snapshot (current state of target).
     */
    constructor(target: object | any[]);
    /**
     * The monitored target object/array.
     */
    get target(): object | any[];
    /**
     * Returns whether there is an undo step.
     */
    get canUndo(): boolean;
    /**
     * Returns whether there is a redo step.
     */
    get canRedo(): boolean;
    /**
     * The depth of the undo stack (number of steps that can still be undone).
     */
    get undoDepth(): number;
    /**
     * The depth of the redo stack (number of steps that can still be redone).
     */
    get redoDepth(): number;
    /**
     * Records a new snapshot.
     *
     * 1. Compute diff between target and snapshot.
     * 2. If no change and not forced → return false.
     * 3. Otherwise: push cloneDiffs'd diff onto undoStack,
     *    clear redoStack (new modification → redo invalid),
     *    update snapshot.
     *
     * Returns: true if new snapshot was created, false otherwise.
     */
    snapshot(bForced?: boolean): boolean;
    /**
     * Undo: revert to previous state.
     *
     * 1. Pop from undoStack.
     * 2. applyDiffs with cloneDiffs'd diff (gets inverseDiffs).
     * 3. target = modified target.
     * 4. inverseDiffs → redoStack (with cloneDiffs).
     * 5. snapshot = structuredClone(target).
     *
     * Returns: true if successful, false if undoStack is empty.
     */
    undo(): boolean;
    /**
     * Redo: reapply to next state.
     *
     * 1. Pop from redoStack.
     * 2. applyDiffs with cloneDiffs'd diff (gets inverseDiffs).
     * 3. target = modified target.
     * 4. inverseDiffs → undoStack (with cloneDiffs).
     * 5. snapshot = structuredClone(target).
     *
     * Returns: true if successful, false if redoStack is empty.
     */
    redo(): boolean;
    /**
     * Clears undo/redo stacks, updates snapshot with current target.
     */
    clear(): void;
}
type HTMLAttributeValue = string | number | boolean | null | undefined;
type TemplateParams = Pick<AddEventListenerOptions, 'signal'> & Record<string, unknown>;
type HTMLTemplateFunction = (chunks: TemplateStringsArray, ...values: unknown[]) => DocumentFragment;
declare function html(params: TemplateParams): HTMLTemplateFunction;
declare function html(chunks: TemplateStringsArray, ...values: unknown[]): DocumentFragment;
declare function svg(params: TemplateParams): HTMLTemplateFunction;
declare function svg(chunks: TemplateStringsArray, ...values: unknown[]): DocumentFragment;
type DasyPathArgument = JSONPath | string;
type DasyWatcherKind = 'each' | 'use' | 'inspect' | 'item';
type DasyTemplateResult = Node | HTMLAttributeValue;
type DasyTemplateContext = {
    each(path: DasyPathArgument, template: DasyTemplateFunction, emptyTemplate?: DasyTemplateFunction): (parent: Element, params: TemplateParams) => DocumentFragment;
    use(path: DasyPathArgument, template: DasyTemplateFunction): (parent: Element | Attr, params: TemplateParams) => DasyTemplateResult;
    inspect(path: DasyPathArgument, template: DasyTemplateFunction): (parent: Element | Attr, params: TemplateParams) => DasyTemplateResult;
    set(path: DasyPathArgument | unknown, value?: unknown): void;
    html(chunks: TemplateStringsArray, ...values: unknown[]): DocumentFragment;
    svg(chunks: TemplateStringsArray, ...values: unknown[]): DocumentFragment;
    refresh(): void;
};
type DasyTemplateFunction = (data: unknown, root: DasyTemplateContext, parent: Element | Attr, path: string) => DasyTemplateResult;
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
};
/**
 * Shared data source for multiple Dasy instances.
 *
 * Owns the data model, its backup, and the diff computation.
 * Dasy instances subscribe with an optional JSONPath filter; on refresh()
 * the source computes one diff for the whole data, then forwards
 * the relevant full-data diff entries to each subscriber.
 */
declare class DasyDataSource {
    #private;
    constructor(data: object);
    get data(): object;
    /**
        * Registers a Dasy subscriber with an optional JSONPath filter.
     * Returns an unsubscribe function.
     */
    subscribe(dasy: Dasy, path: JSONPath | undefined, beforeRefresh?: (data: object) => void): () => void;
    /**
     * Recomputes the diff for the whole shared data, notifies every
        * subscriber's beforeRefresh, then forwards filtered full-data diffs.
     * The backup is updated after the subscribers have been notified.
     */
    refresh(): void;
}
/**
 * This is a data binding observer.
 * Holds the path, the parent DOM element/attr, the template function,
 * and the inner watcher tree structure (each/use directives).
 */
declare class DasyWatcher {
    dasy: Dasy | undefined;
    path: JSONPath | undefined;
    parent: Element | Attr | undefined;
    attributeOwner: Element | undefined;
    startNode: Text | undefined;
    endNode: Text | undefined;
    template: DasyTemplateFunction | undefined;
    ownerParent: DasyWatcher | undefined;
    templateAPI: DasyTemplateContext | undefined;
    kind: DasyWatcherKind;
    children: DasyWatcher[] | undefined;
    timedAttributes: Array<{
        attr: Attr;
        ownerElement: Element;
    }> | undefined;
    emptyTemplate: DasyTemplateFunction | undefined;
    controller: AbortController;
    constructor(oParams: DasyWatcherParams);
    /**
     * Creates another watcher within the same Dasy instance.
     * This keeps watcher construction consistent across each/use/rebuild paths.
     */
    createWatcher(oParams: Omit<DasyWatcherParams, 'dasy'>): DasyWatcher;
    ownWatcher(oParams: Omit<DasyWatcherParams, 'dasy' | 'ownerParent'>): DasyWatcher;
    parentWatcherFrom(params: TemplateParams): DasyWatcher;
    registerTimedAttribute(attr: Attr, ownerElement: Element): void;
    reapplyTimedAttributes(): void;
    /**
     * If parent is Attr, calls renderAttribute, otherwise
     * calls renderTemplate with wrapFragment (startNode/endNode sentinels).
     */
    render(data: unknown): DocumentFragment | HTMLAttributeValue;
    /**
     * For attribute binding: renders the template with the value.
     */
    renderAttribute(data: unknown): HTMLAttributeValue;
    get templateParams(): TemplateParams;
    /**
     * Creates sentinel text nodes (startNode, endNode) for
     * clearing and re-rendering content based on diff.
     */
    wrapFragment(oContentFragment: Node): DocumentFragment;
    /**
     * Removes DOM nodes between startNode and endNode
     * (the previous dynamic content) before re-rendering.
     */
    clearContentDOMNodes(): void;
    /**
     * Resolves a relative path based on the watcher's own base path.
     * If JSONPath or empty string/undefined, returns the base path.
     * Otherwise appends the given path to the base path.
     */
    resolvePath(path?: DasyPathArgument): JSONPath;
    /**
     * Renders the `for` directive:
     * 1. Resolves the full path, fetches the data (must be an array).
     * 2. Creates a baseWatcher and a wrapped fragment.
     * 3. For each array item, creates a new watcher, renders it,
     *    and inserts it into the fragment between startNode/endNode sentinels.
     * 4. Registers the baseWatcher and inner watchers in the dasy.
     */
    renderEach(path: DasyPathArgument | DasyTemplateFunction, template: DasyTemplateFunction | undefined, emptyTemplate: DasyTemplateFunction | undefined, parent: Element, params: TemplateParams): DocumentFragment;
    renderScoped(path: DasyPathArgument, template: DasyTemplateFunction, parent: Element | Attr, params: TemplateParams, kind: 'use' | 'inspect'): DasyTemplateResult;
    /**
     * Renders the `use` directive:
     * 1. Resolves the full path, fetches the data (must be an object).
     * 2. Creates a new watcher with the full path.
     * 3. Renders the template with the data, and registers the watcher.
     */
    renderUse(path: DasyPathArgument, template: DasyTemplateFunction, parent: Element | Attr, params: TemplateParams): DasyTemplateResult;
    /**
     * Renders the `inspect` directive. Unlike `use`, it also rerenders when
     * any descendant path below the watched subtree changes.
     */
    renderInspect(path: DasyPathArgument, template: DasyTemplateFunction, parent: Element | Attr, params: TemplateParams): DasyTemplateResult;
    /**
     * Sets a value in the data model at the given path.
     * If value is undefined, then value=path, path=''.
     * If value is Event, uses target.value.
     * Then triggers the dasy refresh.
     */
    set: (path: DasyPathArgument, value?: unknown) => void;
    /**
     * Calls the dasy instance refresh method.
     */
    refresh: () => void;
    /**
     * Removes all owned child watchers via dasy removeWatcher.
     */
    clearChildren(): void;
    /**
     * Full cleanup: removes DOM nodes, clears owned child watchers,
     * sets all properties to undefined.
     */
    disconnect(): void;
}
type DasyRootParams = {
    data?: object;
    dataSource?: DasyDataSource;
    dataPath?: DasyPathArgument;
    container: HTMLElement;
    beforeRefresh?: (data: object) => void;
    afterRefresh?: (data: object) => void;
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
declare class Dasy {
    #private;
    /**
     * Constructor: validates the data (no redundant references),
     * creates a backup when needed, creates the rootWatcher, and renders
     * the initial DOM tree into the container.
     */
    constructor(oParams: DasyRootParams, template: DasyTemplateFunction);
    get data(): object;
    get container(): HTMLElement;
    /**
     * The shared data source when the dasy was created in data-source mode.
     */
    get dataSource(): DasyDataSource | undefined;
    throwNestedRenderFunction: (position: unknown) => never;
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
    renderTemplate(template: DasyTemplateFunction, data: unknown, oWatcher: DasyWatcher, parent: Element | Attr): Node;
    /**
     * Renders template for an attribute value.
     *
     * Same flow as renderTemplate, but:
     * - Only allows string/number/boolean/null/undefined values.
     * - Returns HTMLAttributeValue, not Node.
     */
    renderTemplateValue(template: DasyTemplateFunction, data: unknown, oWatcher: DasyWatcher, parent: Attr): HTMLAttributeValue;
    /**
     * Registers a watcher in the path-based index map.
     * The key is path.asKey() (with null-byte delimiter), the value is a Set<DasyWatcher>.
     */
    addWatcher(oNewWatcher: DasyWatcher): void;
    /**
     * Removes a watcher from the system.
     *
     * 1. Removes from the map (#removeWatcherFromMap).
     * 2. Removes from the ownerParent children list.
     * 3. Calls the watcher disconnect (DOM + property cleanup).
     */
    removeWatcher(oWatcher: DasyWatcher): void;
    applyAttributeBindingValue(oAttr: Attr, vValue: unknown, ownerElement?: Element | undefined): void;
    /**
    * Entry point used by DasyDataSource to deliver filtered full-data diffs.
     */
    receiveDiffs(aDiffs: DiffEntry[]): void;
    /**
     * Top-level update method.
     *
     * 1. Validates the data (no redundant references).
     * 2. Generates diff between backup and data (diffDeep).
     * 3. Applies diffs and DOM synchronization (#applyDiffsAndSync).
     */
    refresh(): void;
    /**
     * Full disconnect: rootWatcher disconnect, map/data/backup cleanup.
     */
    disconnect(): void;
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
    dump(): any;
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
declare function dasy(oParams: DasyRootParams, fTemplate: DasyTemplateFunction): Dasy;
export { html, svg, dasy, DasyDataSource, JSONUndoBuffer };
