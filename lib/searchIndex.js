import {
    checkCollection,
    checkIndex,
    checkPageNumber,
    checkFn,
} from "../utils/checks.js";
import { env } from "../utils/env.js";
import { Wrap } from "../utils/errors.js";
import { forjsonl } from "../utils/fs.js";

export async function searchIndex(index, collection, fn, pageNumber = 0) {
    let indexError = checkIndex(index);
    if (indexError instanceof Error)
        throw Wrap("Cannot start searchIndex", indexError);
    let collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start searchIndex", collectionError);
    let fnError = checkFn(fn);
    if (fnError instanceof Error)
        throw Wrap("Cannot start searchIndex", fnError);
    let pageNumberError = checkPageNumber(pageNumber);
    if (pageNumberError instanceof Error)
        throw Wrap("Cannot start searchIndex", pageNumberError);

    try {
        let results = [];
        let hits = 0;
        let size = env("PAGESIZE");
        let from = size * pageNumber;
        if (pageNumber === Infinity) {
            from = 0;
            size = Infinity;
        }
        await forjsonl(
            (obj) => {
                if (fn(obj) === true) {
                    hits++;
                    if (hits >= from) {
                        results.push(obj);
                    }
                }
            },
            () => results.length >= size,
            collection,
            `${index}.jsonl`,
        );
        return results;
    } catch (e) {
        throw Wrap("Cannot run searchIndex", e);
    }
}
