import {
    checkCollection,
    checkIndex,
    checkPageNumber,
    checkFn,
} from "../utils/checks.js";
import { env } from "../utils/env.js";
import { Wrap } from "../utils/errors.js";
import { forjsonl } from "../utils/fs.js";
import { hasIndexUpdates, iterateLogicalIndex } from "./indexUpdates.js";
import { collectionResource, indexResource, withResources } from "./resourceLocks.js";

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
        return await withResources([
            collectionResource(collection),
            indexResource(collection, index),
        ], "searchIndex", async () => {
        let results = [];
        let hits = 0;
        let size = env("PAGESIZE");
        let from = size * pageNumber;
        if (pageNumber === Infinity) {
            from = 0;
            size = Infinity;
        }
        const collect = (obj) => {
                if (fn(obj) === true) {
                    hits++;
                    if (hits >= from) {
                        results.push(obj);
                    }
                }
            };
        if (hasIndexUpdates(index, collection)) {
            for await (const obj of iterateLogicalIndex(index, collection)) {
                collect(obj);
                if (results.length >= size) break;
            }
        } else {
            await forjsonl(
                collect,
                () => results.length >= size,
                collection,
                `${index}.jsonl`,
            );
        }
        return results;
        });
    } catch (e) {
        throw Wrap("Cannot run searchIndex", e);
    }
}
